import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * The pipeline proof's real half: a fixed audit script driven over the REAL
 * `whipple3 serve` backend and per-agent `mcp --board` proxies (serve.e2e pattern) —
 * no LLM anywhere. Deterministic by construction: one backend serializes appends, the
 * script is sequential, and the only timing is a ttl expiry the script waits out.
 */
const CLI = fileURLToPath(new URL("../../../packages/cli/dist/main.js", import.meta.url));

const replySchema = z.looseObject({
  id: z.number().optional(),
  result: z
    .looseObject({
      content: z.array(z.looseObject({ text: z.string() })).optional(),
    })
    .optional(),
});

const resultSchema = z.looseObject({
  ok: z.boolean(),
  error: z.looseObject({ code: z.string(), holder: z.string().optional() }).optional(),
});
type ToolResult = z.output<typeof resultSchema>;

const must = (cond: boolean, step: string): void => {
  if (!cond) throw new Error(`audit scenario broke its script at: ${step}`);
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const spawnCli = (cwd: string, children: ChildProcessWithoutNullStreams[], argv: string[]) => {
  const child = spawn("node", [CLI, ...argv], { cwd });
  children.push(child);
  return child;
};

const waitForStdout = async (child: ChildProcessWithoutNullStreams, text: string) => {
  let seen = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${text}"`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      seen += chunk.toString("utf8");
      if (seen.includes(text)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
};

const rpcClient = (child: ChildProcessWithoutNullStreams) => {
  const pending = new Map<number, (reply: z.output<typeof replySchema>) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let cut = buffer.indexOf("\n"); cut >= 0; cut = buffer.indexOf("\n")) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line === "") continue;
      const reply = replySchema.safeParse(JSON.parse(line));
      if (reply.success && reply.data.id !== undefined) pending.get(reply.data.id)?.(reply.data);
    }
  });

  let nextId = 0;
  const request = (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    return new Promise<z.output<typeof replySchema>>((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 10_000);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  return { request };
};

const connectAgent = async (
  cwd: string,
  children: ChildProcessWithoutNullStreams[],
  agent: string,
) => {
  const child = spawnCli(cwd, children, [
    "mcp",
    "--board",
    ".whipple3/board.sock",
    "--agent",
    agent,
  ]);
  const rpc = rpcClient(child);
  await rpc.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bench", version: "0.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return async (tool: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const reply = await rpc.request("tools/call", { name: tool, arguments: args });
    const text = reply.result?.content?.[0]?.text;
    must(text !== undefined, `${tool} answered with content`);
    return resultSchema.parse(JSON.parse(text ?? "{}"));
  };
};

type Call = Awaited<ReturnType<typeof connectAgent>>;

const post = (agent: Call, mutation: Record<string, unknown>) =>
  agent("blackboard_post", { mutation });

const addNode = (id: string, label: string, props: Record<string, unknown>) => ({
  kind: "ADD_NODE",
  id,
  label,
  props,
});

const updateNode = (id: string, expectedVersion: number, props: Record<string, unknown>) => ({
  kind: "UPDATE_NODE",
  id,
  expectedVersion,
  props,
});

/** The fixed script. Every reply is checked — a drifting backend fails loudly. */
const driveScript = async (scanner: Call, a1: Call, a2: Call, a3: Call): Promise<void> => {
  for (const f of ["f1", "f2", "f3"])
    must((await post(scanner, addNode(f, "CodeFile", { path: `src/${f}.ts` }))).ok, `post ${f}`);

  must((await a1("blackboard_claim", { id: "f1" })).ok, "auditor-1 claims f1");
  must((await a2("blackboard_claim", { id: "f2" })).ok, "auditor-2 claims f2");
  must((await a3("blackboard_claim", { id: "f3", ttlMs: 50 })).ok, "auditor-3 claims f3");

  // Contested ATTEMPT: correctly blocked, and — by design — absent from the log.
  const blocked = await a2("blackboard_claim", { id: "f1" });
  must(!blocked.ok && blocked.error?.code === "ALREADY_CLAIMED", "f1 counter-claim blocked");
  must(blocked.error?.holder === "auditor-1", "blocked claim names the true holder");

  must((await post(a3, updateNode("f3", 1, { status: "audited" }))).ok, "auditor-3 audits f3");
  await wait(120); // auditor-3 abandons; its 50ms lease expires

  must((await a2("blackboard_claim", { id: "f3" })).ok, "auditor-2 re-claims expired f3");
  must((await post(a2, updateNode("f3", 2, { status: "audited" }))).ok, "auditor-2 REDOES f3");

  must((await post(a1, updateNode("f1", 1, { status: "audited" }))).ok, "auditor-1 audits f1");
  must((await post(a1, addNode("i1", "SecurityIssue", { file: "src/f1.ts" }))).ok, "issue i1");
  must((await a1("blackboard_release", { id: "f1" })).ok, "auditor-1 releases f1");

  must((await post(a2, updateNode("f2", 1, { status: "audited" }))).ok, "auditor-2 audits f2");
  must((await post(a2, addNode("i2", "SecurityIssue", { file: "src/f2.ts" }))).ok, "issue i2");
};

/** Runs the scenario in `cwd`; resolves to the board's ndjson log path. */
export const runAuditScenario = async (cwd: string): Promise<string> => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const serve = spawnCli(cwd, children, ["serve"]);
  try {
    await waitForStdout(serve, "listening");
    const [scanner, a1, a2, a3] = await Promise.all([
      connectAgent(cwd, children, "scanner"),
      connectAgent(cwd, children, "auditor-1"),
      connectAgent(cwd, children, "auditor-2"),
      connectAgent(cwd, children, "auditor-3"),
    ]);
    await driveScript(scanner, a1, a2, a3);
  } finally {
    for (const c of children) c.kill("SIGKILL");
  }
  const dir = join(cwd, ".whipple3");
  const log = readdirSync(dir).find((f) => f.endsWith(".ndjson"));
  must(log !== undefined, "backend wrote a session log");
  return join(dir, log ?? "");
};

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
});

const spawnCli = (cwd: string, ...argv: string[]) => {
  const child = spawn("node", [bin, ...argv], { cwd });
  children.push(child);
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  return { child, stdout: () => stdout };
};

const waitFor = async (probe: () => boolean, what: string, ms = 5000): Promise<void> => {
  const start = Date.now();
  while (!probe()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const exited = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolve) => child.once("exit", (code) => resolve(code)));

// Test edge: we trust the server's JSON-RPC framing and probe the fields we assert on.
interface RpcReply {
  readonly id?: number;
  readonly result?: {
    readonly serverInfo?: { readonly name: string };
    readonly content?: readonly { readonly text: string }[];
  };
}

const rpcClient = (child: ChildProcessWithoutNullStreams) => {
  const pending = new Map<number, (reply: RpcReply) => void>();
  child.on("exit", (code) => {
    for (const resolve of pending.values())
      resolve({ result: { serverInfo: { name: `proxy exited early (code ${String(code)})` } } });
  });
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let cut = buffer.indexOf("\n");
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line !== "") {
        const reply = JSON.parse(line) as RpcReply;
        if (reply.id !== undefined) pending.get(reply.id)?.(reply);
      }
      cut = buffer.indexOf("\n");
    }
  });

  let nextId = 0;
  const send = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method: string, params: Record<string, unknown>): Promise<RpcReply> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
      send({ jsonrpc: "2.0", id, method, params });
    });
  };
  return {
    request,
    initialize: async () => {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
    call: async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const reply = await request("tools/call", { name, arguments: args });
      const text = reply.result?.content?.[0]?.text;
      if (text === undefined)
        throw new Error(`tool ${name} answered without content: ${JSON.stringify(reply)}`);
      return JSON.parse(text);
    },
  };
};

describe("whipple3 serve — the board backend owns one session on one socket", () => {
  it("announces the socket, serves it, and SIGTERM unlinks it with a clean exit", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    const cwd = mkdtempSync(join(tmpdir(), "w3srv-"));
    const serve = spawnCli(cwd, "serve");
    await waitFor(() => serve.stdout().includes("listening"), "serve to announce its socket");

    const socketPath = join(cwd, ".whipple3", "board.sock");
    expect(existsSync(socketPath)).toBe(true);

    serve.child.kill("SIGTERM");
    expect(await exited(serve.child)).toBe(0);
    expect(existsSync(socketPath)).toBe(false);
  });

  it("two mcp --board proxies share ONE board with per-socket identity (D1, cross-process)", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    const cwd = mkdtempSync(join(tmpdir(), "w3srv-"));
    const serve = spawnCli(cwd, "serve");
    await waitFor(() => serve.stdout().includes("listening"), "serve to announce its socket");

    const proxyArgs = ["mcp", "--board", ".whipple3/board.sock", "--agent"];
    const a1 = rpcClient(spawnCli(cwd, ...proxyArgs, "auditor-1").child);
    const a2 = rpcClient(spawnCli(cwd, ...proxyArgs, "auditor-2").child);
    await a1.initialize();
    await a2.initialize();

    const posted = await a1.call("blackboard_post", {
      mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
    });
    expect(posted).toMatchObject({ ok: true, value: { version: 1 } });

    // auditor-2 claims the node auditor-1 posted — cross-process shared state.
    expect(await a2.call("blackboard_claim", { id: "f1" })).toMatchObject({ ok: true });

    // auditor-1's counter-claim names the TRUE holder, across processes.
    expect(await a1.call("blackboard_claim", { id: "f1" })).toMatchObject({
      ok: false,
      error: { code: "ALREADY_CLAIMED", holder: "auditor-2" },
    });

    // status crosses the socket too (the one op that had to turn async).
    expect(await a1.call("blackboard_status", {})).toMatchObject({
      ok: true,
      value: { nodes: 1, activeClaims: 1 },
    });

    // ONE log, written by the backend only — the proxies own no session and no file.
    const ndjson = readdirSync(join(cwd, ".whipple3")).filter((f) => f.endsWith(".ndjson"));
    expect(ndjson).toHaveLength(1);
    const events = readFileSync(join(cwd, ".whipple3", ndjson[0] ?? ""), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { meta: { agentId: string }; event: { type: string } })
      .map((r) => ({ agent: r.meta.agentId, type: r.event.type }));
    expect(events).toEqual([
      { agent: "auditor-1", type: "graph.mutation" },
      { agent: "auditor-2", type: "graph.mutation" },
      { agent: "auditor-2", type: "claim.acquired" },
    ]);
  });

  it("--policy makes checkAcl real over the wire; distill reports the denial", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    const cwd = mkdtempSync(join(tmpdir(), "w3srv-"));
    writeFileSync(
      join(cwd, "policy.json"),
      JSON.stringify({ acl: { scanner: { write: ["CodeFile"], read: ["CodeFile"] } } }),
    );
    const serve = spawnCli(cwd, "serve", "--policy", "policy.json");
    await waitFor(() => serve.stdout().includes("listening"), "serve to announce its socket");

    const scanner = rpcClient(
      spawnCli(cwd, "mcp", "--board", ".whipple3/board.sock", "--agent", "scanner").child,
    );
    await scanner.initialize();

    expect(
      await scanner.call("blackboard_post", {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: {} },
      }),
    ).toMatchObject({ ok: true });

    expect(
      await scanner.call("blackboard_post", {
        mutation: { kind: "ADD_NODE", id: "x1", label: "Exfil", props: {} },
      }),
    ).toMatchObject({ ok: false, error: { code: "ACL_DENIED_WRITE", label: "Exfil" } });

    const dir = join(cwd, ".whipple3");
    const ndjson = readdirSync(dir).find((f) => f.endsWith(".ndjson"));
    if (ndjson === undefined) throw new Error("no session log written");
    const types = readFileSync(join(dir, ndjson), "utf8")
      .trim()
      .split("\n")
      .map((l) => (JSON.parse(l) as { event: { type: string } }).event.type);
    expect(types).toEqual(["graph.mutation", "acl.denied"]);

    const distill = spawnCli(cwd, "distill", join(".whipple3", ndjson));
    expect(await exited(distill.child)).toBe(0);
    const report = readFileSync(join(dir, ndjson.replace(/\.ndjson$/, ".report.md")), "utf8");
    expect(report).toContain("| scanner | 1 | 0 | 0 | 0 | 0 | 1 |");
  });
});

import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Tarball truth (W3-B): pack the cli with `pnpm pack` — the tool that rewrites
 * `workspace:*` and applies publishConfig, i.e. what an actual publish ships —
 * then npm-install the tarball into a bare directory and drive the installed bin
 * through a real MCP handshake plus a serve/proxy round-trip. No publish involved,
 * so this runs in CI. Needs `pnpm build` first (same rule as the other e2e files)
 * and registry access for the cli's two runtime deps (sdk + citty).
 */

const cliDir = fileURLToPath(new URL("..", import.meta.url));

interface Packed {
  readonly tarball: string;
  readonly entries: readonly string[];
  readonly manifest: {
    readonly bin?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly exports?: unknown;
  };
}

let packedOnce: Packed | undefined;
const packed = (): Packed => {
  if (packedOnce !== undefined) return packedOnce;
  if (!existsSync(join(cliDir, "dist", "main.js")))
    throw new Error("dist/main.js missing — run `pnpm build` first");
  const dest = mkdtempSync(join(tmpdir(), "w3pack-"));
  execFileSync("pnpm", ["pack", "--pack-destination", dest], { cwd: cliDir });
  const name = readdirSync(dest).find((f) => f.endsWith(".tgz"));
  if (name === undefined) throw new Error("pnpm pack produced no tarball");
  const tarball = join(dest, name);
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  execFileSync("tar", ["-xzf", tarball, "-C", dest]);
  const manifest = JSON.parse(
    readFileSync(join(dest, "package", "package.json"), "utf8"),
  ) as Packed["manifest"];
  packedOnce = { tarball, entries, manifest };
  return packedOnce;
};

let installedOnce: string | undefined;
/** npm-installs the packed tarball into a bare dir; returns the bin shim path. */
const installedBin = (): string => {
  if (installedOnce !== undefined) return installedOnce;
  const dir = mkdtempSync(join(tmpdir(), "w3install-"));
  execFileSync(
    "npm",
    ["install", packed().tarball, "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: dir },
  );
  installedOnce = join(dir, "node_modules", ".bin", "whipple3");
  return installedOnce;
};

/** Every relative path mentioned in an exports map, however nested. */
const exportPaths = (value: unknown): string[] => {
  if (typeof value === "string") return value.startsWith("./") ? [value] : [];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(exportPaths);
};

const children: ChildProcessWithoutNullStreams[] = [];
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
});

const spawnBin = (cwd: string, ...argv: string[]) => {
  const child = spawn(installedBin(), argv, { cwd });
  children.push(child);
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  return { child, stdout: () => stdout };
};

const waitFor = async (probe: () => boolean, what: string, ms = 10_000): Promise<void> => {
  const start = Date.now();
  while (!probe()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

// Test edge: we trust the server's JSON-RPC framing and probe only asserted fields.
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
      resolve({ result: { serverInfo: { name: `bin exited early (code ${String(code)})` } } });
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
    initialize: async (): Promise<RpcReply> => {
      const reply = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pack-smoke", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return reply;
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

describe("cli tarball — contents", () => {
  it("ships dist + manifest + LICENSE + README and nothing else", { timeout: 60_000 }, () => {
    const { entries } = packed();
    const allowed = /^package\/(dist\/.+|package\.json|LICENSE|README\.md)$/;
    for (const entry of entries) expect(entry).toMatch(allowed);
    expect(entries).toContain("package/dist/main.js");
    expect(entries).toContain("package/LICENSE");
    expect(entries).toContain("package/README.md");
  });

  it("manifest demands only real runtime deps — and none from this workspace", () => {
    const { manifest, entries } = packed();
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "citty",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(manifest.bin).toEqual({ whipple3: "./dist/main.js" });
    // No dangling paths: everything the manifest points at is in the tarball.
    for (const p of exportPaths(manifest.exports))
      expect(entries).toContain(`package/${p.slice(2)}`);
  });
});

describe("cli tarball — installed artifact", () => {
  it("npm-installs into a bare dir and answers the MCP initialize handshake", {
    timeout: 240_000,
  }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "w3run-"));
    const mcp = rpcClient(spawnBin(cwd, "mcp", "--agent", "smoke").child);
    const reply = await mcp.initialize();
    expect(reply.result?.serverInfo?.name).toBe("whipple3");
  });

  it("serve + proxy round-trip: post → claim → status over the socket", {
    timeout: 240_000,
  }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "w3run-"));
    const serve = spawnBin(cwd, "serve");
    await waitFor(() => serve.stdout().includes("listening"), "serve to announce its socket");

    const proxy = rpcClient(
      spawnBin(cwd, "mcp", "--board", ".whipple3/board.sock", "--agent", "smoke-2").child,
    );
    await proxy.initialize();

    expect(
      await proxy.call("blackboard_post", {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      }),
    ).toMatchObject({ ok: true, value: { version: 1 } });
    expect(await proxy.call("blackboard_claim", { id: "f1" })).toMatchObject({ ok: true });
    expect(await proxy.call("blackboard_status", {})).toMatchObject({
      ok: true,
      value: { nodes: 1, activeClaims: 1 },
    });

    // The board's log names the proxy's identity — identity crossed the socket.
    const dir = join(cwd, ".whipple3");
    const ndjson = readdirSync(dir).find((f) => f.endsWith(".ndjson"));
    if (ndjson === undefined) throw new Error("no session log written by serve");
    const agents = readFileSync(join(dir, ndjson), "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { meta: { agentId: string } }).meta.agentId);
    expect(new Set(agents)).toEqual(new Set(["smoke-2"]));
  });
});

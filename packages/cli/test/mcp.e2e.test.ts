import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { rpcClient } from "./rpc.js";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

describe("whipple3 mcp — end-to-end over stdio (CLAUDE.md W1 §4)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "whipple3-e2e-"));
  let child: ChildProcessWithoutNullStreams;
  afterAll(() => child.kill());

  it("serves the blackboard and writes the session NDJSON log", async () => {
    if (!existsSync(bin)) throw new Error("dist/main.js missing — run `pnpm build` first");
    child = spawn("node", [bin, "mcp", "--agent", "scanner"], { cwd });
    const client = rpcClient(child);

    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0.0.0" },
    });
    expect(init.result?.serverInfo?.name).toBe("whipple3");
    client.notify("notifications/initialized");

    const post = await client.request("tools/call", {
      name: "blackboard_post",
      arguments: {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      },
    });
    const text = post.result?.content?.[0]?.text;
    if (text === undefined) throw new Error("tool answered without content");
    expect(JSON.parse(text)).toMatchObject({ ok: true, value: { version: 1 } });

    const logDir = join(cwd, ".whipple3");
    const logFile = readdirSync(logDir).find(
      (f) => f.startsWith("session-") && f.endsWith(".ndjson"),
    );
    if (logFile === undefined) throw new Error(".whipple3/session-*.ndjson not written");
    const lines = readFileSync(join(logDir, logFile), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as {
      meta: { agentId: string; principal: string | null };
      event: { type: string };
    };
    expect(record.event.type).toBe("graph.mutation");
    expect(record.meta.agentId).toBe("scanner");
    expect(record.meta.principal).toBeTruthy();
  });
});

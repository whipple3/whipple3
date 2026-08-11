import { userInfo } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { agentId, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, liveSessionDeps } from "../src/server.js";
import { createSession, type Session } from "../src/session.js";
import { type ToolName, toolDescriptions } from "../src/tools.js";

const makeSession = () => {
  let n = 0;
  const log = createMemoryLog();
  const session = createSession({
    log,
    acl: null,
    sessionId: sessionId("s1"),
    principal: null,
    now: () => 0,
    newTxId: () => txId(`tx${n++}`),
  });
  return { session, log };
};

/** One MCP server per connection: the transport, not the payload, carries identity. */
const connectClient = async (session: Session, agent: string): Promise<Client> => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(session.connect(agentId(agent))).connect(serverTransport);
  const client = new Client({ name: `test-${agent}`, version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
};

const payloadOf = (result: Awaited<ReturnType<Client["callTool"]>>): unknown => {
  const first = (result.content as { type: string; text: string }[])[0];
  if (first === undefined) throw new Error("empty content");
  return JSON.parse(first.text);
};

describe("server — five tools over a real MCP round-trip (CLAUDE.md W1 §2)", () => {
  it("advertises exactly the six blackboard tools, none accepting an agentId", async () => {
    const client = await connectClient(makeSession().session, "scanner");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "blackboard_claim",
      "blackboard_next",
      "blackboard_post",
      "blackboard_read",
      "blackboard_release",
      "blackboard_status",
    ]);
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("agentId");
    }
  });

  it("advertises the shared descriptions — the LLM-facing contract has one source", async () => {
    // Descriptions live in tools.ts beside the schemas so every transport (direct
    // stdio AND the cli's socket proxy) advertises the same text — the read tool
    // once drifted between the two registration sites.
    const client = await connectClient(makeSession().session, "scanner");
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBe(toolDescriptions[tool.name as ToolName]);
    }
  });

  it("post round-trips a Result payload", async () => {
    const client = await connectClient(makeSession().session, "scanner");
    const result = await client.callTool({
      name: "blackboard_post",
      arguments: {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(payloadOf(result)).toMatchObject({ ok: true, value: { version: 1 } });
  });

  it("a spoofed agentId argument is stripped at the wire; the log records the bound agent", async () => {
    const { session, log } = makeSession();
    const client = await connectClient(session, "scanner");
    const result = await client.callTool({
      name: "blackboard_post",
      arguments: {
        agentId: "fixer",
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: {} },
      },
    });
    expect(result.isError).toBeFalsy();
    const records = await log.read();
    expect(records[0]?.meta.agentId).toBe("scanner");
  });

  it("domain rejections surface as structured Result errors with isError, never prose", async () => {
    const { session } = makeSession();
    const scanner = await connectClient(session, "scanner");
    const auditor1 = await connectClient(session, "auditor-1");
    const auditor2 = await connectClient(session, "auditor-2");
    await scanner.callTool({
      name: "blackboard_post",
      arguments: {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: {} },
      },
    });
    await auditor1.callTool({
      name: "blackboard_claim",
      arguments: { id: "f1", ttlMs: 60_000 },
    });
    const conflict = await auditor2.callTool({
      name: "blackboard_claim",
      arguments: { id: "f1", ttlMs: 60_000 },
    });
    expect(conflict.isError).toBe(true);
    expect(payloadOf(conflict)).toMatchObject({
      ok: false,
      error: { code: "ALREADY_CLAIMED", holder: "auditor-1" },
    });
  });

  it("next and status answer through the same pipe", async () => {
    const { session } = makeSession();
    const scanner = await connectClient(session, "scanner");
    await scanner.callTool({
      name: "blackboard_post",
      arguments: {
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      },
    });
    const auditor = await connectClient(session, "auditor-1");
    const next = await auditor.callTool({
      name: "blackboard_next",
      arguments: { label: "CodeFile", match: { status: "pending" } },
    });
    expect(payloadOf(next)).toMatchObject({ ok: true, value: { pending: 1 } });

    const status = await auditor.callTool({ name: "blackboard_status", arguments: {} });
    expect(payloadOf(status)).toMatchObject({ ok: true, value: { nodes: 1 } });
  });
});

describe("liveSessionDeps — principal from the local environment (OSS default)", () => {
  const saved = process.env.WHIPPLE3_PRINCIPAL;
  afterEach(() => {
    if (saved === undefined) delete process.env.WHIPPLE3_PRINCIPAL;
    else process.env.WHIPPLE3_PRINCIPAL = saved;
  });

  it("WHIPPLE3_PRINCIPAL — the external-injection hook — wins over the OS user", () => {
    process.env.WHIPPLE3_PRINCIPAL = "sso:michael@example.com";
    expect(liveSessionDeps().principal).toBe("sso:michael@example.com");
  });

  it("falls back to the OS user when the hook is unset", () => {
    delete process.env.WHIPPLE3_PRINCIPAL;
    expect(liveSessionDeps().principal).toBe(userInfo().username);
  });
});

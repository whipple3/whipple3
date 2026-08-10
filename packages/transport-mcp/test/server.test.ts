import { sessionId, txId } from "@arai/core";
import { createMemoryLog } from "@arai/log";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createSession } from "../src/session.js";

const connected = async () => {
  let n = 0;
  const session = createSession({
    log: createMemoryLog(),
    acl: null,
    sessionId: sessionId("s1"),
    now: () => 0,
    newTxId: () => txId(`tx${n++}`),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(session).connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
};

const payloadOf = (result: Awaited<ReturnType<Client["callTool"]>>): unknown => {
  const first = (result.content as { type: string; text: string }[])[0];
  if (first === undefined) throw new Error("empty content");
  return JSON.parse(first.text);
};

describe("server — five tools over a real MCP round-trip (CLAUDE.md W1 §2)", () => {
  it("advertises exactly the five blackboard tools", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "blackboard_claim",
      "blackboard_next",
      "blackboard_post",
      "blackboard_read",
      "blackboard_status",
    ]);
  });

  it("post round-trips a Result payload", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "blackboard_post",
      arguments: {
        agentId: "scanner",
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(payloadOf(result)).toMatchObject({ ok: true, value: { version: 1 } });
  });

  it("domain rejections surface as structured Result errors with isError, never prose", async () => {
    const client = await connected();
    await client.callTool({
      name: "blackboard_post",
      arguments: {
        agentId: "scanner",
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: {} },
      },
    });
    await client.callTool({
      name: "blackboard_claim",
      arguments: { agentId: "auditor-1", id: "f1", ttlMs: 60_000 },
    });
    const conflict = await client.callTool({
      name: "blackboard_claim",
      arguments: { agentId: "auditor-2", id: "f1", ttlMs: 60_000 },
    });
    expect(conflict.isError).toBe(true);
    expect(payloadOf(conflict)).toMatchObject({
      ok: false,
      error: { code: "ALREADY_CLAIMED", holder: "auditor-1" },
    });
  });

  it("next and status answer through the same pipe", async () => {
    const client = await connected();
    await client.callTool({
      name: "blackboard_post",
      arguments: {
        agentId: "scanner",
        mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
      },
    });
    const next = await client.callTool({
      name: "blackboard_next",
      arguments: { agentId: "auditor-1", label: "CodeFile", match: { status: "pending" } },
    });
    expect(payloadOf(next)).toMatchObject({ ok: true, value: { pending: 1 } });

    const status = await client.callTool({ name: "blackboard_status", arguments: {} });
    expect(payloadOf(status)).toMatchObject({ ok: true, value: { nodes: 1 } });
  });
});

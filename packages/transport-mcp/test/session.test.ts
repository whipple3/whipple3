import { type AclPolicy, nodeId, sessionId, txId } from "@arai/core";
import { createMemoryLog } from "@arai/log";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/session.js";

const makeSession = (acl: AclPolicy | null = null) => {
  let now = 0;
  let n = 0;
  const log = createMemoryLog();
  const session = createSession({
    log,
    acl,
    sessionId: sessionId("s1"),
    now: () => now,
    newTxId: () => txId(`tx${n++}`),
  });
  return { session, log, tick: (ms: number) => (now += ms) };
};

const addFile = (path: string, id = "f1") => ({
  agentId: "scanner",
  mutation: {
    kind: "ADD_NODE",
    id,
    label: "CodeFile",
    props: { path, status: "pending" },
  },
});

describe("session — parse → acl → apply → append (CLAUDE.md W1 §1)", () => {
  it("post ADD_NODE updates state and appends a graph.mutation record with full meta", async () => {
    const { session, log } = makeSession();
    const r = await session.post(addFile("a.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.version).toBe(1);

    expect(session.snapshot().nodes.get(nodeId("f1"))?.props).toEqual({
      path: "a.ts",
      status: "pending",
    });
    const records = await log.read();
    expect(records).toHaveLength(1);
    expect(records[0]?.event.type).toBe("graph.mutation");
    expect(records[0]?.meta).toMatchObject({ sessionId: "s1", agentId: "scanner", ts: 0 });
  });

  it("malformed input is a PARSE_ERROR value and appends nothing", async () => {
    const { session, log } = makeSession();
    const r = await session.post({ agentId: "scanner", mutation: { kind: "EXPLODE" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
    expect(await log.read()).toHaveLength(0);
  });

  it("ACL denies labels outside the agent's allowlist and leaves state and log untouched", async () => {
    const { session, log } = makeSession({ scanner: ["CodeFile"] });
    expect((await session.post(addFile("a.ts"))).ok).toBe(true);
    const denied = await session.post({
      agentId: "scanner",
      mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: {} },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("ACL_DENIED");
    expect(session.snapshot().nodes.size).toBe(1);
    expect(await log.read()).toHaveLength(1);
  });

  it("a stale expectedVersion surfaces VERSION_CONFLICT with the current version", async () => {
    const { session } = makeSession();
    await session.post(addFile("a.ts"));
    await session.post({
      agentId: "auditor",
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { status: "audited" } },
    });
    const stale = await session.post({
      agentId: "auditor",
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { status: "x" } },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.error.code === "VERSION_CONFLICT") {
      expect(stale.error.current).toBe(2);
    } else {
      throw new Error("expected VERSION_CONFLICT");
    }
  });

  it("claim leases a node until ttl expiry; a second agent is rejected meanwhile", async () => {
    const { session, tick } = makeSession();
    await session.post(addFile("a.ts"));
    const c1 = await session.claim({ agentId: "auditor-1", id: "f1", ttlMs: 1000 });
    expect(c1.ok).toBe(true);
    if (c1.ok) expect(c1.value.expiresAt).toBe(1000);

    const c2 = await session.claim({ agentId: "auditor-2", id: "f1", ttlMs: 1000 });
    expect(c2.ok).toBe(false);
    if (!c2.ok) expect(c2.error.code).toBe("ALREADY_CLAIMED");

    tick(1500);
    expect((await session.claim({ agentId: "auditor-2", id: "f1", ttlMs: 1000 })).ok).toBe(true);
  });

  it("next returns unclaimed matching work and a pending count, honoring lease expiry", async () => {
    const { session, tick } = makeSession();
    await session.post(addFile("a.ts", "f1"));
    await session.post(addFile("b.ts", "f2"));

    const first = session.next({
      agentId: "auditor-1",
      label: "CodeFile",
      match: { status: "pending" },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.node?.id).toBe("f1");
      expect(first.value.pending).toBe(2);
    }

    await session.claim({ agentId: "auditor-1", id: "f1", ttlMs: 1000 });
    const second = session.next({
      agentId: "auditor-2",
      label: "CodeFile",
      match: { status: "pending" },
    });
    if (second.ok) expect(second.value.node?.id).toBe("f2");

    tick(2000);
    const again = session.next({
      agentId: "auditor-2",
      label: "CodeFile",
      match: { status: "pending" },
    });
    if (again.ok) expect(again.value.pending).toBe(2);
  });

  it("read returns the bounded neighborhood slice", async () => {
    const { session } = makeSession();
    await session.post(addFile("a.ts", "f1"));
    await session.post({
      agentId: "auditor",
      mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: { severity: "high" } },
    });
    await session.post({
      agentId: "auditor",
      mutation: { kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: "f1", to: "i1" },
    });
    const r = session.read({ agentId: "auditor", root: "f1", depth: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nodes.map((n) => n.id).sort()).toEqual(["f1", "i1"]);
      expect(r.value.edges).toHaveLength(1);
    }
  });

  it("status counts nodes, edges and only unexpired claims", async () => {
    const { session, tick } = makeSession();
    await session.post(addFile("a.ts", "f1"));
    await session.post(addFile("b.ts", "f2"));
    await session.claim({ agentId: "auditor-1", id: "f1", ttlMs: 1000 });
    expect(session.status()).toEqual({
      nodes: 2,
      edges: 0,
      activeClaims: 1,
      byLabel: { CodeFile: 2 },
    });
    tick(2000);
    expect(session.status().activeClaims).toBe(0);
  });
});

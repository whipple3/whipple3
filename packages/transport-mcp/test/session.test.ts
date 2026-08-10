import { type AclPolicy, agentId, nodeId, principal, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { describe, expect, it } from "vitest";
import { createSession, type Session } from "../src/session.js";

const makeSession = (acl: AclPolicy | null = null) => {
  let now = 0;
  let n = 0;
  const log = createMemoryLog();
  const session = createSession({
    log,
    acl,
    sessionId: sessionId("s1"),
    principal: principal("michael"),
    now: () => now,
    newTxId: () => txId(`tx${n++}`),
  });
  const as = (id: string) => session.connect(agentId(id));
  return { session, as, log, tick: (ms: number) => (now += ms) };
};

const fileNode = (path: string, id = "f1") => ({
  mutation: {
    kind: "ADD_NODE",
    id,
    label: "CodeFile",
    props: { path, status: "pending" },
  },
});

const demoAcl: AclPolicy = {
  scanner: { write: ["CodeFile"], read: ["CodeFile"] },
  auditor: {
    write: ["SecurityIssue", "HAS_ISSUE"],
    read: ["CodeFile", "SecurityIssue", "HAS_ISSUE"],
  },
  // The read-side point: reporter may see issues but never the code files behind them.
  reporter: { write: [], read: ["SecurityIssue", "HAS_ISSUE"] },
};

const seedIssueGraph = async (as: (id: string) => ReturnType<Session["connect"]>) => {
  await as("scanner").post(fileNode("a.ts"));
  await as("auditor").post({
    mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: { severity: "high" } },
  });
  await as("auditor").post({
    mutation: { kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: "f1", to: "i1" },
  });
};

describe("board lifetime is a parameter, not an assumption (SPEC §4.8)", () => {
  it("defaults to ephemeral and accepts it explicitly", async () => {
    const { as } = makeSession(); // no lifetime given — ephemeral
    expect((await as("scanner").post(fileNode("a.ts"))).ok).toBe(true);
    const explicit = createSession({
      log: createMemoryLog(),
      acl: null,
      sessionId: sessionId("s2"),
      principal: null,
      lifetime: "ephemeral",
      now: () => 0,
      newTxId: () => txId("t"),
    });
    expect(explicit.connect(agentId("scanner"))).toBeDefined();
  });

  it("'persistent' is accepted by the type but rejected at runtime as not implemented", () => {
    expect(() =>
      createSession({
        log: createMemoryLog(),
        acl: null,
        sessionId: sessionId("s2"),
        principal: null,
        lifetime: "persistent",
        now: () => 0,
        newTxId: () => txId("t"),
      }),
    ).toThrow(/not implemented/);
  });
});

describe("session — parse → acl → apply → append (CLAUDE.md W1 §1)", () => {
  it("post ADD_NODE updates state and appends a graph.mutation record with full meta", async () => {
    const { session, as, log } = makeSession();
    const r = await as("scanner").post(fileNode("a.ts"));
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

  it("the on-behalf-of principal from deps lands in every record's meta", async () => {
    const { as, log } = makeSession();
    await as("scanner").post(fileNode("a.ts"));
    await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    const records = await log.read();
    expect(records).toHaveLength(2);
    for (const r of records) expect(r.meta.principal).toBe("michael");
  });

  it("malformed input is a PARSE_ERROR value and appends nothing", async () => {
    const { as, log } = makeSession();
    const r = await as("scanner").post({ mutation: { kind: "EXPLODE" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_ERROR");
    expect(await log.read()).toHaveLength(0);
  });

  it("identity comes from the connection: a payload-asserted agentId cannot escalate ACL", async () => {
    const { as, log } = makeSession({
      scanner: { write: ["CodeFile"], read: ["CodeFile"] },
      fixer: { write: ["Fix"], read: ["Fix"] },
    });
    const scanner = as("scanner");

    const allowed = await scanner.post({ agentId: "fixer", ...fileNode("a.ts") });
    expect(allowed.ok).toBe(true);
    const records = await log.read();
    expect(records[0]?.meta.agentId).toBe("scanner");

    const escalation = await scanner.post({
      agentId: "fixer",
      mutation: { kind: "ADD_NODE", id: "x1", label: "Fix", props: {} },
    });
    expect(escalation.ok).toBe(false);
    if (!escalation.ok && escalation.error.code === "ACL_DENIED_WRITE") {
      expect(escalation.error.agentId).toBe("scanner");
    } else {
      throw new Error("expected ACL_DENIED_WRITE for the connection's own identity");
    }
  });

  it("a write denial leaves state untouched and appends an acl.denied event", async () => {
    const { session, as, log } = makeSession({
      scanner: { write: ["CodeFile"], read: ["CodeFile"] },
    });
    const scanner = as("scanner");
    expect((await scanner.post(fileNode("a.ts"))).ok).toBe(true);
    const denied = await scanner.post({
      mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: {} },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("ACL_DENIED_WRITE");
    expect(session.snapshot().nodes.size).toBe(1);
    const records = await log.read();
    expect(records).toHaveLength(2);
    expect(records[1]?.event).toEqual({
      type: "acl.denied",
      agentId: "scanner",
      label: "SecurityIssue",
      reason: "write",
    });
  });

  it("a stale expectedVersion surfaces VERSION_CONFLICT with the current version", async () => {
    const { as } = makeSession();
    const auditor = as("auditor");
    await as("scanner").post(fileNode("a.ts"));
    await auditor.post({
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { status: "audited" } },
    });
    const stale = await auditor.post({
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { status: "x" } },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.error.code === "VERSION_CONFLICT") {
      expect(stale.error.current).toBe(2);
    } else {
      throw new Error("expected VERSION_CONFLICT");
    }
  });

  it("claim leases a node to the connection's agent; a second agent is rejected meanwhile", async () => {
    const { as, tick } = makeSession();
    await as("scanner").post(fileNode("a.ts"));
    const c1 = await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    expect(c1.ok).toBe(true);
    if (c1.ok) expect(c1.value.expiresAt).toBe(1000);

    const c2 = await as("auditor-2").claim({ id: "f1", ttlMs: 1000 });
    expect(c2.ok).toBe(false);
    if (!c2.ok && c2.error.code === "ALREADY_CLAIMED") {
      expect(c2.error.holder).toBe("auditor-1");
    } else {
      throw new Error("expected ALREADY_CLAIMED held by auditor-1");
    }

    tick(1500);
    expect((await as("auditor-2").claim({ id: "f1", ttlMs: 1000 })).ok).toBe(true);
  });

  it("next returns unclaimed matching work and a pending count, honoring lease expiry", async () => {
    const { as, tick } = makeSession();
    const scanner = as("scanner");
    await scanner.post(fileNode("a.ts", "f1"));
    await scanner.post(fileNode("b.ts", "f2"));

    const first = await as("auditor-1").next({ label: "CodeFile", match: { status: "pending" } });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.node?.id).toBe("f1");
      expect(first.value.pending).toBe(2);
    }

    await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    const second = await as("auditor-2").next({ label: "CodeFile", match: { status: "pending" } });
    if (second.ok) expect(second.value.node?.id).toBe("f2");

    tick(2000);
    const again = await as("auditor-2").next({ label: "CodeFile", match: { status: "pending" } });
    if (again.ok) expect(again.value.pending).toBe(2);
  });

  it("read returns the bounded neighborhood slice", async () => {
    const { as } = makeSession();
    const auditor = as("auditor");
    await as("scanner").post(fileNode("a.ts", "f1"));
    await auditor.post({
      mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: { severity: "high" } },
    });
    await auditor.post({
      mutation: { kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: "f1", to: "i1" },
    });
    const r = await auditor.read({ root: "f1", depth: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nodes.map((n) => n.id).sort()).toEqual(["f1", "i1"]);
      expect(r.value.edges).toHaveLength(1);
    }
  });

  it("read is policy-filtered: a reader without CodeFile access cannot see it via a neighbor", async () => {
    const { as } = makeSession(demoAcl);
    await seedIssueGraph(as);
    const r = await as("reporter").read({ root: "i1", depth: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.nodes.map((n) => n.id)).toEqual(["i1"]);
      expect(r.value.edges).toEqual([]);
    }
  });

  it("an explicit read of an unreadable root is denied with ACL_DENIED_READ and logged", async () => {
    const { as, log } = makeSession(demoAcl);
    await seedIssueGraph(as);
    const denied = await as("reporter").read({ root: "f1", depth: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok && denied.error.code === "ACL_DENIED_READ") {
      expect(denied.error.label).toBe("CodeFile");
    } else {
      throw new Error("expected ACL_DENIED_READ");
    }
    const records = await log.read();
    expect(records.at(-1)?.event).toEqual({
      type: "acl.denied",
      agentId: "reporter",
      label: "CodeFile",
      reason: "read",
    });
  });

  it("next for an unreadable label is denied and logged, not silently emptied", async () => {
    const { as, log } = makeSession(demoAcl);
    await seedIssueGraph(as);
    const denied = await as("reporter").next({ label: "CodeFile", match: {} });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("ACL_DENIED_READ");
    expect((await log.read()).at(-1)?.event.type).toBe("acl.denied");
  });

  it("post echoes the version its OWN write produced, even when another commit interleaves mid-append", async () => {
    // Found by W1-A: the echo used to re-read shared state after the append await.
    const now = 0;
    let n = 0;
    const inner = createMemoryLog();
    let appends = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const log = {
      ...inner,
      append: async (
        meta: Parameters<typeof inner.append>[0],
        ev: Parameters<typeof inner.append>[1],
      ) => {
        appends += 1;
        if (appends === 2) await gate; // park the first UPDATE inside its append
        return inner.append(meta, ev);
      },
    };
    const session = createSession({
      log,
      acl: null,
      sessionId: sessionId("s1"),
      principal: null,
      now: () => now,
      newTxId: () => txId(`tx${n++}`),
    });
    const a = session.connect(agentId("a"));
    const b = session.connect(agentId("b"));

    await a.post(fileNode("a.ts")); // append #1, passes through — node at v1
    const parked = a.post({
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { x: 1 } },
    }); // applies v2, parks in append #2
    const interleaved = await b.post({
      mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 2, props: { y: 2 } },
    }); // applies v3 while A is parked
    release();
    const echoed = await parked;

    expect(echoed.ok && echoed.value.version).toBe(2); // A produced v2, not B's v3
    expect(interleaved.ok && interleaved.value.version).toBe(3);
  });

  it("status counts nodes, edges and only unexpired claims", async () => {
    const { as, tick } = makeSession();
    const scanner = as("scanner");
    await scanner.post(fileNode("a.ts", "f1"));
    await scanner.post(fileNode("b.ts", "f2"));
    await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    expect(scanner.status()).toEqual({
      nodes: 2,
      edges: 0,
      activeClaims: 1,
      byLabel: { CodeFile: 2 },
    });
    tick(2000);
    expect(scanner.status().activeClaims).toBe(0);
  });
});

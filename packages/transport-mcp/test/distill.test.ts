import { type AclPolicy, agentId, principal, sessionId, txId } from "@whipple3/core";
import { createMemoryLog } from "@whipple3/log";
import { describe, expect, it } from "vitest";
import { renderReport, summarize } from "../src/distill.js";
import { createSession } from "../src/session.js";

const acl: AclPolicy = {
  scanner: { write: ["CodeFile"], read: ["CodeFile"] },
  auditor: {
    write: ["CodeFile", "SecurityIssue", "HAS_ISSUE"],
    read: ["CodeFile", "SecurityIssue", "HAS_ISSUE"],
  },
  reporter: { write: [], read: ["SecurityIssue"] },
};

/** A full little audit run against a real session — the log is the fixture. */
const runAudit = async () => {
  let now = 1_000;
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
  const scanner = session.connect(agentId("scanner"));
  const auditor = session.connect(agentId("auditor"));

  await scanner.post({
    mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { path: "a.ts" } },
  });
  await scanner.post({
    mutation: { kind: "ADD_NODE", id: "f2", label: "CodeFile", props: { path: "b.ts" } },
  });
  await auditor.claim({ id: "f1", ttlMs: 60_000 });
  await auditor.post({
    mutation: { kind: "ADD_NODE", id: "i1", label: "SecurityIssue", props: { severity: "high" } },
  });
  await auditor.post({
    mutation: { kind: "ADD_EDGE", id: "e1", label: "HAS_ISSUE", from: "f1", to: "i1" },
  });
  await auditor.post({
    mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion: 1, props: { status: "audited" } },
  });
  await auditor.release({ id: "f1" });
  await session.connect(agentId("reporter")).post({
    mutation: { kind: "ADD_NODE", id: "x1", label: "CodeFile", props: {} },
  }); // ACL denial — must show up in the report

  now = 42_000;
  await session.distill("2 files scanned, 1 issue");
  return { log, session };
};

describe("distill — a pure fold over the log (SPEC §4.2: distillation is a post-mortem)", () => {
  it("summarize replays the graph and reads session metadata off the records", async () => {
    const { log } = await runAudit();
    const s = summarize(await log.read());

    expect(s.sessionId).toBe("s1");
    expect(s.principal).toBe("michael");
    expect(s.startTs).toBe(1_000);
    expect(s.endTs).toBe(42_000);
    expect(s.rejected).toEqual([]);
    expect(s.purged).toBe(false);
    expect(s.distilledSummary).toBe("2 files scanned, 1 issue");

    const labels = [...s.nodesByLabel.keys()];
    expect(labels).toEqual(["CodeFile", "SecurityIssue"]); // sorted, deterministic
    const files = s.nodesByLabel.get("CodeFile");
    expect(files?.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(files?.[0]?.props).toEqual({ path: "a.ts", status: "audited" }); // final state, v2
    expect(files?.[0]?.version).toBe(2);
  });

  it("summarize counts per-agent activity including denials", async () => {
    const { log } = await runAudit();
    const s = summarize(await log.read());

    expect([...s.agents.keys()]).toEqual(["auditor", "reporter", "scanner"]); // sorted
    expect(s.agents.get("scanner")).toEqual({
      posts: 2,
      updates: 0,
      edges: 0,
      claims: 0,
      releases: 0,
      denials: 0,
    });
    expect(s.agents.get("auditor")).toEqual({
      posts: 1,
      updates: 1,
      edges: 1,
      claims: 1,
      releases: 1,
      denials: 0,
    });
    expect(s.agents.get("reporter")).toEqual({
      posts: 0,
      updates: 0,
      edges: 0,
      claims: 0,
      releases: 0,
      denials: 1,
    });
  });

  it("an empty log summarizes to an empty report, never a throw", () => {
    const s = summarize([]);
    expect(s.sessionId).toBeNull();
    expect(s.startTs).toBeNull();
    expect(s.records).toBe(0);
    expect(s.nodesByLabel.size).toBe(0);
    expect(s.agents.size).toBe(0);
    expect(renderReport(s)).toContain("# whipple3 session report");
  });

  it("a purged session still reports its full pre-purge graph — the log is the source of truth", async () => {
    const { log, session } = await runAudit();
    await session.purge();
    const s = summarize(await log.read());
    expect(s.purged).toBe(true);
    expect(s.nodesByLabel.get("CodeFile")).toHaveLength(2);
    expect(s.nodesByLabel.get("SecurityIssue")).toHaveLength(1);
  });

  it("renderReport lays out metadata, findings by label and the agent activity table", async () => {
    const { log } = await runAudit();
    const md = renderReport(summarize(await log.read()));

    expect(md).toContain("# whipple3 session report");
    expect(md).toContain("**session:** `s1`");
    expect(md).toContain("**principal:** `michael`");
    expect(md).toContain("**duration:** 41s");
    expect(md).toContain("**purged:** no");
    expect(md).toContain("> 2 files scanned, 1 issue");
    expect(md).toContain("### CodeFile (2)");
    expect(md).toContain('- `f1` v2 — {"path":"a.ts","status":"audited"}');
    expect(md).toContain("### SecurityIssue (1)");
    expect(md).toContain("| auditor | 1 | 1 | 1 | 1 | 1 | 0 |");
    expect(md).toContain("| reporter | 0 | 0 | 0 | 0 | 0 | 1 |");
    expect(md).toContain("| scanner | 2 | 0 | 0 | 0 | 0 | 0 |");
  });
});

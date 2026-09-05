import { agentId, type LogRecord, type Mutation, nodeId, sessionId, txId } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import {
  allClaimsReleased,
  approvedBeforeMerge,
  atLeast,
  every,
  format,
  noDenials,
  none,
  run,
  sessionFrom,
} from "../src/index.js";

let seq = 0;
const record = (event: LogRecord["event"], agent = "worker"): LogRecord => {
  const tx = txId(`tx-${seq}`);
  return {
    seq: seq++,
    meta: {
      txId: tx,
      sessionId: sessionId("s"),
      agentId: agentId(agent),
      principal: null,
      ts: seq,
      causationId: null,
      correlationId: tx,
    },
    event,
  };
};
const mutation = (m: Mutation, agent?: string) =>
  record({ type: "graph.mutation", mutation: m }, agent);
const add = (id: string, label: string, props: Record<string, unknown>) =>
  mutation({ kind: "ADD_NODE", id: nodeId(id), label, props });

describe("assertions over a coordination trajectory", () => {
  const audited = sessionFrom([
    add("f1", "finding", { status: "triaged" }),
    add("f2", "finding", { status: "triaged" }),
    add("c1", "codefile", { status: "audited" }),
  ]);

  it("every() passes when the whole label satisfies the contract", () => {
    const r = run(
      audited,
      every("finding", (p) => p.status === "triaged"),
    );
    expect(r.ok).toBe(true);
    expect(r.checks[0]?.message).toContain("every finding (2)");
  });

  it("every() names the failures instead of just failing", () => {
    const mixed = sessionFrom([
      add("f1", "finding", { status: "triaged" }),
      add("f2", "finding", { status: "pending" }),
    ]);
    const r = run(
      mixed,
      every("finding", (p) => p.status === "triaged"),
    );
    expect(r.ok).toBe(false);
    expect(r.checks[0]?.message).toMatch(/1\/2 finding failed: f2/);
  });

  it("every() is vacuously true on zero nodes — atLeast() is the guard for that", () => {
    const empty = sessionFrom([]);
    expect(
      run(
        empty,
        every("finding", () => false),
      ).ok,
    ).toBe(true);
    expect(run(empty, atLeast("finding", 1)).ok).toBe(false);
  });

  it("none() expresses 'nothing was left pending'", () => {
    expect(
      run(
        audited,
        none("finding", (p) => p.status === "pending"),
      ).ok,
    ).toBe(true);
  });

  it("noDenials() reads the enforcement record, not the state", () => {
    const denied = sessionFrom([
      add("f1", "finding", {}),
      record({ type: "acl.denied", agentId: agentId("scanner"), label: "fix", reason: "write" }),
    ]);
    const r = run(denied, noDenials());
    expect(r.ok).toBe(false);
    expect(r.checks[0]?.message).toContain("scanner→fix (write)");
  });

  it("allClaimsReleased() catches a worker that died holding its work", () => {
    const stuck = sessionFrom([
      add("n1", "task", {}),
      mutation({
        kind: "CLAIM_NODE",
        id: nodeId("n1"),
        agentId: agentId("w1"),
        now: 0,
        ttlMs: 60_000,
      }),
    ]);
    expect(run(stuck, allClaimsReleased()).ok).toBe(false);

    const clean = sessionFrom([
      add("n1", "task", {}),
      mutation({
        kind: "CLAIM_NODE",
        id: nodeId("n1"),
        agentId: agentId("w1"),
        now: 0,
        ttlMs: 60_000,
      }),
      mutation({ kind: "RELEASE_NODE", id: nodeId("n1"), agentId: agentId("w1") }),
    ]);
    expect(run(clean, allClaimsReleased()).ok).toBe(true);
  });

  it("a report is one line per check, readable in a CI log", () => {
    const r = run(
      audited,
      atLeast("finding", 2),
      none("finding", (p) => p.status === "pending"),
    );
    expect(format(r).split("\n")).toHaveLength(2);
    expect(format(r).startsWith("✓")).toBe(true);
  });

  it("the same log always gives the same verdict — the models are not deterministic, this is", () => {
    const records = [add("f1", "finding", { status: "triaged" })];
    const a = run(
      sessionFrom(records),
      every("finding", (p) => p.status === "triaged"),
    );
    const b = run(
      sessionFrom(records),
      every("finding", (p) => p.status === "triaged"),
    );
    expect(a).toEqual(b);
  });
});

describe("approvedBeforeMerge — order in the log, not shape of the state", () => {
  const mutation = (m: Mutation, agent?: string) =>
    record({ type: "graph.mutation", mutation: m }, agent);
  const pr = (): LogRecord =>
    mutation({
      kind: "ADD_NODE",
      id: nodeId("pr:9"),
      label: "PullRequest",
      props: { number: 9, state: "open" },
    });
  const verdict = (v: string): LogRecord =>
    mutation(
      {
        kind: "ADD_NODE",
        id: nodeId(`review:9:${v}`),
        label: "Review",
        props: { pr: 9, reviewer: "rev", verdict: v },
      },
      "rev",
    );
  const merged = (version: number): LogRecord =>
    mutation({
      kind: "UPDATE_NODE",
      id: nodeId("pr:9"),
      expectedVersion: version as never,
      props: { state: "merged" },
    });

  it("approve then merge ⇒ ok", () => {
    const s = sessionFrom([pr(), verdict("approve"), merged(1)]);
    expect(approvedBeforeMerge()(s).ok).toBe(true);
  });

  it("merge with no approve ⇒ names the PR", () => {
    const s = sessionFrom([pr(), merged(1)]);
    expect(approvedBeforeMerge()(s)).toEqual({
      ok: false,
      message: "merged without a standing approve: pr:9",
    });
  });

  it("approve, then request_changes, then merge ⇒ fails", () => {
    const s = sessionFrom([pr(), verdict("approve"), verdict("request_changes"), merged(1)]);
    expect(approvedBeforeMerge()(s).ok).toBe(false);
  });

  it("merge, then approve ⇒ fails — the state alone would have passed", () => {
    const s = sessionFrom([pr(), merged(1), verdict("approve")]);
    expect(approvedBeforeMerge()(s).ok).toBe(false);
  });
});

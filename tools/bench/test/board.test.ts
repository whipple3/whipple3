import {
  agentId,
  type LogRecord,
  type Mutation,
  nodeId,
  sessionId,
  txId,
  version,
  type Whipple3Event,
} from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { extractBoardMetrics } from "../src/board.js";

let seq = 0;
const rec = (agent: string | null, event: Whipple3Event): LogRecord => {
  seq += 1;
  return {
    seq,
    meta: {
      txId: txId(`tx-${seq}`),
      sessionId: sessionId("s1"),
      agentId: agent === null ? null : agentId(agent),
      principal: null,
      ts: 1000 + seq,
      causationId: null,
      correlationId: txId("corr"),
    },
    event,
  };
};

const mutate = (agent: string, mutation: Mutation): LogRecord =>
  rec(agent, { type: "graph.mutation", mutation });

const claim = (agent: string, node: string): readonly LogRecord[] => [
  mutate(agent, {
    kind: "CLAIM_NODE",
    id: nodeId(node),
    agentId: agentId(agent),
    now: 1000 + seq,
    ttlMs: 30_000,
  }),
  rec(agent, { type: "claim.acquired", nodeId: node, agentId: agent }),
];

/** A replay-valid audit trail: renewal, a contested re-claim, and a reworked node. */
const auditTrail = (): readonly LogRecord[] => {
  seq = 0;
  return [
    mutate("scanner", { kind: "ADD_NODE", id: nodeId("f1"), label: "CodeFile", props: {} }),
    mutate("scanner", { kind: "ADD_NODE", id: nodeId("f2"), label: "CodeFile", props: {} }),
    ...claim("auditor-1", "f1"),
    mutate("auditor-1", {
      kind: "UPDATE_NODE",
      id: nodeId("f1"),
      expectedVersion: version(1),
      props: { status: "audited" },
    }),
    mutate("auditor-1", { kind: "ADD_NODE", id: nodeId("i1"), label: "SecurityIssue", props: {} }),
    ...claim("auditor-1", "f1"), // renewal — same agent, D2-correct, NOT duplicate work
    ...claim("auditor-2", "f1"), // contested — a second agent redoes claimed work
    mutate("auditor-2", {
      kind: "UPDATE_NODE",
      id: nodeId("f1"),
      expectedVersion: version(2),
      props: { status: "audited-again" },
    }),
    rec("scanner", { type: "acl.denied", agentId: "scanner", label: "Exfil", reason: "write" }),
  ];
};

describe("extractBoardMetrics — duplicate work and findings from the board log", () => {
  it("counts findings by label from the replayed final state", () => {
    const m = extractBoardMetrics(auditTrail());
    expect(m.findingsByLabel).toEqual({ CodeFile: 2, SecurityIssue: 1 });
  });

  it("counts contested claims: distinct-agent re-claims only, renewals excluded (D2)", () => {
    const m = extractBoardMetrics(auditTrail());
    expect(m.contestedClaims).toBe(1);
  });

  it("counts reworked nodes: updated by two or more distinct agents", () => {
    const m = extractBoardMetrics(auditTrail());
    expect(m.reworkedNodes).toBe(1);
  });

  it("surfaces denials and the sorted agent roster", () => {
    const m = extractBoardMetrics(auditTrail());
    expect(m.denials).toBe(1);
    expect(m.agents).toEqual(["auditor-1", "auditor-2", "scanner"]);
  });

  it("reports a clean run as zero duplicates — the SPEC §8 success shape", () => {
    seq = 0;
    const clean = [
      mutate("scanner", { kind: "ADD_NODE", id: nodeId("f1"), label: "CodeFile", props: {} }),
      ...claim("auditor-1", "f1"),
    ];
    const m = extractBoardMetrics(clean);
    expect(m.contestedClaims).toBe(0);
    expect(m.reworkedNodes).toBe(0);
  });
});

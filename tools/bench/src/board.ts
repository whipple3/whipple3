import type { LogRecord } from "@whipple3/core";
import { summarize } from "@whipple3/transport-mcp";

/**
 * Duplicate-work accounting over a whipple3 board log. Two honest caveats, both from
 * the session pipeline (transport-mcp/session.ts):
 * - REJECTED claims (ALREADY_CLAIMED) are never logged — a contested ATTEMPT that the
 *   board correctly blocked is invisible here. What we count is work actually redone:
 *   a node claim-acquired by a second distinct agent (post-expiry/steal), and a node
 *   updated by two or more distinct agents.
 * - Same-agent re-claims are lease renewals (ruling D2) — correct behavior, not
 *   duplicate work, and excluded.
 */
export interface BoardMetrics {
  readonly findingsByLabel: Readonly<Record<string, number>>;
  /** claim.acquired events by an agent that is not the node's first claimant. */
  readonly contestedClaims: number;
  /** Nodes UPDATE_NODEd by ≥2 distinct agents. */
  readonly reworkedNodes: number;
  readonly denials: number;
  readonly agents: readonly string[];
}

const distinctAgentsPerNode = (pairs: readonly (readonly [string, string])[]) => {
  const byNode = new Map<string, Set<string>>();
  for (const [node, agent] of pairs) {
    const seen = byNode.get(node) ?? new Set<string>();
    seen.add(agent);
    byNode.set(node, seen);
  }
  return byNode;
};

const contested = (records: readonly LogRecord[]): number => {
  const acquisitions = records.flatMap((r): readonly (readonly [string, string])[] =>
    r.event.type === "claim.acquired" ? [[r.event.nodeId, r.event.agentId]] : [],
  );
  let count = 0;
  for (const agents of distinctAgentsPerNode(acquisitions).values()) count += agents.size - 1;
  return count;
};

const reworked = (records: readonly LogRecord[]): number => {
  const updates = records.flatMap((r): readonly (readonly [string, string])[] =>
    r.event.type === "graph.mutation" &&
    r.event.mutation.kind === "UPDATE_NODE" &&
    r.meta.agentId !== null
      ? [[r.event.mutation.id as string, r.meta.agentId as string]]
      : [],
  );
  let count = 0;
  for (const agents of distinctAgentsPerNode(updates).values()) if (agents.size >= 2) count += 1;
  return count;
};

export const extractBoardMetrics = (records: readonly LogRecord[]): BoardMetrics => {
  const summary = summarize(records);
  const findingsByLabel: Record<string, number> = {};
  for (const [label, nodes] of summary.nodesByLabel) findingsByLabel[label] = nodes.length;
  let denials = 0;
  for (const activity of summary.agents.values()) denials += activity.denials;
  return {
    findingsByLabel,
    contestedClaims: contested(records),
    reworkedNodes: reworked(records),
    denials,
    agents: [...summary.agents.keys()],
  };
};

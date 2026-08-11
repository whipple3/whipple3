import {
  type AclPolicy,
  type AgentId,
  type GraphState,
  type NodeId,
  readableLabels,
} from "@whipple3/core";

export interface SessionStatus {
  readonly nodes: number;
  readonly edges: number;
  readonly activeClaims: number;
  readonly byLabel: Readonly<Record<string, number>>;
}

/**
 * The blackboard_status aggregation, pure over its inputs. Same rule as read: an
 * unreadable label leaks neither its name nor its counts, and an edge counts only when
 * its label AND both endpoints are readable. (ADR-008) Counts accumulate in a Map —
 * labels are agent-chosen, and "constructor"/"__proto__" pass the boardName alphabet,
 * so object-literal assignment would corrupt the record.
 */
export const statusOf = (
  state: GraphState,
  acl: AclPolicy | null,
  agent: AgentId,
  now: number,
): SessionStatus => {
  const readable = acl === null ? null : new Set(readableLabels(acl, agent));
  const canSee = (label: string): boolean => readable === null || readable.has(label);
  const nodeVisible = (id: NodeId): boolean => {
    const n = state.nodes.get(id);
    return n !== undefined && canSee(n.label);
  };
  const byLabel = new Map<string, number>();
  let nodes = 0;
  for (const n of state.nodes.values()) {
    if (!canSee(n.label)) continue;
    nodes += 1;
    byLabel.set(n.label, (byLabel.get(n.label) ?? 0) + 1);
  }
  let edges = 0;
  for (const e of state.edges.values())
    if (canSee(e.label) && nodeVisible(e.from) && nodeVisible(e.to)) edges += 1;
  let activeClaims = 0;
  for (const c of state.claims.values())
    if (c.expiresAt > now && nodeVisible(c.nodeId)) activeClaims += 1;
  return { nodes, edges, activeClaims, byLabel: Object.fromEntries(byLabel) };
};

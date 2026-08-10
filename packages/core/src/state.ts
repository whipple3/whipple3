import type { AgentId, EdgeId, NodeId, Version } from "./ids.js";

export interface NodeRecord {
  readonly id: NodeId;
  readonly label: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly version: Version;
}

export interface EdgeRecord {
  readonly id: EdgeId;
  readonly label: string;
  readonly from: NodeId;
  readonly to: NodeId;
}

export interface ClaimRecord {
  readonly nodeId: NodeId;
  readonly agentId: AgentId;
  readonly expiresAt: number;
}

/** Immutable working state. graphology renders this in Studio; it never lives here. (ADR-004) */
export interface GraphState {
  readonly nodes: ReadonlyMap<NodeId, NodeRecord>;
  readonly edges: ReadonlyMap<EdgeId, EdgeRecord>;
  readonly claims: ReadonlyMap<NodeId, ClaimRecord>;
}

export const emptyState = (): GraphState => ({
  nodes: new Map(),
  edges: new Map(),
  claims: new Map(),
});

import type { AgentId, EdgeId, NodeId, Version } from "./ids.js";
import { bump, INITIAL_VERSION } from "./ids.js";
import { err, ok, type Result } from "./result.js";
import type { GraphState, NodeRecord } from "./state.js";

export type Mutation =
  | {
      readonly kind: "ADD_NODE";
      readonly id: NodeId;
      readonly label: string;
      readonly props: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "UPDATE_NODE";
      readonly id: NodeId;
      readonly expectedVersion: Version;
      readonly props: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "ADD_EDGE";
      readonly id: EdgeId;
      readonly label: string;
      readonly from: NodeId;
      readonly to: NodeId;
    }
  | {
      readonly kind: "CLAIM_NODE";
      readonly id: NodeId;
      readonly agentId: AgentId;
      readonly now: number;
      readonly ttlMs: number;
    }
  | { readonly kind: "RELEASE_NODE"; readonly id: NodeId; readonly agentId: AgentId };

export type MutationError =
  | { readonly code: "NODE_EXISTS"; readonly id: NodeId }
  | { readonly code: "NODE_NOT_FOUND"; readonly id: NodeId }
  | { readonly code: "EDGE_EXISTS"; readonly id: EdgeId }
  | {
      readonly code: "VERSION_CONFLICT";
      readonly id: NodeId;
      readonly expected: Version;
      readonly current: Version;
    }
  | { readonly code: "ALREADY_CLAIMED"; readonly id: NodeId; readonly holder: AgentId }
  | { readonly code: "CLAIM_NOT_HELD"; readonly id: NodeId };

const withNode = (s: GraphState, n: NodeRecord): GraphState => ({
  ...s,
  nodes: new Map(s.nodes).set(n.id, n),
});

/**
 * The reducer. Pure and deterministic: time arrives inside the mutation, never from a clock.
 * The append-only log of mutations is the source of truth; GraphState is a materialized view. (SPEC §4)
 */
export const apply = (state: GraphState, m: Mutation): Result<GraphState, MutationError> => {
  switch (m.kind) {
    case "ADD_NODE": {
      if (state.nodes.has(m.id)) return err({ code: "NODE_EXISTS", id: m.id });
      return ok(
        withNode(state, { id: m.id, label: m.label, props: m.props, version: INITIAL_VERSION }),
      );
    }
    case "UPDATE_NODE": {
      const node = state.nodes.get(m.id);
      if (node === undefined) return err({ code: "NODE_NOT_FOUND", id: m.id });
      if (node.version !== m.expectedVersion)
        return err({
          code: "VERSION_CONFLICT",
          id: m.id,
          expected: m.expectedVersion,
          current: node.version,
        });
      return ok(
        withNode(state, {
          ...node,
          props: { ...node.props, ...m.props },
          version: bump(node.version),
        }),
      );
    }
    case "ADD_EDGE": {
      if (state.edges.has(m.id)) return err({ code: "EDGE_EXISTS", id: m.id });
      if (!state.nodes.has(m.from)) return err({ code: "NODE_NOT_FOUND", id: m.from });
      if (!state.nodes.has(m.to)) return err({ code: "NODE_NOT_FOUND", id: m.to });
      return ok({
        ...state,
        edges: new Map(state.edges).set(m.id, {
          id: m.id,
          label: m.label,
          from: m.from,
          to: m.to,
        }),
      });
    }
    case "CLAIM_NODE": {
      if (!state.nodes.has(m.id)) return err({ code: "NODE_NOT_FOUND", id: m.id });
      const existing = state.claims.get(m.id);
      if (existing !== undefined && existing.expiresAt > m.now && existing.agentId !== m.agentId)
        return err({ code: "ALREADY_CLAIMED", id: m.id, holder: existing.agentId });
      return ok({
        ...state,
        claims: new Map(state.claims).set(m.id, {
          nodeId: m.id,
          agentId: m.agentId,
          expiresAt: m.now + m.ttlMs,
        }),
      });
    }
    case "RELEASE_NODE": {
      const existing = state.claims.get(m.id);
      if (existing === undefined || existing.agentId !== m.agentId)
        return err({ code: "CLAIM_NOT_HELD", id: m.id });
      const claims = new Map(state.claims);
      claims.delete(m.id);
      return ok({ ...state, claims });
    }
  }
};

/** Deterministic fold of a mutation list. Errors are skipped and reported, never thrown. */
export const replay = (
  mutations: readonly Mutation[],
  initial: GraphState,
): { readonly state: GraphState; readonly rejected: readonly MutationError[] } => {
  let state = initial;
  const rejected: MutationError[] = [];
  for (const m of mutations) {
    const r = apply(state, m);
    if (r.ok) state = r.value;
    else rejected.push(r.error);
  }
  return { state, rejected };
};

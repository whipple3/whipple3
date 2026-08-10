import type { NodeId } from "./ids.js";
import type { Trigger } from "./schema.js";
import type { EdgeRecord, GraphState, NodeRecord } from "./state.js";

export interface Slice {
  readonly nodes: readonly NodeRecord[];
  readonly edges: readonly EdgeRecord[];
}

/**
 * Context slicing, push-model: the engine computes the minimal slice and injects it at
 * dispatch — agents cannot read beyond it. (SPEC §4.7)
 * v0.1: BFS neighborhood. TODO(W1+): role-declared slices in the schema.
 */
/**
 * The pull-mode work queue: `when()` triggers compile to exactly this query. (SPEC §4.4)
 * A valid (unexpired) claim hides a node from every agent — holders already have their work.
 */
export const availableWork = (
  state: GraphState,
  trigger: Trigger,
  now: number,
): readonly NodeRecord[] => {
  const matches = (node: NodeRecord): boolean =>
    node.label === trigger.label &&
    Object.entries(trigger.match).every(([key, value]) => Object.is(node.props[key], value));

  const claimed = (node: NodeRecord): boolean => {
    const claim = state.claims.get(node.id);
    return claim !== undefined && claim.expiresAt > now;
  };

  return [...state.nodes.values()].filter((n) => matches(n) && !claimed(n));
};

/**
 * One BFS for both public slices. `canSee` filters DURING traversal, not after: an
 * unreadable node blocks its whole path and never leaks via an edge endpoint. (SPEC §4.6)
 */
const bfs = (
  state: GraphState,
  root: NodeId,
  depth: number,
  canSee: (label: string) => boolean,
): Slice => {
  const visible = (id: NodeId): boolean => {
    const n = state.nodes.get(id);
    return n !== undefined && canSee(n.label);
  };

  const seen = new Set<NodeId>();
  let frontier: readonly NodeId[] = visible(root) ? [root] : [];
  for (const id of frontier) seen.add(id);

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: NodeId[] = [];
    for (const edge of state.edges.values()) {
      if (!canSee(edge.label)) continue;
      if (frontier.includes(edge.from) && !seen.has(edge.to) && visible(edge.to)) {
        seen.add(edge.to);
        next.push(edge.to);
      }
      if (frontier.includes(edge.to) && !seen.has(edge.from) && visible(edge.from)) {
        seen.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
  }

  const nodes: NodeRecord[] = [];
  for (const id of seen) {
    const n = state.nodes.get(id);
    if (n !== undefined) nodes.push(n);
  }
  const edges = [...state.edges.values()].filter(
    (e) => canSee(e.label) && seen.has(e.from) && seen.has(e.to),
  );
  return { nodes, edges };
};

/** The unfiltered primitive — internal/trusted callers (studio, replay) only. */
export const neighborhood = (state: GraphState, root: NodeId, depth: number): Slice =>
  bfs(state, root, depth, () => true);

/** The policy-filtered slice LLM-facing reads must go through. (SPEC §4.6, §4.7) */
export const readableNeighborhood = (
  state: GraphState,
  root: NodeId,
  depth: number,
  readable: readonly string[],
): Slice => {
  const allowed = new Set(readable);
  return bfs(state, root, depth, (label) => allowed.has(label));
};

import type { NodeId } from "./ids.js";
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
export const neighborhood = (state: GraphState, root: NodeId, depth: number): Slice => {
  const seen = new Set<NodeId>();
  let frontier: readonly NodeId[] = state.nodes.has(root) ? [root] : [];
  for (const id of frontier) seen.add(id);

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: NodeId[] = [];
    for (const edge of state.edges.values()) {
      if (frontier.includes(edge.from) && !seen.has(edge.to)) {
        seen.add(edge.to);
        next.push(edge.to);
      }
      if (frontier.includes(edge.to) && !seen.has(edge.from)) {
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
  const edges = [...state.edges.values()].filter((e) => seen.has(e.from) && seen.has(e.to));
  return { nodes, edges };
};

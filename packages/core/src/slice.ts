import type { NodeId } from "./ids.js";
import type { FollowRule, SliceDecl, Trigger } from "./schema.js";
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

/** An edge participates in a rule only in its declared endpoint labels, either direction. */
const pairMatches = (a: string, b: string, rule: FollowRule): boolean =>
  (a === rule.from && b === rule.to) || (a === rule.to && b === rule.from);

/**
 * Role-declared slicing — the declarative replacement for raw BFS depth. (SPEC §4.7,
 * ROADMAP Stage 2.) Same leak rule as readableNeighborhood: what the declaration doesn't
 * include is never emitted, and an excluded (undeclared OR unreadable) node blocks
 * traversal through itself. The declaration can only NARROW the read ACL — every check
 * intersects with `readable` — so sliceFor(...) ⊆ readableNeighborhood(...), by property test.
 */
export const sliceFor = (
  state: GraphState,
  root: NodeId,
  decl: SliceDecl,
  readable: readonly string[],
): Slice => {
  const allowed = new Set(readable);
  const rootNode = state.nodes.get(root);
  if (rootNode === undefined || rootNode.label !== decl.root || !allowed.has(rootNode.label)) {
    return { nodes: [], edges: [] };
  }

  const seen = new Set<NodeId>([root]);

  /** Up to rule.hops consecutive hops along rule.edge; returns every node the rule reached. */
  const expand = (starts: ReadonlySet<NodeId>, rule: FollowRule): ReadonlySet<NodeId> => {
    const reached = new Set<NodeId>();
    if (!allowed.has(rule.edge)) return reached;
    const visited = new Set(starts);
    let frontier = starts;
    for (let h = 0; h < rule.hops && frontier.size > 0; h++) {
      const next = new Set<NodeId>();
      for (const edge of state.edges.values()) {
        if (edge.label !== rule.edge) continue;
        for (const [near, far] of [
          [edge.from, edge.to],
          [edge.to, edge.from],
        ] as const) {
          if (!frontier.has(near)) continue;
          const nearNode = state.nodes.get(near);
          const farNode = state.nodes.get(far);
          if (nearNode === undefined || farNode === undefined) continue;
          if (!pairMatches(nearNode.label, farNode.label, rule)) continue;
          if (!allowed.has(farNode.label)) continue;
          reached.add(far);
          seen.add(far);
          if (!visited.has(far)) {
            visited.add(far);
            next.add(far);
          }
        }
      }
      frontier = next;
    }
    return reached;
  };

  const walk = (starts: ReadonlySet<NodeId>, rules: readonly FollowRule[]): void => {
    for (const rule of rules) {
      const reached = expand(starts, rule);
      if (reached.size > 0) walk(reached, rule.next);
    }
  };
  walk(new Set([root]), decl.follow);

  const flat: FollowRule[] = [];
  const flatten = (rules: readonly FollowRule[]): void => {
    for (const r of rules) {
      flat.push(r);
      flatten(r.next);
    }
  };
  flatten(decl.follow);

  const nodes: NodeRecord[] = [];
  for (const id of seen) {
    const n = state.nodes.get(id);
    if (n !== undefined) nodes.push(n);
  }
  const declaredBy = (e: EdgeRecord): boolean => {
    const a = state.nodes.get(e.from);
    const b = state.nodes.get(e.to);
    if (a === undefined || b === undefined) return false;
    return flat.some((r) => e.label === r.edge && pairMatches(a.label, b.label, r));
  };
  const edges = [...state.edges.values()].filter(
    (e) => allowed.has(e.label) && seen.has(e.from) && seen.has(e.to) && declaredBy(e),
  );
  return { nodes, edges };
};

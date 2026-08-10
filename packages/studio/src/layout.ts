import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export const LAYOUT_ITERATIONS = 50;

/**
 * ForceAtlas2 over the seeded positions. Deterministic by construction: the
 * algorithm has no randomness — same seeds, same edges, same iteration count
 * give the same coordinates on every machine (the "deterministic seed" the
 * wave spec asks for lives in render.ts's hash-seeded positions).
 */
export const assignLayout = (graph: Graph, iterations = LAYOUT_ITERATIONS): void => {
  if (graph.order < 2) return;
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, { iterations, settings });
};

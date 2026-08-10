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
  // inferSettings drops gravity to 0.05 (tuned for large connected graphs);
  // boards are small with disconnected file/finding pairs, which repulsion
  // (scalingRatio 10) then flings to the gravity horizon. The library's own
  // default gravity of 1 pulls the components into one cluster: measured on the
  // audit demo log, farthest-pair/mean-edge drops 13.9 → 5.1 with no overlaps.
  const settings = { ...forceAtlas2.inferSettings(graph), gravity: 1 };
  forceAtlas2.assign(graph, { iterations, settings });
};

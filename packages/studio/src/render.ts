import { edgeId, nodeId } from "@whipple3/core";
import type Graph from "graphology";
import { colorForAgent, colorForLabel, fnv1a } from "./colors.js";
import type { StudioModel } from "./model.js";

export const NODE_SIZE = 8;
export const HELD_SIZE = 12;
const EDGE_COLOR = "#5a6b80";

/** Deterministic scatter on a ring: replay-stable seeds; the force layout refines them. */
const seedPosition = (id: string): { readonly x: number; readonly y: number } => {
  const angle = (fnv1a(id) / 0xffffffff) * Math.PI * 2;
  const radius = 0.5 + fnv1a(`${id}#r`) / 0xffffffff;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

/**
 * Diffs a StudioModel into a graphology graph: idempotent, works for the live fold
 * and for scrub-back alike (extra nodes/edges are dropped). Position is written only
 * on first add — the force layout owns movement afterwards. A held node wears its
 * holder's color; on release it falls back to its label color.
 */
export const syncGraph = (graph: Graph, model: StudioModel): void => {
  for (const node of model.graph.nodes.values()) {
    const held = model.held.get(node.id);
    const attrs =
      held === undefined
        ? {
            color: colorForLabel(node.label),
            size: NODE_SIZE,
            highlighted: false,
            label: `${node.id} · ${node.label}`,
          }
        : {
            color: colorForAgent(held.agentId),
            size: HELD_SIZE,
            highlighted: true,
            label: `${node.id} · ${node.label} · held by ${held.agentId}`,
          };
    if (graph.hasNode(node.id)) graph.mergeNodeAttributes(node.id, attrs);
    else graph.addNode(node.id, { ...seedPosition(node.id), ...attrs });
  }
  // graphology keys round-trip the branded ids we inserted; re-brand to query the model
  for (const key of graph.nodes()) if (!model.graph.nodes.has(nodeId(key))) graph.dropNode(key);

  for (const edge of model.graph.edges.values())
    if (!graph.hasEdge(edge.id))
      graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
        label: edge.label,
        size: 2,
        color: EDGE_COLOR,
      });
  for (const key of graph.edges()) if (!model.graph.edges.has(edgeId(key))) graph.dropEdge(key);
};

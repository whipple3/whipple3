import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { fnv1a } from "../src/colors.js";
import { assignLayout } from "../src/layout.js";

/** Same ring seeding as render.ts's seedPosition — the coordinates layout really gets. */
const seed = (id: string): { x: number; y: number } => {
  const angle = (fnv1a(id) / 0xffffffff) * Math.PI * 2;
  const radius = 0.5 + fnv1a(`${id}#r`) / 0xffffffff;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

/** A small file↔finding shape with deterministic seed positions, like syncGraph makes. */
const demoGraph = (): Graph => {
  const graph = new Graph();
  for (let i = 0; i < 6; i += 1)
    graph.addNode(`f${i}`, { x: Math.cos(i), y: Math.sin(i), size: 8 });
  graph.addEdgeWithKey("e0", "f0", "f1");
  graph.addEdgeWithKey("e1", "f1", "f2");
  graph.addEdgeWithKey("e2", "f3", "f4");
  return graph;
};

/**
 * The audit demo log's exact shape: six disconnected components — one file with
 * two issue+fix pairs (5 nodes), four file–issue–fix chains, one isolated
 * policy.json — 18 nodes, 12 edges. FA2's inferred settings flung these apart.
 */
const auditShapedGraph = (): Graph => {
  const graph = new Graph();
  const add = (id: string): void => {
    graph.addNode(id, { ...seed(id), size: 8 });
  };
  const link = (id: string, from: string, to: string): void => {
    graph.addEdgeWithKey(id, from, to, { size: 2 });
  };
  add("file:a");
  for (const issue of ["a1", "a2"]) {
    add(`issue:${issue}`);
    add(`fix:${issue}`);
    link(`has-${issue}`, "file:a", `issue:${issue}`);
    link(`fixes-${issue}`, `fix:${issue}`, `issue:${issue}`);
  }
  for (const file of ["b", "c", "d", "e"]) {
    add(`file:${file}`);
    add(`issue:${file}`);
    add(`fix:${file}`);
    link(`has-${file}`, `file:${file}`, `issue:${file}`);
    link(`fixes-${file}`, `fix:${file}`, `issue:${file}`);
  }
  add("file:policy");
  return graph;
};

/** Farthest node pair over mean edge length — how many "hops" of empty space the view wastes. */
const spreadRatio = (graph: Graph): number => {
  const points = graph.nodes().map((n) => ({
    x: graph.getNodeAttribute(n, "x") as number,
    y: graph.getNodeAttribute(n, "y") as number,
  }));
  let maxPair = 0;
  for (const [i, a] of points.entries())
    for (const b of points.slice(i + 1))
      maxPair = Math.max(maxPair, Math.hypot(a.x - b.x, a.y - b.y));
  const edgeLengths = graph.edges().map((e) => {
    const [s, t] = graph.extremities(e);
    return Math.hypot(
      (graph.getNodeAttribute(s, "x") as number) - (graph.getNodeAttribute(t, "x") as number),
      (graph.getNodeAttribute(s, "y") as number) - (graph.getNodeAttribute(t, "y") as number),
    );
  });
  const meanEdge = edgeLengths.reduce((a, b) => a + b, 0) / edgeLengths.length;
  return maxPair / meanEdge;
};

describe("assignLayout", () => {
  it("is deterministic: identical graphs land on identical coordinates", () => {
    const a = demoGraph();
    const b = demoGraph();
    assignLayout(a);
    assignLayout(b);

    for (const node of a.nodes()) {
      expect(b.getNodeAttribute(node, "x")).toBe(a.getNodeAttribute(node, "x"));
      expect(b.getNodeAttribute(node, "y")).toBe(a.getNodeAttribute(node, "y"));
    }
  });

  it("moves nodes from their seed positions without changing the node set", () => {
    const graph = demoGraph();
    // graphology types attributes as `any`; we wrote numbers in demoGraph, so pin them back
    const before = graph.nodes().map((n) => ({
      n,
      x: graph.getNodeAttribute(n, "x") as number,
      y: graph.getNodeAttribute(n, "y") as number,
    }));
    assignLayout(graph);

    expect(graph.order).toBe(6);
    expect(
      before.some(
        (p) => graph.getNodeAttribute(p.n, "x") !== p.x || graph.getNodeAttribute(p.n, "y") !== p.y,
      ),
    ).toBe(true);
  });

  it("keeps the audit demo's disconnected components in one coherent cluster", () => {
    const graph = auditShapedGraph();
    assignLayout(graph);
    // Inferred FA2 settings scored ~14 here (components repelled to the gravity
    // horizon); a coherent single cluster sits well under 8.
    expect(spreadRatio(graph)).toBeLessThan(8);
  });

  it("tolerates tiny graphs", () => {
    const single = new Graph();
    single.addNode("only", { x: 0, y: 0 });
    expect(() => assignLayout(single)).not.toThrow();
    expect(() => assignLayout(new Graph())).not.toThrow();
  });
});

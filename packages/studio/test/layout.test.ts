import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { assignLayout } from "../src/layout.js";

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

  it("tolerates tiny graphs", () => {
    const single = new Graph();
    single.addNode("only", { x: 0, y: 0 });
    expect(() => assignLayout(single)).not.toThrow();
    expect(() => assignLayout(new Graph())).not.toThrow();
  });
});

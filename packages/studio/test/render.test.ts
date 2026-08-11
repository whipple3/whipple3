import type { LogRecord } from "@whipple3/core";
import { agentId, edgeId, nodeId } from "@whipple3/core";
import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { colorForAgent, colorForLabel } from "../src/colors.js";
import { emptyModel, foldRecord, modelAt, type StudioModel } from "../src/model.js";
import { syncGraph } from "../src/render.js";
import { recordOf } from "./fixtures.js";

const RECORDS: readonly LogRecord[] = [
  recordOf(0, {
    type: "graph.mutation",
    mutation: { kind: "ADD_NODE", id: nodeId("f1"), label: "file", props: {} },
  }),
  recordOf(1, {
    type: "graph.mutation",
    mutation: { kind: "ADD_NODE", id: nodeId("n1"), label: "finding", props: {} },
  }),
  recordOf(2, {
    type: "graph.mutation",
    mutation: {
      kind: "ADD_EDGE",
      id: edgeId("e1"),
      label: "found_in",
      from: nodeId("n1"),
      to: nodeId("f1"),
    },
  }),
  recordOf(3, { type: "claim.acquired", nodeId: nodeId("f1"), agentId: agentId("auditor-1") }),
  recordOf(4, { type: "claim.released", nodeId: nodeId("f1"), agentId: agentId("auditor-1") }),
];

const modelUpTo = (upTo: number): StudioModel => modelAt(RECORDS, upTo);

const synced = (model: StudioModel): Graph => {
  const graph = new Graph();
  syncGraph(graph, model);
  return graph;
};

describe("syncGraph", () => {
  it("adds nodes and edges from the model with label colors", () => {
    const graph = synced(modelUpTo(2));

    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(graph.getNodeAttribute("f1", "color")).toBe(colorForLabel("file"));
    expect(graph.getNodeAttribute("n1", "color")).toBe(colorForLabel("finding"));
    expect(graph.hasEdge("e1")).toBe(true);
  });

  it("tints a held node with the holder's color and names the holder", () => {
    const graph = synced(modelUpTo(3));

    expect(graph.getNodeAttribute("f1", "color")).toBe(colorForAgent("auditor-1"));
    expect(String(graph.getNodeAttribute("f1", "label"))).toContain("auditor-1");
  });

  it("restores the label color after release", () => {
    const graph = synced(modelUpTo(3));
    syncGraph(graph, modelUpTo(4));

    expect(graph.getNodeAttribute("f1", "color")).toBe(colorForLabel("file"));
    expect(String(graph.getNodeAttribute("f1", "label"))).not.toContain("auditor-1");
  });

  it("removes nodes and edges when the model scrubs back", () => {
    const graph = synced(modelUpTo(RECORDS.length - 1));
    syncGraph(graph, modelUpTo(0));

    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
    expect(graph.hasNode("f1")).toBe(true);
  });

  it("seeds positions deterministically — two syncs of one model agree", () => {
    const a = synced(modelUpTo(2));
    const b = synced(modelUpTo(2));

    for (const node of a.nodes()) {
      expect(b.getNodeAttribute(node, "x")).toBe(a.getNodeAttribute(node, "x"));
      expect(b.getNodeAttribute(node, "y")).toBe(a.getNodeAttribute(node, "y"));
    }
  });

  it("keeps an existing node's position on re-sync (layout owns movement)", () => {
    const graph = synced(modelUpTo(0));
    graph.setNodeAttribute("f1", "x", 42);
    syncGraph(graph, modelUpTo(3));

    expect(graph.getNodeAttribute("f1", "x")).toBe(42);
  });

  it("is a no-op on an empty model", () => {
    const graph = synced(emptyModel());
    expect(graph.order).toBe(0);
  });

  it("folds and syncs incrementally to the same graph as a fresh sync", () => {
    const incremental = new Graph();
    let model = emptyModel();
    for (const record of RECORDS) {
      model = foldRecord(model, record);
      syncGraph(incremental, model);
    }

    const fresh = synced(modelUpTo(RECORDS.length - 1));
    expect(incremental.order).toBe(fresh.order);
    expect(incremental.size).toBe(fresh.size);
  });
});

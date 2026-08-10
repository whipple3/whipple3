import { agentId, edgeId, type LogRecord, nodeId, version } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { emptyModel, foldRecord, modelAt } from "../src/model.js";
import { recordOf } from "./fixtures.js";

const addNode = (seq: number, id: string, props: Record<string, unknown> = {}): LogRecord =>
  recordOf(seq, {
    type: "graph.mutation",
    mutation: { kind: "ADD_NODE", id: nodeId(id), label: "file", props },
  });

const updateNode = (
  seq: number,
  id: string,
  expected: number,
  props: Record<string, unknown>,
): LogRecord =>
  recordOf(seq, {
    type: "graph.mutation",
    mutation: { kind: "UPDATE_NODE", id: nodeId(id), expectedVersion: version(expected), props },
  });

const acquired = (seq: number, id: string, agent: string): LogRecord =>
  recordOf(seq, { type: "claim.acquired", nodeId: id, agentId: agent });

const released = (seq: number, id: string, agent: string): LogRecord =>
  recordOf(seq, { type: "claim.released", nodeId: id, agentId: agent });

const fold = (records: readonly LogRecord[]) => records.reduce(foldRecord, emptyModel());

describe("foldRecord", () => {
  it("applies graph mutations through core's reducer", () => {
    const model = fold([
      addNode(0, "f1", { path: "src/auth.ts" }),
      updateNode(1, "f1", 1, { status: "audited" }),
      recordOf(2, {
        type: "graph.mutation",
        mutation: {
          kind: "ADD_EDGE",
          id: edgeId("e1"),
          label: "found_in",
          from: nodeId("f1"),
          to: nodeId("f1"),
        },
      }),
    ]);

    const node = model.graph.nodes.get(nodeId("f1"));
    expect(node?.props).toEqual({ path: "src/auth.ts", status: "audited" });
    expect(node?.version).toBe(2);
    expect(model.graph.edges.get(edgeId("e1"))?.label).toBe("found_in");
  });

  it("skips a rejected mutation instead of throwing (replay semantics)", () => {
    const model = fold([addNode(0, "f1"), updateNode(1, "f1", 99, { status: "x" })]);

    expect(model.graph.nodes.get(nodeId("f1"))?.version).toBe(1);
  });

  it("tints on claim.acquired: holder + since from the record meta", () => {
    const model = fold([addNode(0, "f1"), acquired(1, "f1", "auditor-1")]);

    expect(model.held.get("f1")).toEqual({ agentId: "auditor-1", since: 1 });
  });

  it("clears the tint on claim.released", () => {
    const model = fold([
      addNode(0, "f1"),
      acquired(1, "f1", "auditor-1"),
      released(2, "f1", "auditor-1"),
    ]);

    expect(model.held.get("f1")).toBeUndefined();
  });

  it("re-claim by another agent replaces the holder", () => {
    const model = fold([
      addNode(0, "f1"),
      acquired(1, "f1", "auditor-1"),
      released(2, "f1", "auditor-1"),
      acquired(3, "f1", "auditor-2"),
    ]);

    expect(model.held.get("f1")).toEqual({ agentId: "auditor-2", since: 3 });
  });

  it("CLAIM_NODE mutations do not tint — claim.* events are the tint source", () => {
    const model = fold([
      addNode(0, "f1"),
      recordOf(1, {
        type: "graph.mutation",
        mutation: {
          kind: "CLAIM_NODE",
          id: nodeId("f1"),
          agentId: agentId("auditor-1"),
          now: 1,
          ttlMs: 1000,
        },
      }),
    ]);

    expect(model.held.size).toBe(0);
  });

  it("ignores events outside the graph/claim families", () => {
    const model = fold([addNode(0, "f1"), recordOf(1, { type: "session.started", task: "audit" })]);

    expect(model.graph.nodes.size).toBe(1);
    expect(model.held.size).toBe(0);
  });
});

describe("modelAt", () => {
  const records = [addNode(0, "f1"), acquired(1, "f1", "auditor-1"), addNode(2, "f2")];

  it("folds only records[0..upTo]", () => {
    const at1 = modelAt(records, 1);

    expect(at1.graph.nodes.has(nodeId("f1"))).toBe(true);
    expect(at1.graph.nodes.has(nodeId("f2"))).toBe(false);
    expect(at1.held.get("f1")?.agentId).toBe("auditor-1");
  });

  it("at the head equals the incremental fold", () => {
    expect(modelAt(records, records.length - 1)).toEqual(fold(records));
  });

  it("before the first record is the empty model", () => {
    expect(modelAt(records, -1)).toEqual(emptyModel());
  });
});

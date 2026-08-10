import { agentId, edgeId, type LogRecord, type Mutation, nodeId, version } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { type GraphOp, recordToOps } from "../src/graph-ops.js";
import { recordOf } from "./fixtures.js";

const mutationRecord = (m: Mutation): LogRecord =>
  recordOf(0, { type: "graph.mutation", mutation: m });

const addNodeOp = (id: string, label: string): GraphOp => {
  const op = recordToOps(mutationRecord({ kind: "ADD_NODE", id: nodeId(id), label, props: {} }))[0];
  if (op?.kind !== "add-node") throw new Error(`expected add-node, got ${op?.kind}`);
  return op;
};

describe("recordToOps", () => {
  it("maps ADD_NODE to a single add-node op", () => {
    const record = mutationRecord({
      kind: "ADD_NODE",
      id: nodeId("f1"),
      label: "file",
      props: {},
    });

    const ops = recordToOps(record);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "add-node", id: "f1", label: "file" });
  });

  it("colors nodes deterministically by label", () => {
    const a = addNodeOp("a", "file");
    const b = addNodeOp("b", "file");
    const c = addNodeOp("c", "finding");
    if (a.kind !== "add-node" || b.kind !== "add-node" || c.kind !== "add-node")
      throw new Error("expected add-node ops");

    expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b.color).toBe(a.color);
    expect(c.color).not.toBe(a.color);
  });

  it("positions nodes deterministically by id, spread apart", () => {
    const a = addNodeOp("a", "file");
    const again = addNodeOp("a", "file");
    const b = addNodeOp("b", "file");
    if (a.kind !== "add-node" || again.kind !== "add-node" || b.kind !== "add-node")
      throw new Error("expected add-node ops");

    expect(again.x).toBe(a.x);
    expect(again.y).toBe(a.y);
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });

  it("maps ADD_EDGE to add-edge", () => {
    const ops = recordToOps(
      mutationRecord({
        kind: "ADD_EDGE",
        id: edgeId("e1"),
        label: "found_in",
        from: nodeId("finding-1"),
        to: nodeId("f1"),
      }),
    );

    expect(ops).toEqual([
      { kind: "add-edge", id: "e1", from: "finding-1", to: "f1", label: "found_in" },
    ]);
  });

  it("maps UPDATE_NODE to touch-node (visual hint only)", () => {
    const ops = recordToOps(
      mutationRecord({
        kind: "UPDATE_NODE",
        id: nodeId("f1"),
        expectedVersion: version(1),
        props: { status: "audited" },
      }),
    );

    expect(ops).toEqual([{ kind: "touch-node", id: "f1" }]);
  });

  it("ignores claim and release mutations (claim tinting is Wave 2)", () => {
    const claim = mutationRecord({
      kind: "CLAIM_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor-1"),
      now: 0,
      ttlMs: 1000,
    });
    const release = mutationRecord({
      kind: "RELEASE_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor-1"),
    });

    expect(recordToOps(claim)).toEqual([]);
    expect(recordToOps(release)).toEqual([]);
  });

  it("ignores events that are not graph mutations", () => {
    expect(
      recordToOps(recordOf(0, { type: "claim.acquired", nodeId: "f1", agentId: "auditor-1" })),
    ).toEqual([]);
    expect(recordToOps(recordOf(1, { type: "session.started", task: "audit" }))).toEqual([]);
  });
});

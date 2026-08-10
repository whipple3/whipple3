import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agentId, edgeId, nodeId } from "../src/ids.js";
import { apply, type Mutation, replay } from "../src/mutation.js";
import { availableWork, neighborhood, readableNeighborhood } from "../src/slice.js";
import { emptyState, type GraphState } from "../src/state.js";

const mustApply = (s: GraphState, m: Parameters<typeof apply>[1]): GraphState => {
  const r = apply(s, m);
  if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
  return r.value;
};

const seeded = (): GraphState => {
  let s = emptyState();
  s = mustApply(s, {
    kind: "ADD_NODE",
    id: nodeId("f1"),
    label: "CodeFile",
    props: { path: "a.ts", status: "pending" },
  });
  s = mustApply(s, {
    kind: "ADD_NODE",
    id: nodeId("f2"),
    label: "CodeFile",
    props: { path: "b.ts", status: "audited" },
  });
  s = mustApply(s, {
    kind: "ADD_NODE",
    id: nodeId("i1"),
    label: "SecurityIssue",
    props: { status: "pending" },
  });
  return s;
};

describe("availableWork — pull-mode work query (CLAUDE.md W1 §3)", () => {
  it("returns nodes of the trigger label whose props match", () => {
    const found = availableWork(seeded(), { label: "CodeFile", match: { status: "pending" } }, 0);
    expect(found.map((n) => n.id)).toEqual([nodeId("f1")]);
  });

  it("an empty match returns all nodes of the label", () => {
    const found = availableWork(seeded(), { label: "CodeFile", match: {} }, 0);
    expect(found.map((n) => n.id)).toEqual([nodeId("f1"), nodeId("f2")]);
  });

  it("excludes nodes under a valid claim and readmits them after expiry", () => {
    const s = mustApply(seeded(), {
      kind: "CLAIM_NODE",
      id: nodeId("f1"),
      agentId: agentId("auditor-1"),
      now: 0,
      ttlMs: 1000,
    });
    const during = availableWork(s, { label: "CodeFile", match: { status: "pending" } }, 500);
    expect(during).toEqual([]);
    const after = availableWork(s, { label: "CodeFile", match: { status: "pending" } }, 1500);
    expect(after.map((n) => n.id)).toEqual([nodeId("f1")]);
  });
});

const linked = (): GraphState => {
  let s = seeded();
  s = mustApply(s, {
    kind: "ADD_EDGE",
    id: edgeId("e1"),
    label: "HAS_ISSUE",
    from: nodeId("f1"),
    to: nodeId("i1"),
  });
  s = mustApply(s, {
    kind: "ADD_NODE",
    id: nodeId("i2"),
    label: "SecurityIssue",
    props: { status: "pending" },
  });
  s = mustApply(s, {
    kind: "ADD_EDGE",
    id: edgeId("e2"),
    label: "HAS_ISSUE",
    from: nodeId("f1"),
    to: nodeId("i2"),
  });
  return s;
};

describe("readableNeighborhood — policy-filtered slicing (SPEC §4.6, §4.7)", () => {
  it("filters during traversal: an unreadable node blocks the path and never leaks via an edge", () => {
    // i1 -(HAS_ISSUE)- f1 -(HAS_ISSUE)- i2: f1 is unreadable, so i2 is unreachable at any depth.
    const slice = readableNeighborhood(linked(), nodeId("i1"), 5, ["SecurityIssue", "HAS_ISSUE"]);
    expect(slice.nodes.map((n) => n.id)).toEqual([nodeId("i1")]);
    expect(slice.edges).toEqual([]);
  });

  it("an unreadable edge label blocks traversal even between readable nodes", () => {
    const slice = readableNeighborhood(linked(), nodeId("f1"), 5, ["CodeFile", "SecurityIssue"]);
    expect(slice.nodes.map((n) => n.id)).toEqual([nodeId("f1")]);
    expect(slice.edges).toEqual([]);
  });

  it("an unreadable root yields an empty slice", () => {
    const slice = readableNeighborhood(linked(), nodeId("f1"), 2, ["SecurityIssue"]);
    expect(slice.nodes).toEqual([]);
    expect(slice.edges).toEqual([]);
  });

  it("equals the unfiltered neighborhood when every label is readable", () => {
    const all = ["CodeFile", "SecurityIssue", "HAS_ISSUE"];
    expect(readableNeighborhood(linked(), nodeId("f1"), 2, all)).toEqual(
      neighborhood(linked(), nodeId("f1"), 2),
    );
  });

  it("property: a filtered slice never contains a label outside the reader's set", () => {
    const labels = ["CodeFile", "SecurityIssue", "Fix", "HAS_ISSUE"];
    const arbNode = fc.record({
      kind: fc.constant("ADD_NODE" as const),
      id: fc.constantFrom("n1", "n2", "n3", "n4").map(nodeId),
      label: fc.constantFrom(...labels),
      props: fc.constant<Readonly<Record<string, unknown>>>({}),
    });
    const arbEdge = fc.record({
      kind: fc.constant("ADD_EDGE" as const),
      id: fc.constantFrom("e1", "e2", "e3", "e4").map(edgeId),
      label: fc.constantFrom(...labels),
      from: fc.constantFrom("n1", "n2", "n3", "n4").map(nodeId),
      to: fc.constantFrom("n1", "n2", "n3", "n4").map(nodeId),
    });
    fc.assert(
      fc.property(
        fc.array(fc.oneof(arbNode, arbEdge) as fc.Arbitrary<Mutation>, { maxLength: 30 }),
        fc.subarray(labels),
        fc.constantFrom("n1", "n2", "n3", "n4").map(nodeId),
        fc.integer({ min: 0, max: 5 }),
        (ms, allowed, root, depth) => {
          const { state } = replay(ms, emptyState());
          const slice = readableNeighborhood(state, root, depth, allowed);
          for (const n of slice.nodes) expect(allowed).toContain(n.label);
          for (const e of slice.edges) {
            expect(allowed).toContain(e.label);
            expect(slice.nodes.some((n) => n.id === e.from)).toBe(true);
            expect(slice.nodes.some((n) => n.id === e.to)).toBe(true);
          }
        },
      ),
    );
  });
});

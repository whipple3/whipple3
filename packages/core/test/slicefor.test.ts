import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { edgeId, nodeId } from "../src/ids.js";
import { apply, type Mutation, replay } from "../src/mutation.js";
import {
  defineEdge,
  defineNode,
  defineSlice,
  type FollowRule,
  follow,
  type SliceDecl,
} from "../src/schema.js";
import { readableNeighborhood, sliceFor } from "../src/slice.js";
import { emptyState, type GraphState } from "../src/state.js";

const mustApply = (s: GraphState, m: Parameters<typeof apply>[1]): GraphState => {
  const r = apply(s, m);
  if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
  return r.value;
};

const CodeFile = defineNode("CodeFile", { path: z.string() });
const SecurityIssue = defineNode("SecurityIssue", { severity: z.enum(["low", "high"]) });
const Fix = defineNode("Fix", { approved: z.boolean() });
const HasIssue = defineEdge("HAS_ISSUE", { from: CodeFile, to: SecurityIssue });
const FixedBy = defineEdge("FIXED_BY", { from: SecurityIssue, to: Fix });
const DependsOn = defineEdge("DEPENDS_ON", { from: CodeFile, to: CodeFile });

const ALL = ["CodeFile", "SecurityIssue", "Fix", "Report", "HAS_ISSUE", "FIXED_BY", "MENTIONS"];

/**
 * f1:CodeFile ─HAS_ISSUE→ i1,i2:SecurityIssue; i1 ─FIXED_BY→ x1:Fix;
 * r1:Report ─MENTIONS→ x1; plus a schema-violating HAS_ISSUE f1→r1.
 */
const audited = (): GraphState => {
  let s = emptyState();
  const node = (id: string, label: string, props: Record<string, unknown>): void => {
    s = mustApply(s, { kind: "ADD_NODE", id: nodeId(id), label, props });
  };
  const edge = (id: string, label: string, from: string, to: string): void => {
    s = mustApply(s, {
      kind: "ADD_EDGE",
      id: edgeId(id),
      label,
      from: nodeId(from),
      to: nodeId(to),
    });
  };
  node("f1", "CodeFile", { path: "a.ts" });
  node("i1", "SecurityIssue", { severity: "high" });
  node("i2", "SecurityIssue", { severity: "low" });
  node("x1", "Fix", { approved: false });
  node("r1", "Report", { path: "report.md" });
  edge("e1", "HAS_ISSUE", "f1", "i1");
  edge("e2", "HAS_ISSUE", "f1", "i2");
  edge("e3", "FIXED_BY", "i1", "x1");
  edge("e4", "MENTIONS", "r1", "x1");
  edge("e5", "HAS_ISSUE", "f1", "r1"); // schema-violating endpoint: Report is not declared
  return s;
};

const ids = (slice: { nodes: readonly { id: string }[] }): readonly string[] =>
  [...slice.nodes.map((n) => n.id)].sort();
const edgeIds = (slice: { edges: readonly { id: string }[] }): readonly string[] =>
  [...slice.edges.map((e) => e.id)].sort();

const AuditorSlice = defineSlice(CodeFile, [follow(HasIssue)]);
const FixerSlice = defineSlice(CodeFile, [follow(HasIssue, { next: [follow(FixedBy)] })]);

describe("sliceFor — role-declared slices (SPEC §4.7, ROADMAP Stage 2)", () => {
  it("returns exactly the declared neighborhood: the auditor sees issues, nothing further", () => {
    const slice = sliceFor(audited(), nodeId("f1"), AuditorSlice, ALL);
    expect(ids(slice)).toEqual(["f1", "i1", "i2"]);
    expect(edgeIds(slice)).toEqual(["e1", "e2"]);
  });

  it("a schema-violating edge endpoint is excluded: undeclared labels never leak", () => {
    // e5 is a HAS_ISSUE edge, but r1 is a Report — outside the declared endpoints.
    const slice = sliceFor(audited(), nodeId("f1"), AuditorSlice, ALL);
    expect(ids(slice)).not.toContain("r1");
    expect(edgeIds(slice)).not.toContain("e5");
  });

  it("next rules continue from the nodes the parent rule reached", () => {
    const slice = sliceFor(audited(), nodeId("f1"), FixerSlice, ALL);
    expect(ids(slice)).toEqual(["f1", "i1", "i2", "x1"]);
    expect(edgeIds(slice)).toEqual(["e1", "e2", "e3"]);
  });

  it("hops bounds consecutive hops along one edge label", () => {
    let s = emptyState();
    for (const id of ["c1", "c2", "c3", "c4"]) {
      s = mustApply(s, { kind: "ADD_NODE", id: nodeId(id), label: "CodeFile", props: {} });
    }
    for (const [id, from, to] of [
      ["d1", "c1", "c2"],
      ["d2", "c2", "c3"],
      ["d3", "c3", "c4"],
    ] as const) {
      s = mustApply(s, {
        kind: "ADD_EDGE",
        id: edgeId(id),
        label: "DEPENDS_ON",
        from: nodeId(from),
        to: nodeId(to),
      });
    }
    const decl = defineSlice(CodeFile, [follow(DependsOn, { hops: 2 })]);
    const slice = sliceFor(s, nodeId("c1"), decl, ["CodeFile", "DEPENDS_ON"]);
    expect(ids(slice)).toEqual(["c1", "c2", "c3"]);
    expect(edgeIds(slice)).toEqual(["d1", "d2"]); // d3 would need a third hop
  });

  it("declared but unreadable: an unreadable node blocks the path through itself", () => {
    // SecurityIssue is not readable, so the fixer's declared path to x1 is severed.
    const slice = sliceFor(audited(), nodeId("f1"), FixerSlice, [
      "CodeFile",
      "Fix",
      "HAS_ISSUE",
      "FIXED_BY",
    ]);
    expect(ids(slice)).toEqual(["f1"]);
    expect(slice.edges).toEqual([]);
  });

  it("an unreadable edge label yields no traversal along it", () => {
    const readable = ALL.filter((l) => l !== "HAS_ISSUE");
    const slice = sliceFor(audited(), nodeId("f1"), FixerSlice, readable);
    expect(ids(slice)).toEqual(["f1"]);
    expect(slice.edges).toEqual([]);
  });

  it("an unreadable root yields an empty slice", () => {
    const readable = ALL.filter((l) => l !== "CodeFile");
    const slice = sliceFor(audited(), nodeId("f1"), AuditorSlice, readable);
    expect(slice).toEqual({ nodes: [], edges: [] });
  });

  it("a root whose label is not the declared root yields an empty slice", () => {
    const slice = sliceFor(audited(), nodeId("r1"), AuditorSlice, ALL);
    expect(slice).toEqual({ nodes: [], edges: [] });
  });

  it("a missing root yields an empty slice", () => {
    const slice = sliceFor(audited(), nodeId("ghost"), AuditorSlice, ALL);
    expect(slice).toEqual({ nodes: [], edges: [] });
  });

  it("an edge between two included nodes in an undeclared orientation is not emitted", () => {
    // i1 —HAS_ISSUE→ i2: both nodes are in the slice, but the declaration says
    // HAS_ISSUE runs CodeFile—SecurityIssue, never SecurityIssue—SecurityIssue.
    const s = mustApply(audited(), {
      kind: "ADD_EDGE",
      id: edgeId("e6"),
      label: "HAS_ISSUE",
      from: nodeId("i1"),
      to: nodeId("i2"),
    });
    const slice = sliceFor(s, nodeId("f1"), AuditorSlice, ALL);
    expect(ids(slice)).toEqual(["f1", "i1", "i2"]);
    expect(edgeIds(slice)).toEqual(["e1", "e2"]);
  });
});

/** One shared label pool for nodes, edges, decls AND policies — stresses collisions. */
const POOL = ["CodeFile", "SecurityIssue", "Fix", "HAS_ISSUE", "FIXED_BY"];

const arbNode = fc.record({
  kind: fc.constant("ADD_NODE" as const),
  id: fc.constantFrom("n1", "n2", "n3", "n4", "n5").map(nodeId),
  label: fc.constantFrom(...POOL),
  props: fc.constant<Readonly<Record<string, unknown>>>({}),
});
const arbEdge = fc.record({
  kind: fc.constant("ADD_EDGE" as const),
  id: fc.constantFrom("e1", "e2", "e3", "e4", "e5").map(edgeId),
  label: fc.constantFrom(...POOL),
  from: fc.constantFrom("n1", "n2", "n3", "n4", "n5").map(nodeId),
  to: fc.constantFrom("n1", "n2", "n3", "n4", "n5").map(nodeId),
});
const arbMutations = fc.array(fc.oneof(arbNode, arbEdge) as fc.Arbitrary<Mutation>, {
  maxLength: 30,
});

const arbRule = (depth: number): fc.Arbitrary<FollowRule> =>
  fc.record({
    edge: fc.constantFrom(...POOL),
    from: fc.constantFrom(...POOL),
    to: fc.constantFrom(...POOL),
    hops: fc.integer({ min: 0, max: 3 }),
    next: depth === 0 ? fc.constant([]) : fc.array(arbRule(depth - 1), { maxLength: 2 }),
  });
const arbDecl: fc.Arbitrary<SliceDecl> = fc.record({
  kind: fc.constant("slice" as const),
  root: fc.constantFrom(...POOL),
  follow: fc.array(arbRule(1), { maxLength: 3 }),
});

const totalHops = (rules: readonly FollowRule[]): number =>
  rules.reduce((deepest, r) => Math.max(deepest, r.hops + totalHops(r.next)), 0);

const flatRules = (rules: readonly FollowRule[]): readonly FollowRule[] =>
  rules.flatMap((r) => [r, ...flatRules(r.next)]);

describe("sliceFor invariants (fast-check)", () => {
  it("property: NARROW, never widen — sliceFor ⊆ readableNeighborhood, any decl/policy/graph", () => {
    fc.assert(
      fc.property(
        arbMutations,
        arbDecl,
        fc.subarray(POOL),
        fc.constantFrom("n1", "n2", "n3", "n4", "n5").map(nodeId),
        (ms, decl, readable, root) => {
          const { state } = replay(ms, emptyState());
          const slice = sliceFor(state, root, decl, readable);
          const rn = readableNeighborhood(state, root, totalHops(decl.follow), readable);
          const rnNodes = new Set(rn.nodes.map((n) => n.id));
          const rnEdges = new Set(rn.edges.map((e) => e.id));
          for (const n of slice.nodes) expect(rnNodes.has(n.id)).toBe(true);
          for (const e of slice.edges) expect(rnEdges.has(e.id)).toBe(true);
        },
      ),
    );
  });

  it("property: everything emitted is BOTH declared and readable, and edges never dangle", () => {
    fc.assert(
      fc.property(
        arbMutations,
        arbDecl,
        fc.subarray(POOL),
        fc.constantFrom("n1", "n2", "n3", "n4", "n5").map(nodeId),
        (ms, decl, readable, root) => {
          const { state } = replay(ms, emptyState());
          const slice = sliceFor(state, root, decl, readable);
          const rules = flatRules(decl.follow);
          const declaredNodes = new Set([decl.root, ...rules.flatMap((r) => [r.from, r.to])]);
          const declaredEdges = new Set(rules.map((r) => r.edge));
          for (const n of slice.nodes) {
            expect(readable).toContain(n.label);
            expect(declaredNodes.has(n.label)).toBe(true);
          }
          const sliceNodeIds = new Set(slice.nodes.map((n) => n.id));
          for (const e of slice.edges) {
            expect(readable).toContain(e.label);
            expect(declaredEdges.has(e.label)).toBe(true);
            expect(sliceNodeIds.has(e.from)).toBe(true);
            expect(sliceNodeIds.has(e.to)).toBe(true);
          }
        },
      ),
    );
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineEdge, defineNode, defineSlice, follow, type SliceDecl } from "../src/schema.js";

/**
 * Role-declared slices (ROADMAP Stage 2 "slice tuning", SPEC §4.7): a role's slice shape
 * is DATA in the schema — which labels it sees, how far it follows which edges. Same
 * enforcement as schema.test.ts: tsconfig includes test/, an unused @ts-expect-error is
 * TS2578, so every rejection below is load-bearing in `pnpm typecheck`.
 */

const CodeFile = defineNode("CodeFile", {
  path: z.string(),
  status: z.enum(["pending", "audited"]),
});
const SecurityIssue = defineNode("SecurityIssue", { severity: z.enum(["low", "high"]) });
const Fix = defineNode("Fix", { approved: z.boolean() });
const Report = defineNode("Report", { path: z.string() });

const HasIssue = defineEdge("HAS_ISSUE", { from: CodeFile, to: SecurityIssue });
const FixedBy = defineEdge("FIXED_BY", { from: SecurityIssue, to: Fix });
const DependsOn = defineEdge("DEPENDS_ON", { from: CodeFile, to: CodeFile });
const Mentions = defineEdge("MENTIONS", { from: Report, to: Fix });

describe("defineSlice / follow runtime", () => {
  it("declares root and edge shape with defaults: one hop, no continuation", () => {
    const decl = defineSlice(CodeFile, [follow(HasIssue)]);
    expect(decl).toEqual({
      kind: "slice",
      root: "CodeFile",
      follow: [{ edge: "HAS_ISSUE", from: "CodeFile", to: "SecurityIssue", hops: 1, next: [] }],
    });
  });

  it("carries hops and nested continuation rules verbatim", () => {
    const decl = defineSlice(CodeFile, [
      follow(HasIssue, { next: [follow(FixedBy)] }),
      follow(DependsOn, { hops: 3 }),
    ]);
    expect(decl.follow[0]?.next).toEqual([
      { edge: "FIXED_BY", from: "SecurityIssue", to: "Fix", hops: 1, next: [] },
    ]);
    expect(decl.follow[1]?.hops).toBe(3);
  });

  it("is pure data — JSON round-trips losslessly (no functions, not a query language)", () => {
    const decl = defineSlice(CodeFile, [follow(HasIssue, { next: [follow(FixedBy)] })]);
    expect(JSON.parse(JSON.stringify(decl))).toEqual(decl);
  });
});

describe("slice declaration literal inference (compile-time contract)", () => {
  it("accepts anchored declarations", () => {
    defineSlice(CodeFile, [follow(HasIssue)]);
    defineSlice(CodeFile, [follow(HasIssue, { next: [follow(FixedBy)] })]);
    defineSlice(CodeFile, [follow(DependsOn, { hops: 3 }), follow(HasIssue)]);
    defineSlice(CodeFile, []); // "just the root" — a legitimate, maximally narrow slice
  });

  it("infers the root label as a literal and stays assignable to bare SliceDecl", () => {
    const decl = defineSlice(CodeFile, [follow(HasIssue)]);
    expectTypeOf(decl.root).toEqualTypeOf<"CodeFile">();
    expectTypeOf(decl).toExtend<SliceDecl>();
  });

  it("rejects a top-level edge that does not touch the root — the slice-decl typo case", () => {
    // @ts-expect-error FIXED_BY runs SecurityIssue—Fix; it never touches CodeFile
    defineSlice(CodeFile, [follow(FixedBy)]);
  });

  it("rejects a continuation edge that does not touch its parent's endpoints", () => {
    // @ts-expect-error MENTIONS runs Report—Fix; HAS_ISSUE ends at CodeFile/SecurityIssue
    follow(HasIssue, { next: [follow(Mentions)] });
  });

  it("rejects a node type where an edge is expected", () => {
    // @ts-expect-error a node type is not an edge to follow
    follow(SecurityIssue);
  });

  it("rejects an edge type where the root node is expected", () => {
    // @ts-expect-error a slice is rooted at a node type, not an edge
    defineSlice(HasIssue, []);
  });
});

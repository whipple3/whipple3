import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineEdge, defineNode, type Trigger } from "../src/schema.js";

/**
 * Type-level tests (SPEC §9.3: the type-gymnastics budget is spent on the public DSL).
 * Enforcement is `pnpm typecheck`: core's tsconfig includes test/, and an unused
 * `@ts-expect-error` is TS2578 — so if the DSL ever stops rejecting a case below,
 * the build fails. `expectTypeOf` assertions are checked by the same tsc run.
 */

const CodeFile = defineNode("CodeFile", {
  path: z.string(),
  status: z.enum(["pending", "audited"]),
  priority: z.union([z.literal(1), z.literal(2)]),
});

const SecurityIssue = defineNode("SecurityIssue", {
  severity: z.enum(["low", "high"]),
});

describe("defineNode runtime", () => {
  it("carries label and kind", () => {
    expect(CodeFile.kind).toBe("node");
    expect(CodeFile.label).toBe("CodeFile");
  });

  it("props parse valid prop values", () => {
    const parsed = CodeFile.props.safeParse({ path: "src/a.ts", status: "pending", priority: 1 });
    expect(parsed.success).toBe(true);
  });

  it("props reject a typo'd literal at runtime — the boundary mirror of the compile error", () => {
    const parsed = CodeFile.props.safeParse({ path: "src/a.ts", status: "pendig", priority: 1 });
    expect(parsed.success).toBe(false);
  });
});

describe("when() runtime", () => {
  it("produces a trigger carrying the node label and the match verbatim", () => {
    const trigger = CodeFile.when({ status: "pending" });
    expect(trigger).toEqual({ label: "CodeFile", match: { status: "pending" } });
  });
});

describe("defineEdge runtime", () => {
  it("extracts endpoint labels from the node types", () => {
    const HasIssue = defineEdge("has_issue", { from: CodeFile, to: SecurityIssue });
    expect(HasIssue).toEqual({
      kind: "edge",
      label: "has_issue",
      from: "CodeFile",
      to: "SecurityIssue",
    });
  });
});

describe("when() literal inference (compile-time contract)", () => {
  it("accepts valid literal matches", () => {
    CodeFile.when({ status: "pending" });
    CodeFile.when({ status: "audited", priority: 2 });
    CodeFile.when({ path: "src/a.ts" });
    CodeFile.when({}); // "any CodeFile" — a legitimate trigger
  });

  it("rejects a typo'd prop VALUE — the canonical SPEC §9.3 case", () => {
    // @ts-expect-error "pendig" is not "pending" | "audited"
    CodeFile.when({ status: "pendig" });
  });

  it("rejects a typo'd prop NAME in an inline literal", () => {
    // @ts-expect-error "staus" is not a declared prop of CodeFile
    CodeFile.when({ staus: "pending" });
  });

  it("rejects a typo'd prop NAME even when the match is built elsewhere", () => {
    // Excess-property checking only fires on inline literals; this must NOT leak through.
    const indirect = { path: "src/a.ts", staus: "pending" };
    // @ts-expect-error "staus" is not a declared prop of CodeFile
    CodeFile.when(indirect);
  });

  it("rejects a prop value of the wrong type entirely", () => {
    // @ts-expect-error path is a string, not a number
    CodeFile.when({ path: 42 });
  });

  it("rejects an out-of-union literal number", () => {
    // @ts-expect-error priority is 1 | 2
    CodeFile.when({ priority: 3 });
  });

  it("infers the trigger label as a literal", () => {
    const trigger = CodeFile.when({ status: "pending" });
    expectTypeOf(trigger.label).toEqualTypeOf<"CodeFile">();
  });

  it("carries the inferred match type on the trigger", () => {
    const trigger = CodeFile.when({ status: "pending" });
    expectTypeOf(trigger.match).toEqualTypeOf<{ readonly status: "pending" }>();
    // @ts-expect-error the trigger match has no "staus" key to read back
    void trigger.match.staus;
  });

  it("keeps specific triggers assignable to the bare Trigger slice.ts consumes", () => {
    const trigger = CodeFile.when({ status: "pending" });
    expectTypeOf(trigger).toExtend<Trigger>();
  });
});

describe("defineEdge literal inference (compile-time contract)", () => {
  it("infers endpoint labels as literals, not string", () => {
    const HasIssue = defineEdge("has_issue", { from: CodeFile, to: SecurityIssue });
    expectTypeOf(HasIssue.label).toEqualTypeOf<"has_issue">();
    expectTypeOf(HasIssue.from).toEqualTypeOf<"CodeFile">();
    expectTypeOf(HasIssue.to).toEqualTypeOf<"SecurityIssue">();
  });
});

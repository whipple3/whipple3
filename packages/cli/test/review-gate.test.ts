import { edgeId, nodeId, type Slice, version } from "@whipple3/core";
import { describe, expect, it } from "vitest";
import { reviewGate } from "../src/review-gate.js";

const node = (id: string, label: string, props: Record<string, unknown>) => ({
  id: nodeId(id),
  label,
  props,
  version: version(1),
});

const slice = (nodes: ReturnType<typeof node>[]): Slice => ({
  nodes: [node("pr:7", "PullRequest", { number: 7, branch: "feat/a", state: "open" }), ...nodes],
  edges: [
    { id: edgeId("e"), label: "reviews", from: nodeId("review:7:rev-1"), to: nodeId("pr:7") },
  ],
  claims: [],
});

describe("reviewGate — verdicts and blocking comments stop the merge (design §4)", () => {
  it("no reviews at all ⇒ nothing to say", () => {
    expect(reviewGate(slice([]), 7)).toEqual([]);
  });

  it("request_changes ⇒ names the reviewer", () => {
    const s = slice([
      node("review:7:rev-1", "Review", { pr: 7, reviewer: "rev-1", verdict: "request_changes" }),
    ]);
    expect(reviewGate(s, 7)).toEqual(["changes requested by rev-1"]);
  });

  it("an open blocking comment ⇒ names it and its path", () => {
    const s = slice([
      node("comment:7:x", "ReviewComment", {
        pr: 7,
        path: "src/a.ts",
        body: "x",
        severity: "blocking",
        status: "open",
      }),
    ]);
    expect(reviewGate(s, 7)).toEqual(["blocking: comment:7:x src/a.ts"]);
  });

  it("addressed blocking + approve ⇒ clear; an open nit never blocks", () => {
    const s = slice([
      node("review:7:rev-1", "Review", { pr: 7, reviewer: "rev-1", verdict: "approve" }),
      node("comment:7:x", "ReviewComment", {
        pr: 7,
        path: "src/a.ts",
        body: "x",
        severity: "blocking",
        status: "addressed",
      }),
      node("comment:7:y", "ReviewComment", {
        pr: 7,
        path: "src/a.ts",
        body: "y",
        severity: "nit",
        status: "open",
      }),
    ]);
    expect(reviewGate(s, 7)).toEqual([]);
  });

  it("another PR's review in the slice is ignored", () => {
    const s = slice([
      node("review:8:rev-1", "Review", { pr: 8, reviewer: "rev-1", verdict: "request_changes" }),
    ]);
    expect(reviewGate(s, 7)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { agentId, nodeId } from "../src/ids.js";
import { apply } from "../src/mutation.js";
import { availableWork } from "../src/slice.js";
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

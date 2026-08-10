import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agentId, nodeId, version } from "../src/ids.js";
import { apply, type Mutation, replay } from "../src/mutation.js";
import { emptyState } from "../src/state.js";

// A small ID pool on purpose: collisions exercise NODE_EXISTS / ALREADY_CLAIMED paths.
const arbNodeId = fc.constantFrom("n1", "n2", "n3", "n4").map(nodeId);

const arbMutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant("ADD_NODE" as const),
    id: arbNodeId,
    label: fc.constantFrom("CodeFile", "SecurityIssue"),
    props: fc.constant<Readonly<Record<string, unknown>>>({}),
  }),
  fc.record({
    kind: fc.constant("CLAIM_NODE" as const),
    id: arbNodeId,
    agentId: fc.constantFrom("a1", "a2").map(agentId),
    now: fc.nat(),
    ttlMs: fc.nat(),
  }),
);

describe("core invariants (SPEC §9.4)", () => {
  it("replay is deterministic", () => {
    fc.assert(
      fc.property(fc.array(arbMutation, { maxLength: 50 }), (ms) => {
        const a = replay(ms, emptyState());
        const b = replay(ms, emptyState());
        expect(a.state).toEqual(b.state);
        expect(a.rejected).toEqual(b.rejected);
      }),
    );
  });

  it("a stale version is always rejected", () => {
    const s0 = emptyState();
    const id = nodeId("n1");
    const r1 = apply(s0, { kind: "ADD_NODE", id, label: "CodeFile", props: { status: "pending" } });
    if (!r1.ok) throw new Error("setup failed");
    const r2 = apply(r1.value, {
      kind: "UPDATE_NODE",
      id,
      expectedVersion: version(1),
      props: { status: "audited" },
    });
    if (!r2.ok) throw new Error("setup failed");
    const stale = apply(r2.value, {
      kind: "UPDATE_NODE",
      id,
      expectedVersion: version(1),
      props: { status: "has_issues" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("VERSION_CONFLICT");
  });

  it("a claim is never double-held while the lease is valid", () => {
    const s0 = emptyState();
    const id = nodeId("n1");
    const r1 = apply(s0, { kind: "ADD_NODE", id, label: "CodeFile", props: {} });
    if (!r1.ok) throw new Error("setup failed");
    const c1 = apply(r1.value, {
      kind: "CLAIM_NODE",
      id,
      agentId: agentId("a1"),
      now: 0,
      ttlMs: 1000,
    });
    if (!c1.ok) throw new Error("setup failed");
    const c2 = apply(c1.value, {
      kind: "CLAIM_NODE",
      id,
      agentId: agentId("a2"),
      now: 500,
      ttlMs: 1000,
    });
    expect(c2.ok).toBe(false);
    const c3 = apply(c1.value, {
      kind: "CLAIM_NODE",
      id,
      agentId: agentId("a2"),
      now: 1500,
      ttlMs: 1000,
    });
    expect(c3.ok).toBe(true);
  });
});

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { agentId, nodeId } from "../src/ids.js";
import { apply, type Mutation } from "../src/mutation.js";
import type { ClaimRecord } from "../src/state.js";
import { emptyState } from "../src/state.js";

// Small pools on purpose: collisions exercise renewal, ALREADY_CLAIMED and expiry paths.
const arbNodeId = fc.constantFrom("n1", "n2", "n3").map(nodeId);
const arbAgentId = fc.constantFrom("a1", "a2", "a3").map(agentId);

const arbClaimCycle: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({
    kind: fc.constant("ADD_NODE" as const),
    id: arbNodeId,
    label: fc.constant("CodeFile"),
    props: fc.constant<Readonly<Record<string, unknown>>>({}),
  }),
  fc.record({
    kind: fc.constant("CLAIM_NODE" as const),
    id: arbNodeId,
    agentId: arbAgentId,
    now: fc.integer({ min: 0, max: 10_000 }),
    ttlMs: fc.integer({ min: 1, max: 5_000 }),
  }),
  fc.record({ kind: fc.constant("RELEASE_NODE" as const), id: arbNodeId, agentId: arbAgentId }),
);

const stillValid = (claim: ClaimRecord | undefined, now: number): claim is ClaimRecord =>
  claim !== undefined && claim.expiresAt > now;

describe("claim/lease invariants (Stage 2 collision proof; D2 ruled 2026-08-10)", () => {
  it("no node ever has two simultaneously-valid claims by different agents", () => {
    fc.assert(
      fc.property(fc.array(arbClaimCycle, { maxLength: 60 }), (ms) => {
        let state = emptyState();
        for (const m of ms) {
          const prior =
            m.kind === "CLAIM_NODE" || m.kind === "RELEASE_NODE"
              ? state.claims.get(m.id)
              : undefined;
          const r = apply(state, m);

          if (m.kind === "CLAIM_NODE" && r.ok) {
            // A grant may displace a valid lease only by renewing it — same agent (D2).
            if (stillValid(prior, m.now)) expect(prior.agentId).toBe(m.agentId);
          }
          if (m.kind === "CLAIM_NODE" && !r.ok && r.error.code === "ALREADY_CLAIMED") {
            // A refusal names the true, still-valid holder — never the claimant.
            expect(stillValid(prior, m.now)).toBe(true);
            expect(r.error.holder).toBe(prior?.agentId);
            expect(r.error.holder).not.toBe(m.agentId);
          }
          if (m.kind === "CLAIM_NODE" && !r.ok && r.error.code === "NODE_NOT_FOUND") {
            expect(state.nodes.has(m.id)).toBe(false);
          }
          if (m.kind === "RELEASE_NODE") {
            // Only the holder can release; anything else is CLAIM_NOT_HELD, never a grant.
            const held = prior !== undefined && prior.agentId === m.agentId;
            expect(r.ok).toBe(held);
            if (r.ok) expect(r.value.claims.has(m.id)).toBe(false);
            if (!r.ok) expect(r.error.code).toBe("CLAIM_NOT_HELD");
          }

          if (r.ok) state = r.value;
        }
      }),
    );
  });

  it("a same-agent re-claim RENEWS the lease: expiry resets from the re-claim (D2)", () => {
    const id = nodeId("n1");
    const added = apply(emptyState(), { kind: "ADD_NODE", id, label: "CodeFile", props: {} });
    if (!added.ok) throw new Error("setup failed");
    const first = apply(added.value, {
      kind: "CLAIM_NODE",
      id,
      agentId: agentId("a1"),
      now: 0,
      ttlMs: 1000,
    });
    if (!first.ok) throw new Error("setup failed");
    expect(first.value.claims.get(id)?.expiresAt).toBe(1000);

    const renewed = apply(first.value, {
      kind: "CLAIM_NODE",
      id,
      agentId: agentId("a1"),
      now: 600,
      ttlMs: 1000,
    });
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(renewed.value.claims.get(id)?.expiresAt).toBe(1600);
  });
});

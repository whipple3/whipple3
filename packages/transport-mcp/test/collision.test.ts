import { emptyState, type Mutation, nodeId, replay } from "@whipple3/core";
import type { createMemoryLog } from "@whipple3/log";
import { describe, expect, it } from "vitest";
import type { createSession } from "../src/session.js";
import { makeSession } from "./fixtures.js";

/** Deterministic chaos: a seeded PRNG drives microtask yields, so reruns interleave identically. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const yieldSome = async (rand: () => number): Promise<void> => {
  const times = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < times; i++) await Promise.resolve();
};

const mutationsOf = async (log: ReturnType<typeof createMemoryLog>): Promise<Mutation[]> => {
  const out: Mutation[] = [];
  for (const r of await log.read())
    if (r.event.type === "graph.mutation") out.push(r.event.mutation);
  return out;
};

interface SwarmRun {
  readonly session: ReturnType<typeof createSession>;
  readonly log: ReturnType<typeof createMemoryLog>;
  readonly granted: readonly { node: string; agent: string }[];
  readonly refused: readonly { node: string; agent: string; holder: string }[];
  readonly updates: readonly { node: string; agent: string }[];
  readonly conflicts: readonly { node: string; current: number }[];
}

const FILES = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"];
const AUDITORS = ["auditor-1", "auditor-2", "auditor-3", "auditor-4", "auditor-5"];

/** N agents over ONE session: interleaved next→claim→update loops until no work remains. */
const runSwarm = async (seed: number): Promise<SwarmRun> => {
  const { session, as, log } = makeSession();
  const scanner = as("scanner");
  for (const id of FILES) {
    await scanner.post({
      mutation: { kind: "ADD_NODE", id, label: "CodeFile", props: { status: "pending" } },
    });
  }

  const granted: { node: string; agent: string }[] = [];
  const refused: { node: string; agent: string; holder: string }[] = [];
  const updates: { node: string; agent: string }[] = [];
  const conflicts: { node: string; current: number }[] = [];

  const worker = async (name: string, rand: () => number): Promise<void> => {
    const me = as(name);
    for (;;) {
      await yieldSome(rand);
      const found = await me.next({ label: "CodeFile", match: { status: "pending" } });
      if (!found.ok) throw new Error("next failed without an ACL configured");
      if (found.value.node === null) return;
      const target = found.value.node;

      await yieldSome(rand);
      const claimed = await me.claim({ id: target.id, ttlMs: 60_000 });
      if (!claimed.ok) {
        if (claimed.error.code !== "ALREADY_CLAIMED")
          throw new Error(`unexpected claim error: ${claimed.error.code}`);
        refused.push({ node: target.id, agent: name, holder: claimed.error.holder });
        continue; // lost the race — go find other work
      }
      granted.push({ node: target.id, agent: name });

      await yieldSome(rand);
      const updated = await me.post({
        mutation: {
          kind: "UPDATE_NODE",
          id: target.id,
          expectedVersion: target.version,
          props: { status: "audited", by: name },
        },
      });
      if (updated.ok) updates.push({ node: target.id, agent: name });
      else if (updated.error.code === "VERSION_CONFLICT")
        conflicts.push({ node: target.id, current: updated.error.current });
      else throw new Error(`unexpected update error: ${updated.error.code}`);
    }
  };

  await Promise.all(AUDITORS.map((a, i) => worker(a, mulberry32(seed + i * 101))));
  return { session, log, granted, refused, updates, conflicts };
};

describe("collision proof — N agents, one session, interleaved loops (Stage 2)", () => {
  it("every node is claimed once, audited once, by the claim's own holder", async () => {
    const run = await runSwarm(42);

    // Zero duplicate valid claims: exactly one grant per node, all leases still valid.
    expect(run.granted).toHaveLength(FILES.length);
    expect(new Set(run.granted.map((g) => g.node)).size).toBe(FILES.length);

    // Zero duplicate work, zero lost updates: claim discipline made every update first-try.
    expect(run.updates).toHaveLength(FILES.length);
    expect(run.conflicts).toEqual([]);

    // The race was real: losers exist, and each surfaced as a typed refusal.
    expect(run.refused.length).toBeGreaterThan(0);

    // Every refusal names the true holder — the one agent granted that node — never the claimant.
    const holderOf = new Map(run.granted.map((g) => [g.node, g.agent]));
    for (const r of run.refused) {
      expect(r.holder).toBe(holderOf.get(r.node));
      expect(r.holder).not.toBe(r.agent);
    }

    // Final state: audited exactly once (version 2), attributed to the claim holder.
    for (const [id, node] of run.session.snapshot().nodes) {
      expect(node.props.status).toBe("audited");
      expect(node.version).toBe(2);
      expect(node.props.by).toBe(holderOf.get(id));
    }
  });

  it("the log is the source of truth: replaying it reproduces the exact final state", async () => {
    const run = await runSwarm(42);
    const replayed = replay(await mutationsOf(run.log), emptyState());
    expect(replayed.rejected).toEqual([]);
    expect(replayed.state).toEqual(run.session.snapshot());
  });

  it("the swarm is deterministic: same seed, same mutation log", async () => {
    const [a, b] = [await runSwarm(7), await runSwarm(7)];
    expect(await mutationsOf(a.log)).toEqual(await mutationsOf(b.log));
    expect(a.granted).toEqual(b.granted);
    expect(a.refused).toEqual(b.refused);
  });

  it("undisciplined concurrent updates: one wins, the loser's conflict surfaces and retry merges", async () => {
    const { session, as } = makeSession();
    await as("scanner").post({
      mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
    });
    const update = (agent: string, expectedVersion: number, props: Record<string, unknown>) =>
      as(agent).post({ mutation: { kind: "UPDATE_NODE", id: "f1", expectedVersion, props } });

    // Both read version 1; both write without claiming. Optimistic concurrency arbitrates.
    const results = await Promise.all([
      update("auditor-1", 1, { a: true }),
      update("auditor-2", 1, { b: true }),
    ]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // The losing write is rejected loudly, naming the version that beat it — never silently merged.
    const loser = losers[0];
    if (loser === undefined || loser.ok) throw new Error("expected one losing update");
    if (loser.error.code !== "VERSION_CONFLICT") throw new Error("expected VERSION_CONFLICT");
    expect(loser.error.current).toBe(2);

    // Recovery: retry against the current version merges forward; both writes end up visible.
    const retried = await update("auditor-2", 2, { b: true });
    expect(retried.ok).toBe(true);
    const f1 = session.snapshot().nodes.get(nodeId("f1"));
    expect(f1?.version).toBe(3);
    expect(f1?.props).toMatchObject({ a: true, b: true });
  });
});

const seedFile = async (as: ReturnType<typeof makeSession>["as"]) => {
  await as("scanner").post({
    mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { status: "pending" } },
  });
};

describe("lease abandonment and renewal (Stage 2; D2 ruled 2026-08-10)", () => {
  it("an abandoned lease expires: next() readmits the node and another agent can claim it", async () => {
    const { as, log, tick } = makeSession();
    await seedFile(as);
    await as("auditor-1").claim({ id: "f1", ttlMs: 1000 }); // claims, then vanishes

    const hidden = await as("auditor-2").next({ label: "CodeFile", match: { status: "pending" } });
    if (!hidden.ok) throw new Error("next failed");
    expect(hidden.value).toEqual({ node: null, pending: 0 });

    const refused = await as("auditor-2").claim({ id: "f1", ttlMs: 1000 });
    if (refused.ok || refused.error.code !== "ALREADY_CLAIMED")
      throw new Error("expected ALREADY_CLAIMED before expiry");
    expect(refused.error.holder).toBe("auditor-1");

    tick(1000); // the lease expires exactly at ttl — no release ever arrives
    const readmitted = await as("auditor-2").next({
      label: "CodeFile",
      match: { status: "pending" },
    });
    if (!readmitted.ok) throw new Error("next failed");
    expect(readmitted.value.node?.id).toBe("f1");
    expect(readmitted.value.pending).toBe(1);

    const takeover = await as("auditor-2").claim({ id: "f1", ttlMs: 1000 });
    expect(takeover.ok).toBe(true);

    // The trail shows both grants — abandonment leaves evidence, not mystery.
    const claims = (await mutationsOf(log)).filter((m) => m.kind === "CLAIM_NODE");
    expect(claims.map((c) => c.agentId)).toEqual(["auditor-1", "auditor-2"]);
  });

  it("D2: a same-agent re-claim RENEWS the lease — extended, not rejected, blocking others past the original expiry", async () => {
    const { as, tick } = makeSession();
    await seedFile(as);
    const first = await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    if (!first.ok) throw new Error("claim failed");
    expect(first.value.expiresAt).toBe(1000);

    tick(600);
    const renewed = await as("auditor-1").claim({ id: "f1", ttlMs: 1000 });
    expect(renewed.ok).toBe(true);
    if (renewed.ok) expect(renewed.value.expiresAt).toBe(1600);

    tick(500); // t=1100: past the ORIGINAL expiry, inside the renewed lease
    const refused = await as("auditor-2").claim({ id: "f1", ttlMs: 1000 });
    if (refused.ok || refused.error.code !== "ALREADY_CLAIMED")
      throw new Error("expected ALREADY_CLAIMED during the renewed lease");
    expect(refused.error.holder).toBe("auditor-1");

    tick(500); // t=1600: the renewed lease has now lapsed too
    expect((await as("auditor-2").claim({ id: "f1", ttlMs: 1000 })).ok).toBe(true);
  });

  it("a refusal names the CURRENT holder after an expiry takeover, never the stale one", async () => {
    const { as, tick } = makeSession();
    await seedFile(as);
    await as("auditor-1").claim({ id: "f1", ttlMs: 1000 }); // abandons
    tick(1000);
    await as("auditor-2").claim({ id: "f1", ttlMs: 1000 }); // takes over

    const refused = await as("auditor-3").claim({ id: "f1", ttlMs: 1000 });
    if (refused.ok || refused.error.code !== "ALREADY_CLAIMED")
      throw new Error("expected ALREADY_CLAIMED from the takeover holder");
    expect(refused.error.holder).toBe("auditor-2");
  });
});

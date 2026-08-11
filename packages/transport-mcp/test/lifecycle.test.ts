import { describe, expect, it } from "vitest";
import { checkPurge } from "../src/lifetime.js";
import { makeSession } from "./fixtures.js";

const seedBoard = async (as: ReturnType<typeof makeSession>["as"]) => {
  const scanner = as("scanner");
  await scanner.post({
    mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { path: "a.ts" } },
  });
  await scanner.post({
    mutation: { kind: "ADD_NODE", id: "f2", label: "CodeFile", props: { path: "b.ts" } },
  });
  await scanner.post({
    mutation: { kind: "ADD_EDGE", id: "e1", label: "IMPORTS", from: "f1", to: "f2" },
  });
  await as("auditor").claim({ id: "f1", ttlMs: 1000 });
};

describe("three-tier lifecycle: distill exports, purge discards, the log remains (SPEC §4.3, §4.8)", () => {
  it("checkPurge permits ephemeral boards and rejects persistent ones as a value", () => {
    expect(checkPurge("ephemeral").ok).toBe(true);
    const gate = checkPurge("persistent");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toEqual({ code: "PURGE_NOT_PERMITTED", lifetime: "persistent" });
    }
  });

  it("purge discards nodes, edges and claims back to the empty board and logs session.purged", async () => {
    const { session, as, log } = makeSession();
    await seedBoard(as);
    expect(session.snapshot().nodes.size).toBe(2);

    const purged = await session.purge();
    expect(purged.ok).toBe(true);

    const state = session.snapshot();
    expect(state.nodes.size).toBe(0);
    expect(state.edges.size).toBe(0);
    expect(state.claims.size).toBe(0);

    const last = (await log.read()).at(-1);
    expect(last?.event).toEqual({ type: "session.purged" });
    // A session-level action, not an agent's: attribution is session + principal only.
    expect(last?.meta).toMatchObject({ sessionId: "s1", agentId: null, principal: "michael" });
    if (purged.ok) expect(last?.meta.txId).toBe(purged.value.txId);
  });

  it("purge NEVER fires implicitly: distilling ends the run without touching the board", async () => {
    const { session, as, log } = makeSession();
    await seedBoard(as);

    // The natural end of a run: distill the findings. Nothing else happens.
    await session.distill("2 files scanned, 0 issues");

    expect(session.snapshot().nodes.size).toBe(2); // board intact
    const types = (await log.read()).map((r) => r.event.type);
    expect(types).not.toContain("session.purged");

    await session.purge(); // ONLY the explicit action discards
    expect(session.snapshot().nodes.size).toBe(0);
    expect((await log.read()).at(-1)?.event.type).toBe("session.purged");
  });

  it("distill appends session.distilled carrying the summary and leaves state untouched", async () => {
    const { session, as, log } = makeSession();
    await seedBoard(as);
    const before = session.snapshot();

    const distilled = await session.distill("שני קבצים נסרקו"); // Hebrew-first summaries welcome
    expect(session.snapshot()).toBe(before);

    const last = (await log.read()).at(-1);
    expect(last?.event).toEqual({ type: "session.distilled", summary: "שני קבצים נסרקו" });
    expect(last?.meta).toMatchObject({ agentId: null, principal: "michael" });
    expect(last?.meta.txId).toBe(distilled.txId);
  });

  it("the board stays usable after purge — same session, clean slate", async () => {
    const { session, as } = makeSession();
    await seedBoard(as);
    await session.purge();

    // f1 existed before the purge; a clean board accepts it again at version 1.
    const r = await as("scanner").post({
      mutation: { kind: "ADD_NODE", id: "f1", label: "CodeFile", props: { path: "a.ts" } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.version).toBe(1);
    expect(session.snapshot().nodes.size).toBe(1);
  });
});

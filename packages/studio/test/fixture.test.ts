import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogRecord } from "@whipple3/core";
import { createJsonlLog } from "@whipple3/log";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFixture } from "../src/fixture.js";

/**
 * The fixture IS the demo script — these tests pin what a demo run shows:
 * claims acquired AND released, one hot node updated repeatedly, enough
 * nodes for the force layout to matter, one claim honestly left held.
 */
describe("runFixture", () => {
  let dir: string;
  let records: readonly LogRecord[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "whipple3-studio-fixture-"));
    const path = join(dir, "session.ndjson");
    await runFixture(path, 0);
    records = await createJsonlLog(path).read();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const mutations = () =>
    records.flatMap((r) => (r.event.type === "graph.mutation" ? [r.event.mutation] : []));

  it("shows claims being acquired AND released", () => {
    const acquired = records.filter((r) => r.event.type === "claim.acquired");
    const released = records.filter((r) => r.event.type === "claim.released");
    expect(acquired.length).toBeGreaterThanOrEqual(3);
    expect(released.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves exactly one claim held at the end — the persistent-tint case", () => {
    const balance = new Map<string, number>();
    for (const r of records) {
      if (r.event.type === "claim.acquired")
        balance.set(r.event.nodeId, (balance.get(r.event.nodeId) ?? 0) + 1);
      if (r.event.type === "claim.released")
        balance.set(r.event.nodeId, (balance.get(r.event.nodeId) ?? 0) - 1);
    }
    const stillHeld = [...balance.values()].filter((n) => n > 0);
    expect(stillHeld).toHaveLength(1);
  });

  it("updates one hot node at least three times", () => {
    const updatesById = new Map<string, number>();
    for (const m of mutations())
      if (m.kind === "UPDATE_NODE") updatesById.set(m.id, (updatesById.get(m.id) ?? 0) + 1);
    expect(Math.max(0, ...updatesById.values())).toBeGreaterThanOrEqual(3);
  });

  it("posts enough nodes and edges for the layout to matter", () => {
    const adds = mutations().filter((m) => m.kind === "ADD_NODE");
    const edges = mutations().filter((m) => m.kind === "ADD_EDGE");
    expect(adds.length).toBeGreaterThanOrEqual(12);
    expect(edges.length).toBeGreaterThanOrEqual(5);
  });

  it("involves several distinct agents", () => {
    const agents = new Set(records.map((r) => r.meta.agentId));
    expect(agents.size).toBeGreaterThanOrEqual(3);
  });
});

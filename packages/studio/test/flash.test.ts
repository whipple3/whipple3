import { nodeId, version, type Whipple3Event } from "@whipple3/core";
import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { FLASH_MS, FLASH_SIZE, flashOnUpdate } from "../src/flash.js";
import { addNodeEvent, recordOf } from "./fixtures.js";

const updateNodeEvent = (id: string): Whipple3Event => ({
  type: "graph.mutation",
  mutation: { kind: "UPDATE_NODE", id: nodeId(id), expectedVersion: version(1), props: {} },
});

type Scheduled = { readonly fn: () => void; readonly ms: number };

/** Captures scheduled callbacks and restore calls so tests can drive the pulse by hand. */
const harness = () => {
  const scheduled: Scheduled[] = [];
  let restored = 0;
  return {
    scheduled,
    restore: (): void => {
      restored += 1;
    },
    schedule: (fn: () => void, ms: number): void => {
      scheduled.push({ fn, ms });
    },
    restoredCount: () => restored,
  };
};

const graphWith = (id: string): Graph => {
  const graph = new Graph();
  graph.addNode(id, { x: 0, y: 0, size: 8 });
  return graph;
};

describe("flashOnUpdate", () => {
  it("pulses an UPDATE_NODE target and schedules the restore at FLASH_MS", () => {
    const graph = graphWith("n1");
    const h = harness();

    const flashed = flashOnUpdate(graph, recordOf(0, updateNodeEvent("n1")), h.restore, h.schedule);

    expect(flashed).toBe(true);
    expect(graph.getNodeAttribute("n1", "size")).toBe(FLASH_SIZE);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBe(FLASH_MS);
    expect(h.restoredCount()).toBe(0); // nothing restored until the timer fires
  });

  it("restores through the scheduled callback, not before", () => {
    const graph = graphWith("n1");
    const h = harness();
    flashOnUpdate(graph, recordOf(0, updateNodeEvent("n1")), h.restore, h.schedule);

    h.scheduled[0]?.fn();

    expect(h.restoredCount()).toBe(1);
  });

  it("ignores non-UPDATE records", () => {
    const graph = graphWith("n1");
    const h = harness();

    const flashed = flashOnUpdate(graph, recordOf(0, addNodeEvent(1)), h.restore, h.schedule);

    expect(flashed).toBe(false);
    expect(graph.getNodeAttribute("n1", "size")).toBe(8);
    expect(h.scheduled).toHaveLength(0);
  });

  it("ignores updates for nodes the graph does not hold (scrubbed-away targets)", () => {
    const graph = graphWith("n1");
    const h = harness();

    const flashed = flashOnUpdate(
      graph,
      recordOf(0, updateNodeEvent("elsewhere")),
      h.restore,
      h.schedule,
    );

    expect(flashed).toBe(false);
    expect(h.scheduled).toHaveLength(0);
  });
});

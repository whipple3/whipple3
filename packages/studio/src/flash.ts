import type { LogRecord } from "@whipple3/core";
import type Graph from "graphology";

export const FLASH_SIZE = 15;
export const FLASH_MS = 600;

type Schedule = (fn: () => void, ms: number) => void;

/**
 * UPDATE_NODE pulse: bump the target's size now, hand `restore` to the
 * scheduler for FLASH_MS later. Cosmetic — restore (a syncGraph in main.ts)
 * reasserts the model-derived size. `schedule` is injected so tests can fire
 * the timer by hand. Returns whether a pulse actually happened.
 */
export const flashOnUpdate = (
  graph: Graph,
  record: LogRecord,
  restore: () => void,
  schedule: Schedule,
): boolean => {
  if (record.event.type !== "graph.mutation" || record.event.mutation.kind !== "UPDATE_NODE")
    return false;
  const id = record.event.mutation.id;
  if (!graph.hasNode(id)) return false;
  graph.setNodeAttribute(id, "size", FLASH_SIZE);
  schedule(restore, FLASH_MS);
  return true;
};

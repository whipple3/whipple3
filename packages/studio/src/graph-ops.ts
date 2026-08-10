import type { LogRecord } from "@whipple3/core";

/**
 * Pure reduction from log records to declarative graph operations — the only
 * layer the renderer applies, and the only layer that needs unit tests.
 * Claims/tinting and time-travel are Wave 2: claim mutations reduce to nothing.
 */
export type GraphOp =
  | {
      readonly kind: "add-node";
      readonly id: string;
      readonly label: string;
      readonly color: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "add-edge";
      readonly id: string;
      readonly from: string;
      readonly to: string;
      readonly label: string;
    }
  | { readonly kind: "touch-node"; readonly id: string };

import { colorForLabel, fnv1a } from "./colors.js";

/** Deterministic scatter on a ring: no layout engine, no randomness, replay-stable. */
const positionFor = (id: string): { readonly x: number; readonly y: number } => {
  const angle = (fnv1a(id) / 0xffffffff) * Math.PI * 2;
  const radius = 0.5 + fnv1a(`${id}#r`) / 0xffffffff;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

export const recordToOps = (record: LogRecord): readonly GraphOp[] => {
  if (record.event.type !== "graph.mutation") return [];
  const mutation = record.event.mutation;
  switch (mutation.kind) {
    case "ADD_NODE":
      return [
        {
          kind: "add-node",
          id: mutation.id,
          label: mutation.label,
          color: colorForLabel(mutation.label),
          ...positionFor(mutation.id),
        },
      ];
    case "UPDATE_NODE":
      return [{ kind: "touch-node", id: mutation.id }];
    case "ADD_EDGE":
      return [
        {
          kind: "add-edge",
          id: mutation.id,
          from: mutation.from,
          to: mutation.to,
          label: mutation.label,
        },
      ];
    case "CLAIM_NODE":
    case "RELEASE_NODE":
      return [];
  }
};

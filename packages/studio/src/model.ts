import { apply, emptyState, type GraphState, type LogRecord } from "@whipple3/core";

/**
 * The one reduction both views share: live streaming folds records incrementally,
 * the time-travel scrubber refolds a prefix — so the two can never disagree.
 * Graph truth goes through core's `apply` (replay semantics: rejects are skipped);
 * claim tint is layered from the observational `claim.*` events. TTL expiry has no
 * event yet (`claim.expired` is reserved for the scheduler), so a tint clears only
 * on release — the UI states this honestly.
 */
export interface HeldClaim {
  readonly agentId: string;
  readonly since: number;
}

export interface StudioModel {
  readonly graph: GraphState;
  readonly held: ReadonlyMap<string, HeldClaim>;
}

export const emptyModel = (): StudioModel => ({ graph: emptyState(), held: new Map() });

export const foldRecord = (model: StudioModel, record: LogRecord): StudioModel => {
  const event = record.event;
  switch (event.type) {
    case "graph.mutation": {
      const applied = apply(model.graph, event.mutation);
      if (!applied.ok) return model;
      return { ...model, graph: applied.value };
    }
    case "claim.acquired": {
      const held = new Map(model.held);
      held.set(event.nodeId, { agentId: event.agentId, since: record.meta.ts });
      return { ...model, held };
    }
    case "claim.released": {
      if (!model.held.has(event.nodeId)) return model;
      const held = new Map(model.held);
      held.delete(event.nodeId);
      return { ...model, held };
    }
    // The board discarded its working graph (ADR-009) — the mirror must too, tints
    // included. Time travel still reaches the pre-purge world: the log keeps it.
    case "session.purged":
      return emptyModel();
    default:
      return model;
  }
};

/** State at scrubber position `upTo`: the fold of records[0..upTo]. */
export const modelAt = (records: readonly LogRecord[], upTo: number): StudioModel =>
  records.slice(0, upTo + 1).reduce(foldRecord, emptyModel());

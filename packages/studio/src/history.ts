import type { LogRecord } from "@whipple3/core";

/**
 * A node's story, extracted from the record prefix [0..upTo] so time travel trims
 * history exactly like it trims the graph. Claim entries come from the observational
 * claim.* events; their twin CLAIM/RELEASE mutations are skipped to avoid doubles.
 * Denials are label-scoped (acl.denied carries no node id) and say so in the detail.
 */
export interface HistoryEntry {
  readonly seq: number;
  readonly ts: number;
  readonly agentId: string | null;
  readonly kind: "added" | "updated" | "claimed" | "released" | "denied";
  readonly detail: string;
}

const propsSummary = (props: Readonly<Record<string, unknown>>): string =>
  Object.entries(props)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");

const labelOf = (records: readonly LogRecord[], id: string): string | null => {
  for (const record of records) {
    const event = record.event;
    if (event.type === "graph.mutation" && event.mutation.kind === "ADD_NODE")
      if (event.mutation.id === id) return event.mutation.label;
  }
  return null;
};

const entryFor = (record: LogRecord, id: string, label: string | null): HistoryEntry | null => {
  const base = { seq: record.seq, ts: record.meta.ts };
  const event = record.event;
  switch (event.type) {
    case "graph.mutation": {
      const m = event.mutation;
      const agentId = record.meta.agentId;
      if (m.kind === "ADD_NODE" && m.id === id)
        return { ...base, agentId, kind: "added", detail: propsSummary(m.props) };
      if (m.kind === "UPDATE_NODE" && m.id === id)
        return { ...base, agentId, kind: "updated", detail: propsSummary(m.props) };
      return null; // ADD_EDGE not shown; CLAIM/RELEASE twins covered by claim.* events
    }
    case "claim.acquired":
      if (event.nodeId !== id) return null;
      return { ...base, agentId: event.agentId, kind: "claimed", detail: "" };
    case "claim.released":
      if (event.nodeId !== id) return null;
      return { ...base, agentId: event.agentId, kind: "released", detail: "" };
    case "acl.denied":
      if (label === null || event.label !== label) return null;
      return {
        ...base,
        agentId: event.agentId,
        kind: "denied",
        detail: `${event.reason} denied on label "${event.label}" (label-scoped)`,
      };
    default:
      return null;
  }
};

export const nodeHistory = (
  records: readonly LogRecord[],
  id: string,
  upTo: number,
): readonly HistoryEntry[] => {
  const prefix = records.slice(0, upTo + 1);
  // Start at the last purge, exactly like the fold's graph: the board discarded that
  // world, so a re-added id must not inherit its pre-purge story or label.
  // (Reverse loop, not findLastIndex — the tsconfig lib stops at es2022.)
  let purgedAt = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (prefix[i]?.event.type === "session.purged") {
      purgedAt = i;
      break;
    }
  }
  const epoch = purgedAt >= 0 ? prefix.slice(purgedAt + 1) : prefix;
  const label = labelOf(epoch, id);
  const entries: HistoryEntry[] = [];
  for (const record of epoch) {
    const entry = entryFor(record, id, label);
    if (entry !== null) entries.push(entry);
  }
  return entries;
};

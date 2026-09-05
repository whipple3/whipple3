import type { AgentTranscript } from "@whipple3/transcript";
import { LENSES, type Lens, primaryTarget } from "@whipple3/transcript";

export interface Call {
  readonly agent: string;
  readonly tool: string;
  readonly target: string;
}

export interface Hotspot {
  readonly agents: number;
  readonly tool: string;
  readonly target: string;
}

export interface LensResult {
  /** Calls that had a comparable target — the honest denominator. */
  readonly comparable: number;
  /** Agents beyond the first on a shared target: the work someone paid for again. */
  readonly repaid: number;
  readonly share: number;
  readonly hotspots: readonly Hotspot[];
}

export const callsOf = (agents: readonly AgentTranscript[]): readonly Call[] =>
  agents.flatMap((agent) =>
    agent.transcript.records.flatMap((record) => {
      if (record.kind !== "assistant" || record.toolUse === null) return [];
      const target = primaryTarget(record.toolUse, record.toolInput);
      return target === null ? [] : [{ agent: agent.name, tool: record.toolUse, target }];
    }),
  );

/**
 * "Work paid for more than once", never "waste": two agents reading one file may both have
 * needed it. What is counted is that it was paid for twice, not that either was wrong.
 */
export const measure = (calls: readonly Call[], lens: Lens): LensResult => {
  const keep = LENSES[lens];
  const byTarget = new Map<string, { agents: Set<string>; calls: number; call: Call }>();
  for (const call of calls) {
    if (!keep(call.tool)) continue;
    const key = `${call.tool.toLowerCase()} :: ${call.target}`;
    const entry = byTarget.get(key) ?? { agents: new Set<string>(), calls: 0, call };
    entry.agents.add(call.agent);
    entry.calls++;
    byTarget.set(key, entry);
  }
  const all = [...byTarget.values()];
  const shared = all.filter((e) => e.agents.size > 1);
  const comparable = all.reduce((n, e) => n + e.calls, 0);
  const repaid = shared.reduce((n, e) => n + (e.agents.size - 1), 0);
  return {
    comparable,
    repaid,
    share: comparable === 0 ? 0 : repaid / comparable,
    hotspots: shared
      .sort((a, b) => b.agents.size - a.agents.size)
      .slice(0, 5)
      .map((e) => ({ agents: e.agents.size, tool: e.call.tool, target: e.call.target })),
  };
};

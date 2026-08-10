import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { extractTranscriptMetrics, type TranscriptMetrics } from "./metrics.js";
import { parseTranscript, type Transcript } from "./transcript.js";

/**
 * Current-format subagent sidecars: `<dir>/<sessionId>/subagents/agent-*.jsonl`, every
 * line `isSidechain: true`, with an `agent-*.meta.json` beside each carrying the
 * spawned `agentType` (verified on the 2026-08-11 live run). Their tokens are SUBAGENT
 * context — kept apart from the orchestrator's numbers, surfaced so total cost stays
 * honest, and attributed per agent type when the meta file names one.
 */
export interface AgentTotals {
  readonly agentType: string | null;
  readonly requests: number;
  readonly contextInTokens: number;
  readonly outputTokens: number;
}

export interface SidechainTotals {
  readonly files: number;
  readonly requests: number;
  readonly contextInTokens: number;
  readonly outputTokens: number;
  /** One row per sidecar file, in file-name order; agentType null when meta is absent. */
  readonly byAgent: readonly AgentTotals[];
}

export interface SessionMetrics {
  readonly main: TranscriptMetrics;
  /** null when the session has no subagents directory (or the old inline format). */
  readonly subagents: SidechainTotals | null;
}

export interface SidecarTranscript {
  readonly transcript: Transcript;
  readonly agentType: string | null;
}

/** Sidecar files are all-sidechain; lift the flag so the same extractor applies. */
const asMainThread = (t: Transcript): Transcript => ({
  malformed: t.malformed,
  records: t.records.map((r) => ({ ...r, sidechain: false })),
});

export const aggregateSidechains = (sidecars: readonly SidecarTranscript[]): SidechainTotals => {
  const byAgent = sidecars.map((s): AgentTotals => {
    const m = extractTranscriptMetrics(asMainThread(s.transcript));
    return {
      agentType: s.agentType,
      requests: m.requests,
      contextInTokens: m.contextInTokens,
      outputTokens: m.outputTokens,
    };
  });
  const sum = (pick: (a: AgentTotals) => number): number =>
    byAgent.reduce((total, a) => total + pick(a), 0);
  return {
    files: sidecars.length,
    requests: sum((a) => a.requests),
    contextInTokens: sum((a) => a.contextInTokens),
    outputTokens: sum((a) => a.outputTokens),
    byAgent,
  };
};

const metaSchema = z.looseObject({ agentType: z.string().optional() });

/** `agent-X.jsonl` → `agent-X.meta.json`; anything missing or malformed is just null. */
const metaAgentType = (jsonlPath: string): string | null => {
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  if (!existsSync(metaPath)) return null;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
  const parsed = metaSchema.safeParse(json);
  return parsed.success ? (parsed.data.agentType ?? null) : null;
};

const subagentFiles = (transcriptPath: string): readonly string[] => {
  const sessionId = basename(transcriptPath, extname(transcriptPath));
  const dir = join(dirname(transcriptPath), sessionId, "subagents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
    .sort()
    .map((f) => join(dir, f));
};

export const loadSessionMetrics = (transcriptPath: string): SessionMetrics => {
  const main = extractTranscriptMetrics(parseTranscript(readFileSync(transcriptPath, "utf8")));
  const files = subagentFiles(transcriptPath);
  if (files.length === 0) return { main, subagents: null };
  const sidecars = files.map(
    (f): SidecarTranscript => ({
      transcript: parseTranscript(readFileSync(f, "utf8")),
      agentType: metaAgentType(f),
    }),
  );
  return { main, subagents: aggregateSidechains(sidecars) };
};

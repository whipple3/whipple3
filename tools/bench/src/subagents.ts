import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { extractTranscriptMetrics, type TranscriptMetrics } from "./metrics.js";
import { parseTranscript, type Transcript } from "./transcript.js";

/**
 * Current-format subagent sidecars: `<dir>/<sessionId>/subagents/agent-*.jsonl`, every
 * line `isSidechain: true`. Their tokens are SUBAGENT context — kept apart from the
 * orchestrator's numbers, surfaced so total cost stays honest.
 */
export interface SidechainTotals {
  readonly files: number;
  readonly requests: number;
  readonly contextInTokens: number;
  readonly outputTokens: number;
}

export interface SessionMetrics {
  readonly main: TranscriptMetrics;
  /** null when the session has no subagents directory (or the old inline format). */
  readonly subagents: SidechainTotals | null;
}

/** Sidecar files are all-sidechain; lift the flag so the same extractor applies. */
const asMainThread = (t: Transcript): Transcript => ({
  malformed: t.malformed,
  records: t.records.map((r) => ({ ...r, sidechain: false })),
});

export const aggregateSidechains = (transcripts: readonly Transcript[]): SidechainTotals => {
  const each = transcripts.map((t) => extractTranscriptMetrics(asMainThread(t)));
  const sum = (pick: (m: TranscriptMetrics) => number): number =>
    each.reduce((total, m) => total + pick(m), 0);
  return {
    files: transcripts.length,
    requests: sum((m) => m.requests),
    contextInTokens: sum((m) => m.contextInTokens),
    outputTokens: sum((m) => m.outputTokens),
  };
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
  const transcripts = files.map((f) => parseTranscript(readFileSync(f, "utf8")));
  return { main, subagents: aggregateSidechains(transcripts) };
};

import type { AssistantRecord, Transcript, Usage } from "./transcript.js";

/**
 * Orchestrator-context accounting over the MAIN thread only. Token counts come from the
 * transcript's own usage fields — never a tokenizer. Context consumed per request is
 * input + cache_creation + cache_read: caching discounts price, not window occupancy.
 */
export interface TranscriptMetrics {
  readonly requests: number;
  /** Uncached input tokens (the `input_tokens` field alone). */
  readonly inputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  /** input + cacheCreation + cacheRead — what the orchestrator's window actually held. */
  readonly contextInTokens: number;
  readonly outputTokens: number;
  /** contextIn + output — the headline orchestrator-context number. */
  readonly contextTokens: number;
  /** First → last main-thread timestamp; null when nothing is timestamped. */
  readonly wallMs: number | null;
  readonly toolCalls: number;
  readonly toolCallsByName: Readonly<Record<string, number>>;
  readonly sidechainLines: number;
  readonly malformedLines: number;
}

/** One usage per API request: lines sharing a requestId are cumulative snapshots. */
const lastUsagePerRequest = (assistants: readonly AssistantRecord[]): readonly Usage[] => {
  const byRequest = new Map<string, Usage>();
  for (const a of assistants) {
    if (a.requestId === null || a.usage === null) continue;
    byRequest.set(a.requestId, a.usage); // later lines overwrite: last snapshot wins
  }
  return [...byRequest.values()];
};

const timeWindow = (timestamps: readonly number[]): number | null => {
  if (timestamps.length === 0) return null;
  return Math.max(...timestamps) - Math.min(...timestamps);
};

const countByName = (names: readonly string[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  return counts;
};

export const extractTranscriptMetrics = (transcript: Transcript): TranscriptMetrics => {
  const main = transcript.records.filter((r) => !r.sidechain);
  const assistants = main.filter((r): r is AssistantRecord => r.kind === "assistant");
  const usages = lastUsagePerRequest(assistants);

  const sum = (pick: (u: Usage) => number): number =>
    usages.reduce((total, u) => total + pick(u), 0);
  const inputTokens = sum((u) => u.input);
  const cacheCreationTokens = sum((u) => u.cacheCreation);
  const cacheReadTokens = sum((u) => u.cacheRead);
  const contextInTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  const outputTokens = sum((u) => u.output);

  const toolNames = assistants.flatMap((a) => (a.toolUse === null ? [] : [a.toolUse]));

  return {
    requests: usages.length,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    contextInTokens,
    outputTokens,
    contextTokens: contextInTokens + outputTokens,
    wallMs: timeWindow(main.flatMap((r) => (r.timestamp === null ? [] : [r.timestamp]))),
    toolCalls: toolNames.length,
    toolCallsByName: countByName(toolNames),
    sidechainLines: transcript.records.length - main.length,
    malformedLines: transcript.malformed,
  };
};

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractTranscriptMetrics } from "../src/metrics.js";
import { parseTranscript } from "../src/transcript.js";

const fixture = readFileSync(new URL("./fixtures/main-session.jsonl", import.meta.url), "utf8");
const metrics = extractTranscriptMetrics(parseTranscript(fixture));

describe("extractTranscriptMetrics — orchestrator (main-thread) context accounting", () => {
  it("dedupes one API response split across lines: LAST usage snapshot per requestId wins", () => {
    // req_1 is three lines with cumulative output 5 → 100 → 150; req_2 is one line (60).
    expect(metrics.requests).toBe(2);
    expect(metrics.outputTokens).toBe(150 + 60);
  });

  it("sums the three input components — cache changes price, not context size", () => {
    expect(metrics.inputTokens).toBe(3 + 10);
    expect(metrics.cacheCreationTokens).toBe(1000 + 500);
    expect(metrics.cacheReadTokens).toBe(2000 + 4000);
    expect(metrics.contextInTokens).toBe(7513);
    expect(metrics.contextTokens).toBe(7513 + 210);
  });

  it("ignores sidechain lines entirely — usage AND wall clock", () => {
    // The inline sidechain line carries 999s and a 10:20 timestamp; both must be invisible.
    expect(metrics.sidechainLines).toBe(1);
    expect(metrics.contextInTokens).toBe(7513);
    expect(metrics.wallMs).toBe(5 * 60 * 1000); // 10:00:00 → 10:05:00 main-thread window
  });

  it("counts tool calls by name from tool_use blocks", () => {
    expect(metrics.toolCalls).toBe(2);
    expect(metrics.toolCallsByName).toEqual({ Bash: 1, Task: 1 });
  });

  it("carries the malformed-line count through — honesty over silence", () => {
    expect(metrics.malformedLines).toBe(1);
  });

  it("survives a very large transcript — the wall window is loop-, not spread-, computed", () => {
    // 150k timestamped lines: Math.max(...ts) would blow the argument-count limit.
    const lines = Array.from({ length: 150_000 }, (_, i) =>
      JSON.stringify({ type: "user", timestamp: new Date(1_700_000_000_000 + i * 1000) }),
    );
    const m = extractTranscriptMetrics(parseTranscript(lines.join("\n")));
    expect(m.wallMs).toBe(149_999_000);
  });

  it("yields null wall time when nothing carries a timestamp", () => {
    const empty = extractTranscriptMetrics(parseTranscript('{"type":"summary","summary":"x"}\n'));
    expect(empty.wallMs).toBeNull();
    expect(empty.requests).toBe(0);
  });
});

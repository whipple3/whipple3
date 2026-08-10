import { describe, expect, it } from "vitest";
import type { BoardMetrics } from "../src/board.js";
import { renderComparison } from "../src/compare.js";
import type { TranscriptMetrics } from "../src/metrics.js";
import type { SessionMetrics } from "../src/subagents.js";

const main = (over: Partial<TranscriptMetrics>): TranscriptMetrics => ({
  requests: 0,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  contextInTokens: 0,
  outputTokens: 0,
  contextTokens: 0,
  wallMs: null,
  toolCalls: 0,
  toolCallsByName: {},
  sidechainLines: 0,
  malformedLines: 0,
  ...over,
});

const w3: SessionMetrics = {
  main: main({
    requests: 2,
    contextInTokens: 7513,
    outputTokens: 210,
    contextTokens: 7723,
    wallMs: 300_000,
    toolCalls: 2,
  }),
  subagents: { files: 2, requests: 3, contextInTokens: 3330, outputTokens: 90 },
};

const vanilla: SessionMetrics = {
  main: main({
    requests: 5,
    contextInTokens: 14_500,
    outputTokens: 470,
    contextTokens: 14_970,
    wallMs: 240_000,
    toolCalls: 6,
  }),
  subagents: { files: 3, requests: 6, contextInTokens: 8600, outputTokens: 400 },
};

const board: BoardMetrics = {
  findingsByLabel: { CodeFile: 2, SecurityIssue: 1 },
  contestedClaims: 0,
  reworkedNodes: 0,
  denials: 1,
  agents: ["auditor-1", "auditor-2", "scanner"],
};

describe("renderComparison — deterministic, honest, exact", () => {
  it("renders the full table byte-for-byte for a winning-tokens, losing-wall-time run", () => {
    expect(renderComparison(w3, vanilla, board)).toBe(
      `# whipple3 vs vanilla — audit benchmark

| metric (main thread) | whipple3 | vanilla | Δ |
| --- | ---: | ---: | ---: |
| orchestrator context (in+out) | 7,723 | 14,970 | -48.4% |
| context in (input+cache write+cache read) | 7,513 | 14,500 | -48.2% |
| output | 210 | 470 | -55.3% |
| API requests | 2 | 5 | — |
| tool calls | 2 | 6 | — |
| wall time | 5m 0s | 4m 0s | +25.0% |
| subagent context (sidecar files) | 3,420 (2 files) | 9,000 (3 files) | — |
| total context incl. subagents | 11,143 | 23,970 | -53.5% |

## Board log (whipple3 run)

| metric | value |
| --- | ---: |
| findings | CodeFile: 2, SecurityIssue: 1 |
| contested claims | 0 |
| reworked nodes | 0 |
| ACL denials | 1 |
| agents | auditor-1, auditor-2, scanner |

## Verdict

- Orchestrator context: -48.4% — MEETS the >=40% reduction target (SPEC §8).
- Wall time: whipple3 LOSES: +25.0% slower.
- Duplicate work: zero contested claims, zero reworked nodes.
- Total context incl. subagents: -53.5% vs vanilla.
- Findings quality: not machine-judged — compare the two run reports (RUNBOOK).
`,
    );
  });

  it("says so when whipple3 loses on tokens — negative results are printed, not hidden", () => {
    const losing: SessionMetrics = {
      main: main({ contextInTokens: 11_500, outputTokens: 500, contextTokens: 12_000 }),
      subagents: null,
    };
    const base: SessionMetrics = {
      main: main({ contextInTokens: 9500, outputTokens: 500, contextTokens: 10_000 }),
      subagents: null,
    };
    const out = renderComparison(losing, base, null);
    expect(out).toContain(
      "- Orchestrator context: whipple3 LOSES: +20.0% vs vanilla — MISSES the >=40% reduction target (SPEC §8).",
    );
    expect(out).toContain("- Duplicate work: no board log provided (--board) — not measured.");
    expect(out).not.toContain("## Board log");
  });

  it("marks a reduction that still misses the 40% bar, and a faster wall time", () => {
    const modest: SessionMetrics = {
      main: main({ contextTokens: 8000, wallMs: 200_000 }),
      subagents: null,
    };
    const base: SessionMetrics = {
      main: main({ contextTokens: 10_000, wallMs: 240_000 }),
      subagents: null,
    };
    const out = renderComparison(modest, base, null);
    expect(out).toContain(
      "- Orchestrator context: -20.0% — MISSES the >=40% reduction target (SPEC §8).",
    );
    expect(out).toContain("- Wall time: -16.7% faster.");
  });

  it("reports duplicate work when the board shows it", () => {
    const dup: BoardMetrics = { ...board, contestedClaims: 2, reworkedNodes: 1 };
    expect(renderComparison(w3, vanilla, dup)).toContain(
      "- Duplicate work: 2 contested claim(s), 1 reworked node(s) — DUPLICATE WORK PRESENT.",
    );
  });
});

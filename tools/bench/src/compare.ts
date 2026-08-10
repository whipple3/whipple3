import type { BoardMetrics } from "./board.js";
import type { SessionMetrics } from "./subagents.js";

/**
 * The comparison frame for SPEC §8 criterion 1 (>=40% orchestrator-context reduction)
 * and ROADMAP Stage 4's "publish honest numbers, including where we lose". Pure and
 * deterministic: the same two runs always render the same bytes — verdicts are computed,
 * never phrased, so results cannot be cherry-picked after the fact.
 */
const TARGET_REDUCTION_PCT = 40;

export const int = (n: number): string => n.toLocaleString("en-US");

/** Signed percent delta of a vs b, one decimal; null when the baseline is empty. */
const pct = (a: number, b: number): number | null => (b === 0 ? null : ((a - b) / b) * 100);

const fmtPct = (delta: number | null): string => {
  if (delta === null) return "—";
  const fixed = delta.toFixed(1);
  return delta > 0 ? `+${fixed}%` : `${fixed}%`;
};

export const fmtDur = (ms: number | null): string => {
  if (ms === null) return "n/a";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const subagentContext = (s: SessionMetrics): number | null =>
  s.subagents === null ? null : s.subagents.contextInTokens + s.subagents.outputTokens;

export const totalContext = (s: SessionMetrics): number =>
  s.main.contextTokens + (subagentContext(s) ?? 0);

export const subagentCell = (s: SessionMetrics): string => {
  const context = subagentContext(s);
  return context === null ? "n/a" : `${int(context)} (${int(s.subagents?.files ?? 0)} files)`;
};

const wallDelta = (w3: SessionMetrics, vanilla: SessionMetrics): number | null =>
  w3.main.wallMs === null || vanilla.main.wallMs === null
    ? null
    : pct(w3.main.wallMs, vanilla.main.wallMs);

const metricsTable = (w3: SessionMetrics, vanilla: SessionMetrics): readonly string[] => {
  const row = (name: string, a: string, b: string, delta: string): string =>
    `| ${name} | ${a} | ${b} | ${delta} |`;
  const tokenRow = (name: string, a: number, b: number): string =>
    row(name, int(a), int(b), fmtPct(pct(a, b)));
  const [m, v] = [w3.main, vanilla.main];
  return [
    "| metric (main thread) | whipple3 | vanilla | Δ |",
    "| --- | ---: | ---: | ---: |",
    tokenRow("orchestrator context (in+out)", m.contextTokens, v.contextTokens),
    tokenRow("context in (input+cache write+cache read)", m.contextInTokens, v.contextInTokens),
    tokenRow("output", m.outputTokens, v.outputTokens),
    row("API requests", int(m.requests), int(v.requests), "—"),
    row("tool calls", int(m.toolCalls), int(v.toolCalls), "—"),
    row("wall time", fmtDur(m.wallMs), fmtDur(v.wallMs), fmtPct(wallDelta(w3, vanilla))),
    row("subagent context (sidecar files)", subagentCell(w3), subagentCell(vanilla), "—"),
    tokenRow("total context incl. subagents", totalContext(w3), totalContext(vanilla)),
  ];
};

export const boardSection = (board: BoardMetrics): readonly string[] => {
  const findings = Object.entries(board.findingsByLabel)
    .map(([label, count]) => `${label}: ${int(count)}`)
    .join(", ");
  return [
    "## Board log (whipple3 run)",
    "",
    "| metric | value |",
    "| --- | ---: |",
    `| findings | ${findings === "" ? "none" : findings} |`,
    `| contested claims | ${int(board.contestedClaims)} |`,
    `| reworked nodes | ${int(board.reworkedNodes)} |`,
    `| ACL denials | ${int(board.denials)} |`,
    `| agents | ${board.agents.join(", ")} |`,
    "",
  ];
};

const contextVerdict = (delta: number | null): string => {
  const bar = `the >=${TARGET_REDUCTION_PCT}% reduction target (SPEC §8)`;
  if (delta === null) return `- Orchestrator context: baseline is empty — ${bar} unmeasurable.`;
  if (delta >= 0)
    return `- Orchestrator context: whipple3 LOSES: ${fmtPct(delta)} vs vanilla — MISSES ${bar}.`;
  const label = -delta >= TARGET_REDUCTION_PCT ? "MEETS" : "MISSES";
  return `- Orchestrator context: ${fmtPct(delta)} — ${label} ${bar}.`;
};

const wallVerdict = (delta: number | null): string => {
  if (delta === null) return "- Wall time: not measurable (missing timestamps).";
  if (delta > 0) return `- Wall time: whipple3 LOSES: ${fmtPct(delta)} slower.`;
  if (delta < 0) return `- Wall time: ${fmtPct(delta)} faster.`;
  return "- Wall time: even.";
};

export const duplicateVerdict = (board: BoardMetrics | null): string => {
  if (board === null) return "- Duplicate work: no board log provided (--board) — not measured.";
  if (board.contestedClaims === 0 && board.reworkedNodes === 0)
    return "- Duplicate work: zero contested claims, zero reworked nodes.";
  return (
    `- Duplicate work: ${int(board.contestedClaims)} contested claim(s), ` +
    `${int(board.reworkedNodes)} reworked node(s) — DUPLICATE WORK PRESENT.`
  );
};

const verdict = (
  w3: SessionMetrics,
  vanilla: SessionMetrics,
  board: BoardMetrics | null,
): readonly string[] => [
  "## Verdict",
  "",
  contextVerdict(pct(w3.main.contextTokens, vanilla.main.contextTokens)),
  wallVerdict(wallDelta(w3, vanilla)),
  duplicateVerdict(board),
  `- Total context incl. subagents: ${fmtPct(pct(totalContext(w3), totalContext(vanilla)))} vs vanilla.`,
  "- Findings quality: not machine-judged — compare the two run reports (RUNBOOK).",
];

export const renderComparison = (
  w3: SessionMetrics,
  vanilla: SessionMetrics,
  board: BoardMetrics | null,
): string =>
  [
    "# whipple3 vs vanilla — audit benchmark",
    "",
    ...metricsTable(w3, vanilla),
    "",
    ...(board === null ? [] : boardSection(board)),
    ...verdict(w3, vanilla, board),
    "",
  ].join("\n");

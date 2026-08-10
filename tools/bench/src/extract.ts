import type { BoardMetrics } from "./board.js";
import {
  boardSection,
  duplicateVerdict,
  fmtDur,
  int,
  subagentCell,
  totalContext,
} from "./compare.js";
import type { SessionMetrics, SidechainTotals } from "./subagents.js";

/**
 * One-sided extraction: the RUNBOOK's runs land at different times, so one side must be
 * bankable alone — same row labels as renderComparison so a column transplants verbatim,
 * but NO verdicts: those exist only against a counterpart run. Pure and deterministic.
 */
const mainTable = (s: SessionMetrics): readonly string[] => {
  const row = (name: string, value: string): string => `| ${name} | ${value} |`;
  const m = s.main;
  return [
    "| metric (main thread) | value |",
    "| --- | ---: |",
    row("orchestrator context (in+out)", int(m.contextTokens)),
    row("context in (input+cache write+cache read)", int(m.contextInTokens)),
    row("output", int(m.outputTokens)),
    row("API requests", int(m.requests)),
    row("tool calls", int(m.toolCalls)),
    row("wall time", fmtDur(m.wallMs)),
    row("subagent context (sidecar files)", subagentCell(s)),
    row("total context incl. subagents", int(totalContext(s))),
  ];
};

const agentTable = (subagents: SidechainTotals): readonly string[] => [
  "## Subagent context by agent type",
  "",
  "| agent type | requests | context in | output | context total |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...subagents.byAgent.map(
    (a) =>
      `| ${a.agentType ?? "(untyped)"} | ${int(a.requests)} | ${int(a.contextInTokens)} | ` +
      `${int(a.outputTokens)} | ${int(a.contextInTokens + a.outputTokens)} |`,
  ),
  "",
];

export const renderExtract = (s: SessionMetrics, board: BoardMetrics | null): string =>
  [
    "# bench extract — one session, no verdicts",
    "",
    ...mainTable(s),
    "",
    ...(s.subagents === null ? [] : agentTable(s.subagents)),
    ...(board === null ? [] : boardSection(board)),
    "## Status",
    "",
    "- One-sided extraction (N=1): comparison verdicts need the counterpart run (RUNBOOK §2).",
    duplicateVerdict(board),
    "",
  ].join("\n");

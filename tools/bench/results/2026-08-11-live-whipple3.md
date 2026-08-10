# Live benchmark — whipple3 side (Run A1), 2026-08-11

**N = 1.** This banks the whipple3 column of the RUNBOOK §1 comparison from the first
live `/whipple3:audit` run. No verdict is possible or claimed here: verdicts are computed
by `bench compare` only when the vanilla counterpart exists, and the RUNBOOK's protocol
(3 alternated run pairs, all published) is a Michael-side decision still pending.

## Provenance

| fact | value |
| --- | --- |
| target repo | `/Users/michael/Projects/whipple3/audit-demo` (6 seeded source files + policy) |
| run mode | headless `claude -p "/whipple3:audit"`, session persistence on |
| backend | `whipple3 serve --policy` (5 per-agent MCP proxies via `--mcp-config` fallback) |
| model | claude-opus-4-7 (every request, main + sidecars) |
| Claude Code | 2.1.138 |
| session | `bb721fae-6c3b-470d-b149-b2f8bcae2615`, 2026-08-10T22:36:43Z → 22:41:05Z |
| board log | `2026-08-11-live/session-2026-08-10T22-32-01.057Z.ndjson` (66 records) |
| halted | at the fixer HITL question, by design — scan → audit → triage → propose, no fix applied |

Raw artifacts are banked beside this file in `2026-08-11-live/` (transcript +
`whipple3-main/subagents/` sidecars, board log, distill report) so the eventual
`bench compare` run needs nothing outside the repo. Sources were copied unmodified.

### How the right session was identified (7 failed/smoke attempts share the directory)

The project transcript dir held 9 sessions from the same hour. `bb721fae` is the run
because it alone (a) ends at the HITL AskUserQuestion ("Which fixes should I apply?"),
(b) has 5 sidecar files whose `agent-*.meta.json` name the scanner/auditor-1..3/fixer
agent types, and (c) spans ~4.4 min. The others: two `reply with exactly: ok` auth
smoke tests, and five aborted `/whipple3:audit` attempts (dead/unconnected MCP proxies)
that die inside 60 s with `tool_result` `is_error: true` on blackboard tools — API-level
synthetic error lines appear in none of them.

## Extraction (verbatim `bench extract` output, deterministic)

```sh
node tools/bench/dist/main.js extract \
  tools/bench/results/2026-08-11-live/whipple3-main.jsonl \
  --board tools/bench/results/2026-08-11-live/session-2026-08-10T22-32-01.057Z.ndjson
```

# bench extract — one session, no verdicts

| metric (main thread) | value |
| --- | ---: |
| orchestrator context (in+out) | 296,769 |
| context in (input+cache write+cache read) | 293,051 |
| output | 3,718 |
| API requests | 7 |
| tool calls | 8 |
| wall time | 4m 23s |
| subagent context (sidecar files) | 869,365 (5 files) |
| total context incl. subagents | 1,166,134 |

## Subagent context by agent type

| agent type | requests | context in | output | context total |
| --- | ---: | ---: | ---: | ---: |
| whipple3:whipple3-auditor-2 | 16 | 144,298 | 2,644 | 146,942 |
| whipple3:whipple3-fixer | 36 | 401,040 | 5,628 | 406,668 |
| whipple3:whipple3-auditor-3 | 16 | 137,386 | 2,330 | 139,716 |
| whipple3:whipple3-scanner | 5 | 31,966 | 987 | 32,953 |
| whipple3:whipple3-auditor-1 | 16 | 140,884 | 2,202 | 143,086 |

## Board log (whipple3 run)

| metric | value |
| --- | ---: |
| findings | CodeFile: 6, Fix: 6, SecurityIssue: 6 |
| contested claims | 0 |
| reworked nodes | 0 |
| ACL denials | 0 |
| agents | auditor-1, auditor-2, auditor-3, fixer, scanner |

## Comparison table (RUNBOOK §4) — vanilla column PENDING

| metric (main thread) | whipple3 (A1) | vanilla (B1) | Δ |
| --- | ---: | ---: | ---: |
| orchestrator context (in+out) | 296,769 | *pending* | — |
| context in (input+cache write+cache read) | 293,051 | *pending* | — |
| output | 3,718 | *pending* | — |
| API requests | 7 | *pending* | — |
| tool calls | 8 | *pending* | — |
| wall time | 4m 23s | *pending* | — |
| subagent context (sidecar files) | 869,365 (5 files) | *pending* | — |
| total context incl. subagents | 1,166,134 | *pending* | — |

The 8 main-thread tool calls: 1 Skill + 1 Bash (preflight) + 5 Agent spawns + 1
AskUserQuestion. The orchestrator never touched a source file or a finding — findings
crossed between agents over the board, not through the parent's window.

## Predeclared board expectations — met

- Duplicates: **zero** contested claims, **zero** reworked nodes (expected: zero).
- Findings: CodeFile 6, SecurityIssue 6, Fix 6 (expected: 6+6+6) — the full seeded set,
  severity-triaged; the per-finding list is banked in `2026-08-11-live/distill-report.md`
  so the finding-quality judgment can be made against the vanilla reports BEFORE token
  numbers are compared, as §1 requires.

## Caveats (stated before any comparison exists)

- **N=1.** Two more whipple3 runs are owed by the protocol (§2: 3 pairs, alternated).
- The run halted at the HITL gate by design; its scope is scan → audit → propose. The
  predeclared vanilla prompt ends at a merged findings report and has no fix-proposal
  stage — the fixer's 406,668 sidecar tokens have no vanilla counterpart. Main-thread
  (headline) numbers are unaffected; total-context comparisons must carry this note.
- Wall time includes headless startup and MCP connection, on a laptop, single sample.

# Benchmark RUNBOOK — whipple3 vs vanilla subagents

The live-comparison protocol for SPEC §8 criterion 1 and ROADMAP Stage 4. Everything
here is **predeclared**: metrics, decision rules, and run counts are fixed BEFORE the
first live run, so results cannot be cherry-picked after the fact. Whatever the numbers
say — including where whipple3 loses — is what gets published.

## 0. Prove the instrument first (no LLM, ~5 seconds)

```sh
pnpm -C tools/bench build
node tools/bench/dist/main.js mock /tmp/bench-proof
```

This spawns the REAL `whipple3 serve` + four `mcp --board` proxies, drives a fixed audit,
synthesizes a format-true transcript pair, and prints the comparison. The exact expected
table (byte-for-byte) is asserted in `tools/bench/test/cli.e2e.test.ts` — if the printed
table matches `/tmp/bench-proof/comparison.md` and the suite is green
(`pnpm -C tools/bench test`), the instrument works. Only then run the live comparison.

## 1. Predeclared metrics (what will be measured, decided now)

From each session transcript (main thread = orchestrator, `isSidechain` filtered):

| metric | definition |
| --- | --- |
| orchestrator context | per-request `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`, one usage per `requestId` (last snapshot), summed — **the headline number** |
| wall time | first → last main-thread timestamp |
| API requests / tool calls | deduped request count; `tool_use` blocks by name |
| subagent context | same accounting over `<session>/subagents/agent-*.jsonl` — total-cost honesty |

From the whipple3 board log (`.whipple3/session-*.ndjson`):

| metric | definition |
| --- | --- |
| findings | nodes by label in the replayed final state |
| contested claims | `claim.acquired` on one node by a 2nd+ distinct agent (same-agent renewal = D2, excluded) |
| reworked nodes | nodes UPDATE_NODEd by ≥2 distinct agents |

Decision rules, fixed now:
- **Token claim:** whipple3 meets SPEC §8 only if orchestrator context drops ≥40% vs
  vanilla **at equal finding quality** (rule below). The tool computes the verdict line;
  nobody re-derives it by hand.
- **Finding quality:** counted and judged from the two reports BEFORE anyone looks at
  token numbers: list each run's distinct true findings; runs are "equal quality" when
  neither misses a real finding the other caught. If whipple3 finds less, the token win
  does not count and both facts get published.
- **Known caveats, stated up front:** context ≠ price (cache reads are cheap but still
  occupy window); wall time on a laptop is noisy; rejected claim attempts never reach the
  board log (only redone work is countable); vanilla has no board, so its duplicate work
  must be judged manually from its transcript.

## 2. The two runs (same repo, same commit, same model, same day)

Target: one repo at a pinned commit, ~10–30 source files, with at least a few real
issues. Record: repo, commit SHA, model, Claude Code version.

**Run A — whipple3.** Follow `examples/claude-code-plugin/README.md`: start
`whipple3 serve` in the repo (terminal 1), open a FRESH Claude Code session (terminal 2),
run `/whipple3:audit`. Let it finish (scanner → three auditors → distill). Do not
interact beyond the command and any HITL approvals.

**Run B — vanilla.** Fresh Claude Code session, same repo, whipple3 MCP servers NOT
configured. Paste exactly this prompt (predeclared, verbatim):

> Audit this repository for security issues. Spawn three parallel general-purpose
> subagents, splitting the source files between them; each subagent reports its findings
> back to you in full. Merge their reports yourself and write the combined findings to
> audit-report.md.

Same interaction discipline: the prompt, then hands off.

Run each side **3 times** (fresh session each time; alternate A/B to spread cache and
load effects). All 6 results get reported — no picking the best.

## 3. Locate the artifacts

- Transcripts: `~/.claude/projects/<munged-repo-path>/<sessionId>.jsonl`, where the
  munged path is the repo's absolute path with `/` → `-` (e.g. `/Users/m/proj` →
  `-Users-m-proj`). The newest file after a run is that run's session:
  `ls -t ~/.claude/projects/<munged>/ | head`. Subagent sidecars are auto-discovered
  from `<sessionId>/subagents/` — nothing to pass.
- Board log (run A only): `<repo>/.whipple3/session-*.ndjson`.

**Newest-file is not enough when attempts failed** (learned on the 2026-08-11 live run,
where 9 sessions from one hour shared the directory). Identify the run by content:

- The first line of every session is a `queue-operation` enqueue whose `content` is the
  exact prompt typed — grep it to separate `/whipple3:audit` runs from smoke tests.
- A completed run-A session ends at the fixer's HITL `AskUserQuestion` tool call and has
  one sidecar pair per spawned agent under `<sessionId>/subagents/`: `agent-*.jsonl`
  plus `agent-*.meta.json`, the meta naming the `agentType`
  (e.g. `whipple3:whipple3-scanner`) — the extractor reads it for per-agent attribution.
- Aborted attempts (proxy dead / MCP servers never connected) die within ~60 s with
  `tool_result` lines carrying `is_error: true` on blackboard tools. They contain NO
  API-level synthetic error lines — the API never failed, the tools did.
- Match the board log to the session independently: distill's session ULID and record
  count must agree with what the transcript's tool calls imply.

## 3.5 Bank one side as soon as it exists

Runs A and B rarely land the same minute. Extract and commit each side immediately —
same rows as compare, per-agent-type subagent table, NO verdicts (those only exist
against a counterpart):

```sh
node tools/bench/dist/main.js extract <session>.jsonl \
  --board <repo>/.whipple3/session-<ts>.ndjson --out results/<date>-<side>.md
```

Copy the raw transcript (with its `subagents/` dir), board log, and distill report into
`tools/bench/results/` beside the extraction, unmodified — the eventual compare must
need nothing outside the repo. Banked so far: `results/2026-08-11-live-whipple3.md`
(run A1, N=1; vanilla side pending).

## 4. Compare

```sh
node tools/bench/dist/main.js compare \
  <run-A-session>.jsonl <run-B-session>.jsonl \
  --board <repo>/.whipple3/session-<ts>.ndjson \
  --out results-run1.md
```

Deterministic: the same inputs always render the same bytes. Repeat per run pair; publish
all three tables plus the finding-quality judgment. The verdict lines are the published
claim — including every line that says LOSES.

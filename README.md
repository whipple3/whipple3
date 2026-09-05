<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/whipple3-mark-dark.svg">
  <img src="assets/whipple3-mark.svg" alt="whipple3" width="88" align="right">
</picture>

# whipple3

> **whipple3** (from *whippletree* — the crossbar that lets a team of harnessed horses pull
> one load without pulling against each other). Sessions stay ephemeral, sukkah-style: built
> for a purpose, lived in, taken down. What remains is what it taught you.

**A typed, ephemeral, event-sourced blackboard for coordinating AI agents.**

One agent doesn't need whipple3. **Two do.**

**Small enough to audit before you trust it: 4,038 lines of TypeScript across every package** —
657 of them the coordination core, which runs on one runtime dependency (Zod) and is
property-tested with fast-check. Count it yourself:
`find packages/*/src -name '*.ts' | xargs wc -l`.

Keep your framework. whipple3 slots underneath it: agents don't chat and don't funnel everything
through an orchestrator's context — they read and write a shared typed graph through structured,
versioned, ACL-checked mutations. Every mutation passes one enforcement point, and the append-only
event log — not the graph — is the source of truth, so every session is auditable and replayable
by construction.

NanoClaw isolates one agent from your machine. whipple3 coordinates many agents with each other.

## Quick start — repo to working board

Prereqs: **Node ≥ 22**, [pnpm](https://pnpm.io), git.
(Command wall-time measured cold on 2026-08-11: under one minute; budget ten with host wiring.)

**1. Install the CLI.** Until the npm publish lands (after it: `npm i -g whipple3`):

```bash
git clone https://github.com/whipple3/whipple3 && cd whipple3
pnpm install && pnpm build
(cd packages/cli && npm link)     # `whipple3` now resolves anywhere
```

**2. Start the board** — terminal 1, in the project your agents should coordinate on:

```bash
whipple3 serve
# whipple3 serve: board listening on .whipple3/board.sock — log .whipple3/session-<ts>.ndjson
```

One process owns the session and the append-only log. Start it **before** the host: stdio MCP
servers dial the socket once, at session start. Optional `--policy policy.json` loads
label-level read/write ACLs per agent — every denial is logged, never silently dropped.

**3. Connect agents** — terminal 2, same directory. One proxy process per agent; identity is
bound to the socket, never self-declared in a payload, and one identity holds at most one
live connection (a second hello is refused). The socket itself is the trust boundary,
guarded by filesystem permissions alone — any local process that can reach it may declare
any free identity, which is why the host's per-agent tool allowlists stay the second gate:

```bash
claude mcp add --transport stdio whipple3-main -- whipple3 mcp --board .whipple3/board.sock --agent main
```

Repeat per agent identity — or skip the wiring and run the complete five-agent demo
(scanner, three parallel auditors, a fixer behind a human approval gate):

```bash
claude --plugin-dir ./examples/claude-code-plugin
# then, inside Claude Code:
/whipple3:audit
```

See [examples/claude-code-plugin/](./examples/claude-code-plugin/) for how the pieces fit
and what each enforcement layer actually guarantees. No board running? `whipple3 mcp --agent main`
alone serves a private single-process board over stdio.

**4. Distill** — fold the session log into a report; the trace stays:

```bash
whipple3 distill .whipple3/session-<ts>.ndjson    # → .whipple3/session-<ts>.report.md
```

**5. Watch it live.** Three sources, in ascending order of what they ask of you:

```bash
whipple3 studio --session          # your last Claude Code session — nothing to set up
whipple3 studio --demo             # a self-generating fixture, if you have no session
whipple3 studio .whipple3/session-<ts>.ndjson    # a real board's log
```

`--session` reads a transcript you already have (`~/.claude/projects/…`), projects it onto
the graph and prints the line that started this project:

```
77 agents (76 subagents) · 6398 tool calls · 190 targets touched by more
than one agent (1329 calls)
```

Read-only, and it stays on your machine — nothing is uploaded.

Agents become nodes, and so do the **targets** they aimed at — the file, command or URL —
shared between every agent that touched one. That sharing is not drawn in; it is what the
session already contained and nobody could see. So the picture is a web: your agents,
entangled through the files they each paid to read, having never exchanged a word. A target
only one agent touched gets no node, because it says nothing about the fleet; its calls are
still counted on that agent.

It is a normal whipple3 log, so `whipple3 replay` and `whipple3 distill` work on it, and
`tools/duplication` puts a number on the same picture.

Live graph, claims tinted per holding agent, per-node history, a time-travel scrubber over
the log.

**Merge gate.** The same claims stand in front of the forge. A branch's agent records the PR
it opened and the files it touched; `whipple3 merge` refuses to merge while another branch
still holds one of them, runs the forge's own merge only when the board is clear, and hands
the files back afterwards. The board runs locally, so the gate runs where the board runs —
wrap the merge instead of waiting for a cloud queue to dial a socket it cannot reach:

```bash
whipple3 pr open src/pay.ts --agent feat/a --number 12     # PR node + touches edges + claims
whipple3 pr check --agent feat/a --number 12               # 0 clear · 2 held by <branch> · 1 no board
whipple3 merge --agent feat/a --number 12                  # check → gh pr merge 12 → release
whipple3 merge --agent feat/a --number 12 -- <forge cmd>   # any forge; Origin when it has a CLI
```

Fail closed: an unreachable board is exit 1, never a merge. A failed forge command leaves the
claims held. The log keeps every PR as a `PullRequest` node, so `replay`, `distill`, Studio and
`@whipple3/assert` see who touched what, who was refused, and when the hold ended — the record
agent-scale git hosting (Cursor Origin, GitHub) does not produce.

**Review on the board.** A forge stores review as threads of prose; the board stores it as
typed state behind an ACL. The forge keeps human review, the board keeps agent review, and
nothing is synced between them. A reviewer identity posts comments and one verdict; the
branch marks comments addressed; the merge gate reads the state, never the thread:

```bash
whipple3 comment post "Null check on line 12" --agent reviewer-1 --number 12 --path src/pay.ts --severity blocking
whipple3 review --agent reviewer-1 --number 12 --verdict request_changes
whipple3 pr check --agent feat/a --number 12        # changes requested by reviewer-1 · blocking: comment:12:… · exit 2
whipple3 comment addressed comment:12:null-check-on-line-12 --agent feat/a --number 12
whipple3 review --agent reviewer-1 --number 12 --verdict approve
whipple3 merge --agent feat/a --number 12          # clear → forge → released
```

Start the board with `whipple3 serve --policy examples/review-policy.json` and the `Review`
label is writable by the reviewer alone: a branch approving itself is refused, and the refusal
is an `acl.denied` in the log. No review is not a refusal — the forge's own protection still
covers the human side. In CI, `approvedBeforeMerge()` from `@whipple3/assert` reads the log in
order and fails any merge that was not preceded by a standing approve. The reviewer subagent
for Claude Code is [examples/claude-code-plugin/agents/reviewer.md](./examples/claude-code-plugin/agents/reviewer.md).

**6. Assert it in CI.** Eval tools judge what an agent *said*. `@whipple3/assert` judges
what a fleet *left behind* — the typed state, and the enforcement record of reaching it:

```ts
import { sessionFromLog, run, format, every, none, atLeast, noDenials, allClaimsReleased }
  from "@whipple3/assert";

const session = await sessionFromLog(".whipple3/session-<ts>.ndjson");
const report = run(session,
  atLeast("CodeFile", 1),                          // guards the vacuous pass below
  every("CodeFile", (p) => p.status === "audited"),
  none("SecurityIssue", (p) => p.status === "pending"),
  noDenials(),
  allClaimsReleased(),                             // nobody died holding their work
);
if (!report.ok) throw new Error(format(report));
```

Run against the real five-agent audit log from 2026-08-11, all five pass. It is a pure fold
of the log, so the verdict is deterministic even though the models are not — which is the
only reason a coordination regression can fail a build. Hop budgets and cost ceilings are
**deliberately absent**: nothing emits `causationId` chains or `llm.call` yet, and an
assertion over an empty stream is worse than no assertion.

## Hosts

whipple3 speaks plain MCP stdio, so any MCP host can sit on the other side of the board.
Every row below is backed by commands actually run on 2026-08-11 (or honestly marked
doc-only) — evidence and exact wiring per host in [docs/hosts/](./docs/hosts/).
Status legend: ✅ ran e2e · 🔒 installed but unauthenticated (wiring verified as far as
auth allows; no logins attempted) · 📋 documented from official docs, not run.

| Host | Status | Date | Notes |
|---|---|---|---|
| [Claude Code](./docs/hosts/claude-code.md) ≥ 2.1.138 | ✅ ran | 2026-08-11 | Five-agent `/audit` demo e2e: 3 parallel auditors, zero duplicate claims, zero lost updates. Plugin `.mcp.json` needs ≥ 2.1.140; `--mcp-config` fallback below that. |
| [OpenAI Codex CLI](./docs/hosts/codex.md) 0.42.0 | 🔒 installed, unauthenticated | 2026-08-11 | MCP handshake + tool load verified via per-invocation `-c mcp_servers.*` overrides; model turn blocked (token refresh 401). Known issue: codex 0.42.0 drops `blackboard_next` at schema conversion (`additionalProperties: {}`). |
| [Cursor CLI](./docs/hosts/cursor.md) 2026.04.17 | ✅ ran | 2026-08-11 | Full model turn over MCP against a live board: status → post → status, the mutation attributed to `cursor` in the board log. Stale-proxy identity lockout + approval findings in the host doc. |
| [Gemini CLI](./docs/hosts/gemini-cli.md) 0.41.2 | 🔒 installed, unauthenticated | 2026-08-11 | Project `.gemini/settings.json` wiring per current docs; headless run stopped at auth (`IneligibleTierError` — no supported credential on the machine). |
| [opencode](./docs/hosts/opencode.md) | 📋 documented, not run | 2026-08-11 | `opencode.json` `"mcp"` wiring from official docs (`type: "local"`, single command array). CLI not installed on the verification machine. |

## Status

Pre-release (v0.1 vertical slice — see [SPEC.md](./SPEC.md) §12). What's real today:

- `@whipple3/core` — pure functional core: branded IDs, immutable `GraphState`, the `apply()`
  reducer with optimistic versioning and claim/lease semantics, ACL checks, context slicing,
  the full event taxonomy. One runtime dependency: Zod. Property-tested with fast-check.
- `@whipple3/log` — `LogStore` port with memory and NDJSON adapters, verified by a shared
  conformance suite.
- `@whipple3/transport-mcp` — the six blackboard tools (`post` / `read` / `claim` / `release` /
  `next` / `status`): session shell (parse → ACL → apply → append) and a stdio MCP server,
  tested over a real client round-trip. Identity is bound to the connection at
  `session.connect` — no tool payload carries an `agentId`; every event records the
  `principal` the session runs on behalf of.
- `@whipple3/transport-uds` — the shared-state backend: one board server on a Unix domain
  socket, per-agent connections with identity bound at connect.
- `whipple3` — the CLI: `serve` (the board backend, with `--policy`), `mcp --board <sock>
  --agent <id>` per-agent proxies (or `mcp --agent <id>` standalone), `distill <log>` →
  report.md, `claim <paths…> --agent <id>` / `release` — a claim a shell can make, so a
  PreToolUse hook can refuse an edit on a path another branch holds (exit 2 names the holder),
  `studio <log> | --demo` — the live graph, served from the bin with the built
  page shipped beside it — and `replay <log>`, which re-folds the log through the pure
  reducer and exits non-zero if it fails to reproduce itself. Every command in `--help`
  works — nothing there is a stub. Session traces live under `.whipple3/`.

First target: a shared blackboard for **Claude Code subagents** — parallel workers that
claim tasks instead of colliding, with a live graph Studio. See `examples/claude-code-plugin/`.

## Developing

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm depcruise && pnpm build && pnpm test
```

## Design

Read [SPEC.md](./SPEC.md); the decision records live in [docs/adr/](./docs/adr/), and where
whipple3 sits relative to LangGraph, CrewAI, Letta and the CLI agents is in
[docs/positioning.md](./docs/positioning.md). The short
version: functional core / imperative shell; the log is the truth and the graph is a view;
pull-mode dispatch for host runtimes (Claude Code) now, push-mode reactive runtime later;
MCP as the agent-facing surface — model-agnostic by construction, bring your own key.

## The mark

<img src="assets/whipple3-mark.svg#gh-light-mode-only" alt="" width="64" align="left" hspace="18" vspace="4">
<img src="assets/whipple3-mark-dark.svg#gh-dark-mode-only" alt="" width="64" align="left" hspace="18" vspace="4">

A compound whippletree for three. The pivot sits at one third, so two pulling on the short arm
equal one on the long arm — and the bar hangs level. Fair distribution, drawn. It is also the
graph: three agents under one load, with the tinted node the one currently holding a claim.

Files in [`assets/`](./assets): `whipple3-mark.svg` and its `-dark` pair, `whipple3-icon.svg`
(reduced, for small sizes) and `whipple3-badge.svg` (dark tile, for favicons and avatars — a
bare mark goes muddy under about 24px).

<br clear="left">

## License

MIT

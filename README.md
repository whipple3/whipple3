# whipple3

> **whipple3** (from *whippletree* — the crossbar that lets a team of harnessed horses pull
> one load without pulling against each other). Sessions stay ephemeral, sukkah-style: built
> for a purpose, lived in, taken down. What remains is what it taught you.

**A typed, ephemeral, event-sourced blackboard for coordinating AI agents.**

One agent doesn't need whipple3. **Two do.**

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

**5. Watch it live** (optional, from this repo while `whipple3 studio` wiring is pending):

```bash
pnpm --filter @whipple3/studio dev /path/to/.whipple3/session-<ts>.ndjson
```

Live graph, claims tinted per holding agent, per-node history, a time-travel scrubber over
the log.

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
| [Cursor CLI](./docs/hosts/cursor.md) 2026.04.17 | 🔒 installed, unauthenticated | 2026-08-11 | `.cursor/mcp.json` wiring verified: `cursor-agent mcp list-tools whipple3` returned all six tools over a live board. Agent turn needs `cursor-agent login`. |
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
  report.md. `init` / `studio` / `replay` are still stubs; session traces live under
  `.whipple3/`.

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

## License

MIT

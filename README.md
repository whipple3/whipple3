# whipple3

> **whipple3** (from *whippletree* — the crossbar that lets a team of harnessed horses pull
> one load without pulling against each other). Sessions stay ephemeral, sukkah-style: built
> for a purpose, lived in, taken down. What remains is what it taught you.

**A typed, ephemeral, event-sourced blackboard for coordinating AI agents.**

NanoClaw isolates one agent from your machine. **whipple3 coordinates many agents with each other.**

Agents don't chat and don't funnel everything through an orchestrator's context. They read and
write a shared typed graph through structured, versioned, ACL-checked mutations. The append-only
event log is the source of truth — so every session is auditable and replayable by construction.

## Status

Pre-release skeleton (v0.1 vertical slice in progress — see [SPEC.md](./SPEC.md) §12).
What's real today:

- `@whipple3/core` — pure functional core: branded IDs, immutable `GraphState`, the `apply()`
  reducer with optimistic versioning and claim/lease semantics, ACL checks, context slicing,
  the full event taxonomy. One runtime dependency: Zod. Property-tested with fast-check.
- `@whipple3/log` — `LogStore` port with memory and NDJSON adapters, verified by a shared
  conformance suite.
- `@whipple3/transport-mcp` — the five blackboard tools (`post` / `read` / `claim` / `next` /
  `status`): session shell (parse → ACL → apply → append) and a stdio MCP server, tested
  over a real client round-trip. Identity is bound to the connection at `session.connect` —
  no tool payload carries an `agentId`; every event records the `principal` the session
  runs on behalf of.
- `whipple3` — the CLI: `whipple3 mcp --agent <id>` serves the blackboard as that agent
  (one server process per agent; default `main`) and writes the session trace to
  `.whipple3/session-<timestamp>.ndjson` (`init` / `studio` / `replay` are still stubs).

First target: a shared blackboard for **Claude Code subagents** — parallel workers that
claim tasks instead of colliding, with a live graph Studio. See `examples/claude-code-plugin/`.

## Quick start (dev)

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm depcruise && pnpm build && pnpm test
```

Hook the blackboard into Claude Code (or any MCP host). On stdio, one server process is
one agent identity — pass it with `--agent`:

```bash
claude mcp add --transport stdio whipple3 -- node packages/cli/dist/main.js mcp --agent main
```

## Design

Read [SPEC.md](./SPEC.md); the decision records live in [docs/adr/](./docs/adr/). The short
version: functional core / imperative shell; the log is the truth and the graph is a view;
pull-mode dispatch for host runtimes (Claude Code) now, push-mode reactive runtime later;
MCP as the agent-facing surface — model-agnostic by construction, bring your own key.

## License

MIT

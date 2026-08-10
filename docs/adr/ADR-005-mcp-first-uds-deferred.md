# ADR-005 — MCP-first agent surface; UDS transport deferred

**Status:** Accepted (2026-08-10, SPEC v0.1). Amended by ruling D1 (2026-08-10): a
minimal socket-backed shared-state backend is pulled forward to Wave 2 — see below.

## Context

Agents need a wire to the blackboard. MCP is an open standard already spoken by Claude
Code, Codex CLI, Gemini CLI, Cursor, opencode, Goose — exposing the blackboard as MCP
tools makes whipple3 model- and host-agnostic by construction (SPEC §3). Claude Code as
first demo is a distribution decision, not an architectural dependency (SPEC §8).

A Unix-domain-socket transport is only needed when whipple3 spawns and owns agent
processes itself — which v0.1 does not do (ADR-003, ADR-002).

## Decision

The agent-facing surface is five constrained, typed MCP tools over stdio via the
official `@modelcontextprotocol/sdk` (SPEC §6): `blackboard_post` / `read` / `claim` /
`next` / `status`. No query language is ever exposed to LLMs (SPEC §3). UDS transport
(`@whipple3/transport-uds`, socket per agent) is deferred to the phase where whipple3
runs its own processes (ROADMAP Stage 5).

**Amendment (D1, 2026-08-10):** Claude Code multiplexes all subagents over ONE stdio
connection, so on a real host every subagent shares one identity. To give Stage 2's
demo real per-agent identity, a minimal piece of Stage 5 moves to Wave 2 (W2-B):
`whipple3 serve` owns the session, `whipple3 mcp --agent <id>` becomes a thin
stdio↔socket proxy, and identity comes from the socket — the same socket-per-agent
design Stage 5 promises, one wave early.

## Consequences

- Any MCP host gets the blackboard for free; host-specific integration stays in
  `examples/` (SPEC §14).
- Identity-from-connection (ADR-007) maps cleanly onto both transports: process per
  agent on stdio, socket per agent on UDS.
- Tool schemas are projections of core's Zod schemas — one source of truth, four
  projections (SPEC §9.3).

# CLAUDE.md — whipple3

## What this is

whipple3: a typed, ephemeral, event-sourced blackboard for coordinating AI agents.
SPEC.md is the canonical contract — read it before any non-trivial change.
ARCHITECTURE.md is the 60-second map. This file is your working brief.

## Current focus: W1 (vertical slice, week 1)

Goal: a Claude Code subagent can post / claim / read against a running `whipple3 mcp` server.

1. `packages/transport-mcp/src/session.ts` — the imperative shell. Owns the current
   `GraphState`, a `LogStore`, and an `AclPolicy`. Injects time and ULID txIds; assembles
   `EventMeta` (causationId / correlationId). Pipeline per mutation:
   parse (Zod, from tools.ts) → `checkAcl` → `apply` → `append` → Result-shaped payload.
   Core stays untouched and pure.
2. `packages/transport-mcp/src/server.ts` — stdio MCP server via
   `@modelcontextprotocol/sdk`, registering the five tools from `tools.ts`.
   Verify the SDK's current API from its own docs/types — do not code it from memory.
   Tool errors return structured data (mirroring `Result`), never prose.
3. `blackboard_next` — pull-mode query: nodes of the given label matching `match` props,
   excluding nodes with a valid (unexpired) claim. If the query is pure, it belongs in
   core (`slice.ts` or a sibling); anything needing a clock stays in session.
4. `packages/cli` — wire `whipple3 mcp` to start the server with a JSONL log under
   `.whipple3/session-<timestamp>.ndjson`.
5. Tests — integration tests at the session layer (drive the five handlers, assert both
   log contents and resulting state). Keep the property tests and conformance suites green.

Out of scope for W1 — do not start: studio, push scheduler, XState, UDS transport,
OTel, sandboxes, DSL literal-inference polish. (SPEC §12.)

## Non-negotiable rules (SPEC §9 — CI enforces most of them)

- `@whipple3/core` is PURE: no I/O, no `Date.now()`, no randomness, no `node:` imports,
  and it imports nothing from other packages. Time and ids are passed in.
- Core's only runtime dependency is `zod`. **Adding ANY dependency anywhere requires
  asking Michael first.** Pre-approved exception: `ulid` in `@whipple3/transport-mcp`.
- Errors are values (`Result`) in core and session logic; exceptions only at process edges.
- Strict TS as configured. Zero `any`; `unknown` only at boundaries, parsed once with Zod
  ("parse, don't validate" — interior code never re-checks).
- Branded IDs everywhere; events/mutations are discriminated unions with exhaustive
  `switch` + `never` assertions.
- Abstractions only at package boundaries (the ports). No internal single-implementation
  interfaces, no factories where a closure suffices, no class hierarchies.
  Rule of three before extracting any abstraction.
- Budgets: core stays under ~1,000 lines total; no file over ~200 lines; one directory
  level per package.
- Every port implementation must pass its shared conformance suite.
- The graph is the control plane: never store file contents or blobs in node props —
  paths and hashes only.
- Never expose a query language to LLM-facing tools.

## Workflow

- After EVERY change: `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test`.
  All green or do not proceed. Never commit red.
- Small, focused commits, signed off: `git commit -s`. Message style: `area: what`
  (e.g., `transport-mcp: wire stdio server`).
- Dev exports point at `src` and `publishConfig` swaps to `dist` on publish — this is
  intentional (internal-package pattern). Do not "fix" it. Sanity: `pnpm build`.
- Tests live outside `src` (`test/`, `conformance/`) — never inside `src`.
- When touching `examples/claude-code-plugin/`, verify against the current Claude Code
  subagent/plugin docs rather than assuming.

## Map

```
packages/core           pure reducer, ids, events, acl, claims, slices  (test/ = fast-check)
packages/log            LogStore port + memory/jsonl + conformance/
packages/transport-mcp  tools.ts (Zod schemas) · server.ts + session.ts (W1)
packages/cli            whipple3 bin: init | mcp | studio | replay
packages/studio         W2 — do not touch in W1
examples/claude-code-plugin   the /audit demo: scanner, auditors, fixer
```

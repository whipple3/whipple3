# CLAUDE.md — whipple3

## What this is

whipple3: a typed, ephemeral, event-sourced blackboard for coordinating AI agents.
SPEC.md is the canonical contract — read it before any non-trivial change.
ARCHITECTURE.md is the 60-second map. This file is your working brief.

## Current focus: Stage 2, executed in parallel waves

Stage 1 is code-complete (see ROADMAP.md): identity binds at `session.connect(agentId)` —
no tool payload ever carries an `agentId`; `EventMeta` carries `principal`
(`WHIPPLE3_PRINCIPAL` → OS user); ACL enforces BOTH directions and logs every denial as
an `acl.denied` event; board lifetime is a parameter (`BoardLifetime`, SPEC §4.8) —
nothing may hardcode "session end ⇒ purge", and purge is never core's business.

Work now runs as parallel sessions on disjoint packages. Before writing code:

1. Read ROADMAP.md, then find your package in `docs/plans/2026-08-10-swarm-waves.md`.
2. Work ONLY inside your package's owned paths, in its own worktree/branch.
3. Frozen mid-wave (design around them; request changes in the wave doc):
   core's export surface, `tools.ts` schemas, the event taxonomy, the log port,
   the `AclPolicy` shape, `AgentConnection`, `BoardLifetime`.

Out of scope until the wave doc says otherwise: push scheduler, XState, OTel, sandboxes.

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
packages/studio         Stage 3 — owned by the studio wave-package only
examples/claude-code-plugin   the /audit demo: scanner, auditors, fixer
```

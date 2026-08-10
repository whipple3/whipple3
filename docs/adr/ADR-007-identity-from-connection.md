# ADR-007 — Identity from the connection, never from the payload

**Status:** Accepted (2026-08-10, Stage 1 identity hardening — commit `3d750bf`)

## Context

The original tool schemas carried `agentId` as a payload field. A self-declared identity
makes `checkAcl` decorative: any agent can assert any name, so the ACL keys on a claim
the enforcement point cannot verify (SPEC §4.6). Attribution has the same problem —
"on whose behalf" cannot be reconstructed from old logs retroactively, so the field is
now-or-never. Stage 1 was the last cheap moment to fix both, before the server
calcified around the old schemas.

## Decision

- **No tool payload carries an `agentId`.** Zod strips a spoofed argument at the wire
  (`transport-mcp/src/tools.ts`). Identity binds once, at `session.connect(agentId)`
  (`session.ts`); one connection = one agent.
- On stdio that means one server process per agent: `whipple3 mcp --agent <id>`,
  declared in each subagent's frontmatter. On UDS (Stage 5 / W2-B per ruling D1):
  one socket per agent — the same principle, so this is right by design, not just
  convenient.
- `EventMeta` gains `principal` — on-behalf-of attribution ("Michael's agent did", not
  just "auditor did"). Resolved once per session by `liveSessionDeps`:
  `WHIPPLE3_PRINCIPAL` (the SSO/enterprise injection hook) falling back to the OS user.

## Consequences

- `checkAcl` is meaningful: the identity it keys on is bound by the transport, not
  asserted by the payload.
- Breaking change to the tool schemas — accepted deliberately while there were no
  external users.
- On a host that multiplexes all subagents over one stdio connection (Claude Code
  today), everyone shares that connection's identity (CLI default `main`). Real
  per-agent identity on such a host needs the socket-per-agent backend — ruling D1
  green-lit pulling it forward to Wave 2 (see ADR-005).
- Every event in the log is attributable to agent AND principal from day one; the
  commercial identity story (SSO → role mapping) later plugs into the same hook.

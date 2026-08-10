# Architecture

The canonical design document is [SPEC.md](./SPEC.md); decisions live in
[docs/adr/](./docs/adr/). This file is the 60-second version.

```
     agents (Claude Code subagents, any MCP host)
            │  five MCP tools over stdio: post / read / claim / next / status
            │  (no payload carries an agentId — ADR-007)
            ▼
  @whipple3/transport-mcp                ← shell: one process per agent
            │                              (`whipple3 mcp --agent <id>`);
            │                              identity binds at session.connect
   parse (Zod) → checkAcl / checkRead → apply() → append(log)
            │
  @whipple3/core (pure)                  ← reducer, versions, claims,
            │                              policy-filtered slices
  @whipple3/log (port)                   ← memory | NDJSON | (sqlite next)
            │
  @whipple3/studio                       ← ReadonlyLog → SSE → sigma.js
```

What the shell guarantees on every call:

- **Identity from the connection.** `session.connect(agentId)` binds who is talking;
  tool payloads cannot assert or override it. Every event's `EventMeta` also carries
  `principal` — on whose behalf the session runs (`WHIPPLE3_PRINCIPAL` → OS user).
- **Two-sided ACL, denials logged.** `checkAcl` gates every write; reads return
  `readableNeighborhood` — filtered *during* traversal, so an unreadable node never
  leaks via an edge endpoint. Every denial is an `acl.denied` event (ADR-008).
- **Board lifetime is config.** `BoardLifetime` is a session parameter; v0.1 implements
  `"ephemeral"` only, and purge is an explicit policy-gated action, never a session-end
  side effect (ADR-009).

Rules that keep it honest (enforced in CI):

- `@whipple3/core` imports nothing internal and no Node built-ins (dependency-cruiser).
- Every `LogStore` implementation passes the same conformance suite.
- Errors are values (`Result`); exceptions only at shell edges.
- Time and IDs are injected into core, never generated inside it.

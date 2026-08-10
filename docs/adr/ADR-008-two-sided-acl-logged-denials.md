# ADR-008 — Two-sided ACL: reads filtered during traversal, every denial logged

**Status:** Accepted (2026-08-10 — commit `f3c8d4f`)

## Context

`checkAcl` governed writes only; reads were wide open. Any agent could read the whole
graph regardless of policy — an enforcement gap, not a future feature. Filtering reads
*after* a traversal would still leak: an edge endpoint reveals the existence and id of a
node the reader may not see. And a denial that vanishes silently is unauditable — the
opposite of the project's audit-by-construction claim (SPEC §4.6).

## Decision

- `AclPolicy` declares `{ write, read }` label lists per agent (`core/src/acl.ts`).
  An absent agent may do nothing. `AclError` is discriminated:
  `ACL_DENIED_WRITE | ACL_DENIED_READ`.
- `checkAcl` gates every mutation; `checkRead` + `readableNeighborhood` filter slices
  **during traversal** (`core/src/slice.ts`): an unreadable node blocks its whole path
  and never leaks via an edge endpoint. Property-tested: no slice ever contains a label
  outside the reader's set.
- `blackboard_read` and `blackboard_next` return the policy-filtered slice. An explicit
  request for an unreadable root or label is a denial; interior filtering silently
  shapes the slice — the engine decides what the agent sees, the agent never widens its
  own scope (SPEC §4.7).
- Every denial, read or write, is appended to the log as an `acl.denied` event
  (`session.ts`): enforcement leaves a trail, never a silent drop.
- `acl: null` means no ACL configured — the host's tool allowlist is the only gate
  (the v0.1 CLI default until the plugin demo ships policy config).

## Consequences

- The read side and write side share one policy shape and one enforcement point — the
  session pipeline: parse → ACL → apply → append.
- The audit log answers "who was denied what, when" — the choke point the eventual
  governance story depends on (ROADMAP Stage 9).
- Slice filtering costs a predicate per node/edge during BFS; unfiltered `neighborhood`
  remains for trusted callers (studio, replay).

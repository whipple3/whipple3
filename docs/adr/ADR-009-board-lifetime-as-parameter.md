# ADR-009 — Board lifetime is a parameter, not an assumption

**Status:** Accepted (2026-08-10 — commit `582f22f`)

## Context

whipple3 boards are ephemeral by design (three-tier lifecycle, SPEC §4.3) — but
"ephemeral" hardcoded as an assumption ("session end ⇒ purge") would make long-lived
boards shared by sessions from different processes a refactor instead of a feature.
The core was audited before deciding: reducer, claims, ACL, and slices reference no
session boundary — `EventMeta.sessionId` is attribution, not scoping — so nothing needs
working around (SPEC §4.8).

## Decision

- `SessionDeps` carries `lifetime: BoardLifetime = "ephemeral" | "persistent"`,
  defaulting to `"ephemeral"` (`transport-mcp/src/session.ts`).
- The type admits `"persistent"` so persistence lands later as config, not refactor;
  the runtime rejects it with a clear not-implemented error until it exists
  (ROADMAP Stage 5+).
- Purge (Stage 2) is an **explicit action** gated by the lifetime policy — never an
  implicit side effect of a session ending, and never core's business.
- Core stays lifetime-agnostic: reducer, claims, ACL, slices know nothing about board
  lifetime.

## Consequences

- Stage 2's `distill()` → purge flow builds on the policy instead of baking session-end
  semantics into the shell (constraint recorded against W2-A in the waves plan).
- Multi-process persistent boards (Stage 5's `whipple3 serve` topology) arrive by
  flipping config, with the rejection point already marking where the implementation
  goes.
- One more parameter in `SessionDeps` today buys the absence of a breaking change
  later.

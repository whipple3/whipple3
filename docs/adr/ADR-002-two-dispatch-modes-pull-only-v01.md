# ADR-002 — Two dispatch modes, one core; v0.1 is pull-only

**Status:** Accepted (2026-08-10, SPEC v0.1)

## Context

Agents must be dispatched when the graph state matches their trigger. Two topologies
exist (SPEC §4.4):

- **Pull** — a host runtime (e.g., Claude Code) already owns spawning, models, and
  permissions; whipple3 only needs to answer "what should this role work on next".
- **Push** — whipple3 runs the loop itself: reactive triggers dispatch agents on
  matching mutations. That requires a real scheduler: queues, concurrency caps,
  batching, retries, lease expiry, quiescence detection.

The v0.1 vertical slice targets Claude Code (SPEC §8), which provides orchestration for
free. Building the scheduler first would delay the slice for capability the first host
does not need.

## Decision

The schema's `when()` predicates are dispatch-mode-neutral. In pull mode they compile to
work-queue queries served by `blackboard_next` (`availableWork` in `core/src/slice.ts`:
label + props match, minus nodes under a valid claim). v0.1 implements pull only; push
mode arrives with the Phase 2 runtime (ROADMAP Stage 6).

## Consequences

- v0.1 ships with no scheduler code; the host's orchestrator stays in charge.
- The same schema serves both modes later — `when()` becomes a push subscription without
  changing agent definitions.
- Quiescence detection ("the task is finished") is deferred with push mode; in pull mode
  the host decides when work ends.

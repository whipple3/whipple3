# ADR-004 — graphology demoted to Studio; core state is our own immutable structure

**Status:** Accepted (2026-08-10, SPEC v0.1)

## Context

The working graph needs a data structure. graphology (with sigma.js for rendering) is
the obvious library — but it is a mutable, event-emitting graph model, and
`@whipple3/core` must be pure: zero I/O, deterministic `apply`, exactly one runtime
dependency, Zod (SPEC §4.1, §5). Purity is a product feature — replay, time-travel, and
property-based testing fall out of it — not aesthetics.

## Decision

Core state is our own immutable structure: `GraphState` is three `ReadonlyMap`s
(nodes, edges, claims) in `core/src/state.ts`; the reducer returns fresh state,
never mutates. graphology and sigma.js live ONLY in `packages/studio`, which consumes
the log through the `ReadonlyLog` port and rebuilds its render graph there (SPEC §5,
§10). Ruling D3 (2026-08-10) admits `vite`, `sigma`, `graphology` as dependencies of
`packages/studio` and nowhere else.

## Consequences

- Core keeps its single-dependency guarantee; dependency-cruiser fails CI if graphology
  ever leaks inward.
- Replay is a deterministic fold; fast-check property tests run against plain data.
- We forgo graphology's algorithms in core — the BFS in `core/src/slice.ts` is
  hand-rolled, which the ~1,000-line core budget absorbs.
- Studio's render model can diverge from core's state model freely; they meet only at
  the log.

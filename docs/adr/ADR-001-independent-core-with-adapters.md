# ADR-001 — Independent core with adapters, not built on a vendor runtime

**Status:** Accepted (2026-08-10, SPEC v0.1)

## Context

whipple3 needs event handling, an append-only log, and (eventually) scheduling — all
things a durable-execution vendor runtime (Inngest et al.) provides out of the box.
Building on one would trade implementation effort for coupling: the reducer's replay
semantics, the log format, and the dispatch model would follow a vendor's roadmap.

SPEC.md's non-goals rule this out directly: no vendor lock-in (§3), no required external
database (§3), no LLM calls in core (§3). The engineering standards (§9.1) demand the
inverse dependency direction: core defines the port types; adapters depend on core,
never the reverse.

## Decision

`@whipple3/core` is an independent, pure library — zero I/O, one runtime dependency
(Zod). All integration happens at ports: `LogStore` and `Transport` in v0.1;
`SandboxProvider`, `ModelProvider`, `Exporter`, `TelemetryExporter` in Phase 2 (SPEC §5).
Every port ships a conformance suite that all adapters must pass; import direction is
enforced by dependency-cruiser in CI.

## Consequences

- Replay, time-travel, and property-based testing fall out of core's purity instead of
  depending on a vendor's replay features.
- Any backend (log store, transport, sandbox, model provider) is an adapter with a
  conformance suite — extension without touching core (SPEC §9.1-O).
- We own primitives a runtime would have provided (`Result`, log ports, later the
  scheduler). The size budgets in SPEC §9.3 keep that cost bounded.

# ADR-006 — KùzuDB rejected; core dependencies minimized

**Status:** Accepted (2026-08-10, SPEC v0.1)

## Context

An embedded graph database (KùzuDB) was a candidate for storing and querying the graph.
In October 2025 the upstream project was archived — a bus-factor lesson learned before a
line depended on it. Independently, the SPEC's non-goals already forbade a required
external database (§3), and the reducer-over-log design (§4.1–§4.2) makes the working
graph a materialized view that fits in memory.

## Decision

No KùzuDB, and the lesson generalized: every dependency is a decision (ROADMAP standing
rule 6). `@whipple3/core` carries exactly one runtime dependency — Zod (SPEC §5). State
is our own immutable structure (ADR-004); persistence is the append-only log behind the
`LogStore` port — JSONL now, SQLite adapter next, preferring built-in `node:sqlite` over
a native module (SPEC §10).

## Consequences

- Zero-install default: in-memory graph + append-only file, no external database ever
  required.
- Graph access stays constrained typed tools — no query language for a database to
  tempt us into exposing (SPEC §3).
- Storage backends are swappable behind the port conformance suite; an archived upstream
  costs us an adapter, not the core.

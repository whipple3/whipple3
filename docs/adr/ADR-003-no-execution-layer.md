# ADR-003 — We do not build the execution/sandbox layer

**Status:** Accepted (2026-08-10, SPEC v0.1)

## Context

Multi-agent systems need two distinct planes: an execution plane (container isolation,
credential gateways, microVMs) and a coordination plane (shared state, claims, ACLs,
audit). The execution plane is already owned — NanoClaw, E2B, Daytona (SPEC §3). The
positioning line states the split: NanoClaw isolates one agent from your machine;
whipple3 coordinates many agents with each other.

For the v0.1 slice, Claude Code additionally provides tool execution and permissions for
free (SPEC §8), so whipple3 needs no execution capability at all to ship.

## Decision

whipple3 is a coordination plane, deliberately not an execution plane. We never build
sandboxes, credential gateways, or model runtimes; we ride that layer via a
`SandboxProvider` port in Phase 2 (dockerode adapter first, then E2B / Daytona /
NanoClaw-pattern adapters — ROADMAP Stage 5). This is a standing rule across every
stage (ROADMAP rule 3).

## Consequences

- Scope stays solo-sized; the §3 non-goals and §9.3 budgets are the contract against
  creep (SPEC §14).
- whipple3 composes with the isolation tool users already run instead of competing
  with it.
- Anything execution-shaped in the roadmap (UDS transport for self-spawned processes,
  sandbox adapters) is gated behind the phase where whipple3 actually spawns processes.

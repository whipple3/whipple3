# @whipple3/core

The pure functional core of [whipple3](https://github.com/whipple3/whipple3) — a typed,
ephemeral, event-sourced blackboard for coordinating AI agents.

Immutable `GraphState`, the `apply()` reducer with optimistic versioning and claim/lease
semantics, ACL checks, typed slices, the full event taxonomy. No I/O, no clocks, no
randomness — time and ids are passed in. One runtime dependency: Zod.

Design contract: [SPEC.md](https://github.com/whipple3/whipple3/blob/main/SPEC.md).

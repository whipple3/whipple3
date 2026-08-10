# @whipple3/log

The append-only session log of [whipple3](https://github.com/whipple3/whipple3) — a typed,
ephemeral, event-sourced blackboard for coordinating AI agents.

`LogStore` / `ReadonlyLog` ports with memory and NDJSON adapters, each verified by a shared
conformance suite. The log is the source of truth: replay, Studio, distill, and audit all
depend on it and on nothing else.

Design contract: [SPEC.md](https://github.com/whipple3/whipple3/blob/main/SPEC.md).

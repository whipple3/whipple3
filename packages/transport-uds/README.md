# @whipple3/transport-uds

The shared-state backend transport of [whipple3](https://github.com/whipple3/whipple3) — a
typed, ephemeral, event-sourced blackboard for coordinating AI agents.

One board server owns the session over a Unix domain socket; per-agent clients connect with
identity bound at socket connect. This is what makes `whipple3 serve` + per-agent
`whipple3 mcp --board` proxies possible on hosts that multiplex agents over one stdio pipe.

Design contract: [SPEC.md](https://github.com/whipple3/whipple3/blob/main/SPEC.md).

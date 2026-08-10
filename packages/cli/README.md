# whipple3

The CLI for [whipple3](https://github.com/whipple3/whipple3) — a typed, ephemeral,
event-sourced blackboard for coordinating AI agents.

- `whipple3 serve` — one process owns the board, its session log, and a Unix socket.
- `whipple3 mcp --board <sock> --agent <id>` — a per-agent stdio MCP proxy; identity is
  bound to the socket, never self-declared in a payload.
- `whipple3 mcp --agent <id>` — standalone single-process board over stdio.
- `whipple3 distill <log>` — fold a session log into `report.md`.

Full quickstart, design docs, and the Claude Code `/audit` demo:
[github.com/whipple3/whipple3](https://github.com/whipple3/whipple3).

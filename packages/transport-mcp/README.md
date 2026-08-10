# @whipple3/transport-mcp

The agent-facing surface of [whipple3](https://github.com/whipple3/whipple3) — a typed,
ephemeral, event-sourced blackboard for coordinating AI agents.

The six blackboard tools (`post` / `read` / `claim` / `release` / `next` / `status`) as Zod
schemas, the session shell (parse → ACL → apply → append), and a stdio MCP server. Identity
binds at `session.connect` — no tool payload ever carries an `agentId`.

Design contract: [SPEC.md](https://github.com/whipple3/whipple3/blob/main/SPEC.md).

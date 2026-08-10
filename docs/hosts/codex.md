# Host: OpenAI Codex CLI

**Status: 🔒 installed, unauthenticated** — wiring verified through MCP handshake and
tool enumeration; the model turn was blocked by expired credentials (no login was
attempted). Verified 2026-08-11 against `codex-cli 0.42.0` on macOS, whipple3 0.1.0
(npm-linked), board via `whipple3 serve --socket /tmp/w4b.sock`.

## Wiring

Codex reads MCP stdio servers from `~/.codex/config.toml` (or project-scoped
`.codex/config.toml`), one `[mcp_servers.<name>]` table per server:

```toml
[mcp_servers.whipple3]
command = "npx"
args = ["whipple3", "mcp", "--board", "/abs/path/to/.whipple3/board.sock", "--agent", "codex"]
```

Equivalent one-liner: `codex mcp add whipple3 -- npx whipple3 mcp --board <sock> --agent codex`.
For a run that leaves the user's config untouched, the same table can be passed
per-invocation — this is what the verification used:

```bash
codex exec --skip-git-repo-check -s read-only \
  -c 'mcp_servers.whipple3.command="npx"' \
  -c 'mcp_servers.whipple3.args=["whipple3","mcp","--board","/tmp/w4b.sock","--agent","codex"]' \
  '<prompt: blackboard_status → blackboard_post → blackboard_status>'
```

(Config syntax cross-checked against the Codex MCP docs, learn.chatgpt.com/docs/extend/mcp,
fetched 2026-08-11. The `-c` override form comes from `codex exec --help` on 0.42.0.)

## What was run, and what happened

The board was live with two seeded `Task` nodes. Codex spawned the whipple3 proxy and
completed the MCP handshake — its connection manager log shows the server loaded:

```
codex_core::mcp_connection_manager: new_stdio_client ... program: "npx"
  args: ["whipple3", "mcp", "--board", "/tmp/w4b.sock", "--agent", "codex"]
  ... client_info: Implementation { name: "codex-mcp-client", ... version: "0.42.0" }
```

Two findings, then the stop:

**1. Codex 0.42.0 drops `blackboard_next` at schema conversion** (whipple3 issue to
track, found by this run — the other five tools converted without error):

```
codex_core::openai_tools: Failed to convert "whipple3__blackboard_next" MCP tool
  to OpenAI tool: Error("invalid type: map, expected a boolean", line: 0, column: 0)
```

Cause, confirmed by dumping the proxy's `tools/list` output: `blackboard_next.match`
(`z.record(z.string(), z.unknown()).default({})`) emits
`"additionalProperties": {}` — the *object* form of the keyword — on a top-level
property, and codex's converter accepts only the boolean form there. Effect on a codex
host today: agents can post/read/claim/release/status but not pull work via `next`.

**2. Credentials were stale, so no model turn ran:**

```
[2026-08-11] stream error: Failed to refresh token: 401 Unauthorized; retrying 5/5 ...
[2026-08-11] ERROR: Failed to refresh token: 401 Unauthorized
```

Per verification protocol no login was attempted. Re-run the same `codex exec` command
after `codex login` to turn this page into a ✅ — the wiring itself is proven.

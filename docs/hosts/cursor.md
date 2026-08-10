# Host: Cursor CLI (cursor-agent)

**Status: 🔒 installed, unauthenticated** — wiring verified end-to-end through the MCP
handshake: the CLI loaded the whipple3 proxy over the live board socket and enumerated
all six tools. An agent (model) turn requires login, and none was attempted. Verified
2026-08-11 against `cursor-agent 2026.04.17-787b533` on macOS, whipple3 0.1.0
(npm-linked), board via `whipple3 serve --socket /tmp/w4b.sock`.

## Wiring

The Cursor CLI uses the same MCP configuration as the editor, with the same precedence
(project → global): `.cursor/mcp.json` in the project or `~/.cursor/mcp.json` globally
(cursor.com/docs/cli/mcp + cursor.com/docs/context/mcp, fetched 2026-08-11). The exact
project-scoped wiring used:

```json
{
  "mcpServers": {
    "whipple3": {
      "command": "npx",
      "args": ["whipple3", "mcp", "--board", "/abs/path/to/.whipple3/board.sock", "--agent", "cursor"]
    }
  }
}
```

New servers are gated by a per-project approval; approve once with
`cursor-agent mcp enable whipple3` (stored under `~/.cursor/projects/<project>/
mcp-approvals.json`, scoped to that directory), or pass `--approve-mcps` on agent runs.

## What was run, and what happened

```
$ cursor-agent mcp list
whipple3: not loaded (needs approval)
$ cursor-agent mcp enable whipple3
✓ Enabled and approved MCP server: whipple3
$ cursor-agent mcp list
whipple3: ready
$ cursor-agent mcp list-tools whipple3
Tools for whipple3 (6):
- blackboard_claim (id, ttlMs)
- blackboard_next (label, match)
- blackboard_post (mutation)
- blackboard_read (root)
- blackboard_release (id)
- blackboard_status ()
```

`list-tools` is a real MCP round-trip: cursor-agent spawned the proxy, the proxy dialed
the board socket, and the six frozen tool schemas came back — including
`blackboard_next`, which Codex 0.42.0 rejects (see [codex.md](./codex.md)); no schema
incompatibility here. The blocker is only auth:

```
$ cursor-agent status
Not logged in
```

Per verification protocol no login was attempted. After `cursor-agent login`, a one-shot
`cursor-agent -p "<blackboard_status → blackboard_post>" --approve-mcps` from the wired
directory would turn this page into a ✅.

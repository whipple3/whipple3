# Host: Cursor CLI (cursor-agent)

**Status: ✅ ran** — full agent (model) turn over the MCP proxy against a live board:
`blackboard_status` → `blackboard_post` → `blackboard_status`, node count 0 → 1, and the
board log attributes the mutation to `agentId: "cursor"` with the local principal.
Verified 2026-08-11 (after `cursor-agent login`) against `cursor-agent
2026.04.17-787b533` on macOS, whipple3 0.1.0 (npm-linked). Earlier the same day the
pre-auth wiring check (below) had verified handshake + tool enumeration.

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


## The authenticated run (2026-08-11)

One-shot from the wired directory:

```
cursor-agent -p "…status → post → status…" --approve-mcps --trust -f
```

Model output (verbatim tail): status `{"nodes":0}` → post
`{"ok":true,"value":{"txId":"01KZQ10537HB3G3N8VP3PVE9E0","version":1}}` → status
`{"nodes":1,"byLabel":{"Task":1}}`. Board log:
`{"agent":"cursor","principal":"michael","type":"graph.mutation","id":"note:cursor-host-check"}`.

Two findings from getting there, both real:

1. **Stale-proxy identity lockout.** `cursor-agent mcp list-tools` spawns the whipple3
   proxy and never reaps it; the zombie keeps holding the board identity, so every
   later proxy is refused `IDENTITY_IN_USE` — which the host surfaces only as
   `MCP error -32000: Connection closed`. whipple3's one-identity-one-connection rule
   worked exactly as designed; the improvement queued on our side is for the proxy to
   print the refusal to stderr before exiting so host logs say WHY. Workaround: kill
   lingering `whipple3 mcp` processes before starting a session.
2. **Tool-call approvals are separate from server approval.** `--approve-mcps` loads
   the server but cursor's allowlist (`~/.cursor/cli-config.json`) still gates tool
   CALLS; non-interactively that means `-f` for the run (used here, scoped by a
   throwaway workspace) or adding `Mcp(whipple3, *)` to the allowlist.

Bonus observation for the socket-trust doc: while its MCP tools were broken, the model
read the transport source and wrote a raw NDJSON-frame client
(`.whipple3/run-check.mjs` in the demo dir) declaring the identity itself — on a local
socket the trust boundary is the socket, exactly as documented (ADR-007 / the
socket-trust note). It never got to run it; the shell allowlist blocked node.

# Host: opencode

**Status: 📋 documented, not run** — opencode is not installed on the verification
machine, and the protocol forbids installing hosts mid-verification. Wiring below is
from the official docs (opencode.ai/docs/mcp-servers, fetched 2026-08-11); no command
on this page has been executed against a whipple3 board.

## Wiring (from docs — untested)

opencode reads MCP servers from the `mcp` key of `opencode.json` / `opencode.jsonc`
(project-scoped; a global config uses the same shape). A whipple3 board would be a
`local` (stdio) server:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "whipple3": {
      "type": "local",
      "command": ["npx", "whipple3", "mcp", "--board", "/abs/path/to/.whipple3/board.sock", "--agent", "opencode"],
      "enabled": true
    }
  }
}
```

Shape differences from the other hosts, worth noting for anyone wiring this up:

- `command` is a **single array** including the executable — not `command` + `args`.
- The key is `mcp`, not `mcpServers`; stdio is spelled `"type": "local"`.
- Env vars go under `environment` (an object), and there is no CLI add command —
  configuration is file-only (`opencode mcp list` / `opencode mcp debug <name>` exist
  for inspection).

## To turn this page into a ✅

1. Install opencode; start a board (`whipple3 serve`) in the project directory.
2. Drop the config above into `opencode.json` with the real socket path.
3. Run a one-shot prompt calling `blackboard_status` then `blackboard_post`, and paste
   the transcript plus the matching board-log lines here.

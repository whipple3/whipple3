# Host: Gemini CLI

**Status: 🔒 installed, unauthenticated** — wiring written and cross-checked against the
current docs; the headless run stopped at authentication before the MCP layer was
reached (no login was attempted). Verified 2026-08-11 against Gemini CLI `0.41.2` on
macOS, whipple3 0.1.0 (npm-linked), board via `whipple3 serve --socket /tmp/w4b.sock`.

## Wiring

Gemini CLI reads MCP stdio servers from `mcpServers` in `~/.gemini/settings.json`
(user scope) or `.gemini/settings.json` (project scope — the default for
`gemini mcp add`). The exact project-scoped wiring used:

```json
{
  "mcpServers": {
    "whipple3": {
      "command": "npx",
      "args": ["whipple3", "mcp", "--board", "/abs/path/to/.whipple3/board.sock", "--agent", "gemini"],
      "trust": true
    }
  }
}
```

`"trust": true` bypasses per-call tool confirmations for this server. Equivalent
one-liner: `gemini mcp add --trust whipple3 npx whipple3 mcp --board <sock> --agent gemini`.
Two host-specific gates worth knowing (both from the official MCP docs at
geminicli.com/docs/tools/mcp-server, fetched 2026-08-11):

- **Folder trust:** stdio servers "are only tested and displayed as 'Connected' if the
  current folder is trusted" — `gemini mcp list` shows project-scoped stdio servers
  only after `gemini trust` (observed: in an untrusted dir, `gemini mcp list` printed
  only the user-scope servers). Headless runs can pass `--skip-trust` per session.
- **Approval:** `--approval-mode yolo` (or per-server `trust`) is needed for
  non-interactive tool calls.

## What was run, and what happened

```bash
gemini --skip-trust --approval-mode yolo --allowed-mcp-server-names whipple3 \
  -p '<prompt: blackboard_status → blackboard_post → blackboard_status>'
```

The session died at auth setup, before MCP servers were loaded:

```
Error authenticating: IneligibleTierError: This client is no longer supported for
Gemini Code Assist for individuals. To continue using Gemini, please migrate to the
Antigravity suite of products: https://antigravity.google
```

The machine's `~/.gemini/oauth_creds.json` exists but the free-tier OAuth path is
rejected for this client version, and no `GEMINI_API_KEY`/`GOOGLE_API_KEY` was present.
Per verification protocol nothing was installed and no login was attempted. With working
auth (API key or a supported tier), re-run the command above from a directory containing
the settings file to turn this page into a ✅.

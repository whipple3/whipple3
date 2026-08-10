# arai Claude Code plugin (v0.1 demo)

Packaging target: a Claude Code plugin bundling the MCP server (`.mcp.json`), three
subagents, and an `/audit` command — one install. Minimal path while developing:

```bash
claude mcp add --transport stdio arai -- npx arai mcp
```

> TODO before release: pin the minimum Claude Code version and verify the current
> plugin manifest layout against the official plugin docs (SPEC §15).

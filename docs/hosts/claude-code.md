# Host: Claude Code

**Status: ✅ ran** — the primary host; the five-agent `/audit` demo ran end-to-end
against a real board on 2026-08-11 (Claude Code 2.1.138, headless `claude -p`). This
page cites that recorded run rather than re-running it; the full topology and setup
live in [examples/claude-code-plugin/](../../examples/claude-code-plugin/).

## Wiring

One `whipple3 serve` board; one stdio MCP server **per agent identity**, each a proxy
dialing the board socket:

```bash
claude mcp add --transport stdio whipple3-main -- \
  npx whipple3 mcp --board .whipple3/board.sock --agent main
```

The plugin form (five agents, `/whipple3:audit` command, HITL hook) needs
**Claude Code ≥ 2.1.140** — older hosts load plugin commands/agents but silently skip
the plugin's `.mcp.json`. On older hosts pass the five servers via `--mcp-config` with
plugin-scoped names (`plugin_whipple3_whipple3-<agent>`); that fallback is what the
recorded run used. Details: [plugin README](../../examples/claude-code-plugin/README.md).

## The recorded run (2026-08-11)

From the in-repo record of the live validation
([docs/plans/2026-08-10-swarm-waves.md](../plans/2026-08-10-swarm-waves.md), Wave 3
STATUS block):

> Headless `claude -p "/whipple3:audit"` against a real board (`serve --policy`), five
> real MCP proxies, real models: 66 log records, 6 CodeFiles scanned, 3 auditors in
> true parallel — **zero duplicate claims, zero lost updates, zero denials**, full
> claim→issue→update→release chains, 6 SecurityIssues found (exactly the seeded set +
> severity triage), 6 Fix nodes proposed, session halted AT the HITL question as
> designed. distill report generated.

Host-specific caveats that run surfaced (fixed or documented since): the plugin
`.mcp.json` loading gap below 2.1.140, `${CLAUDE_PROJECT_DIR}` expansion requiring
2.1.139, and the UDS `sun_path` length guard now in `serve`/`connectBoard`.

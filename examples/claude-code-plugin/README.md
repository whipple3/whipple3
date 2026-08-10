# whipple3 Claude Code plugin — the /audit demo

One shared, typed, event-sourced blackboard; five subagents with REAL per-agent identity;
a human approval gate on every file write. This directory is a complete Claude Code
plugin: `.claude-plugin/plugin.json`, five MCP servers (`.mcp.json`), five subagents
(`agents/`), the `/audit` command (`commands/`), and a HITL hook (`hooks/`).

## How it fits together

```
whipple3 serve                      ← ONE process owns the session + the log (terminal 1)
   ▲ .whipple3/board.sock (UDS)
   ├── npx whipple3 mcp --agent scanner     ─ MCP server "whipple3-scanner"
   ├── npx whipple3 mcp --agent auditor-1   ─ MCP server "whipple3-auditor-1"
   ├── npx whipple3 mcp --agent auditor-2   ─ MCP server "whipple3-auditor-2"
   ├── npx whipple3 mcp --agent auditor-3   ─ MCP server "whipple3-auditor-3"
   └── npx whipple3 mcp --agent fixer      ─ MCP server "whipple3-fixer"
        ▲ stdio                                (terminal 2: claude, spawns these)
```

Identity is bound to the socket, never self-declared in a payload: each subagent's
frontmatter allowlists ONLY its own server's tools, so auditor-2 physically cannot post
as auditor-1. Three auditors run in parallel against one board; `blackboard_claim` makes
duplicate work impossible and every log record names the agent that acted. One auditor
per server matters: a whipple3 claim is renewable by its holder, so two workers sharing
one identity would not be protected from each other.

## Setup (under 10 minutes)

**Prereqs:** Node ≥ 20, Claude Code with plugin support (verified against the plugin docs
at code.claude.com/docs, 2026-08).

1. **Get the `whipple3` binary resolvable** (~2 min). Until the npm publish lands:

   ```bash
   git clone <whipple3 repo> && cd whipple3
   pnpm install && pnpm build
   cd packages/cli && npm link        # makes `npx whipple3` work anywhere
   ```

   In a project that has whipple3 as a dependency, skip the link — `npx whipple3`
   already resolves.

2. **Start the board** (terminal 1, in the repo you want audited):

   ```bash
   npx whipple3 serve
   # whipple3 serve: board listening on .whipple3/board.sock — log .whipple3/session-<ts>.ndjson
   ```

   This must be running BEFORE Claude Code starts: the five per-agent proxies dial the
   socket once, at session start, and Claude Code does not reconnect stdio MCP servers.
   Started serve too late? Restart the Claude Code session.

3. **Start Claude Code with the plugin** (terminal 2, same directory):

   ```bash
   claude --plugin-dir /path/to/whipple3/examples/claude-code-plugin
   ```

   Approve the five whipple3 MCP servers when prompted (same per-server approval as a
   project `.mcp.json`).

4. **Run it:**

   ```
   /whipple3:audit
   ```

## What happens

1. **Preflight** — the command checks the board socket and stops with instructions if
   serve isn't up.
2. **Scan** — `whipple3-scanner` posts a `CodeFile` node per audit-worthy file
   (paths only — file contents never enter the graph).
3. **Parallel audit** — three auditor subagents loop `next → claim → audit →
   post SecurityIssue → update → release`. No coordinator assigns files; the claims do.
   A second claim on a held file is rejected naming the true holder.
4. **Propose** — `whipple3-fixer` posts a `Fix` node per issue (`status: "proposed"`).
   It edits nothing.
5. **Approve** — you pick which fixes to apply, in the main conversation.
6. **Apply** — the fixer edits ONLY the approved fixes, and Claude Code interrupts each
   edit with a permission prompt. Board state advances: `Fix → applied`,
   `SecurityIssue → resolved`.
7. **Report** — `npx whipple3 distill <log>` folds the session log into `report.md`:
   findings by label, per-agent activity table (posts/claims/releases/denials), replay
   verification.

## The HITL gate, honestly

The fixer never writes a file without a human approval. Enforcement is layered, and the
layers are different kinds of guarantees:

| Layer | Enforced by | What it guarantees |
|---|---|---|
| Tool allowlists | Claude Code (host) | scanner + auditors have no Edit/Write at all; each agent can only reach its own board identity's tools |
| Permission prompts | Claude Code (host) | subagents inherit the session's permission context; in default mode every fixer Edit prompts the user |
| `hooks/fixer-gate.mjs` | Claude Code (host) | PreToolUse hook answers `permissionDecision: "ask"` for any Edit/Write where `agent_type` is `whipple3-fixer` — the prompt survives even a session set to auto-accept edits |
| PROPOSE/APPLY protocol | prompt only | fixes exist as `Fix` nodes on the board before any edit; APPLY touches only human-named fix ids |

Known limits, stated plainly: `bypassPermissions` sessions opt out of prompting entirely
(the docs do not define hook-"ask" behavior there — do not run the demo that way);
the hook fires on `agent_type`, which is set for subagents only; and the label-level
write ACL (`scanner may post CodeFile and nothing else`) is prompt-discipline in v0.1 —
`whipple3 serve` does not yet load an `AclPolicy` file, so the host tool allowlist is the
enforcement layer that exists. Every layer above marked "host" was verified against the
current Claude Code docs; the protocol layer is instructions, and treated as such.

## Manual install (no plugin)

`claude mcp add --transport stdio whipple3-scanner -- npx whipple3 mcp --board
.whipple3/board.sock --agent scanner` (repeat for auditor-1/2/3 and fixer), then copy
`agents/*.md` into `.claude/agents/` and `commands/audit.md` into `.claude/commands/`.
One naming caveat: outside a plugin, tool names lose the `plugin_whipple3_` scope —
change `mcp__plugin_whipple3_whipple3-scanner__…` to `mcp__whipple3-scanner__…` in each
agent's `tools` line. The HITL hook only ships via the plugin.

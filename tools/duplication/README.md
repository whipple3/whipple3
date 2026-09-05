# duplication

How much of a multi-agent session's work was **paid for more than once** — the instrument
behind the measurement in [ADR-010](../../docs/adr/ADR-010-positioning-reset-reputation-over-adoption.md).

```bash
pnpm build
node tools/duplication/dist/main.js ~/.claude/projects/<project>/<session>.jsonl
node tools/duplication/dist/main.js --all 4      # census: every session with ≥4 subagents
```

Read-only. Nothing leaves the machine — these are your own prompts and outputs.

## What it counts

The same **tool** aimed at the same **primary target**, by **more than one agent**. Each
agent after the first is one unit of work paid for again.

| Tool | Primary target |
|---|---|
| Read / Edit / Write / NotebookEdit | `file_path` |
| Bash | the command string |
| Grep / Glob | `pattern @ path` |
| WebFetch | `url` |
| anything else, including MCP tools | **none — excluded from the denominator** |

Unrecognised tools are dropped rather than guessed at. Guessing would quietly move every
number downstream.

## What it does not claim

**"Paid for more than once" is not "wasted."** Two agents reading one file may both have
needed it. What is measured is that the work was bought twice, not that either purchase was
wrong. One agent repeating itself does not count — that is a retry, not duplication.

## Three lenses, always printed together

`all` · `lookups` (Read/Grep/Glob/WebFetch) · `reads` (Read only). The denominators differ
by an order of magnitude, so a single figure can be made to say almost anything. Quote
`all`, and quote the per-session range with it. Narrowing the denominator until the number
improves is the exact failure this tool exists to resist — which is why it will not print
one lens alone.

## Known limits

- **One machine.** A census here is a census of one developer's habits, not evidence about
  coding agents in general.
- **Exact-match only.** Two agents reading the same fact out of two different files, or
  running `npm ci` and `npm install`, are invisible to it. Every number is a lower bound.
- Sessions with a `subagents/` directory and no main transcript are skipped.

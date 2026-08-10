---
description: Run the whipple3 blackboard audit — scanner seeds CodeFiles, three auditors work claims in parallel, the fixer proposes and (after human approval) applies fixes, distill writes the report.
argument-hint: [optional focus, e.g. "src/ only"]
allowed-tools: Bash(ls:*)
---

Run a security audit of this repository over the whipple3 shared blackboard.
Focus, if given: $ARGUMENTS

## Step 0 — preflight

Board socket (a `whipple3 serve` process must already own it — it starts BEFORE the
Claude Code session, see the plugin README):

!`ls .whipple3/board.sock`

If the line above shows the socket path, continue. If it shows an error instead, STOP and
tell the user: run `npx whipple3 serve` in a separate terminal, then restart this Claude
Code session (the per-agent MCP proxies dial the socket once, at session start — stdio
servers are not reconnected automatically). Do not attempt to start serve yourself; the
proxies for this session are already dead.

## Step 1 — scan

Invoke the `whipple3-scanner` subagent once. It posts `CodeFile` nodes for the files
worth auditing and reports the count.

## Step 2 — audit in parallel

Invoke `whipple3-auditor-1`, `whipple3-auditor-2`, and `whipple3-auditor-3` IN PARALLEL —
all three in a single message. Do not partition files between them or relay findings:
each has its own board identity, and the board's claims guarantee no file is audited
twice. Wait for all three to finish.

## Step 3 — propose fixes

Invoke the `whipple3-fixer` subagent in PROPOSE mode (say "PROPOSE" in its task prompt).
It posts a `Fix` node per open issue and returns the proposal list. It must not edit any
file in this step.

## Step 4 — the human decides

Present the proposals as a numbered list (fix id, path, severity, approach) and ask the
user which to apply. Then invoke `whipple3-fixer` in APPLY mode, naming the approved fix
ids and the rejected fix ids explicitly in the task prompt. Every file edit will surface
a permission prompt to the user — that is the HITL gate, expect it and never work around
it. A denied prompt means that fix is rejected.

## Step 5 — summary and report

1. Call the `blackboard_status` tool (the `whipple3-scanner` server's copy) and summarize:
   files audited, issues by severity, fixes applied/rejected.
2. Distill the session log into a report — run, with the Bash tool:
   `ls -t .whipple3/*.ndjson | head -1` to find the current log, then
   `npx whipple3 distill <that log>`. Tell the user where the generated `report.md` is,
   and that the full per-agent trail (who claimed, posted, released what) is in the log —
   every record carries the acting agent's identity.

---
description: Run the whipple3 blackboard audit demo — scanner, parallel auditors, gated fixer.
---

Run a security audit of this repository using the whipple3 blackboard:

1. Use the whipple3-scanner subagent to populate CodeFile nodes.
2. Launch three whipple3-auditor subagents in parallel; they coordinate via claims — no duplicated work.
3. When auditing is done, use the whipple3-fixer subagent; approve or reject each proposed fix.
4. Call `blackboard_status` and summarize: files audited, issues found, fixes applied.

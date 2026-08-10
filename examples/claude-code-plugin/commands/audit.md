---
description: Run the arai blackboard audit demo — scanner, parallel auditors, gated fixer.
---

Run a security audit of this repository using the arai blackboard:

1. Use the arai-scanner subagent to populate CodeFile nodes.
2. Launch three arai-auditor subagents in parallel; they coordinate via claims — no duplicated work.
3. When auditing is done, use the arai-fixer subagent; approve or reject each proposed fix.
4. Call `blackboard_status` and summarize: files audited, issues found, fixes applied.

# Architecture

The canonical design document is [SPEC.md](./SPEC.md). This file is the 60-second version.

```
            agents (Claude Code subagents, any MCP host)
                        │  MCP tools (stdio)
                        ▼
              @whipple3/transport-mcp        ← shell: parse, don't validate
                        │
        checkAcl() ──► apply() ──► append(log)
                        │
              @whipple3/core (pure)          ← reducer, versions, claims, slices
                        │
              @whipple3/log (port)           ← memory | NDJSON | (sqlite next)
                        │
              @whipple3/studio               ← ReadonlyLog → SSE → sigma.js
```

Rules that keep it honest (enforced in CI):
- `@whipple3/core` imports nothing internal and no Node built-ins (dependency-cruiser).
- Every `LogStore` implementation passes the same conformance suite.
- Errors are values (`Result`); exceptions only at shell edges.
- Time and IDs are injected into core, never generated inside it.

# Architecture

The canonical design document is [SPEC.md](./SPEC.md). This file is the 60-second version.

```
            agents (Claude Code subagents, any MCP host)
                        │  MCP tools (stdio)
                        ▼
              @arai/transport-mcp        ← shell: parse, don't validate
                        │
        checkAcl() ──► apply() ──► append(log)
                        │
              @arai/core (pure)          ← reducer, versions, claims, slices
                        │
              @arai/log (port)           ← memory | NDJSON | (sqlite next)
                        │
              @arai/studio               ← ReadonlyLog → SSE → sigma.js
```

Rules that keep it honest (enforced in CI):
- `@arai/core` imports nothing internal and no Node built-ins (dependency-cruiser).
- Every `LogStore` implementation passes the same conformance suite.
- Errors are values (`Result`); exceptions only at shell edges.
- Time and IDs are injected into core, never generated inside it.

# Architecture decision records

Format: Status / Context / Decision / Consequences. Canonical design: [SPEC.md](../../SPEC.md);
numbers 001–006 match SPEC §13. New decisions take the next free number.

| ADR | Decision |
|---|---|
| [001](./ADR-001-independent-core-with-adapters.md) | Independent core with adapters, not built on a vendor runtime |
| [002](./ADR-002-two-dispatch-modes-pull-only-v01.md) | Two dispatch modes, one core; v0.1 is pull-only |
| [003](./ADR-003-no-execution-layer.md) | We do not build the execution/sandbox layer |
| [004](./ADR-004-graphology-studio-only.md) | graphology demoted to Studio; core state is our own immutable structure |
| [005](./ADR-005-mcp-first-uds-deferred.md) | MCP-first agent surface; UDS transport deferred |
| [006](./ADR-006-kuzudb-rejected.md) | KùzuDB rejected; core dependencies minimized |
| [007](./ADR-007-identity-from-connection.md) | Identity from the connection, never from the payload |
| [008](./ADR-008-two-sided-acl-logged-denials.md) | Two-sided ACL: reads filtered during traversal, every denial logged |
| [009](./ADR-009-board-lifetime-as-parameter.md) | Board lifetime is a parameter, not an assumption |

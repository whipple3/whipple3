# Changelog

All notable changes to whipple3 are documented here, grouped by capability rather than
by commit. The append-only session log is the project's source of truth at runtime; the
git history is its source of truth here.

## v0.1.0 — Unreleased

First release. A typed, ephemeral, event-sourced blackboard for coordinating AI agents,
served over MCP. Everything below is covered by the CI gate (strict TypeScript, Biome,
dependency-cruiser import direction, Vitest + fast-check property tests).

### The board and its six tools

- A shared typed graph that agents mutate through six constrained MCP tools —
  `blackboard_post`, `blackboard_read`, `blackboard_claim`, `blackboard_release`,
  `blackboard_next`, `blackboard_status`. No query language is ever exposed to an LLM.
- Optimistic versioning per node: a mutation carries the version it expects; a mismatch
  is rejected with the current state returned as a structured value, never prose.
- Claims and leases make parallel work collision-free: a claim on a held node is
  rejected naming the true holder; an abandoned claim expires by TTL and the node
  re-enters the work queue; a holder may renew its own lease. Proven by multi-agent
  interleaving tests and fast-check properties over arbitrary claim/release/expiry
  orders.
- `blackboard_next` is pull-mode dispatch: "what's for me?" — pending nodes matching
  label and props, excluding anything under a valid claim, filtered by what the asking
  agent may read.
- LLM-facing inputs are budgeted at the parse boundary: claim ttl ≤ 1 hour, props
  ≤ 16 KiB of JSON, ids and labels from a closed alphabet (≤ 256 chars, no whitespace
  or backticks — they cross verbatim into report markdown and Studio). The
  control-plane rule — paths and hashes, never contents — is enforced, not just
  prompted.
- The core reducer is pure — no I/O, no clock, no randomness, time and IDs injected —
  which is what makes replay, time-travel, and property testing possible at all.

### Connection-bound identity and principal

- An agent's identity is bound at connect time — one server process (or one socket) per
  agent. No tool payload carries an `agentId`, so no agent can impersonate another; an
  ACL keyed on a self-declared name would be decorative.
- One identity, at most one live connection: the board refuses a second hello for a
  name already bound (`IDENTITY_IN_USE`) — two workers sharing an identity would renew
  each other's leases and dissolve the claim protection. The identity frees when its
  socket closes.
- Every event also records a `principal`: on whose behalf the session runs
  (`WHIPPLE3_PRINCIPAL`, falling back to the OS user). "Michael's auditor did this,"
  not just "auditor did this" — attribution is captured at write time because it is
  unreconstructable later.

### Two-sided ACL with logged denials

- A policy declares `{ write, read }` label lists per agent. Writes pass `checkAcl`
  on every mutation; reads are filtered **during traversal**, so an unreadable node
  never leaks through an edge endpoint.
- Every denial — read or write — is appended to the log as an `acl.denied` event.
  Enforcement leaves a trail, never a silent drop.

### Role-declared slices

- A slice DSL (`defineSlice` / `follow`) lets the schema declare what each role sees.
  A declared agent's `blackboard_read` returns exactly its slice; undeclared agents get
  a policy-filtered neighborhood default. The agent never chooses its own scope — reads
  carry a root, not a depth.
- A property test proves the narrowing invariant: a role's slice is always a subset of
  what its read ACL would allow.

### Board lifetime as a parameter

- `BoardLifetime` is session config, not an assumption: v0.1 implements `"ephemeral"`;
  `"persistent"` is admitted by the type and rejected at runtime until it exists, so
  persistence can arrive as config rather than refactor.
- Purge is an explicit, lifetime-gated action — never an implicit side effect of a
  session ending, and never the pure core's business.

### Shared-state backend: `whipple3 serve`

- `whipple3 serve` owns one session, one log, and one Unix domain socket;
  `whipple3 mcp --board <socket> --agent <id>` becomes a thin per-agent proxy. Multiple
  real processes now share one board with per-socket identity — proven cross-process in
  the e2e suite.
- `whipple3 serve --policy <file>` loads `{ acl, slices }` from a JSON policy file,
  making `checkAcl` and role slices real over the wire; the resulting `acl.denied`
  events show up in the distilled report.
- The UDS wire format is NDJSON frames, parsed once with Zod at the boundary.

### The distill lifecycle

- `whipple3 distill <log>` folds a session log into a markdown report: findings by
  label, a per-agent activity table (posts, claims, releases, denials), and replay
  verification — the three-tier lifecycle's "what remains is what it taught you."
- The working graph is purged only through the lifetime gate; the trace log is always
  retained.
- The NDJSON log adapter reads incrementally via a byte-offset index, so tailing a live
  session does not reread the file. Memory and NDJSON adapters pass one shared
  conformance suite.

### Studio

- A live graph of what your agents are doing right now: nodes appear as agents post,
  colors follow labels and status, claims are tinted by the holding agent.
- Click a node for its mutation history and the agent that produced each change.
- A time-travel scrubber replays the session from the log — a direct consequence of the
  pure reducer, not a feature bolted on.
- Live/paused SSE streaming over `ReadonlyLog`; ForceAtlas2 layout. All graph-rendering
  dependencies live only in the studio package.
- The log tail reports a stall (e.g. a poisoned line that fails every reread) to the
  dev-server terminal instead of starving silently; a successful poll re-arms it.

### Claude Code plugin demo: `/whipple3:audit`

- A complete example plugin: five subagents (scanner, three auditors, fixer) with five
  real board identities, an `/audit` command, and a human-in-the-loop gate.
- Scanner posts `CodeFile` nodes (paths and hashes only — file contents never enter the
  graph); three auditors run in parallel, claiming files so duplicate work is
  impossible; the fixer proposes `Fix` nodes and edits nothing until a human approves —
  backed by host tool allowlists, permission prompts, and a PreToolUse hook.

### Known limitations, stated plainly

- **`claim.expired` is never emitted.** The event exists in the taxonomy; expiry is
  enforced when someone touches an expired claim, not announced when the TTL passes.
  Emitting it is the push-mode scheduler's job (Phase 2).
- **`"persistent"` boards don't exist yet.** The type admits the value; the runtime
  rejects it. Ephemeral sessions only in v0.1.
- **The live Claude Code run is not yet validated.** The five-identity `/audit`
  topology is proven headlessly (real processes, real sockets, per-agent log
  attribution); the interactive run on a real Claude Code host — spawn behavior,
  permission prompts, hook `agent_type` — is the remaining checkbox.
- **ACL in the demo requires `--policy`.** `whipple3 serve` without a policy file runs
  with no ACL; the label-level write discipline then rests on host tool allowlists and
  prompts. Pass `--policy` to make `checkAcl` enforce it on the board.
- **CLI stubs:** `whipple3 init`, `studio`, and `replay` print a pointer and exit;
  Studio currently runs as a Vite dev app inside `packages/studio`.
- **No published benchmark numbers yet.** The harness and runbook exist
  (`tools/bench`); the numbers ship before the launch post does, or the post ships
  without the claim.

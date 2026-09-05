# Changelog

All notable changes to whipple3 are documented here, grouped by capability rather than
by commit. The append-only session log is the project's source of truth at runtime; the
git history is its source of truth here.

## v0.1.0 — Unreleased

First release. A typed, ephemeral, event-sourced blackboard for coordinating AI agents,
served over MCP. Everything below is covered by the CI gate (strict TypeScript, Biome,
dependency-cruiser import direction, Vitest + fast-check property tests).

### `whipple3 review` / `whipple3 comment` — typed review behind the gate

- `Review` (one node per reviewer per PR; a changed verdict is an UPDATE, so the log keeps
  the history) and `ReviewComment` (`severity: blocking | nit`, `status: open | addressed |
  wontfix`) nodes, with `reviews`, `part_of` and `comments_on` edges. `whipple3 review
  --verdict approve|request_changes`, `whipple3 comment post <body> --path … [--line] [--severity]`,
  `whipple3 comment addressed|wontfix <id…>`.
- `pr check` (and so `merge`) refuses on `request_changes` or an open blocking comment
  before it looks at file holds. No review is not a refusal.
- `examples/review-policy.json`: the `Review` label is writable by the reviewer alone; a
  branch approving itself is an `acl.denied`. `examples/claude-code-plugin/agents/reviewer.md`
  is the subagent that plays the reviewer.
- `@whipple3/assert`: `approvedBeforeMerge()` walks the log in order — a merge with no
  standing approve, or one that was revoked before the merge, fails.

### `whipple3 pr` / `whipple3 merge` — the board in front of the forge

- `whipple3 pr open <paths…> --agent <branch> --number <n>` records a `PullRequest` node with
  `touches` edges to the `File` nodes and claims them; `pr check` exits 0 when every touched
  path is free or held by `--agent`, 2 naming the holder otherwise; `pr merged` flips the node
  to `merged` and releases the paths. `whipple3 merge` chains check → forge command
  (`gh pr merge <n>` unless a command follows `--`) → merged, and stops at the first failure:
  a held path never reaches the forge, a failed forge never releases a claim, an unreachable
  board is exit 1. No new event type — PRs are ordinary `graph.mutation`s, so replay, distill,
  Studio and `@whipple3/assert` see them unchanged.
- `Slice.claims`: every slice now carries the raw `ClaimRecord`s of its nodes (ACL-filtered
  with the nodes; expiry is the reader's comparison against `expiresAt`), so a read-only gate
  can name a holder without taking a lease.

### `whipple3 claim` / `whipple3 release` — a claim a shell can make

- `whipple3 claim <paths…> --agent <id> [--ttl s]` creates a `File` node per path on first
  sight and claims it as `--agent`; renewing your own hold succeeds, another identity's hold
  prints `held <path> by <holder>` and exits 2 (board unreachable exits 1). `release` hands
  paths back. Built for a PreToolUse hook in a repo where parallel branches each run their
  own agent: identity = branch name, so a cross-branch file overlap is refused at the first
  edit instead of discovered at merge.

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
  terminal instead of starving silently; a successful poll re-arms it.
- Shipped in the bin as `whipple3 studio <log>`: a plain `node:http` server for the built
  page plus the `/events` SSE tail, no dev server involved. `whipple3 studio --demo` drives
  the fixture into a throwaway log, so a first run needs no board, no agents and no host
  wiring — the one command that shows the product on its own.

### `whipple3 studio --session` — your own last run, as a graph

- `@whipple3/transcript` reads a Claude Code session from disk (`~/.claude/projects/…`,
  main thread plus `subagents/agent-*.jsonl` sidecars, agent names from the `.meta.json`)
  and projects it into an ordinary whipple3 log: one node per agent, one per tool call,
  edges from each agent to its own calls, ordered by timestamp.
- Nothing to install into, nothing to wire: no board, no MCP server, no agent changes.
  The transcript already exists. Read-only, and it never leaves the machine.
- Because the output is a real log, `replay` and `distill` compose on it, and the Studio's
  scrubber replays a session that already happened.
- **Targets are shared nodes.** The file, command or URL a call was aimed at becomes one
  node, joined to every agent that touched it. Nothing is invented: two agents reading one
  file do stand in a relation, through the file, and the projection draws the relation the
  session already had. A target only one agent reached gets no node — it says nothing about
  the fleet — and its calls stay counted on that agent as `untargetedCalls`/`toolCalls`, so
  the filter is visible rather than silent.
- The result is a picture of **contention without communication**: agents entangled through
  the files they each paid to read, having exchanged nothing. A transcript records what each
  agent *did* and never what any of them *shared*, because there is no shared state in it to
  read. Describe the output as contention and its absence; never as coordination.
- `primaryTarget` lives in `@whipple3/transcript`, not in the measuring tool, so the picture
  and `tools/duplication`'s number can never disagree about what "the same target" means.

### `@whipple3/assert` — judging the trajectory, not the text

- Assertions over a finished session: `every` / `none` / `atLeast` against the final typed
  state, `noDenials` and `allClaimsReleased` against the enforcement record. Pure functions
  of the log through the same reducer the board runs, so a verdict cannot disagree with what
  happened, and it is deterministic while the models are not.
- No test-runner dependency: checks return `{ ok, message }` and compose through `run(...)`.
  Use them inside vitest, inside a script, or straight in a pipeline step.
- `none` and `every` always print the population they examined, including zero — a
  misspelled label would otherwise pass in silence, and a green check that looked at nothing
  is the worst output this package could produce. `atLeast` is the explicit guard.
- **Not shipped, on purpose:** hop budgets and cost ceilings. `EventMeta.causationId` is
  always null and nothing emits `llm.call`; both assertions would have been green over an
  empty stream. They wait for Stage 6 and the OTel adapter.
- Verified against the real five-agent audit log of 2026-08-11: all five checks pass.

### `whipple3 replay` — the log checked in CI

- Re-folds a session log through core's pure `replay()` and exits non-zero on a
  violation: a break in `seq` (a torn or spliced write), a mutation that no longer
  applies against the state the log itself produced, or a node claimed by a second agent
  before a release or an expiry.
- That last check is the README's headline claim made falsifiable — "zero duplicate
  claims" stops being a sentence and becomes a build failure. Verified against the real
  five-agent audit log from 2026-08-11: 66 records, zero violations.
- `--json` emits the verdict for a pipeline step. Schema-free on purpose: it checks that
  coordination held, never whether the work was correct.

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
- **No `whipple3 init`.** Scaffolding is not in v0.1; wiring is the two commands in the
  README quickstart. The subcommand was removed rather than shipped as a stub — every
  command in `--help` does what it says.
- **`replay` verifies integrity, not intent.** It proves a log reproduces itself and that
  no claim was double-held; it cannot assert that the agents did the *right* work. Typed
  trajectory assertions are Stage 7.
- **Studio watches one log at a time.** A developer running many sessions across several
  worktrees gets one board per Studio; there is no cross-session view, and none across
  machines — a cloud session cannot reach a local Unix socket.
- **No published benchmark numbers yet.** The harness and runbook exist
  (`tools/bench`); the numbers ship before the launch post does, or the post ships
  without the claim.

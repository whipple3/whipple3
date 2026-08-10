# whipple3 — a typed, event-sourced blackboard for coordinating AI agents

> **DRAFT — do not publish before the checklist in `checklist.md` is green.**
> Placeholders: `[STUDIO RECORDING]`, benchmark numbers. Suggested venues: HN (Show HN),
> r/ClaudeAI / r/LocalLLaMA, X thread. Adapt length per venue; this is the long form.

One agent doesn't need whipple3. **Two do.** One file doesn't need git either — the need
appears the moment a second worker touches the same state, and it never goes away.

Multi-agent coding setups coordinate through one of two broken channels. Either agents
chat with each other in free text — which burns tokens on coordination, contaminates
context, and is unauditable — or everything funnels through an orchestrator, which is
what Claude Code subagents do today: each subagent runs isolated and returns a summary
to the parent. Parallel workers can't see each other, so they duplicate work, and the
parent's context window becomes the bottleneck. Subagent-heavy workflows have been
reported to consume roughly 7× the tokens of a single-thread session, much of it
re-describing state that already existed somewhere.

whipple3 is a third channel: a shared, typed, event-sourced graph that agents read and
write through structured mutations instead of chat. It's the classic blackboard
architecture (Hearsay-II lineage) with three modern additions — a typed schema, LLM
agents, and an event-sourced core — packaged as an MCP server, so it works with
whatever agent runtime you already run.

The usual agent diagram — input, model, tools, sandbox, memory — has one loop in it, and
whipple3 isn't a box in that loop. Draw a second agent and it appears immediately:

```
      agent A                agent B                agent C
 ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
 │  LLM → tools  │      │  LLM → tools  │      │  LLM → tools  │
 │   → sandbox   │      │   → sandbox   │      │   → sandbox   │
 └───────┬───────┘      └───────┬───────┘      └───────┬───────┘
         │        post / claim / read / release        │
         ▼                      ▼                      ▼
 ══════════════════════════════════════════════════════════════
   whipple3 — shared typed state
   checkAcl → apply → append         ← the one enforcement point
 ══════════════════════════════════════════════════════════════
                        │  append-only log = the truth
      ┌─────────────────┼──────────────────┐
      ▼                 ▼                  ▼
 blackboard_next     Studio          distill → your
 (next turn's        (live graph,     memory system
  context: sliced,    time travel)
  ACL-filtered)
      │
      └──→ replay → CI assertions
```

Note what feeds an agent's next turn: **other agents' writes**, filtered to the slice its
role declared. Not its own history — that's memory, and memory is somebody else's box.
The sandbox isolates agent ↔ machine; whipple3 mediates agent ↔ agent.

## If you know Redux, you know the shape

One store, and it's not any agent's context window. Mutations are typed actions.
`apply()` is a pure reducer — no I/O, no clock, no randomness; time and IDs are
injected. The append-only event log is the source of truth and the graph is a
materialized view, which means you get time-travel debugging of your agent session for
free: not as a feature we built, but as a consequence of the architecture. Replay the
log, watch the coordination happen again, deterministically. The LLMs aren't
deterministic; the coordination substrate is.

On top of that store:

- **Claims and leases.** A worker claims a node before working it. A second claim is
  rejected naming the true holder. Abandoned claims expire by TTL and the work
  re-enters the queue. Zero duplicate work across parallel agents — property-tested
  over arbitrary claim/release/expiry interleavings.
- **Identity from the connection.** No tool payload carries an `agentId`; identity
  binds when the agent's process connects. An ACL keyed on a self-declared name would
  be decorative.
- **Two-sided ACL, denials logged.** Per-agent read/write label lists. Reads are
  filtered during graph traversal, so an unreadable node never leaks through an edge.
  Every denial is an `acl.denied` event in the log — enforcement leaves a trail.
- **Scoped context.** Each role declares a slice of the graph; agents get their slice,
  not the transcript. The agent never widens its own scope — reads carry a root, not a
  depth. Small typed slices are also what makes cheap-model fleets plausible: the
  schema does the thinking the frontier model was doing.

## What a run looks like

The first packaged demo is `/whipple3:audit`, a Claude Code plugin. One
`whipple3 serve` process owns the board; five subagents connect as five real
identities over a Unix socket:

1. A scanner posts a `CodeFile` node per audit-worthy file — paths and hashes only,
   file contents never enter the graph.
2. Three auditors run in parallel, looping `next → claim → audit → post finding →
   release`. Nobody assigns files; the claims do. Watch the board and you can see a
   second auditor bounce off a held file, by name.
3. A fixer posts proposed `Fix` nodes and edits nothing. A human approves specific
   fixes; only those get applied, each behind the host's own permission prompt.
4. `whipple3 distill` folds the session log into a markdown report: findings by label,
   a per-agent activity table, replay verification. Graph purged, trace retained.

`[STUDIO RECORDING — 20 seconds: nodes appearing as the scanner posts, three claim
colors moving through the file set, the time-travel scrubber dragging the session
backwards]`

That's Studio: a live graph of what your subagents are doing right now, with a
time-travel scrubber over the session log. It exists because the log is the source of
truth — the UI is just a fold over it.

## The numbers

> **TODO before publishing:** run the benchmark per `tools/bench` RUNBOOK and replace
> this block with the actual table — orchestrator-context tokens, wall time, duplicate
> work, findings quality, whipple3 vs. vanilla subagents on the same audit task.
> The target we committed to in the spec is ≥40% orchestrator-context token reduction
> at equal finding quality. Publish whatever the harness says, including where we lose.
> If the numbers aren't ready, this section ships as "benchmark harness included,
> numbers to follow" — no unmeasured claims.

## What it is not

No LLM calls in core — ever; models belong to the host runtime. Not an orchestrator
and not a framework replacement: whipple3 interoperates with Claude Code today and
speaks MCP, so Codex CLI, Gemini CLI, Cursor, and opencode are the same server with a
different host — that list becomes a compatibility table as each row gets a real run.
Not an execution/sandbox layer — that layer is owned and we ride it. No query language
for agents: constrained typed tools only, six of them. And not a memory system: memory
answers what *one* agent knew last week, whipple3 answers what *all* of them can see right
now and how much of it each is allowed to see — `whipple3 distill` hands the session to
whatever memory layer you already use.

## Try it

```bash
npm install -g whipple3        # or: npx whipple3
whipple3 serve                 # terminal 1 — the board
claude --plugin-dir <repo>/examples/claude-code-plugin   # terminal 2
/whipple3:audit
```

Requires Node ≥ 22. The repo README has the 10-minute path and the honest list of
what's stubbed. MIT.

## Status, honestly

v0.1 is the vertical slice: pull-mode dispatch (the host still spawns agents; whipple3
is the radio, not yet the dispatcher), ephemeral sessions only, `claim.expired` defined
but not yet emitted, and ACL in the demo requires an explicit `--policy` file. The
push-mode scheduler, sandbox adapters, OTel, and eval tooling are Phase 2 — designed
for (the event taxonomy reserves them) but not built. If the coordination substrate
isn't useful without them, we'd rather find out now.

Repo: `github.com/whipple3/whipple3` · Spec and ADRs in-repo — the design is the
readable part.

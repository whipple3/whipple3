# ADR-010 — Positioning reset: reputation over adoption

**Status:** Accepted (2026-08-11). Item 4 opened deliberately and **resolved 2026-08-12**;
amended with findings 2026-08-12 (item 6) and 2026-08-15 (item 7). No item is open.

Unlike ADRs 001–009 this records a **positioning** decision, not an architectural one. It
changes no code and none of the engineering rules in SPEC §9 — those are constraints, not
assumptions. [positioning.md](../positioning.md) remains the narrative; this is the dated
decision, written so these questions are not re-argued from zero.

## Context

A working session on 2026-08-11 tested the launch assumptions against evidence that did
not exist when they were written: a persona exercise for an Israeli AI-builders audience,
a survey of nine tools the author had been measuring himself against, the author's own
production dashboards, and a survey of how the physical-AI stack solves the same problem.

Four assumptions moved — three resolved, one held open on purpose — plus one finding
(item 5) that is not a decision but changes how the others must be worded.

## Decision

### 1. The goal is reputation — not adoption, and not a company yet

Demonstrating systems-design judgement to engineers who can tell the difference. Usability
by others is a hope, not an objective.

- **Deleted as goals:** chasing installs, maintaining the host matrix for its own sake, a
  contributor path, evangelism. Adoption is a possible side effect, never the measure.
- **Kept:** the npm publish. It is the *credential*, not the funnel — a reader who takes
  the writing seriously will check whether the thing installs, and `git clone && pnpm build`
  fails that check. Publishing is half an hour and buys the claim's credibility.
- **The constraint behind it, recorded because it — not preference — is what decides:** no
  runway. §4's install ladder stays a correct model of *how* adoption happens; it is no
  longer what we optimise.

### 2. The metaphor is a Bobcat with attachments; Gett is dated to Stage 6

Gett describes push-mode dispatch — a product that does not exist. Applying it to today's
pull-mode board is what made the pitch ring hollow. It stays, labelled, as the Stage 6 story.

Two words that must not merge:

| | What it is | Examples | What it sells |
|---|---|---|---|
| **Attachment** | what the machine *does* — schema, roles, gates, report | migration sweep, `/audit`, test backfill | the job |
| **Adapter / port** | where the machine *runs* | hosts, `SandboxProvider`, `LogStore`, `ModelProvider` | portability |

Discipline: **one attachment before any attachment interface.** The Bobcat itself launched
as a one-job loader; the universal mount came after the machine was everywhere. Rule of
three applies here as everywhere else.

### 3. Rejected: a fleet view over whipple3 logs

Not deferred — rejected, on evidence.

- The author's own dev dashboard keys on **an open PR carrying a session link** (GitHub +
  Linear). That signal exists whether or not an agent ever wrote to a board.
- A fleet view built on the session log could only ever show agents that opted in, making
  it **strictly worse** than what already works. Building it would have been a regression
  wearing a feature's clothes.
- **Negative finding, recorded because it is the strongest datapoint available on the
  wedge:** in that workflow agents are partitioned by Linear ticket *before* they start, so
  they never contend for the same state. The author is not currently a whipple3 user. This
  does not invalidate the trigger ("one agent doesn't need whipple3, two do") — it narrows
  who reaches it, and says the author has not.
- Related gap for any future attention-routing view: the event taxonomy has no
  *blocked-on-human* state. `agent.failed`, `claim.expired` and `agent.completed` exist;
  "waiting for a person" is expressible only as a per-schema prop, which nothing generic can
  read. ROADMAP Stage 6 already lists "stalled as a first-class state" — that is the
  prerequisite, and it is a data-model change, not a UI one.

#### Measured 2026-08-11 — the negative finding qualified, not overturned

The claim above ("partitioned by ticket, therefore no contention") was an inference. It has
now been measured. Method: computed **directly from the transcript**, not from the graph
projection — same tool aimed at the same primary target (`file_path` for Read/Edit/Write,
the command string for Bash, pattern+path for Grep/Glob, `url` for WebFetch), by **more than
one agent**. Tools with no comparable primary argument, including MCP tools, were excluded
rather than guessed. The term is **work paid for more than once**, not waste: two agents
reading one file may both have needed it.

**Reproducible:** the instrument is in the repo as `tools/duplication`
(`node tools/duplication/dist/main.js --all 4`), with its definitions, its three lenses and
its limits documented in that package's README. Every figure below can be re-derived, and a
reader with their own transcripts can run it against theirs.

**Exact-match only, so every number here is a lower bound.** Two agents learning the same
fact from two different files, or running `npm ci` and `npm install`, are invisible to it.

Three definitions were run in one pass over **three sessions across two projects**, and all
three definitions on all three sessions are reported, because tuning the definition until the
number improves is the failure mode this measurement exists to avoid.

**This is a census, not a sample: every multi-agent session on the machine with ≥4 subagent
transcripts — 45 sessions, 6 projects, 1,283 agents, 61,623 tool calls.** Three further
sessions were skipped: they have a `subagents/` directory and no main transcript.

Grouped by workload, because that is what the numbers separate on. Agent count predicts
nothing — 312 agents duplicated less than 25 did.

| Workload | Sessions | A — every comparable tool |
|---|---|---|
| **Fan-out over a shared corpus** — web research, multi-agent code review | 3 | **38.2% – 54.4%** (lookups up to **75.8%**) |
| Middle — mixed exploration and execution | ~20 | 5% – 25% |
| **Partitioned execution** — implement a ticket, fix a bug | ~20 | **0.0% – 5%** |
| **Pooled, all 45** | 45 | **7.4%** (lookups 23.5%) |

**Pooled A — 7.4% — is the headline**, and the range (0.0% → 54.4%) must be quoted with it.
The distribution is skewed, not centred: roughly twenty sessions sit under 5%, and a short
tail does nearly all the duplicating.

**The estimate moved on every batch: 6.6% (n=1) → 10.7% (n=3) → 12.2% (n=8) → 9.2% (n=18) →
7.4% (n=45)** — and the drift has an explanation that is a warning, not a comfort. The early
batches were the *largest* sessions, chosen first because they looked most informative. That
was selection bias, introduced by the person doing the measuring, and it inflated every
figure this ADR published before the census. The corpus is now exhausted, so 7.4% has no
sampling error left in it.

**What remains unknown is not precision — it is generality.** One developer, one working
style, one machine. n=1 at the level that matters.

**A third duplication kind, absent from the earlier passes:** repeated *environment* work.
`10 agents · Bash · npm ci`, `5 agents · Bash · npm run typecheck`. Not tokens — wall-clock
minutes, paid separately by each agent. It is neither the shared-notes case nor the
claim/lease case, and nothing in whipple3 addresses it today.

**The most useful thing here is not the average.** The workload that duplicates hardest is
multi-agent review over one codebase — which is exactly what `examples/claude-code-plugin`
ships as `/whipple3:audit`. That is a datapoint about the demo's own premise, obtained
without meaning to, and it is worth more than the pooled percentage.

**Retraction (this is the second time this measurement corrected itself, and both are kept
on the record).** At n=3 this ADR stated that B "holds at 32.1–36.2% across three sessions
and two unrelated codebases" and called that stability the reason to report it. **At n=8
that is false:** B runs 0%, 0%, 15.3%, 19.2%, 32.1%, 32.6%, 33.1%, 36.2%. The apparent
stability was an artefact of three similar sessions. Do not quote a stable lookup rate.

**What n=8 shows instead: duplication tracks the WORKLOAD, not the agent count.**

- **Research fan-out duplicates hardest.** The two web-research sessions top the table
  (54.4%, 46.5%) and their duplication is almost entirely `WebFetch` — twelve agents pulling
  the same URL, ten pulling the same GitHub page. Agents sent at a shared external corpus
  with no shared notes re-fetch it, each paying full price.
- **Code sessions run 3.9%–15.6%,** and 312 agents (bold-hellman) do not duplicate more than
  38 (bulibot-2). Fan-out width is not the driver.
- **Write contention is real and recurs.** `15 agents · Edit · src/data/content.ts`
  (Michaelvx-CV) and `16 agents · Edit · .env.example` (bulibot-1) — two of eight sessions
  had many agents editing one file. That is the claim/lease case, not the shared-notes case.
- Concentration at the top is consistent everywhere: 31 of 48 agents read `CONTRACT.md`;
  13 read `docs/knowledge/conventions.md`; 29 ran the identical `git fetch` line.

**Correction to the first pass (n=1),** kept for the same reason: "87% of duplication is
`Read` — agents duplicate lookups, not actions" was true of session 1 and false in general.

**A measurement bug found and fixed while doing this, and it belongs in the record.**
Sidecars live in at least two layouts — `subagents/agent-*.jsonl` and
`subagents/workflows/wf_<id>/agent-*.jsonl`. The flat `readdirSync` in
`packages/transcript/src/session.ts` found the first and **silently reported zero for the
second**: a 312-agent session came back as one agent with 24 tool calls, and would have
entered this table as a clean 0%. Fixed by walking the tree. The project exists to make
silent undercounts impossible and shipped one in its own reader; nothing caught it but
running the number against a session whose size was known independently.

- **What this supports:** item 3's inference — "partitioned, therefore never contending" —
  is not a property of the author's workflow. It is a property of *some* of his sessions.
  Both halves of whipple3 are implicated: the shared-state half by repeated lookups and
  re-fetches, the claim/lease half by many agents editing one file.
- **What it does NOT support, and must not be stretched into:** 12.2% pooled is still
  modest, a repeated read is a cost rather than a correctness failure, and the high numbers
  come from research workloads whipple3 has never been aimed at. Item 3 is **not withdrawn**:
  the author still did not reach for a board, and a fleet view over logs is still rejected.

### 4. RESOLVED 2026-08-12 — "slots underneath", for a different reason than the original

> Opened 2026-08-11 and closed the next morning by item 6. The original text is kept below
> because the *answer* did not change and the *reason* did, and that distinction is the only
> thing that makes this record worth keeping.

`positioning.md` §4 argues for slotting underneath: *adopting whipple3 instead of LangGraph
is a migration, and a migration is never mandatory.* That argument optimises **install
friction** — which decision 1 just removed from the objective function. A sharp, arguable,
subtractive claim ("you do not need the framework") serves reputation better than a hedge
that minimises friction nobody is measuring. It is also the shape that worked for the
closest comparable project: defined by what it removes, with the line count as the argument.

**Against it, and the reason this stays open:** whipple3 has no loop. It is a board;
LangGraph is a runtime. As a *product* claim, "alternative" is unearned today and a reader
who checks will find nothing to replace.

**Resolution path, decided:** adopt it in **writing** first. The essay's claim is about
frameworks, not about whipple3 — it is backed by two independent implementations by the same
author (ShowMe's production runtime on Postgres: table-queue, per-minute drain, TTL leases
via `SKIP LOCKED`, first-class stalled; and whipple3's typed clean-room version). That claim
needs no new code. **README, positioning.md §7 and both launch posts stay unchanged** until
the claim has met real readers.

**What would settle it:** if the claim survives contact, the README follows — and the
minimum loop that earns it is Stage 6 in the *ShowMe shape* (drain + lease + first-class
stalled), explicitly **not** the roadmap's written Stage 6 (XState + `ModelProvider` +
sandbox adapters), which is framework-shaped and would make the original §4 warning correct
after all.

**How it actually resolved (2026-08-12).** Not by readers and not by building the loop:
by noticing that the loop already belongs to someone else (item 6). "Slots underneath"
stands, so `positioning.md` §7 and both launch posts need no edit — but the justification
in §4 is now the weaker half of the argument. Record both:

- *Old reason (weakening):* replacing LangGraph is a migration, and migrations are never
  mandatory. This optimises install friction, which decision 1 removed from the objective.
- *New reason (load-bearing):* **whipple3 should not own the loop at all.** Durable
  execution is a mature, contested category with a decade of hardening in it. Being
  reachable *from* that layer is a defensible position; being an alternative to it is not.

### 5. Finding — robotics settled this architecture first, and that cuts both ways

Not a decision; a piece of prior art that changes how the claims must be worded. Surveyed
2026-08-11 (four searches — the mapping below is ours, not a term of art, and should be
checked with someone from the field before it appears in print).

| whipple3 | Physical AI / robotics |
|---|---|
| The model (Claude, GPT) | VLA model — π0, GR00T N1.7, Gemini Robotics On-Device |
| The harness (Claude Code, Cursor) | ROS 2 + a policy runtime — LeRobot, Isaac, Jetson Thor |
| An agent with a declared role | A behavior-tree node / ROS 2 node — a skill with a contract |
| The typed shared board | **The Blackboard** (BehaviorTree.CPP) |
| Role-declared slices | **A *scoped* Blackboard** — same mechanism, same stated reason |
| Claim / lease | **Mutex Groups** (Open-RMF) — virtual locks on a route or location |
| Claim rejected on conflict | **Traffic negotiation** — schedule DB → conflict notice → proposals → a third-party judge decides |

BehaviorTree.CPP documents its blackboard as *scoped, "visible only in a portion of the
tree… to avoid name pollution and allow the creation of large scale trees"* — which is the
argument for slices, arrived at independently.

**The one thing with no equivalent** — and therefore the only structurally novel territory
in the comparison: robotics splits the runtime **by frequency**. Reasoning runs at 2–10 Hz,
the action layer at 50–200 Hz, bridged by predicting action chunks of 10–100 timesteps.
Software agents have no latency floor and no separation between deciding and moving.

**In our favour:** this is the first genuinely *independent* validation of the architecture.
It is not showme-ui — that is the same designer twice (see `positioning.md` §4). A different
field, different people, decades of multi-agent work in the physical world, converging on
the same primitives.

**Against us:** "a blackboard for agents" is not news to anyone from ROS. Published without
acknowledging that, the launch post reads as unaware of its own field's prior art to exactly
the readers whose respect is the objective under decision 1.

### 6. Finding 2026-08-12 — durable execution is a settled category, and Stage 6 is in it

Temporal, and behind it DBOS, Restate and Inngest, are durable-execution engines: workflow
code replayed deterministically from an event history, workers on task queues, timers,
retries, timeouts. Temporal now markets this explicitly at agents (OpenAI Agents SDK
integration, workflow streams, external payload storage). Verified 2026-08-12; the space
moves, re-check before quoting.

**ROADMAP Stage 6 — scheduler, retries, dead-letter, backpressure, lease expiry, quiescence
— is a description of that product.** SPEC §3 already forbids building it: *"Not an
execution layer… we ride it via adapters, we do not rebuild it."* **Stage 6 is therefore an
adapter, not a build**, and the largest remaining item on the roadmap is deleted rather
than scheduled.

**Third independent arrival at the same architecture.** Event log as truth with state
re-derived by deterministic replay: Temporal's foundation, the blackboard lineage in
robotics (item 5), and the author's own showme-ui engine built before whipple3 existed.
Three unrelated origins. Unlike showme-ui — same designer twice — two of the three are
genuinely independent.

**Also settled, in the other direction: "Temporal but simpler" is not available.** DBOS is
durable execution as an in-process library over Postgres or SQLite with zero new
infrastructure; Restate and Inngest occupy the same slot, and comparison listicles for the
category already exist. Beyond being crowded, the position is self-defeating — Temporal's
complexity *is* its durability, so a simpler version is a less durable one — and it would
trade away the only thing here nobody else has.

**What none of them have.** Their histories record what a workflow *did*; state lives in
workflow-local variables, and sharing typed state between concurrent workflows is a known
gap solved with signals or an external store. **None of them has per-identity read/write
permission over shared state with logged denials** — they assume every worker is yours.
That is whipple3's remaining, real, and small differentiator.

**The composition, unbuilt and untested:** core's purity rules (no I/O, no `Date.now()`, no
randomness — CI-enforced) are the same constraints a Temporal workflow sandbox imposes, so
`apply()` is legal workflow code by construction. A board could be one long-lived workflow
holding `GraphState`, mutated through Update handlers that Temporal serialises — which would
make the board survive crashes and deploys, and would give the single enforcement point
durably and for free. **Open questions before any of that is real:** workflow history growth
under thousands of mutations, and whether anyone running Temporal wants a typed board rather
than a table. The cheap next step is a half-page sketch, not a package.

### 7. Finding 2026-08-15 — DeepSeek Harness: the fourth arrival, and the moat named as somebody else's non-goal

Not a decision. It changes no item above; it supplies the missing evidence for item 4 and
converts two of §6's threats. Recorded because a reader will ask, and because the answer is
"this is the best news the project has had" — which is exactly the kind of claim that needs
its method attached.

**What launched.** `deepseek-ai/deepseek-harness` ("dsh"), an agent harness whose headline is
*everything is a plugin*, on a vendored Cordis fork. Verified 2026-08-15 via `gh api`:
created **2026-08-13T11:56Z**, MIT, ~51 package families of TypeScript.

**The numbers, with the discipline this ADR applies to its own.** 114,198 stars and 11,103
forks two days in. **That is attention, not adoption**, and this project has already been
burned once by reading its own favourable numbers too fast (see the retractions above). The
counter-evidence sits in the same API response: **no push to `master` since launch day** and
**0 open issues**. It is a code drop released alongside DeepSeek's V4-Pro API announcement, and
`BENCHMARK.md` is a three-line stub — no evaluation methodology of any kind. Cite the
architecture; do not cite the star count as validation of anything.

**Fourth independent arrival at event-log-as-truth.** Item 6 counted three — robotics (item 5),
durable execution, and showme-ui, the last of which is the same designer twice and therefore
does not count. dsh makes four, two of which are genuinely independent of this author.
Its session layer is the same design under other names: `session-persistence-jsonl`,
`session-projection`, `session-projection-cache`, deterministic replay from committed `.jsonl`
fixtures as the test strategy.

**This is the evidence item 4 was waiting for, and it arrived from the direction item 6
predicted.** Item 4 resolved to "slots underneath" on the reasoning that *whipple3 should not
own the loop at all*. dsh **is** the loop layer, MIT-licensed, from a frontier lab, published
in one day. Anyone who still believed whipple3 should grow a loop now has a concrete answer
about what that would cost and who they would be racing.

**What dsh does not have — checked against the moat named in item 6, not assumed.**

| Moat claim (item 6) | dsh, as of 2026-08-15 |
|---|---|
| Per-agent identity | `packages/identity` contains only `anonymous-user-id` — telemetry, not an agent principal |
| Two-sided ACL with logged denials | Absent. `packages/guard` is loop hygiene: `repeat-tool-reminder`, `timeout-policy` |
| Scoped shared state | `packages/core/scope` — real, and **visibility only** |
| Cross-process MCP surface | `packages/mcp/mcp-client` only. dsh **consumes** MCP servers; it does not expose itself as one |

The `scope` package is the near miss, and its own README closes the question:

> "Scopes route trusted same-process plugins; **they are not sandboxes or authority
> boundaries.**"

— linking a design note anchored `#security-and-authority-are-non-goals`. **They solved
visibility, declared authority out of scope, and wrote it down.** That is a stronger form of
the finding than absence would have been: absence invites "they just haven't got to it yet",
whereas a documented non-goal is a stated boundary. It can still change — see the re-check
below — but it is no longer a gap this project has to argue exists.

**Threat #1 (§6) fired, from the wrong direction and only halfway.** It was written as
"Anthropic ships native shared state for subagents". What shipped was DeepSeek, and it shipped
the *subagents without the shared state*: `subagent-claude-code`, `subagent-codex` and
`subagent-acp` spawn heterogeneous agents, each owning a separate session log, with no typed
state between them. The trigger — *one agent doesn't need whipple3, two do* — is now reachable
by far more people than last week, and the thing they reach it with does not close it. **This
is the most favourable resolution that threat had available.** Note also that the insurance
booked against it (Stage 5, host independence) is what makes the finding actionable at all.

**Threat #3 (§6) is largely paid off.** "Nobody searches for *blackboard for agents*" was the
education cost that kills architecturally-correct projects. A frontier lab has now spent a
launch cycle teaching the market why the log is the source of truth. That is the single
largest change to this project's cost structure in the record, and none of it was earned.

**A correction that originates in dsh's own documentation, not just the coverage.**
`docs/architecture.md` states: *"Model-visible means logged. Anything that reaches a model
request must be reconstructable from the log, and a runtime invariant asserts it."* The launch
write-ups repeat this as verification "on every production dispatch". **In shipped
configurations it asserts nothing.** `packages/core/agent-loop/src/invariant.ts` does assert
byte-equality between the outgoing request and `session.deriveMessages()` — plus model, system,
temperature, maxTokens, stop and tools against a folded `request/header` event — but it is a
Cordis companion that must be mounted, and **none of the three shipped bundles mounts it**:
`packages/bundle/{base,web-app,headless}/cordis.patch.yml`, 910 lines of composed config,
contain zero occurrences of `invariant` (checked 2026-08-15). The decision was deliberate and
is recorded at
`.agents/notes/implemented/simplification/2026-08-03-omit-invariants-from-shipped-config.md`,
whose config-dump test actively *rejects* an invariant entry in either surface. Always-on is the
storage boundary only: lossless JSON snapshot, deep-freeze, detached projections.

**The structural point this exposes, which matters more than the correction.** In dsh the
session log is itself a plugin, and so is the check that the log is honest. "Everything the
model sees is logged" is therefore a property of a *composition*, not of the architecture —
a patch may replace the persistence row, and the shipped tree already omits the assertion.
whipple3's equivalent guarantee is structural instead: core is pure by CI-enforced rule, every
mutation passes one enforcement point, and there is no configuration in which it does not.
**That is a real and defensible difference, and it is the first one found that is about
enforcement rather than features.** It should be stated as a difference in kind, never as a
defect in dsh — their split (cheap structural boundary always on, expensive relational
assertions opt-in) is a sound engineering answer to a cost problem we have not had to face at
our size.

**The design lesson in that split is worth more than the correction.** They separated the
*structural* guarantee (cheap, always on, owned by `Session`) from the *relational* assertions
(expensive — the check serialises the full history twice — opt-in, owned by each package). Our
equivalent boundary is core's purity plus the single enforcement point; `@whipple3/assert` is
already the relational tier. The split is convergent, and it is the second time an independent
team has landed on our shape after we shipped ours.

**What would overturn this, and when to look.** dsh is two days old with no commits since
launch. If it grows an authority boundary over shared state — the natural next step once
subagents from three vendors write to one workspace — the item 6 moat closes and the honest
response is to say so here rather than to restate the table. **Re-check `packages/core/scope`,
`packages/identity` and any new `packages/*/acl` at the next stage boundary.** The
`#security-and-authority-are-non-goals` note is the specific thing to watch for a status change.

## Consequences

- §4's ladder rung 2 is already updated: `replay` shipped 2026-08-11. §7's copy and both
  launch posts are **provisional** pending item 4.
- ROADMAP Stage 6's own gate — *"only worth building if Stages 1–4 found users"* — is
  reaffirmed. **Being able to build it cheaply is not a reason to build it.** At this
  author's velocity that argument is always available, which is exactly why it needs an
  explicit answer.
- Stages 8 and 9 are not buildable by building. Their done-criteria — a meaningful PR from
  a stranger, and design partners — are human-clock outcomes. Recorded so that any "build
  the whole roadmap" plan is costed honestly: it terminates in a technically complete
  platform with no users, which is the state it was meant to escape.
- **From item 5:** the writing must cite the robotics prior art rather than be caught by it.
  Hearsay-II is already named in SPEC §2 and `positioning.md` §1; that citation is now
  insufficient — it credits the 1970s ancestor while omitting the *living* practice
  (BehaviorTree.CPP, Nav2, Open-RMF) that never stopped using it. Claim the packaging and
  the cross-process MCP surface, never the idea.
- **Item 5 strengthens item 4.** "Software agent frameworks are re-deriving, worse, what
  robotics settled decades ago" is an argument for being an alternative to a framework, and
  it stands on a whole field rather than on two implementations by one author. If item 4
  resolves toward the framework-alternative position, this is its strongest support.
- **Item 5 softens threat #3** (`positioning.md` §6, "the category does not exist"). It
  exists — under other words, in another field. That is a vocabulary to borrow and a
  literature to cite, not a category to invent from nothing.
- **Pooled 7.4% is the number any public claim must use** (census of 45 sessions, 6 projects,
  1,283 agents, 61,623 tool calls) — **and the 0.0%–54.4% range goes with it, always.** Not
  23.5%, not the shared-corpus tail, not the best session.
- **Quote the shape, not the average.** Roughly twenty of forty-five sessions duplicated
  under 5%; a three-session tail does nearly all of it. Duplication tracks *workload*, and
  agent count predicts nothing.
- **The trigger is narrower than "two agents."** On this evidence whipple3's case is
  strongest for **fan-out over one corpus** — review, audit, research sweeps — and weak for
  partitioned ticket work, which is what most of these sessions were. That refines item 3's
  negative finding rather than reversing it, and points at the same attachment ROADMAP
  Stage 8 lists first.
- **Never quote a figure from before the census.** Two retractions and a self-inflicted
  selection bias across five batches; every pre-census number in this ADR was too high, and
  they are kept above only to show which way the error ran.
- **Say "one developer's machine" every time.** The census removed sampling error and left
  the harder limitation untouched: nothing here establishes that any of it generalises.
- **From item 6: ROADMAP Stage 6 is retired as a build.** Rewrite it as an adapter over an
  existing durable-execution engine, or drop it. Nothing in Stages 5–9 is now worth building
  before there is a user; the one exception already shipped (Stage 7 tier 2,
  `@whipple3/assert`, pulled ahead 2026-08-11).
- **Never position against durable execution.** Not as an alternative, not as a lighter
  version. The sentence to keep is "the shared typed board those workflows read and write",
  and the honest rider is that a Postgres table is the incumbent answer — the one the author
  himself reached for at ShowMe.
- **From item 7: the log stops being the claim and becomes the mechanism.** §7's English copy
  leads on *"the append-only log — not the graph — is the truth. Replay it, watch it, assert on
  it in CI."* As of 2026-08-13 that is also dsh's headline, under MIT, and leading with it now
  reads as derivative to the exact audience decision 1 is written for. **Promote per-identity
  authority over shared state — identity bound at connect, role-scoped slices, logged denials —
  to the first claim; demote log/replay to the subordinate clause it earns.** This is §5's
  standing rule ("claim the packaging and the cross-process MCP surface, never the idea")
  applied to the one sentence that had drifted from it.
- **From item 7: `dsh` joins the host matrix, and Stage 5 stops being insurance.** dsh ships
  `mcp-client` and no server, so `whipple3 mcp --board … --agent <id>` attaches with no new
  code. Host independence was booked as insurance against threat #1; that threat has now fired,
  and the insurance is the cheapest available demonstration of "slots underneath". It is the
  one item here worth doing before the copy edit.
- **Retire "Gett לרתמות" from §7's Hebrew copy rather than keeping it dated.** Item 2 parked
  Gett as the Stage 6 story; item 6 then deleted Stage 6 as a build. A metaphor reserved for a
  product this ADR has since decided not to build is not dated, it is unbacked — and it is the
  same hollowness item 2 diagnosed in the first place.
- **Never repeat the "verified on every production dispatch" claim about dsh** (item 7). The
  shipped config mounts no invariant companions. Quote the storage boundary — snapshot, deep
  freeze, detached projections — which is the part that is always on.
- **Cite dsh's architecture, never its star count.** 114K stars in two days, zero commits since
  launch and zero open issues describe a launch, not an adoption curve. This ADR has retracted
  two of its own favourable numbers already; the rule applies to other people's.
- Revisit at a stage boundary or on new evidence, per the standing rule. Items 1–3 change on
  evidence; item 4 is resolved and would only reopen if whipple3 were ever to grow a loop;
  item 5 needs verification by someone who actually ships ROS before it is used in public;
  item 7 changes if dsh ships an authority boundary — re-check the three paths named there.

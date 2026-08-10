# Positioning

Where whipple3 sits in the agent landscape, what it will never be, and how it earns its
install. Written 2026-08-11, pre-v0.1.0. Competitor claims here are directional — re-verify
before quoting any of them publicly; this space moves monthly.

Canonical design: `SPEC.md`. Stage order: `ROADMAP.md`.

---

## 1. The category

The agent landscape is usually drawn in four buckets. whipple3 is in none of them.

| Category | Examples | What it owns |
|---|---|---|
| Personal multi-channel agents | Hermes, OpenClaw, NanoClaw | One agent, messaging channels, personal memory |
| Developer / CLI agents | Claude Code, Goose, Aider | Local execution: code, git, the terminal |
| Multi-agent orchestration | AutoGen, CrewAI | Who runs when, role decomposition |
| Agent frameworks & memory | LangGraph, MemGPT/Letta | Building agents from scratch, state and recall |
| **Coordination substrate** | **whipple3** | **The shared typed state many agents mutate — and who may mutate what** |

Every project in the first four answers *"what kind of agent should I build"* or *"who calls
whom."* whipple3 answers a different question: **where does shared state live when several
agents touch it at once, and what enforces the rules.**

The one-line distinction:

> AutoGen, CrewAI and agent-to-agent protocols coordinate through **conversation**.
> whipple3 coordinates through **state**.

Agents here never talk to each other. They post, claim, read and release against a typed
graph. This is the classic blackboard architecture (Hearsay-II lineage); what is new is that
it is served over MCP, so it crosses processes, languages and hosts.

## 2. Where it sits in the agent loop

The canonical single-agent loop is drawn like this:

```
[input] ──> [LLM] ──> [tool calls] ──> [sandboxed execution]
   ▲                                          │
   └──────── [memory & context manager] <──────┘
```

It is tempting to claim whipple3 *is* the "memory & context manager" box. Half of that is
right, and the wrong half is expensive.

That box bundles two unrelated jobs:

- **Memory** — vertical, over time, one agent: *what do I remember from last week.*
  Embeddings, recall, summarization, persistence. This is Letta / mem0 / Zep.
  **whipple3 does not do this, ever.** Sessions are ephemeral by design (SPEC §4.8).
- **Context assembly** — what enters the prompt *this turn*. Which slice of the world this
  agent gets to see. This whipple3 owns outright: role-declared slices, read-ACL filtering
  during traversal, `blackboard_next` as the pull query.

Claim the whole box and you get benchmarked against memory products on recall quality — a
comparison built out of features we deliberately refuse to build. Claim the *right half* and
the axis is instantly legible:

> Memory answers **"what did *I* know before."**
> whipple3 answers **"what do *we all* know right now, and how much of it am I allowed to see."**

The deeper correction: that diagram has no box for whipple3 because it has only one loop.
Draw N loops and whipple3 is not inside any of them — it is the plane they all touch, and the
only place in the picture where a rule can be enforced:

This is the canonical picture — keep it byte-identical in `ARCHITECTURE.md` and both launch
posts. Labels stay in English everywhere, including the Hebrew post: mixed-direction ASCII art
scrambles in RTL renderers, so the Hebrew carries the caption, never the diagram.

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

The return arrow into an agent's next turn is fed by **other agents' writes**, not by that
agent's own history. That single fact is the whole difference between this and a memory layer.

Two boxes of the original diagram are neighbours, not competitors:

- The **sandbox** isolates agent ↔ machine. whipple3 mediates agent ↔ agent.
  (README's line: NanoClaw isolates one agent from your machine; whipple3 coordinates many
  agents with each other.)
- The **tool-call** leg *is* whipple3's surface — six typed tools, no query language.

## 3. Competitor by competitor

| Against | The real difference | Relationship |
|---|---|---|
| Claude Code, Aider, Goose | They are the harnesses; whipple3 is the dispatch. Claude Code subagents are the first target customer. Goose and Claude Code both speak MCP — free distribution. | Complementary; distribution channel |
| OpenClaw, NanoClaw, Hermes | Opposite axis: they isolate one agent. We coordinate many. | Not a competitor |
| CrewAI | Coordination is execution order across declared roles. No claim, no lease, no proof of non-duplication — dedup is a prompting problem there. | Conceptual competitor |
| AutoGen | Closest of the two since the event-driven runtime: no longer everything through one context. Still message passing between actors — no shared typed state, no per-identity ACL, no log-as-truth to replay from. | Largest conceptual overlap |
| LangGraph | **The dangerous one.** Real state, reducers, checkpointers, HITL. But state lives in one process and one language; every node sees all of it (no per-identity ACL, no enforced slicing); a checkpoint is a snapshot, not an event log the graph is merely a view of. The distance from there to "shared store with permissions" is a feature, not an architecture change. | Threat #1 |
| MemGPT / Letta | Orthogonal, see §2. `distill` is the boundary. | Integration, not competition |

### Capability matrix

Honest scale: **strong / adequate / weak / absent**.

| Capability | whipple3 | LangGraph | AutoGen, CrewAI | Letta | Claude Code, Goose |
|---|---|---|---|---|---|
| Parallel work without collision (claim/lease) | strong | adequate (DIY) | weak | absent | weak |
| Typed shared state | strong | strong (in-process) | weak | adequate | absent |
| Per-agent ACL, read **and** write, denials logged | strong | absent | absent | absent | absent |
| Log as source of truth, replay + time travel | strong | adequate | weak | weak | absent |
| Orchestrator-context savings | strong *(claimed; not yet published)* | adequate | weak | adequate | weak |
| Host / language independence | strong (MCP) | weak (Py/TS) | weak (Py) | adequate (API) | — |
| Long-term memory | **absent, by choice** | adequate | weak | strong | weak |
| Authoring agents, prompts, tools | **absent, by choice** | strong | strong | strong | strong |
| Execution: sandbox, code, git | **absent, by choice** | weak | weak | weak | strong |
| Maturity, adoption, community | **very weak** — pre-publish, one developer | strong | strong | strong | strong |

The last row is the one that matters commercially. Everything above it is true and irrelevant
until someone other than the author has run it.

## 4. How it earns an install

Nothing becomes a required install by claiming breadth. git, eslint, Sentry and OTel became
required because installing costs nothing, there is a **defined moment of pain** where skipping
it looks negligent, and they produce an artifact something else comes to depend on.

That maps onto two moves, and they are not independent:

- **Adapters make whipple3 installable.** As long as adopting it means adopting it *instead of*
  LangGraph or CrewAI, it is a migration, not an install — and a migration is never mandatory.
- **The architectural gap makes it un-removable.** Two-sided ACL with `acl.denied` in the log,
  typed slicing during traversal, log-as-truth producing replay and time travel: none of it can
  be handed back through an adapter by the framework itself.

> Easy install without the artifact is a toy.
> The artifact without easy install is a research project.
> Both together is a requirement.

The lock-in is not at runtime. It happens in CI: once a test asserts over a session log,
removing whipple3 breaks the build. That is a free consequence of the pure reducer, not a
feature to be designed.

### The trigger, which is the whole message

> **One agent doesn't need whipple3. Two do.**
> One file doesn't need git either.

Horizontal in effect — every multi-agent workflow reaches that moment, in every framework —
but stated narrowly enough to survive a skeptical reader.

### Install ladder

| Rung | User action | What they get | Blocker today |
|---|---|---|---|
| 0 — trial (60s) | `npx whipple3 serve` + one `mcp add` line | Log, Studio, live graph | **npm publish.** Without `npx` there is no install, only a `git clone` |
| 1 — the wedge (second agent) | Another `--agent`, claims | Zero duplicate work, zero lost updates | The Stage 4 benchmark number |
| 2 — the ratchet (CI) | `whipple3 replay <log>` in the pipeline | Coordination regressions caught before a human sees them | `replay` is a stub |
| 3 — the org | Shared `serve --policy` | "What did our agents do, under which policy, what got blocked" | Exists; this is the commercial stage |

### Roadmap consequences

1. **Pull `replay --assert` (Stage 7, tier 1) ahead of Stage 6.** The scheduler extends the
   product; replay is what makes it required. It is nearly free architecturally and it is the
   only item on the roadmap that gets whipple3 into someone else's CI. Stage 6 waits for
   evidence of users.
2. **Adapters ship as examples, not packages.** No `whipple3-py`. LangGraph and CrewAI can both
   consume MCP tools already, so the adapter is `examples/langgraph-audit/` running the same
   audit task against `whipple3 serve`, one proxy per node, measured on the same benchmark.
   Extract a package only when two frameworks need identical glue (rule of three). Order:
   LangGraph → MCP-native hosts (free) → CrewAI → AutoGen. Verify each framework's current MCP
   support before committing.
3. **`distill` → memory stays a boundary, not an integration.** Freeze the report format, write
   one paragraph in the docs: the sukkah comes down, what it taught you moves to your memory
   system. Orthogonality to Letta bought for the price of a paragraph and no dependency.

## 5. What we never build

Memory. Agent authoring. The execution layer. Messaging channels. Each one converts whipple3
from irreplaceable infrastructure into an inferior competitor.

## 6. Threats, in order

1. **Anthropic ships native shared state for subagents.** Erases the first wedge directly.
   Insurance: host independence (Stage 5) — the compatibility table is a policy, not a nicety.
2. **LangGraph adds a shared store with permissions.** One quarter of work for them. Insurance:
   do not compete on agent authoring; be reachable *from* LangGraph.
3. **The category does not exist.** Nobody searches for "blackboard for agents." Education cost
   is the thing that kills architecturally-correct projects.
4. **Agent-to-agent protocols normalize "agents talk to each other"** as the default, and shared
   state reads as over-engineering until someone gets burned by duplicated work.

## 7. Copy

**English (README / HN):**

> One agent doesn't need whipple3. **Two do.**
> Keep your framework. whipple3 slots underneath it: a typed shared board where agents claim
> work instead of colliding, every mutation passes one enforcement point, and the append-only
> log — not the graph — is the truth. Replay it, watch it, assert on it in CI.

**Hebrew (launch post):**

> whipple3 הוא לא פריימוורק לבניית סוכנים — הוא מה שמתקינים ברגע שיש סוכן שני.
> תשאיר את CrewAI, את LangGraph ואת Claude Code בדיוק איפה שהם. whipple3 נכנס מתחתיהם: לוח
> משותף מוטפס שבו סוכנים תופסים משימות במקום להתנגש, כל שינוי עובר דרך נקודת אכיפה אחת, וכל
> דחייה נרשמת. הלוג הוא מקור האמת — ולכן כל סשן ניתן לשחזור, לצפייה ולבדיקה ב-CI, בחינם.
> **Gett לרתמות.** המוניות נשארות שלך.

**Never write "required install" in a post.** That is a label users grant, not one you announce;
at v0.1 with no users it reads as arrogance to exactly the audience you want. State the trigger,
publish the numbers including the losses, and let them say it.

# whipple3 — Specification v0.1

**Status:** Accepted — approved for vertical slice implementation
**Date:** 2026-08-10
**License:** MIT
**Name:** `whipple3` (from *whippletree*, the crossbar that lets a harnessed team pull one load together) — npm package and github.com/whipple3 verified free 2026-08-10

> **Positioning in one line:** NanoClaw isolates one agent from your machine. **whipple3 coordinates many agents with each other.**

whipple3 is a **typed, ephemeral, event-sourced blackboard** — a shared knowledge graph that multiple AI agents read and write through structured mutations instead of chat. It is a **coordination plane**, deliberately not an execution plane, an orchestration framework, or a model runtime.

---

## 1. Problem

Multi-agent setups today coordinate through one of two broken channels:

1. **Free-text chat between agents** (classic group-chat frameworks): burns tokens on coordination, contaminates context, is unauditable.
2. **Funneling everything through an orchestrator** (e.g., Claude Code subagents): each subagent runs in an isolated context and returns only a summary to the parent. Parallel workers can't see each other, duplicate work, and the parent's context becomes the bottleneck. Subagent-heavy workflows are reported to consume roughly 7× the tokens of a single-thread session.

The emerging third option — direct agent-to-agent messaging (e.g., experimental Agent Teams) — recreates chat coordination point-to-point.

## 2. Thesis

Revive the **blackboard architecture** (Hearsay-II lineage) with three modern additions: a **typed schema**, **LLM agents**, and an **event-sourced core**. Agents coordinate by mutating a shared typed graph; the system is auditable and replayable by construction.

The thesis is research-validated (2025–26): blackboard-style shared state outperforms master–slave coordination in published benchmarks, and schema-grounded state mutation for LLM multi-agent collaboration is an active research direction — but **no dominant OSS implementation packages it as a DX-first TypeScript framework**. The gap is packaging, not physics.

### Value proposition — stated precisely

- **Context scoping**, not "zero tokens": each agent receives a minimal typed slice, not the transcript.
- **Auditable, replayable coordination**, not "deterministic AI": the coordination substrate is deterministic; the LLMs are not.
- **Collision-free parallelism**: claims/leases make parallel workers safe.
- **Cheap-model fleets become viable**: schema-validated mutations, small slices, and ACLs lower the intelligence bar per agent — a fleet of budget models instead of a fleet of frontier models.

## 3. Non-goals (v0.x)

- **Not an execution/sandbox layer.** Container isolation, credential gateways, microVMs — that layer is owned (NanoClaw, E2B, Daytona). We ride it via adapters (Phase 2), we do not rebuild it. *(ADR-003)*
- **Not a framework replacement.** whipple3 interoperates with Claude Code, Mastra, AgentKit — it does not compete with them for the agent loop.
- **No LLM calls in core.** Ever. Models are brought by the host runtime (v0.1) or a `ModelProvider` port (Phase 2).
- **No vendor lock-in.** Model-agnostic by construction. The agent-facing surface is MCP — an open standard spoken by Claude Code, Codex CLI, Gemini CLI, Cursor, opencode, Goose. Claude Code as first demo is a **distribution** decision, not an architectural dependency.
- **No query language exposed to LLMs.** No Cypher. Agents get constrained, typed tools only.
- **No observability backend.** We emit; existing tools store and display.
- **No required external database.** In-memory + append-only file by default.

## 4. Architecture

### 4.1 Functional core, imperative shell

`@whipple3/core` is **pure**: zero I/O, zero `Date.now()`, zero randomness, zero Node APIs. Time and IDs are injected in; effects live in the shell behind ports. The central function is a reducer:

```ts
apply(state: GraphState, mutation: Mutation): Result<{ state: GraphState; events: Event[] }, MutationError>
```

Purity is a product feature, not aesthetics: replay, time-travel, and property-based testing fall out of it.

### 4.2 Event sourcing

The **append-only event log is the source of truth**. The graph is a materialized view. Distillation is a fold over the log. Consequences: replay, time-travel in Studio, deterministic coordination tests, audit trail, and single-point serialization of writes.

### 4.3 Three-tier lifecycle

| Tier | Fate at session end |
|---|---|
| Working graph (in-memory) | **Purged** |
| Trace log (append-only) | **Retained** — debugging, replay, evals |
| Distilled memory (`distill()` output) | **Exported** (markdown/JSON; Phase 2: exporter adapters) |

### 4.4 Dispatch: two modes, one core

- **Pull** (host-controlled runtimes, e.g., Claude Code): the host's orchestrator controls spawning; `when()` predicates compile to **work-queue queries** (`blackboard_next`). **v0.1 implements pull only.** *(ADR-002)*
- **Push** (whipple3-controlled runtime, Phase 2): reactive triggers dispatch agents on matching mutations, with a real scheduler (queues, concurrency caps, batching, retries, lease expiry, quiescence detection).

### 4.5 Concurrency & safety

- **Optimistic versioning per node** — a mutation carries the expected version; mismatch is rejected with current state returned.
- **Claims/leases** — `claim(nodeId, agentId, ttl)` with injected time; expiry releases work. No duplicate work across parallel agents.
- **Causality chain** — every event carries `causationId`/`correlationId`. The same chain serves cycle detection and hop budgets (safety) and trace propagation (observability).
- **Quiescence** (Phase 2, push mode): all agents idle ∧ queues empty ∧ no in-flight work ∧ settle window.

### 4.6 Security model

- **ACL at the schema level, in both directions.** Each agent declares `{ write, read }`
  label lists. `canMutate` (write) is enforced by the engine on every mutation; the read
  side filters every slice during traversal (§4.7) — an unreadable node blocks its path
  and never leaks via an edge endpoint. Every denial, read or write, is appended to the
  log as an `acl.denied` event: enforcement leaves a trail, never a silent drop.
- **Identity is bound to the connection, never self-declared.** No tool payload carries an
  `agentId`; the transport binds one at `session.connect` (stdio: one server process per
  agent, `whipple3 mcp --agent <id>`; UDS in Phase 2: one socket per agent). An ACL keyed
  on a name the payload can assert is decorative.
- **Host permission systems as a second gate** (Claude Code `tools` allowlists in v0.1).
- **HITL gates** for high-impact mutations (e.g., a fixer's changes require approval).
- Taint/provenance labeling for agents processing untrusted input: **designed for, deferred to Phase 2.**

### 4.7 Context: control plane vs data plane

Slicing is **push-model**: the engine computes the minimal slice and injects it at dispatch; agents cannot read beyond it. Pull-mode reads obey the same principle: `blackboard_read` and `blackboard_next` return the **policy-filtered** slice (`readableNeighborhood`) — the engine decides what the agent sees; the agent never widens its own scope. The **graph carries metadata and pointers/hashes only** — blobs (file contents, diffs) live on the filesystem/data plane, never in node properties.

## 5. Packages & ports

```
packages/
  core/src/
    schema.ts     # defineNode / defineEdge / when — the typed DSL
    state.ts      # GraphState — immutable nodes/edges/claims/versions
    mutation.ts   # Mutation union + apply() — the reducer
    events.ts     # event taxonomy + causality fields
    acl.ts        # canMutate — pure predicate
    claim.ts      # lease semantics — time injected
    slice.ts      # context slicing — pure query
    ids.ts        # branded types + parsers
    result.ts     # Result<T, E> (~20 lines, no library)
    index.ts      # the only public gate
  log/            # LogStore port + memory + jsonl + conformance/
  transport-mcp/  # tools.ts (schemas derived from core), server.ts (shell)
  studio/         # graphology + sigma.js live ONLY here (ADR-004)
  cli/            # init | mcp | studio | replay
examples/
  claude-code-plugin/   # .mcp.json + .claude/agents/* + /audit command
```

**Ports (v0.1):** `LogStore` (append/read/subscribe — Studio depends on `ReadonlyLog` only), `Transport`.
**Ports (Phase 2):** `SandboxProvider`, `ModelProvider`, `Exporter`, `TelemetryExporter`.

`@whipple3/core` has **exactly one runtime dependency: Zod v4**. The public schema boundary is **Standard Schema**, so users may bring Valibot/ArkType. `index.ts` is the only entry, locked via `package.json` `exports` — no deep imports.

## 6. Protocol & MCP surface

**Transport (v0.1):** MCP over **stdio** via the official `@modelcontextprotocol/sdk`. UDS transport is **deferred to Phase 2** *(ADR-005)* — it is only needed when whipple3 runs its own sandboxes.

**Tools exposed:**

| Tool | Purpose |
|---|---|
| `blackboard_post` | Submit a typed, versioned mutation (schema + ACL validated) |
| `blackboard_read` | Read a scoped slice |
| `blackboard_claim` | Claim/lease a node for exclusive work |
| `blackboard_next` | Pull the next pending work item for this role (`when()` in pull mode) |
| `blackboard_status` | Session/graph summary |

**Envelope (NDJSON on the wire and in the log):** `protocolVersion`, `sessionId`, `agentId`, `principal`, `ts`, `causationId`, `correlationId` (W3C traceparent-compatible IDs), payload. `agentId` is derived from the connection — tool payloads carry no identity (§4.6). `principal` is on-behalf-of attribution ("Michael's agent did", not just "auditor did"): read from the local environment in OSS, injectable via `WHIPPLE3_PRINCIPAL` (the enterprise/SSO hook). Transaction IDs are **ULIDs**. Errors return as structured values (mirroring core's `Result`), never as prose.

## 7. Event taxonomy

Reserved from day one (the slice emits the subset it can observe; the schema reserves the rest):

`graph.mutation` · `claim.acquired/released/expired` · `agent.triggered/started/completed/failed` · `llm.call` (model, tokens, cost, latency) · `tool.call` · `sandbox.spawned/exited` · `session.started/distilled/purged`

This single decision is what makes observability and evals adapters later instead of a rewrite.

## 8. Vertical Slice v0.1 — Claude Code shared blackboard

**Why here first:** largest concentration of developers running local multi-agent workflows with felt pain (isolated subagents, summary-only returns, token multiplication); the most mature parallel-subagent primitive; one-line plugin install; maximum visibility. The same MCP server is host-agnostic by design.

**What Claude Code provides for free:** orchestration, models (per-subagent `model` frontmatter — whipple3 never sees model choice), tool execution, permissions. **Therefore out of scope for the slice:** sandboxes, scheduler, LLM layer, UDS, OTel adapter, evals package, CRDTs, XState.

**Packaging:** a Claude Code **plugin** bundling the MCP server (`.mcp.json`), three subagents (`.claude/agents/`), and an `/audit` command. Minimal path alternative: `claude mcp add --transport stdio whipple3 -- npx whipple3 mcp` + drop agent files. Subagents access the blackboard via inherited or allow-listed MCP tools; the `tools` whitelist doubles as a second enforcement layer over `canMutate`.

**Demo script:** `/audit` on a real repo → *scanner* posts `CodeFile` nodes (ACL: can post nothing else) → three *auditors* in parallel, each `blackboard_claim`s pending files (zero duplicate work; leases visible in Studio, colored per agent) → `SecurityIssue` nodes accumulate → *fixer* reads issues; fixes pass a HITL approval gate → `distill()` → `report.md`; graph purged; trace log retained. The viral moment is Studio: a **live graph of what your subagents are doing right now.**

**Success criteria:**

1. ≥ **40% reduction in orchestrator-context tokens** at equal finding quality vs. a vanilla-subagents baseline (same task, findings funneled through parent summaries).
2. **Zero duplicate claims / lost updates** across repeated parallel runs.
3. The trace answers **"why did agent X do Y"** without guessing.
4. Install-to-wow **< 10 minutes**.

## 9. Engineering standards

**Principles:** CLEAN, SOLID, DRY, KISS, composition, pure functions, strict typing — enforced mechanically, not aspirationally. *A principle that doesn't run in CI is an opinion.*

### 9.1 SOLID, translated to functional TS

- **S** — one concept per file (see §5), one reason to change per package.
- **O** — extension via adapters implementing ports; core untouched.
- **L** — **conformance test suites**: every port ships a shared Vitest suite that all implementations must pass (`describe.each([memoryLog, jsonlLog])`).
- **I** — narrow ports; consumers depend on the narrowest slice (`ReadonlyLog`).
- **D** — core defines port types; adapters depend on core, never the reverse; **import direction enforced by dependency-cruiser in CI**.

### 9.2 Type discipline

- `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Zero `any`; `unknown` at boundaries only.
- **Parse, don't validate:** Zod parses NDJSON/tool input into domain types once at the edge; interior code never re-checks.
- **Branded types** for all IDs (`NodeId`, `AgentId`, `SessionId`, `Version`).
- Events/mutations as **discriminated unions** with exhaustive `switch` + `never` assertions — adding a variant breaks compilation everywhere it must be handled.
- Errors as values in core (`Result<T, E>`, homemade, ~20 lines); exceptions only at shell edges. `readonly` everywhere.

### 9.3 Budgets (the KISS enforcement)

- **Abstraction budget is spent only at the ports.** No internal interfaces with a single implementation, no factories where a closure suffices, no class hierarchies — composition via plain functions and object literals.
- **Type-gymnastics budget is spent only on the public DSL** (`defineNode` inference must make `when({ status: 'pendig' })` a compile error). Internals stay boring.
- **DRY is about knowledge, not lines:** the schema definition is a single source projected four ways — TS types, Zod validators, MCP tool JSON Schemas, docs. For code: **rule of three** — no abstraction before the third occurrence.
- **Size constraints (NanoClaw lesson — legibility is a feature):** core < ~1,000 lines total; no file > ~200 lines; directory depth 1 per package.

### 9.4 CI gates

`tsc` strict · Biome · dependency-cruiser (import direction) · knip (dead exports) · Vitest + **fast-check property tests on core invariants** (replay is deterministic; version conflicts always rejected; a claim is never double-held; `apply` never drops events) · port conformance suites · demo scenario as integration test. GitHub Actions matrix: Node 20/22 + Bun smoke test.

## 10. Toolchain

TypeScript strict, **ESM-only, Node ≥ 20** (Deno/Bun consume npm; publishing for Node reaches both). pnpm workspaces + changesets · tsup · Vitest + fast-check · Biome · citty (CLI) · Vite + vanilla TS + sigma.js (Studio v0 — no UI framework; revisit for Studio v2 based on contributors, likely React) · `@modelcontextprotocol/sdk` · JSONL log now, SQLite adapter next (prefer built-in `node:sqlite`; `better-sqlite3` fallback).

## 11. Observability & evals — designed for now, built later

- **Emit, don't store:** core emits the full event taxonomy (§7) with causality fields; Phase 2 adds an OTel GenAI adapter (→ Langfuse/Jaeger/console). Studio consumes the same stream (SSE; Yjs considered later for engine↔studio sync only).
- **Replay is the eval primitive.** Three tiers:
  1. **Deterministic replay tests** — session logs as fixtures + VCR-style LLM record/replay; coordination regression tests in CI with zero API calls.
  2. **Trajectory assertions over typed state** — the novel tier: `expect(final).toSatisfy(CodeFile.all({ status: 'audited' }))`, `expect(trace).maxHops(5)`, `expect(session.cost).lessThan(x)`. Existing eval tools judge text; whipple3 judges structured state trajectories.
  3. **LLM-as-judge on distilled output** — commodity; pluggable scorer interface, integrate rather than build.

## 12. Roadmap

**Phase 1 (weeks 1–3):**
- W1: core + log + MCP server; terminal happy path.
- W2: claim/lease; the three demo subagents; Studio-lite.
- W3: benchmark vs. vanilla baseline; README + ARCHITECTURE.md + ADRs 001–005; demo GIF; publish.

**Phase 1.5:** run the same server against Codex CLI, Gemini CLI, opencode — turn "works with whatever agent you already run" from a claim into a recording.

**Phase 2:** push-mode runtime (scheduler: queues, concurrency caps, batching, retries, quiescence) · UDS transport · `SandboxProvider` (dockerode → E2B/Daytona/NanoClaw-pattern adapters) · `ModelProvider` (Vercel AI SDK v5 → OpenRouter/any provider — BYOM) · OTel + Langfuse adapters · `@whipple3/evals` · taint/provenance labels · published benchmark harness vs. LangGraph and vanilla subagents.

## 13. ADR index

| ADR | Decision |
|---|---|
| 001 | Independent core with adapters, not built on Inngest/vendor runtime |
| 002 | Two dispatch modes; v0.1 is pull-only |
| 003 | We do not build the execution/sandbox layer (NanoClaw et al. own it) |
| 004 | graphology demoted to Studio; core state is our own immutable structure (purity) |
| 005 | MCP-first agent surface; UDS deferred to Phase 2 |
| 006 | KùzuDB rejected: upstream archived Oct 2025 (bus-factor lesson → core deps minimized) |

## 14. Risks

- **NanoCo (or another funded player) expands into coordination.** Their DNA is execution, not typed reactive blackboards — but the window for "blackboard for agents" mindshare closes once claimed. Mitigation: ship the slice in 3 weeks.
- **Claude Code surface churn** (subagents/plugins/MCP evolve fast). Mitigation: pin a minimum version; plugin smoke test in CI; keep the host integration thin — everything host-specific lives in `examples/`.
- **Solo scope creep.** Mitigation: §3 non-goals and §9.3 budgets are the contract; anything not in §8 is Phase 2 by default.

## 15. Open TODOs before repo creation

- [x] Package name: `whipple3` verified free on npm (2026-08-10). Still open: npm org + GitHub org/user availability (blocked from sandbox; 10-second check), and full legal name in LICENSE.
- [ ] Pin minimum Claude Code version for the plugin.
- [ ] Choose GitHub org/repo name; enable Actions matrix.

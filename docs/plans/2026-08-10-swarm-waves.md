# Swarm Waves — parallel-session execution plan

> **For Claude:** you are ONE session in a swarm. Find your package below, stay inside its
> owned paths, and before writing any code expand your package into a full TDD plan
> (REQUIRED SUB-SKILLS: superpowers:writing-plans, then superpowers:test-driven-development).

**Goal:** execute ROADMAP.md Stages 2–4 as waves of work packages that run in parallel
Claude Code sessions without colliding.

**Architecture of the plan itself:** a wave = a set of packages with disjoint owned paths
and a frozen contract surface between them. Merge only at wave boundaries. This is the
blackboard's own claim discipline applied to the repo: claim before work, one owner per
path, no exceptions.

---

## Protocol (every session, every wave)

1. **Worktree per package:**
   `git worktree add ../whipple3-<pkg> -b wave<N>/<pkg>` — never two sessions in one tree.
2. **Ownership = claim.** Write ONLY inside your package's owned paths. Everything else is
   read-only. If you need a file someone else owns, you don't — redesign or request.
3. **Contracts are frozen mid-wave:** `packages/core/src/index.ts` export surface,
   `tools.ts` schemas, the event taxonomy in `events.ts`, `packages/log/src/port.ts`,
   the `AclPolicy` shape, the `AgentConnection` surface, `BoardLifetime`.
   Need a change? Append it under "Contract-change requests" below and design around the
   current contract; the integration pass applies approved changes at the wave boundary.
4. **Gate before handoff:** `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test`
   (plus `pnpm build` if you touched cli). Never hand off red. TDD per CLAUDE.md — no
   production code without a failing test first.
5. **Commits:** small, signed off (`git commit -s`), style `area: what`.
6. **Integration pass** (one session, after all packages land): merge order
   core → log → transport-mcp → cli → studio → examples → docs; full gate after EACH
   merge; a non-trivial conflict means someone broke rule 2 — stop and flag it.

---

## Wave 1 — no cross-dependencies, start all four today

| Pkg | Mission | Owned paths |
|---|---|---|
| **W1-A** | Collision proof (Stage 2) | `packages/transport-mcp/test/**`, `packages/core/test/**` |
| **W1-B** | Schema DSL literal inference (Stage 2) | `packages/core/src/schema.ts`, `packages/core/test/schema.test.ts` |
| **W1-C** | Studio skeleton (Stage 3) | `packages/studio/**` |
| **W1-D** | ADRs + architecture docs (Stage 4, pulled early) | `docs/adr/**`, `ARCHITECTURE.md`, `README.md` |

**W1-A — collision proof.** Multi-connection integration tests over one session
(`session.connect` per agent, as in `server.test.ts`): N agents × interleaved
next→claim→update loops; assert zero duplicate valid claims, zero lost updates, every
`ALREADY_CLAIMED` names the true holder; lease abandonment (claim, never release, expiry
readmits). fast-check property over arbitrary claim/release/expiry interleavings.
Read decision **D2** first — if Michael rules "non-reentrant claims", this package also
owns the `CLAIM_NODE` case in `packages/core/src/mutation.ts`.
*Done:* repeated runs green and deterministic; property suite in CI.

**W1-B — DSL literal inference.** `defineNode` / `defineEdge` / `when()` carry full
literal prop inference so `when({ status: "pendig" })` is a **compile** error. Type-level
tests (vitest `expectTypeOf` / `@ts-expect-error`). No new runtime code paths; respect
core's ~1,000-line budget — this is the type-gymnastics allowance, spend it here only.
*Done:* the typo test fails to compile; runtime suite unchanged and green.

**W1-C — Studio skeleton.** Inside `packages/studio` only (no cli wiring this wave —
cli is unowned in Wave 1 on purpose): a dev server that tails a given `.ndjson` via
`ReadonlyLog`, streams records over SSE, and renders a live sigma.js graph (nodes appear
on `graph.mutation`, basic status coloring). Blocked on decision **D3** (dependencies) —
get the OK before `pnpm add`.
*Done:* point it at a log file from a real `whipple3 mcp` run and watch the graph appear.

**W1-D — ADRs + docs.** Reconstruct the decision records the SPEC references (grep
`ADR-` in SPEC.md) and write them: pure event-sourced core, log-as-source-of-truth,
MCP-first transport, ULID ids, UDS deferral (ADR-005)… plus the three decided today:
identity-from-connection, two-sided ACL with logged denials, board-lifetime-as-parameter.
Refresh ARCHITECTURE.md to the post-Stage-1 reality (connect-bound identity, read
filtering, principal).
*Done:* a stranger can reconstruct WHY from docs alone; no stale W1 references anywhere.

---

## Wave 2 — after Wave 1 merges

| Pkg | Mission | Owned paths | Needs |
|---|---|---|---|
| **W2-A** | Lifecycle: `distill()` → report, explicit lifetime-gated purge, retained trace | `packages/transport-mcp/src/session.ts`, `packages/cli/**`, `packages/log/**` | — |
| **W2-B** | Shared-state backend: `whipple3 serve` + stdio↔socket proxy, identity from socket | `packages/transport-uds/**` (new), `packages/cli/**` (mcp/serve cmds) | **D1** |
| **W2-C** | Studio live: claim tinting, click→history, time-travel scrubber over `replay` | `packages/studio/**` | W1-C |
| **W2-D** | Role-declared slices replacing raw BFS depth | `packages/core/src/schema.ts`, `slice.ts` | W1-B |
| **W2-E** | Plugin demo + fixer HITL gate; per-agent wiring per D1 | `examples/**` | W2-B |

W2-A and W2-B both touch cli — **serialize them or split cli command files first** at the
integration pass of Wave 1. W2-A must respect SPEC §4.8: purge is an explicit action
triggered by the lifetime policy, never an implicit end-of-session effect.

---

## Wave 3 — proof and launch (Stage 4)

- **W3-A** Benchmark harness (`tools/bench/**`): whipple3 vs. vanilla subagents; publish
  honest numbers. Needs W2-E.
- **W3-B** Packaging: npm publishConfig sanity, plugin version pinning, quickstart README.
- **W3-C** Launch checklist: LICENSE full name, GitHub org, npm org, v0.1.0 tag, post.
  (Open items live in Michael's memory + ROADMAP Stage 4.)

---

## Decisions needed from Michael (blocking marked packages only)

- **D1 — shared-state topology for the real-host demo.** Claude Code multiplexes all
  subagents over ONE stdio connection, so today they all share identity `main`; and
  process-per-agent stdio servers would each own a separate in-memory board. To make
  Stage 2's "three auditors, zero duplicates" true on a real host with real identities,
  pull a minimal piece of Stage 5 forward (W2-B): one `whipple3 serve` process owns the
  session; `whipple3 mcp --agent X` becomes a thin proxy; identity comes from the socket.
  **Recommendation: yes** — it is the same socket-per-agent design Stage 5 promises,
  arriving one wave early. Alternative: demo stays mono-identity, coordination proven at
  the test layer only.
- **D2 — claim renewal semantics.** `CLAIM_NODE` today lets the SAME agent re-claim a
  valid lease (renewal — `mutation.ts`, the `existing.agentId !== m.agentId` guard).
  With real per-agent identity (D1 = yes) renewal is correct — keep it. If the demo stays
  mono-identity, renewal is a duplicate-work hole (two "main" workers both claim f1) —
  make claims non-reentrant as an interim. **Recommendation: accept D1, keep renewal.**
- **D3 — Studio dependencies.** W1-C needs `vite`, `sigma`, `graphology` (dev/studio
  only; SPEC already scopes graphology to studio). Rule 6 says every dependency is a
  decision — approve before install.

## Contract-change requests

*(append here during a wave; applied only at the wave boundary)*

- —

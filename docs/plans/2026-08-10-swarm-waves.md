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

> **STATUS: Wave 1 CLOSED 2026-08-10.** All four packages merged to main, final gate
> green (87 tests, build included). Bonus: W1-A's sweep surfaced a real race — post()'s
> version echo read state after the append await — fixed on main (`6073803`) before
> integration. Wave 2 additions pending Michael's ruling, from Wave 1 findings:
> (a) `blackboard_release` tool — RELEASE_NODE exists in core but is unreachable over
> MCP, so leases end only by TTL (→ W2-A or a new tool; W1-D finding);
> (b) SPEC catch-up: §4.1 apply signature, §6 envelope (protocolVersion/traceparent),
> §5 naming (`canMutate`→`checkAcl`, no claim.ts) — or code changes if the SPEC should
> win, notably claim.* taxonomy events are never emitted (W1-D finding);
> (c) log port follow/incremental-read for cross-process tailing — studio polls
> full-file reads today, seam isolated in `packages/studio/src/tail.ts` (W1-C request);
> (d) `graphology-layout-force` dep for poster-grade Studio layout (W1-C request).

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
Decision **D2** is ruled (2026-08-10): **renewal stays** — a same-agent re-claim extends
the lease and is correct behavior; cover it with a test as spec, don't "fix" it. This
package owns NO src paths; a genuine core bug goes in the report, not in a patch.
*Done:* repeated runs green and deterministic; property suite in CI.

**W1-B — DSL literal inference.** `defineNode` / `defineEdge` / `when()` carry full
literal prop inference so `when({ status: "pendig" })` is a **compile** error. Type-level
tests (vitest `expectTypeOf` / `@ts-expect-error`). No new runtime code paths; respect
core's ~1,000-line budget — this is the type-gymnastics allowance, spend it here only.
*Done:* the typo test fails to compile; runtime suite unchanged and green.

**W1-C — Studio skeleton.** Inside `packages/studio` only (no cli wiring this wave —
cli is unowned in Wave 1 on purpose): a dev server that tails a given `.ndjson` via
`ReadonlyLog`, streams records over SSE, and renders a live sigma.js graph (nodes appear
on `graph.mutation`, basic status coloring). Decision **D3** is approved (2026-08-10):
`vite`, `sigma`, `graphology` may be added — to `packages/studio` only.
*Done:* point it at a log file from a real `whipple3 mcp` run and watch the graph appear.

**W1-D — ADRs + docs.** Reconstruct the decision records the SPEC references (grep
`ADR-` in SPEC.md) and write them: pure event-sourced core, log-as-source-of-truth,
MCP-first transport, ULID ids, UDS deferral (ADR-005)… plus the three decided today:
identity-from-connection, two-sided ACL with logged denials, board-lifetime-as-parameter.
Refresh ARCHITECTURE.md to the post-Stage-1 reality (connect-bound identity, read
filtering, principal).
*Done:* a stranger can reconstruct WHY from docs alone; no stale W1 references anywhere.

---

## Wave 2 — LAUNCHED 2026-08-10 (after the pre-wave contract pass, `5df5111`)

Pre-wave contract pass already landed on main (rulings on the Wave-1 queue):
`blackboard_release` is the sixth tool; `claim.acquired/released` are emitted as
observational events (replay truth stays `graph.mutation`; `claim.expired` reserved for
the scheduler); SPEC §4.1/§5/§6 caught up to reality; cli split one-command-per-file —
`main.ts` is a FROZEN registry.

| Pkg | Mission | Owned paths | Needs |
|---|---|---|---|
| **W2-A** | Lifecycle: `whipple3 distill <log>` → report.md; explicit lifetime-gated purge; jsonl incremental read (port UNCHANGED) | `packages/transport-mcp/src/**` + `test/**`, `packages/cli/src/distill.ts`, `packages/log/**` | — |
| **W2-B** | Shared-state backend: `whipple3 serve` owns one session over UDS; `mcp --agent X` becomes a per-agent proxy; identity bound at socket connect | `packages/transport-uds/**` (new), `packages/cli/src/mcp.ts`, `packages/cli/src/serve.ts`, `packages/cli/test/**`, root workspace/depcruise config for the new package | — |
| **W2-C** | Studio live: claim tinting off `claim.*` events, click→history, time-travel scrubber over `replay`, force layout (`graphology-layout-force` approved) | `packages/studio/**` | — |
| **W2-D** | Role-declared slices in the schema DSL + pure slice honoring them — CORE ONLY; transport wiring is a Wave-3 boundary item | `packages/core/src/**` + `test/**` | — |
| **W2-E** | Plugin demo + fixer HITL gate; per-agent wiring over the serve backend | `examples/**` | W2-B merged |

W2-A must respect SPEC §4.8: purge is an explicit action triggered by the lifetime
policy, never an implicit end-of-session effect, and never core's business. W2-E
launches only after W2-B lands at the integration pass.

---

## Wave 3 — proof and launch (Stage 4)

- **W3-A** Benchmark harness (`tools/bench/**`): whipple3 vs. vanilla subagents; publish
  honest numbers. Needs W2-E.
- **W3-B** Packaging: npm publishConfig sanity, plugin version pinning, quickstart README.
- **W3-C** Launch checklist: LICENSE full name, GitHub org, npm org, v0.1.0 tag, post.
  (Open items live in Michael's memory + ROADMAP Stage 4.)

---

## Decisions — RULED by Michael, 2026-08-10

- **D1 ✅ APPROVED** (W2-B is green-lit) — **D2 ✅ keep renewal** — **D3 ✅ APPROVED**.

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

- **From W2-D (2026-08-10), for the Wave-3 contract pass** — role-slice transport wiring:
  1. `tools.ts` `blackboard_read`: remove/deprecate `depth`; a declared agent gets
     `sliceFor(state, root, decl, readableLabels(policy, agent))`, undeclared falls back
     to `readableNeighborhood` with a server-side default depth during migration.
  2. Session config grows `slices?: Readonly<Record<AgentId, SliceDecl>>` beside
     `AclPolicy` — schema file, never tool payload (§4.7: the agent never picks its scope).
  3. SPEC §4.7 one-sentence catch-up naming `sliceFor` as the declaration-bounded tier.

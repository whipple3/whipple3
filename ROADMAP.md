# whipple3 — Full Roadmap

Ordered by **dependency, not calendar**. Each stage lists what gets built, what "done" means,
and what must not leak in. Stages 0–3 are the product. Stages 4+ are optionality — they only
happen if the stage before them earned them.

Canonical design: `SPEC.md`. Working brief for the coding agent: `CLAUDE.md`.
Parallel-session execution plan: `docs/plans/2026-08-10-swarm-waves.md`.

---

## Stage 0 — Foundation ✅ DONE

The skeleton, green end to end.

- `@whipple3/core`: branded IDs, immutable `GraphState`, `apply()` reducer with optimistic
  versioning + claim/lease, `checkAcl`, `neighborhood` slicing, full event taxonomy,
  `Result`. One runtime dep: Zod.
- `@whipple3/log`: `LogStore` / `ReadonlyLog` ports, memory + NDJSON adapters, shared
  conformance suite running against both.
- `@whipple3/transport-mcp`: Zod schemas for the blackboard tools.
- `whipple3` CLI shell; Claude Code plugin example (scanner / auditor / fixer + `/audit`).
- CI gates: strict tsc, Biome, dependency-cruiser (core purity + import direction),
  Vitest + fast-check invariants.

**Done means:** `pnpm typecheck && lint && depcruise && test && build` all green.

---

## Stage 1 — First write to the graph ✅ CODE-COMPLETE (2026-08-10)

The moment it stops being documents.

1. ✅ **Identity hardening (do this first — it changes the tool schemas).** *(commit `3d750bf`)*
   - `agentId` removed from tool payloads; derived from the connection.
     stdio ⇒ one server process per agent (`whipple3 mcp --agent auditor-1`), declared in each
     subagent's frontmatter. This mirrors socket-per-agent in Stage 5 — right by design,
     not just convenient.
   - `principal` added to `EventMeta`; read once at session start from the local
     environment (`WHIPPLE3_PRINCIPAL` → OS user), with a hook for external injection later.
     Attribution is unreconstructable retroactively — this field is now-or-never.
1b. ✅ **Read-side ACL (added 2026-08-10 — same logic: cheap now, breaking later).** *(commit `f3c8d4f`)*
   - `AclPolicy` declares `{ write, read }` per agent; `checkRead` + `readableNeighborhood`
     filter slices **during traversal** — an unreadable node never leaks via an edge endpoint.
   - Every denial, read or write, is logged as an `acl.denied` event. Enforcement leaves
     a trail, never a silent drop.
2. ✅ **`session.ts` (imperative shell):** owns `GraphState`, a `LogStore`, an `AclPolicy`;
   injects time and ULID `txId`s; assembles `EventMeta` (causation/correlation/principal).
   Pipeline: parse (Zod) → `checkAcl` → `apply` → `append` → Result-shaped payload.
3. ✅ **`server.ts`:** stdio MCP server registering the tools. Structured errors, never prose.
   (Five at the time; `blackboard_release` landed in the Wave-2 contract pass — six total.)
4. ✅ **`blackboard_next`:** pull-mode query — nodes matching label + props, excluding
   nodes under a valid claim (and now: only for labels the agent may read).
5. ✅ **CLI:** `whipple3 mcp --agent <id>` starts the server against
   `.whipple3/session-<ts>.ndjson`.
6. ✅ **Integration tests** at the session layer: drive all the handlers, assert log contents
   *and* resulting state. 43 tests green.

**Done means:** a Claude Code subagent posts a node, a second one claims it, and the JSONL
log shows both with correct identity and causality.
**Status:** code-complete and e2e-tested over stdio; the live two-subagent run on a real
Claude Code host is the remaining checkbox — gated on the shared-state topology decision
(D1 in the waves plan).

**Not in this stage:** studio, scheduler, XState, UDS, OTel, sandboxes, DSL inference polish.

---

## Stage 2 — Parallel work that doesn't collide

The coordination claim, proven.

- Three auditor subagents running concurrently against one blackboard: claims, lease
  expiry on abandonment, zero duplicate work.
- Fixer with a HITL approval gate before any file write.
- `distill()` → `report.md`; graph purged; trace log retained (the three-tier lifecycle).
- Schema DSL polish: full literal inference so `when({ status: "pendig" })` is a
  compile error. This is where the type-gymnastics budget is spent.
- Slice tuning: role-declared slices in the schema, replacing raw BFS depth.

**Done means:** repeated parallel runs produce zero duplicate claims and zero lost updates,
and the run completes without an orchestrator babysitting it.

---

## Stage 3 — Studio: the thing people screenshot

The adoption driver. This is the stage that decides whether anyone ever hears about whipple3.

- Vite + vanilla TS + sigma.js over graphology, fed by SSE from `ReadonlyLog`.
  graphology lives only here.
- Live graph: nodes appear as agents post, colors change with status, claims tinted by
  holding agent.
- Click a node → its mutation history and the agent that produced it.
- **Time-travel scrubber** — replay the session from the log. Free consequence of the
  pure reducer; the single most demo-able feature in the project.
- `whipple3 studio` command; `whipple3 replay <log>` for post-mortems.

**Done means:** a 20-second screen recording that makes a stranger understand the product
without narration.

---

## Stage 4 — Proof and launch

Claims become measurements.

- **Benchmark harness:** same audit task, whipple3 vs. vanilla subagents (everything funneled
  through parent summaries). Measure orchestrator-context tokens, wall time, findings
  quality, duplicate work. Target: ≥40% context-token reduction at equal quality.
  **Publish the numbers honestly, including where we lose.**
- Docs: README with the 10-minute quickstart, ARCHITECTURE, ADRs 001–006, API reference.
- Package the Claude Code plugin properly; pin minimum supported version.
- Publish to npm (locks the name), tag v0.1.0, write the launch post.
- Legal/admin hygiene: full name in LICENSE, npm + GitHub org, DCO vs. CLA finalized
  before accepting substantial external contributions.

**Done means:** installable by a stranger in under 10 minutes, with numbers to argue about.

---

## Stage 5 — Host-agnostic

Turning "not locked to any vendor" from a claim into a recording.

- Same server against Codex CLI, Gemini CLI, opencode, Cursor — one page of results per host.
- **UDS transport** (`@whipple3/transport-uds`): socket-per-agent, NDJSON, identity from the
  socket. Needed once whipple3 runs processes we spawn ourselves.
  *(A minimal shared-state backend may be pulled forward to Stage 2 — see D1 in the
  waves plan: per-agent identity on a real host needs it.)*
- `SandboxProvider` port: dockerode adapter first; E2B / Daytona / NanoClaw-pattern adapters
  after. We ride the execution layer, we never rebuild it.

**Done means:** a compatibility table in the README where every row is a real run.

---

## Stage 6 — Push mode: whipple3 runs the loop

The step from "radio dispatch" to automatic matching. Only worth doing if Stages 1–4 found users.

- **Scheduler:** matching → per-agent queues → dispatch; concurrency caps, batching,
  backpressure. XState for the agent lifecycle state machine
  (idle → triggered → working → done/failed).
- **Failure semantics:** retries with idempotency, lease expiry, dead-letter, hop budgets
  and cycle detection off the causation chain.
- **Quiescence detection:** all agents idle ∧ queues empty ∧ nothing in flight ∧ settle
  window — the honest version of "the task is finished."
- `ModelProvider` port via Vercel AI SDK → OpenRouter / any provider. BYOM, including
  cheap-model fleets: small typed slices and schema validation lower the intelligence bar
  per agent.
- `when()` compiles to real push subscriptions; the same schema serves both dispatch modes.

**Done means:** a session that runs to completion with no external orchestrator, and
survives a killed agent mid-task.

---

## Stage 7 — Observability & evals

Emit, don't store. Both are adapters because the event taxonomy was reserved on day one.

- `@whipple3/otel`: OTel GenAI semantic-convention spans → Langfuse / Jaeger / console.
- `@whipple3/evals`:
  1. **Deterministic replay tests** — session logs as fixtures + VCR-style LLM
     record/replay; coordination regressions caught in CI with zero API calls.
  2. **Trajectory assertions over typed state** — the novel tier:
     `expect(final).toSatisfy(CodeFile.all({ status: "audited" }))`,
     `expect(trace).maxHops(5)`, `expect(session.cost).lessThan(x)`.
     Existing eval tools judge text; whipple3 judges structured state trajectories.
  3. **LLM-as-judge** on distilled output — commodity, pluggable scorer interface.
- SQLite log adapter (prefer built-in `node:sqlite`), passing the same conformance suite.

**Done means:** a coordination regression is caught by CI before a human notices it.

---

## Stage 8 — Ecosystem

The project stops being one person's.

- Schema/agent templates beyond code audit: research pipelines, content workflows,
  data QA, migration sweeps.
- Adapters so whipple3 is usable *from* Mastra / AgentKit rather than instead of them.
- Contributor path: good-first-issues, ADR discipline, release cadence via changesets.
- Talks and writeups: the Redux analogy for one audience, "Gett of the harnesses" for another.

**Done means:** a meaningful PR lands from someone you've never met.

---

## Stage 9 — Commercial optionality

Only if Stage 8 produced real teams. **Nothing below ever enters the MIT repo** — the moat
is the discipline, not the license.

The line is not "how much" but **one vs. many**. The core stays complete and unlimited forever.

| Free forever (OSS) | Commercial |
|---|---|
| Local session, log on disk | Fleet-wide logs: developers + CI in one place |
| `canMutate` in a repo file | Central policy distribution to every session |
| `agentId` verified against the connection | SSO → role mapping, service accounts |
| `principal` from local environment | Verified on-behalf-of, org identity |
| Single-session trail | **Cross-session activity view by identity** |
| Local replay tests | Trajectory regression suites across the team |
| Local Studio | Retention, search, SIEM export, cost attribution |

**First sellable thing:** not a platform — one dashboard answering *"what did our agents do
this week, under which policy, and what got blocked."* Buyer: platform / AI-infra lead,
with security behind them. It sells because of the choke point already in the code:
every state change passes `checkAcl` → `apply` → `append`. Frameworks where agents talk in
free text cannot sell governance — they have no enforcement point.

Path: adoption → design partners → product. Never the reverse. Interim revenue, if any, is
consulting and sponsorship — and the primary goal remains employment.

---

## Standing rules across every stage

1. **Core stays pure.** No I/O, no clocks, no randomness, no `node:` imports. CI enforces it.
2. **The log is the source of truth.** Every capability downstream — studio, replay, evals,
   audit — depends on this and on nothing else.
3. **We never build the execution layer.** Sandboxes, credential gateways, model runtimes:
   adapters only.
4. **No LLM-facing query language.** Constrained typed tools only.
5. **The graph is the control plane.** Paths and hashes, never blobs.
6. **Every dependency is a decision.** Core: Zod only. Elsewhere: justify or don't add it.
7. **Abstraction only at the ports.** Rule of three everywhere else. Core under ~1,000
   lines; no file over ~200.
8. **Nothing potentially commercial ships under MIT.** Once released, it's released.

# Forge Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `whipple3 pr open|check|merged` and `whipple3 merge` — the board refuses a merge whose files another branch still holds, and records every PR as a node.

**Architecture:** No core semantics change. `Slice` gains a `claims` field (raw `ClaimRecord`s for nodes in the slice; expiry is the reader's judgement) so a read-only gate can see holders. PRs are ordinary `PullRequest` nodes with `touches` edges to the existing `File` nodes. CLI commands reuse `files.ts` (`withBoard`, `fileNodeId`, exit codes). Design: `docs/plans/2026-09-05-forge-gate-design.md`.

**Tech Stack:** TypeScript strict, citty, vitest (+ fast-check in core), pnpm workspace. Build before CLI e2e: `pnpm build` (tests spawn `packages/cli/dist/main.js`).

**Conventions (CLAUDE.md):** functions < 25 lines, early returns, no `as` casts, no comments that restate code. One commit per task. Run `pnpm typecheck && pnpm lint` before each commit.

---

### Task 1: `Slice.claims` — the slice reports who holds what

**Files:**
- Modify: `packages/core/src/slice.ts` (interface at line 11, `bfs` return at ~line 79, `sliceFor` return)
- Test: `packages/core/test/slice.test.ts`

**Step 1: Write the failing test** (append to `slice.test.ts`)

```ts
describe("Slice.claims — holders travel with the slice (forge gate D7)", () => {
  const claimed = (): GraphState =>
    mustApply(seeded(), {
      kind: "CLAIM_NODE", id: nodeId("f1"), agentId: agentId("feat/a"), now: 0, ttlMs: 1000,
    });

  it("a claim on a node in the slice is in slice.claims, raw, with expiresAt", () => {
    const s = neighborhood(claimed(), nodeId("f1"), 0);
    expect(s.claims).toEqual([{ nodeId: nodeId("f1"), agentId: agentId("feat/a"), expiresAt: 1000 }]);
  });

  it("a claim on a node OUTSIDE the slice never appears", () => {
    const s = neighborhood(claimed(), nodeId("i1"), 0);
    expect(s.claims).toEqual([]);
  });

  it("property: every claim in a readable slice names a node of that slice", () => {
    fc.assert(
      fc.property(fc.constantFrom("CodeFile", "SecurityIssue"), (label) => {
        const s = readableNeighborhood(claimed(), nodeId("f1"), 2, [label]);
        const ids = new Set(s.nodes.map((n) => n.id));
        return s.claims.every((c) => ids.has(c.nodeId));
      }),
    );
  });
});
```

Check the exact `CLAIM_NODE` mutation field names in `packages/core/src/mutation.ts:26-35` and adjust.

**Step 2: Run it** — `pnpm vitest run packages/core/test/slice.test.ts`
Expected: FAIL, `claims` undefined / type error.

**Step 3: Implement** in `slice.ts`

```ts
import type { ClaimRecord, EdgeRecord, GraphState, NodeRecord } from "./state.js";

export interface Slice {
  readonly nodes: readonly NodeRecord[];
  readonly edges: readonly EdgeRecord[];
  /** Raw claim records for nodes in the slice. Expiry is the reader's call: compare expiresAt. */
  readonly claims: readonly ClaimRecord[];
}

const claimsOn = (state: GraphState, ids: ReadonlySet<NodeId>): readonly ClaimRecord[] =>
  [...state.claims.values()].filter((c) => ids.has(c.nodeId));
```

In `bfs`: `return { nodes, edges, claims: claimsOn(state, seen) };`
In `sliceFor`: the empty early-return becomes `{ nodes: [], edges: [], claims: [] }`; the final return adds `claims: claimsOn(state, seen)` (it already tracks a `seen` set).

**Step 4: Fix every other `Slice` literal.** `pnpm typecheck` lists them (studio, transport-mcp tests, assert). Add `claims: []` where a slice is hand-built.

**Step 5: Run** `pnpm typecheck && pnpm lint && pnpm vitest run packages/core` — all green.

**Step 6: Commit**
```bash
git add packages/core packages/**/test
git commit -m "core: Slice.claims — holders travel with the slice"
```

---

### Task 2: `pr open` — a PR is a node, its files are edges, its claims are renewed

**Files:**
- Create: `packages/cli/src/pr.ts`
- Modify: `packages/cli/src/files.ts` (export `touchesEdgeId`, `prNodeId`)
- Modify: `packages/cli/src/main.ts` (register `pr`)
- Test: `packages/cli/test/pr.e2e.test.ts`

**Step 1: Failing e2e test.** Copy the harness (imports, `run`, `waitFor`, `beforeAll` with `serve`) from `claim.e2e.test.ts` verbatim; tmp prefix `w3pr-`. Then:

```ts
describe("whipple3 pr open — the PR node, its touches edges, its claims", () => {
  it("records the PR and claims its paths, exit 0", async () => {
    const r = await run(cwd, "pr", "open", "src/a.ts", "src/b.ts", "--agent", "feat/a", "--number", "12");
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("pr 12 opened\nclaimed src/a.ts\nclaimed src/b.ts\n");
    expect(r.code).toBe(0);
  });

  it("a path another branch holds: PR still recorded, holder named, exit 2", async () => {
    await run(cwd, "claim", "src/c.ts", "--agent", "feat/b");
    const r = await run(cwd, "pr", "open", "src/c.ts", "--agent", "feat/a", "--number", "13");
    expect(r.stdout).toBe("pr 13 opened\nheld src/c.ts by feat/b\n");
    expect(r.code).toBe(2);
  });

  it("opening the same number twice is idempotent", async () => {
    const r = await run(cwd, "pr", "open", "src/a.ts", "--agent", "feat/a", "--number", "12");
    expect(r.stdout).toBe("pr 12 opened\nclaimed src/a.ts\n");
    expect(r.code).toBe(0);
  });
});
```

**Step 2: Run** `pnpm build && pnpm vitest run packages/cli/test/pr.e2e.test.ts` — FAIL (unknown command).

**Step 3: Implement.** In `files.ts` add:

```ts
export const PR_LABEL = "PullRequest";
export const TOUCHES_LABEL = "touches";
export const prNodeId = (n: number): string => `pr:${n}`;
export const touchesEdgeId = (n: number, path: string): string => `touches:${prNodeId(n)}->${fileNodeId(path)}`;
export const prArgs = {
  ...fileArgs,
  number: { type: "string", description: "Pull request number.", required: true },
  url: { type: "string", description: "Pull request URL (recorded, not fetched)." },
} as const;
```

`pr.ts` — one `defineCommand` with `subCommands: { open, check, merged }`. `open`:

```ts
const ensureNode = async (board: RemoteAgentConnection, mutation: Mutation): Promise<boolean> => {
  const r = await board.post({ mutation });
  return r.ok || r.error.code === "NODE_EXISTS" || r.error.code === "EDGE_EXISTS";
};

const openPr = async (board: RemoteAgentConnection, n: number, branch: string, url?: string) =>
  ensureNode(board, { kind: "ADD_NODE", id: prNodeId(n), label: PR_LABEL,
    props: { number: n, branch, url: url ?? null, state: "open" } });

const touch = async (board: RemoteAgentConnection, n: number, path: string): Promise<boolean> => {
  const file = await ensureNode(board, { kind: "ADD_NODE", id: fileNodeId(path), label: FILE_LABEL, props: { path } });
  if (!file) return false;
  return ensureNode(board, { kind: "ADD_EDGE", id: touchesEdgeId(n, path), label: TOUCHES_LABEL,
    from: prNodeId(n), to: fileNodeId(path) });
};
```

`run`: parse `number` (NaN ⇒ stderr + exit 1), then `withBoard(args, async (board, path, me) => …)`. `withBoard` iterates per path, so open the PR node once before the loop: add an optional `before?: (board) => Promise<boolean>` hook to `withBoard` (false ⇒ exit 1, skip paths), print `pr <n> opened`, then per path: `touch` then the same claim/held/error branch as `claim.ts` — extract that branch from `claim.ts` into `claimPath(board, path, ttlMs): Promise<Outcome>` in `files.ts` and call it from both. Nodes/edges/claims are all `graph.mutation` events — nothing new in the log taxonomy.

**Step 4: Run** build + test — PASS. Also `pnpm vitest run packages/cli/test/claim.e2e.test.ts` still green (the extraction).

**Step 5: Commit**
```bash
git add packages/cli
git commit -m "cli: whipple3 pr open — a pull request is a node with touches edges"
```

---

### Task 3: `pr check` — the read-only gate

**Files:** `packages/cli/src/pr.ts`, `packages/cli/test/pr.e2e.test.ts`

**Step 1: Failing test**

```ts
describe("whipple3 pr check — clear only when every touched file is free or mine", () => {
  it("held by another branch ⇒ names holder, exit 2", async () => {
    const r = await run(cwd, "pr", "check", "--agent", "feat/a", "--number", "13");
    expect(r.stdout).toBe("held src/c.ts by feat/b\n");
    expect(r.code).toBe(2);
  });
  it("all mine ⇒ clear, exit 0", async () => {
    const r = await run(cwd, "pr", "check", "--agent", "feat/a", "--number", "12");
    expect(r.stdout).toBe("clear\n");
    expect(r.code).toBe(0);
  });
  it("unknown PR ⇒ exit 1", async () => {
    const r = await run(cwd, "pr", "check", "--agent", "feat/a", "--number", "99");
    expect(r.stderr).toContain("no such pr");
    expect(r.code).toBe(1);
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement.** `check` takes no paths, so it does not use `withBoard`'s loop; it connects the same way (factor `connectOrExit(args)` out of `withBoard`). Then:

```ts
const holdersOf = (slice: Slice, me: AgentId, now: number): readonly [string, AgentId][] =>
  slice.claims
    .filter((c) => c.expiresAt > now && c.agentId !== me)
    .map((c) => [pathOf(slice, c.nodeId), c.agentId]);

const pathOf = (slice: Slice, id: NodeId): string => {
  const node = slice.nodes.find((n) => n.id === id);
  return typeof node?.props.path === "string" ? node.props.path : String(id);
};
```

`run`: `const r = await board.read({ root: prNodeId(n) })`; not ok or `nodes` lacks the PR node ⇒ stderr `no such pr <n>`, exit 1. Otherwise `holdersOf(r.value, me, Date.now())`: empty ⇒ print `clear`, exit 0; else one `held <path> by <holder>` line each, exit 2. Confirm `DEFAULT_READ_DEPTH ≥ 1` in `connection.ts` so the Files are in the slice.

**Step 4: Run** — PASS. **Step 5: Commit** `cli: whipple3 pr check — the read-only merge gate`.

---

### Task 4: `pr merged` — state flips, claims go back

**Step 1: Failing test**

```ts
describe("whipple3 pr merged — releases the branch's files, marks the node", () => {
  it("releases every touched path held by me, exit 0", async () => {
    const r = await run(cwd, "pr", "merged", "--agent", "feat/a", "--number", "12");
    expect(r.stdout).toBe("pr 12 merged\nreleased src/a.ts\nreleased src/b.ts\n");
    expect(r.code).toBe(0);
    const again = await run(cwd, "claim", "src/a.ts", "--agent", "feat/b");
    expect(again.code).toBe(0);
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement.** Read the slice as in `check`; the PR node's `version` feeds `UPDATE_NODE { id, expectedVersion: node.version, props: { state: "merged" } }` (a `VERSION_CONFLICT` ⇒ stderr, exit 1 — someone else moved it). Then for every `touches` edge from the PR, `board.release({ id: edge.to })`; `CLAIM_NOT_HELD` is fine (print `not held <path>`, outcome stays `ok` — a file another branch took over is not our failure). Print `released <path>` per success.

**Step 4: Run** — PASS. **Step 5: Commit** `cli: whipple3 pr merged — hand the files back`.

---

### Task 5: `whipple3 merge` — check → forge → merged, fail closed

**Files:** Create `packages/cli/src/merge.ts`; register in `main.ts`; test in `pr.e2e.test.ts`.

**Step 1: Failing test**

```ts
describe("whipple3 merge — gate, forge command, release; stops at the first failure", () => {
  it("held ⇒ forge command never runs, exit 2", async () => {
    await run(cwd, "pr", "open", "src/d.ts", "--agent", "feat/a", "--number", "14");
    await run(cwd, "pr", "merged", "--agent", "feat/a", "--number", "14"); // free d
    await run(cwd, "claim", "src/d.ts", "--agent", "feat/b");
    const marker = join(cwd, "ran");
    const r = await run(cwd, "merge", "--agent", "feat/a", "--number", "14", "--", "touch", marker);
    expect(r.code).toBe(2);
    expect(existsSync(marker)).toBe(false);
  });
  it("clear ⇒ forge command runs, then merged; a failing forge leaves claims held", async () => {
    await run(cwd, "pr", "open", "src/e.ts", "--agent", "feat/a", "--number", "15");
    const bad = await run(cwd, "merge", "--agent", "feat/a", "--number", "15", "--", "false");
    expect(bad.code).toBe(1);
    expect((await run(cwd, "claim", "src/e.ts", "--agent", "feat/b")).code).toBe(2);
    const good = await run(cwd, "merge", "--agent", "feat/a", "--number", "15", "--", "true");
    expect(good.stdout).toContain("pr 15 merged");
    expect(good.code).toBe(0);
  });
});
```

**Step 2: Run** — FAIL.

**Step 3: Implement** `merge.ts`: args = `prArgs` minus paths, plus positional rest = forge command, default `["gh", "pr", "merge", String(n)]`. Steps, each an early return on failure:
1. `check` logic (import the function from `pr.ts`, do not shell out to self) ⇒ exit 2 on held.
2. `spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" })`; non-zero ⇒ exit 1, claims untouched.
3. `merged` logic.

No `--no-board`: the board being unreachable is exit 1 by `connectOrExit`, and that is the fail-closed contract. (Design D4's bypass flag is YAGNI until a host asks.)

**Step 4: Run** — PASS. **Step 5: Commit** `cli: whipple3 merge — the gate in front of the forge`.

---

### Task 6: The log proves it — replay, assert, distill

**Files:** `packages/cli/test/pr.e2e.test.ts`

**Step 1: Test** (append): after the suite above, find the session log (`.whipple3/session-*.ndjson` in `cwd`), run `replay` on it (exit 0, no violations), and with `@whipple3/assert`:

```ts
const session = await sessionFromLog(logPath);
expect(run(session, [none("PullRequest", { state: "open" }), allClaimsReleased()])).…  // mirror the assert README usage
```

Note PR 13 is still open (never merged) — either merge it in the test first, or assert `atLeast(2, "PullRequest", { state: "merged" })` instead. Check the exact API in `packages/assert/src/index.ts`.

**Step 2–4:** run, fix, commit `test: the forge gate leaves a log replay and assert accept`.

---

### Task 7: Docs

- `README.md`: a short "Merge gate" section after step 5 (the seven-step run from the design §5, as commands).
- `CHANGELOG.md`: Unreleased — `Slice.claims`; `pr open|check|merged`; `merge`.
- `ROADMAP.md` Stage 5: one bullet "Forge gate shipped; Origin adapter waits on their API".
- Commit `docs: forge gate`.

**Done means:** `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm build && pnpm test` green; the seven-step demo runs by hand against a real `gh` repo.

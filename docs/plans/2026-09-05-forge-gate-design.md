# Forge gate — the board as the merge queue's authority check

**Status:** Accepted 2026-09-05 (option 1 of three; option 2 "review primitives on the board" follows if this finds users)
**Trigger:** Cursor Origin (beta 2026-08-17) ships agent-scale git hosting — stacked PRs, agent-aware merge queue, agents subscribed to their own PRs — and says nothing about agent identity, authority, or conflicts between parallel agents. Same hole DeepSeek Harness declared a non-goal. whipple3 already has the primitive that fills it (`whipple3 claim` / `release`, identity = branch). This design connects that primitive to the forge.

## 1. What it does, in one paragraph

An agent working on a branch holds claims on the files it edits (existing PreToolUse hook). When it opens a PR, the PR becomes a node on the board, linked to those File nodes. Before a merge, a gate asks the board: *is every file in this PR free, or held by this branch?* Held by another branch ⇒ the merge is refused with the holder named. A merge releases the branch's claims. The event log now records, per PR, which files it touched, who else was holding them, and when the hold ended — the audit trail no forge produces.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Identity is the branch.** A PR is a *property* of the branch's work, not an identity. | Claims exist before a PR does. One socket per branch already holds (ADR-007). A PR number as identity would break `IDENTITY_IN_USE` protection for the pre-PR window. |
| D2 | **No new event type.** PRs are ordinary nodes: `ADD_NODE` label `PullRequest`, edges `touches` → File. | Core stays untouched. `replay`, `distill`, `assert`, Studio all see PRs for free. A `pr.*` taxonomy would be a second truth. |
| D3 | **The gate runs where the board runs.** `whipple3 merge` wraps `gh pr merge` (and later Origin's CLI) locally. A GitHub Action variant waits for a `persistent` board (ADR-009) — not this stage. | The board is a UDS socket on one machine; cloud CI cannot dial it. Pretending otherwise is the sync problem option 2 was rejected for. |
| D4 | **Fail closed.** Board unreachable ⇒ exit 1, no merge. `--no-board` bypasses explicitly and prints that it did. | A gate that silently opens is decoration. |
| D5 | **File-level claims, knowingly coarse.** Two agents on different functions of one file block each other. | Correct by construction beats clever-and-wrong. Finer grain is a later schema, not a v1 change. |
| D6 | **Claims are ephemeral; the PR node is not the claim.** A merged/closed PR node stays in the log; the claim lives only while the agent works. | Three-tier lifecycle (SPEC §4.3). The gate checks *live* holds; the audit question ("who touched this in the session") is answered from the log. |
| D7 | **`read` learns to report holders.** `Slice` gains `claims: ClaimRecord[]` for nodes in the slice. | Today only `claim` reveals a holder, and it does so by taking the lease. A read-only gate cannot have a side effect. Additive, ACL-filtered like everything else in the slice. |

## 3. Surface

Three CLI commands beside `claim` / `release` in `packages/cli/src`:

```
whipple3 pr open   --agent <branch> --number <n> [--url <u>] <paths…>
    ADD_NODE PullRequest {id: pr:<n>, props: {number, branch, url, state: "open"}}
    ADD_EDGE touches pr:<n> → file:<path>   (File node created on first sight, as claim does)
    claim <paths…> as <branch>              (renew; a held path ⇒ exit 2, PR still recorded)

whipple3 pr check  --agent <branch> --number <n>
    read pr:<n> + touched Files with claims
    every File free or held by <branch>  ⇒ exit 0, prints "clear"
    any File held by another             ⇒ exit 2, prints "held <path> by <holder>"
    board unreachable / no such PR       ⇒ exit 1

whipple3 pr merged --agent <branch> --number <n>
    UPDATE_NODE pr:<n> state: "merged"
    release every touched File held by <branch>
```

`whipple3 merge --agent <branch> --number <n> [-- <gh args>]` = `pr check` → `gh pr merge <n> …` → `pr merged`. One command for the demo; the three parts stay separately callable for hosts that own the merge.

Exit codes follow `files.ts`: 0 ok, 2 held, 1 error.

## 4. Schema

```ts
defineNode("PullRequest", { number: z.number().int(), branch: z.string(),
  url: z.string().url().optional(), state: z.enum(["open", "merged", "closed"]) })
defineEdge("touches", { from: "PullRequest", to: "File" })
```

ACL: a branch identity may write `PullRequest` and `File`; the default policy grants it. The merge gate needs only read.

## 5. Data flow (demo run)

1. `whipple3 serve` — board up.
2. Agent A on branch `a` edits `src/pay.ts` → hook claims `file:src/pay.ts` as `a`.
3. Agent B on branch `b` tries to edit `src/pay.ts` → hook exit 2, "held by a". B is stopped **before** a conflict exists in git.
4. A: `whipple3 pr open --agent a --number 12 src/pay.ts` → PR node, edge, claim renewed.
5. `whipple3 merge --agent a --number 12` → check clear → `gh pr merge 12` → node merged, claim released.
6. B retries, claim succeeds, proceeds.
7. `whipple3 distill` shows PR 12 touched one file, held by `a` from t₁ to t₂, refused `b` once.

## 6. Error handling

- `pr open` on a held path: the PR node and edge are still written (they are facts); exit 2 tells the caller the merge will not clear until the holder releases.
- `pr check` with an expired claim held by another branch: expired ⇒ free, consistent with the reducer.
- `pr merged` when `gh pr merge` failed: not called — `merge` stops at the first non-zero step and leaves the claim held.
- Second `pr open` for the same number: `NODE_EXISTS` is not an error; edges are upserted.

## 7. Testing

- **Session-layer integration** (like `claim.ts` tests): open → check clear; a rival claim → check exit 2 naming the holder; merged → files released, node state `merged`.
- **Slice contract:** `read` returns claims only for nodes in the ACL-filtered slice (property test: no claim whose node is unreadable).
- **CLI e2e** over the built `dist/main.js` against a `serve` board: the seven-step demo run, asserted with `@whipple3/assert` (`allClaimsReleased`, `none(PullRequest, {state: "open"})`).
- **replay** must still pass on the produced log (no core change, so it should by construction — the test proves it).

## 8. Out of scope (option 2 and beyond)

Review comments and verdicts as nodes; reviewer/fixer ACL split; Origin API adapter (undocumented as of 2026-09-05); persistent board so a cloud merge queue can dial it; sub-file claims.

# Review on the board — typed review primitives behind the merge gate

**Status:** Accepted 2026-09-05 (option 2; option 1 = `docs/plans/2026-09-05-forge-gate-design.md`, shipped)
**Thesis:** A forge stores review as threads of prose. The board stores it as typed state with an ACL: who may issue a verdict, who may only address a comment, and a merge gate that reads the state instead of a human reading the thread. `@whipple3/assert` then proves in CI that no merge preceded its approval.

## 1. Split, not sync

The forge keeps **human** review; the board keeps **agent** review. Nothing is imported from the forge and nothing is required to be exported. Branch protection on GitHub still enforces the human side at merge time; `whipple3 merge` enforces the board side before the forge is called. No two copies of one thread, so no sync bug. (One-way export of a verdict via `gh pr review` is a later flag, not this stage.)

## 2. Schema

```ts
defineNode("Review",        { pr: int, reviewer: string, verdict: "approve" | "request_changes" })
defineNode("ReviewComment", { pr: int, path: string, line?: int, body: string,
                              severity: "blocking" | "nit", status: "open" | "addressed" | "wontfix" })
defineEdge("reviews",     { from: "Review",        to: "PullRequest" })
defineEdge("comments_on", { from: "ReviewComment", to: "File" })
defineEdge("part_of",     { from: "ReviewComment", to: "PullRequest" })
```

Ids: `review:<pr>:<reviewer>` (one node per reviewer per PR; a new verdict is an `UPDATE_NODE`, so the log keeps the history and the state keeps the latest), `comment:<pr>:<slug>`.

Everything is `graph.mutation`; no new event type (same rule as option 1).

## 3. Authority — the ACL is the product

`examples/review-policy.json`:

| identity | read | write |
|---|---|---|
| `reviewer-*` | File, PullRequest, ReviewComment, Review | Review, ReviewComment |
| branch (fixer) | File, PullRequest, ReviewComment, Review | File, PullRequest, ReviewComment |

The verdict label is reviewer-only: a branch that tries to approve itself is refused and the refusal is an `acl.denied` in the log. What label-level ACL cannot say: "the branch may *update* a comment's status but not *create* one." Accepted and stated; a per-mutation-kind ACL is a later schema, not this stage.

## 4. The gate rule

`pr check` (and therefore `merge`) adds one read of the same slice it already fetches:

- any `Review` on the PR with `verdict: request_changes` ⇒ `changes requested by <reviewer>`, exit 2
- any `ReviewComment` on the PR with `severity: blocking` and `status: open` ⇒ `blocking: <id> <path>`, exit 2
- otherwise the file-hold rule as today.

**No review is not a failure.** A PR nobody reviewed on the board passes the board (the forge's own protection still applies). Requiring at least one approval is a policy question; expose it as `--require-approval` only when a host asks.

## 5. Surface

```
whipple3 review  --agent <reviewer> --number <n> --verdict approve|request_changes
whipple3 comment --agent <reviewer> --number <n> --path <p> [--line <l>] [--severity blocking|nit] <body>
whipple3 comment addressed|wontfix --agent <branch> --number <n> <comment-id…>
```

MCP agents (the reviewer subagent) post the same nodes through `blackboard_post`; the CLI is the shell's door, same as `claim`.

## 6. Proof

`@whipple3/assert`: `approvedBeforeMerge()` — for every `PullRequest` whose state became `merged`, a `Review` with `verdict: approve` for that PR precedes that mutation in the log, and no `request_changes` follows it. `noDenials()` already proves nobody wrote outside their lane.

## 7. Example

`examples/claude-code-plugin/agents/reviewer.md` + `examples/review-policy.json`: the reviewer reads the PR slice, reads each touched file, posts comments and one verdict, never edits a file. The branch's agent addresses comments. `whipple3 merge` is the last word.

## 8. Out of scope

Importing forge threads; exporting verdicts; per-mutation-kind ACL; `--require-approval`; Origin adapter (undocumented API); sub-file claims.

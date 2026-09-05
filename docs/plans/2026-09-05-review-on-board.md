# Review on the Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Review verdicts and comments as typed nodes with an ACL, read by the merge gate, provable by `@whipple3/assert`.

**Architecture:** No core change. A pure `reviewGate(slice, n)` in the CLI decides from the slice `pr check` already reads; `review` and `comment` are shell doors that post the same nodes an MCP agent would. Design: `docs/plans/2026-09-05-review-on-board-design.md`.

**Tech Stack:** TypeScript strict, citty, vitest. Build before CLI e2e. Conventions per CLAUDE.md; `pnpm typecheck && pnpm lint` before each commit.

---

### Task 1: `reviewGate` — a pure rule over the slice

**Files:** Create `packages/cli/src/review-gate.ts`; Test `packages/cli/test/review-gate.test.ts` (unit, no board); Modify `packages/cli/src/files.ts` (ids/labels), `packages/cli/src/pr.ts` (`checkPr` calls it first).

Test: build a `Slice` by hand (`{nodes, edges, claims: []}`) with a PR 7, a Review `request_changes` → returns `["changes requested by rev-1"]`; a blocking open comment → `["blocking: comment:7:x src/a.ts"]`; addressed blocking + approve → `[]`; nit open → `[]`; no reviews → `[]`.

Impl: `reviewGate(slice, n): readonly string[]` — filter nodes by label and `props.pr === n`. In `checkPr`: print each line, return `"held"` if any (exit 2 stays the "not clear" code), before the file-hold check.

Commit: `cli: reviewGate — verdicts and blocking comments stop the merge`.

### Task 2: `whipple3 review`

e2e in `pr.e2e.test.ts`: `review --agent rev-1 --number 12 --verdict request_changes` ⇒ `review 12: request_changes by rev-1`, exit 0; then `pr check --agent feat/a --number 12` ⇒ `changes requested by rev-1`, exit 2; `review … --verdict approve` ⇒ check clear (files were released earlier — open a fresh PR 16 for this block). Bad verdict ⇒ exit 1. Impl: `ADD_NODE review:<n>:<agent>` (NODE_EXISTS ⇒ read version, `UPDATE_NODE`), `ADD_EDGE reviews`. Commit `cli: whipple3 review`.

### Task 3: `whipple3 comment` and `comment addressed|wontfix`

e2e: `comment --agent rev-1 --number 16 --path src/f.ts --severity blocking "null check"` ⇒ prints `comment:16:null-check`, exit 0; check ⇒ `blocking: comment:16:null-check src/f.ts`, exit 2; `comment addressed --agent feat/a --number 16 comment:16:null-check` ⇒ check clear. Slug: lowercase, non-alnum → `-`, ≤ 40 chars. Edges `part_of` → PR and `comments_on` → File (ensureFile). Commit `cli: whipple3 comment`.

### Task 4: ACL proves the lane

e2e with `serve --policy examples/review-policy.json` in a second tmp dir: `review --agent feat/x --verdict approve` ⇒ exit 1, stderr contains `ACL`; log contains an `acl.denied`. Create `examples/review-policy.json` (table in design §3; identities `reviewer-1`, `feat/*` is not a glob — list `feat/x` for the test and document that policies name identities exactly). Commit `examples: review policy — the verdict is reviewer-only`.

### Task 5: `approvedBeforeMerge` in `@whipple3/assert`

Unit test over hand-built records (`sessionFrom`): merged PR with an earlier approve ⇒ ok; merged with no approve ⇒ fail naming the PR; approve then request_changes then merged ⇒ fail. Impl: walk `records` in order tracking latest verdict per PR; on `UPDATE_NODE` of `pr:<n>` with `state: "merged"` check it. Export from index; README of assert one line. Commit `assert: approvedBeforeMerge`.

### Task 6: Reviewer agent example + docs

`examples/claude-code-plugin/agents/reviewer.md` (mirror auditor.md's shape: tools list with `blackboard_read`/`blackboard_post` only, loop: read PR slice → Read files → post comments → post verdict; rules: never Edit). README: "Review on the board" paragraph after the merge-gate block with the three commands and the assert line. CHANGELOG + ROADMAP bullet. Commit `docs: review on the board`.

**Done means:** full gate green; the e2e suite runs review → comment → addressed → approve → merge on one board and `approvedBeforeMerge` accepts its log.

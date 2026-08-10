# v0.1.0 release checklist

Ordered by dependency — each phase gates the next. `[Michael]` = needs his credentials,
identity, or judgment; `[automatable]` = a Claude session can do it end-to-end (Michael
still reviews the diff/output).

## 0. Repo truth (before anything leaves the machine)

- [ ] **[automatable]** Wave 3 integration pass merged (W3-A bench, W3-B packaging,
      W3-C launch kit); full gate green from a clean clone:
      `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test && pnpm build`.
- [x] **[automatable]** Stale-doc sweep (done 2026-08-11): the two items originally
      listed here (root README tool count, plugin README `--policy`) turned out fixed
      already; the review sweep caught the real stragglers — ARCHITECTURE.md tool count
      (five → six), SPEC §13 ADR index (007–009 added), SPEC §9.4/§10 CI and Node
      claims aligned with reality (Node 22 only, knip/Bun marked planned), ROADMAP
      made count-free.

## 1. Legal & admin

- [ ] **[Michael]** LICENSE full legal name. Line 3 is a placeholder today:
      `Copyright (c) 2026 Michael <TODO: full legal name before first publish>`.
      Nothing publishes — npm, GitHub, posts — while the TODO is in the file.
- [ ] **[Michael]** Create the GitHub org (`github.com/whipple3` — verified free
      2026-08-10; re-verify, it was a while ago) and the `whipple3` repo.
- [ ] **[Michael]** `git remote add origin … && git push` main; enable the Actions
      matrix (SPEC §15 TODO). First CI run green on GitHub, not just locally.
- [ ] **[Michael]** Create the npm org / verify the `whipple3` package name and
      `@whipple3` scope are still free (verified 2026-08-10; re-verify at publish).

## 2. Validation (the proofs the posts lean on)

- [ ] **[Michael]** The live `/whipple3:audit` run on a real Claude Code host — the one
      thing headless tests can't prove: subagent spawn/approval flow, real permission
      prompts, hook `agent_type`, the command's `!` preflight. Runbook =
      `examples/claude-code-plugin/README.md`. This is the remaining checkbox from
      W2-E.
- [ ] **[Michael]** Capture the 20-second Studio recording during that run (posts have
      a `[STUDIO RECORDING]` placeholder).
- [ ] **[Michael]** Benchmark numbers per `tools/bench` RUNBOOK (live LLM comparison —
      needs API spend and judgment on "equal quality"). The mock-mode pipeline proof is
      **[automatable]**. Numbers go into both posts' TODO blocks — or the section ships
      explicitly as "numbers to follow". No unmeasured claims.

## 3. Publish

- [ ] **[automatable]** Version bump to 0.1.0 across `packages/*/package.json`
      (+ the CLI's citty `version` string, currently "0.0.0"); `npm pack` smoke test
      per package (W3-B's tarball check).
- [ ] **[Michael]** `pnpm publish` — MUST be pnpm, not npm: the `workspace:*` rewrite,
      the `publishConfig` exports swap, and root-LICENSE injection are pnpm behaviors
      (`npm publish` would ship a broken manifest — W3-B). Dependency order for the four
      libs: **core → log → transport-mcp → transport-uds**; the cli can publish anytime
      (its workspace deps are inlined by tsup and declared dev-only).
- [ ] **[automatable]** Post-publish smoke: `npx whipple3@0.1.0 serve` + `mcp` from an
      empty directory on a clean machine/container — this is what unblocks the
      plugin's `.mcp.json` `npx whipple3` and retires the `npm link` path in
      `examples/claude-code-plugin/README.md` (update that README accordingly).
- [ ] **[Michael]** Tag `v0.1.0` on the release commit and push the tag; stamp the
      date into CHANGELOG.md ("Unreleased" → the date) in the same commit.
- [ ] **[Michael]** Plugin availability: decide the install story for launch day
      (`--plugin-dir` from a clone is what works today; a marketplace entry is a
      separate submission) and pin the minimum supported Claude Code version in
      `examples/claude-code-plugin/.claude-plugin/plugin.json` (SPEC §15 TODO).

## 4. Announce

- [ ] **[automatable]** Fill both posts: benchmark table (or the honest fallback),
      Studio recording link, final repo/npm URLs; re-read against SPEC's register — no
      superlatives survived editing.
- [ ] **[Michael]** Publish `docs/launch/post.md` (HN/Reddit/X) and
      `docs/launch/post-he.md` (Hebrew venues). Posts go out only after everything
      above — the install path in them must actually work for a stranger.
- [ ] **[Michael]** Watch the first issues/PRs; CONTRIBUTING.md now states the DCO +
      gate expectations for outsiders.

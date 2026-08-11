# v0.1.0 release checklist

Ordered by dependency — each phase gates the next. `[Michael]` = needs his credentials,
identity, or judgment; `[automatable]` = a Claude session can do it end-to-end (Michael
still reviews the diff/output).

## 0. Repo truth (before anything leaves the machine)

- [x] **[automatable]** Wave 3 integration pass merged (W3-A bench, W3-B packaging,
      W3-C launch kit); full gate green from a clean clone (verified 2026-08-11):
      `pnpm typecheck && pnpm lint && pnpm depcruise && pnpm build && pnpm test`.
      Order matters — **build before test**: the CLI e2e suites run the built
      `dist/main.js` and fail on a clean clone otherwise (checklist/ROADMAP said
      test-first; fixed 2026-08-11).
- [x] **[automatable]** Stale-doc sweep (done 2026-08-11): the two items originally
      listed here (root README tool count, plugin README `--policy`) turned out fixed
      already; the review sweep caught the real stragglers — ARCHITECTURE.md tool count
      (five → six), SPEC §13 ADR index (007–009 added), SPEC §9.4/§10 CI and Node
      claims aligned with reality (Node 22 only, knip/Bun marked planned), ROADMAP
      made count-free.

## 1. Legal & admin

- [x] **[Michael]** LICENSE full legal name — `Copyright (c) 2026 Michael Vexler`
      (set 2026-08-11). The publish gate this imposed is lifted.
- [x] **[Michael]** GitHub org `whipple3` created + public repo `whipple3/whipple3`
      (2026-08-11).
- [x] **[Michael]** main pushed; Actions ran on push. First cloud run was RED — it
      caught a real Linux/macOS divergence (connect(2) to a plain file: ENOTSOCK on
      macOS, ECONNREFUSED on Linux; the dial error advised deleting a possibly-real
      file). Fixed in transport-uds (stat before advising rm); second run **green**
      (2026-08-11). Cloud CI earned its keep on day one.
- [ ] **[Michael]** Create the npm org / verify the `whipple3` package name and
      `@whipple3` scope are still free (re-verified 2026-08-11: package 404 on the
      registry, org page "Scope not found"; re-verify at publish).

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

- [x] **[automatable]** Version bump to 0.1.0 across `packages/*/package.json`
      (+ the CLI's citty `version` string) — found already done, verified 2026-08-11.
      `pnpm pack` smoke for core / log / transport-mcp / transport-uds: dist + LICENSE
      + README present, zero `workspace:` deps in packed manifests; the cli tarball is
      covered by `pack.smoke.test` (green from the clean clone). Studio is `private` —
      correctly excluded from publish.
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

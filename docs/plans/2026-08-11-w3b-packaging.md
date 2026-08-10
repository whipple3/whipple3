# W3-B Packaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A stranger gets from the repo (or a future `npm i -g whipple3`) to a working board in under 10 minutes; every publishable tarball is proven correct by a real pack-install-handshake smoke test.

**Architecture:** Tarball truth is established with `pnpm pack` (NOT `npm pack` — pnpm is what rewrites `workspace:*` to real versions and applies the `publishConfig.exports` dist swap; `npm pack` would ship a manifest whose deps literally say `workspace:*`). The cli bundles all `@whipple3/*` code via tsup `noExternal`, so those are build-time deps — reclassifying them as devDependencies makes the cli tarball installable TODAY (only `@modelcontextprotocol/sdk` + `citty` come from the registry), which is what lets the smoke test run in CI without publishing.

**Tech Stack:** pnpm pack, npm install (temp dir), vitest, tar -tzf, citty CLI.

**Constraints:** no publish, no tags, no new deps, NO src/ changes (report instead). Gate before every commit: `pnpm build && pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test`.

---

### Task 0: Baseline

**Step 1:** `pnpm install && pnpm build` from the worktree.
**Step 2:** Full gate; confirm green before touching anything.
**Step 3:** Commit this plan: `docs: W3-B packaging plan`.

### Task 1: Tarball smoke test (TDD — it must fail first)

**Files:**
- Create: `packages/cli/test/pack.smoke.test.ts`

**Step 1: Write the failing test.** The test:
1. `pnpm pack --pack-destination <tmp>` in `packages/cli` → one `.tgz`.
2. `tar -tzf` the tarball: every entry is `package/dist/*`, `package/package.json`, `package/LICENSE`, `package/README.md`; NO `src/`, NO `test/`.
3. Packed `package.json`: no `workspace:` anywhere, no `@whipple3/*` in `dependencies`.
4. `npm install <tgz>` into a fresh temp dir (registry serves sdk + citty).
5. Spawn installed `node_modules/.bin/whipple3 mcp --agent smoke` → MCP initialize handshake → serverInfo.name === "whipple3".
6. Spawn `whipple3 serve` in the temp dir, then `whipple3 mcp --board .whipple3/board.sock --agent smoke-2` → initialize → `blackboard_post` + `blackboard_claim` + `blackboard_status` round-trip over the real socket; assert the ndjson log names the agent.
Reuse the `rpcClient`/`waitFor` pattern from `packages/cli/test/serve.e2e.test.ts`. Generous timeout (180s — npm install hits the network). Guard: skip-with-error if `dist/main.js` missing (same convention as the other e2e files).

**Step 2: Run it — expect FAIL at step 4:** `npm install` 404s on `@whipple3/core@0.0.0` because the workspace deps are declared as runtime `dependencies` while the bin actually inlines them. This failure IS the packaging bug.

### Task 2: Fix the cli manifest (make Task 1 pass)

**Files:**
- Modify: `packages/cli/package.json`

**Step 1:** Move `@whipple3/core`, `@whipple3/log`, `@whipple3/transport-mcp`, `@whipple3/transport-uds` from `dependencies` → `devDependencies` (tsup `noExternal: [/^@whipple3\//]` inlines them into `dist/main.js`; sdk + citty stay runtime deps and stay external).
**Step 2:** `pnpm install` (lockfile refresh) + `pnpm build`, rerun the smoke test → PASS.
**Step 3:** Full gate. Commit: `packaging: cli inlines workspace deps — declare them dev-only; add tarball-install smoke test`.

### Task 3: Manifest hygiene across packages

**Files:** Modify all six `packages/*/package.json`.

Per publishable package (core, log, transport-mcp, transport-uds, cli):
- `version: "0.1.0"` (studio too, for alignment; root monorepo untouched — not owned).
- `description` (one precise sentence each).
- `keywords`: shared set (multi-agent, blackboard, coordination, mcp, claude-code, event-sourcing, agents) + per-package specifics.
- `engines: { "node": ">=22" }` — floor justification: Node 20 EOL'd 2026-04-30; Node 22 is the oldest still-supported LTS (maintenance until 2027-04-30), Node 24 is active LTS. `>=22` is the honest floor; nothing in the code needs 24.
- `repository` `{type,url,directory}` → `git+https://github.com/whipple3/whipple3.git` (SPEC line 6: github.com/whipple3 verified free 2026-08-10; org creation is Michael-side, W3-C checklist), `homepage` (repo README anchor), `bugs`.
- `sideEffects: false` on the four libs (verified: module scope is consts/fn defs only). NOT on cli (its entry executes `runMain` on import — a bundler must not tree-shake it).
- `publishConfig.access: "public"` on the four scoped packages (scoped publishes default to restricted).
- Verify, do not "fix": dev `exports` → `./src/index.ts`, publishConfig swaps to dist (internal-package pattern per CLAUDE.md).

Gate. Commit: `packaging: manifest hygiene — 0.1.0, engines >=22, repository, keywords, sideEffects, access`.

### Task 4: LICENSE + README in every tarball

**Files:** Create `packages/{core,log,transport-mcp,transport-uds,cli}/LICENSE` (copy of root — npm only auto-includes LICENSE/README found in the package dir itself) and a 4–6-line `README.md` per package (what it is, link to repo README/SPEC).

Gate. Commit: `packaging: ship LICENSE and a README in every publishable tarball`.

### Task 5: Tarball verdict table (verification, no code)

For each of the five: `pnpm pack` → record size, `tar -tzf` listing (whitelist ok? LICENSE/README present? no src/test leakage — libs intentionally ship dist only), packed `package.json` (exports → dist swap applied, workspace deps rewritten to 0.1.0, access public). Table goes in the final report.

### Task 6: Plugin manifest pinning

**Files:** Modify `examples/claude-code-plugin/.claude-plugin/plugin.json`.

Verified against code.claude.com/docs/en/plugins-reference (fetched 2026-08-11): only `name` is required; recognized metadata fields include `version`, `description`, `license`, `keywords`, `repository`, `homepage`, `author`, and a free-form `metadata` object that Claude Code never interprets; unrecognized top-level fields are load-time-ignored (validate warns); the `dependencies` field is for OTHER PLUGINS, not npm packages — so the npm pin goes in `metadata`:
- keep `name`/`version: "0.1.0"`; add `license: "MIT"`, `keywords`, `repository`, `homepage`
- add `"metadata": { "whipple3": { "minVersion": "0.1.0" } }` and state the pin in `description` (the only place a human sees it in the /plugin UI).
- If a `claude` binary is available: `claude plugin validate examples/claude-code-plugin --strict`.

Gate. Commit: `packaging: pin plugin manifest — 0.1.0, license, min whipple3 version`.

### Task 7: Root README 10-minute quickstart

**Files:** Modify `README.md` (top). Keep the whippletree preamble, Status, Design, License sections.

New "Quick start" immediately after the preamble, the real path in order:
1. Prereqs: Node ≥ 22, pnpm (git for now).
2. Install: today = clone → `pnpm install && pnpm build` → `cd packages/cli && npm link`; post-publish = `npm i -g whipple3` (marked "after the npm publish lands").
3. `whipple3 serve` (terminal 1, in the repo to coordinate) — one process owns board + log.
4. Wire agents: per-agent proxies `whipple3 mcp --board .whipple3/board.sock --agent <id>` via `claude mcp add`, OR the plugin path: `claude --plugin-dir .../examples/claude-code-plugin` → `/whipple3:audit` (link to the example README).
5. `whipple3 distill .whipple3/session-<ts>.ndjson` → report.md.
6. Studio: `pnpm --filter @whipple3/studio dev -- <log>` (note: `whipple3 studio` not wired yet).

### Task 8: Measure the quickstart cold

Script the exact README commands in a scratch dir (`git clone` from the worktree, temp npm prefix so the machine stays clean), wall-clock each step with `date +%s`, run serve + one proxy handshake as the "it works" check + distill. Report minutes. If > 10, cut README steps until it fits.

Gate. Commit: `docs: README 10-minute quickstart (measured)`.

### Report-only items (src changes are out of charter)

- `packages/cli/src/main.ts` citty `meta.version: "0.0.0"` and `packages/cli/src/mcp.ts` `new McpServer({ ... version: "0.0.0" })` — both should read the real version (or at least say 0.1.0). `whipple3 --version` will lie until fixed.
- `examples/claude-code-plugin/README.md` says "Node ≥ 20" (unowned) — floor is now 22.
- Root `package.json` engines `>=20` (unowned) — dev floor should match.
- LICENSE full-name TODO + org creation remain Michael-side (W3-C checklist).

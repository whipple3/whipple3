# Contributing to whipple3

Thanks for your interest. Until v1.0 the API is unstable and large refactors land often —
please open an issue before starting significant work.

## Sign-off (DCO)

All commits must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin](https://developercertificate.org/).

> **Note (pre-1.0):** before we accept large external contributions we will finalize the
> CLA-vs-DCO policy (tracked in the roadmap). Small fixes are welcome under DCO now.

## The gate

Run before every commit, from the repo root — green or don't commit:

```bash
pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test
```

Add `pnpm build` if you touched `packages/cli` (the e2e tests run the built binary).

Commits are small and focused, message style `area: what`
(e.g., `transport-mcp: wire stdio server`, `docs: fix stale tool count`).

## Engineering standards

See SPEC.md §9. Non-negotiables: `@whipple3/core` stays pure (no I/O, no clocks, no randomness),
errors are values (`Result`), every port ships a conformance suite, and import direction is
enforced by dependency-cruiser in CI.

## A note on the waves plan

`docs/plans/2026-08-10-swarm-waves.md` describes how the maintainer runs parallel
working sessions (worktree per package, frozen contracts, wave-boundary merges). That
discipline is internal — as an outside contributor you don't need any of it. An issue
first, the gate green, and a signed-off commit are the whole contract.

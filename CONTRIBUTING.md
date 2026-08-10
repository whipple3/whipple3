# Contributing to whipple3

Thanks for your interest. Until v1.0 the API is unstable and large refactors land often —
please open an issue before starting significant work.

## Sign-off (DCO)

All commits must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin](https://developercertificate.org/).

> **Note (pre-1.0):** before we accept large external contributions we will finalize the
> CLA-vs-DCO policy (tracked in the roadmap). Small fixes are welcome under DCO now.

## Engineering standards

See SPEC.md §9. Non-negotiables: `@whipple3/core` stays pure (no I/O, no clocks, no randomness),
errors are values (`Result`), every port ships a conformance suite, and import direction is
enforced by dependency-cruiser in CI.

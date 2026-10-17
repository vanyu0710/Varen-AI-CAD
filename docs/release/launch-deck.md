# Varen CAD — Launch Deck (internal master copy)

> One source of truth for all external posts (Reddit / X / HN / LinkedIn / PH / Dev.to).
> Every number here must be reproducible via `scripts/run_benchmark.py`; link the run record, never the claim alone.
> Banned claims list: `docs/launch/positioning.md`.

## 30-second pitch

**Varen CAD is an auditable, local-first CAD agent for parametric mechanical assemblies.**
An LLM drives a real OpenCascade kernel (via build123d) through 34 validated ops — planning a BOM, modeling parts one by one, and exporting STEP assemblies. What makes it different isn't generation; it's refusal: hole-count contracts, single-body checks, and full pairwise interference gates **reject delivery when validation fails**. Local-first: your drawings never leave your machine except to the model endpoint you configure. Open source (AGPL-3.0).

## Why now

- The market believes AI can generate CAD. It does not yet believe the results. HN threads in 2026 called demos "toys, toys, toys"; academic benchmarks (CAD-Judge, MUSE, AssemCAD) confirm verification is *the* bottleneck.
- Varen shipped the answer as product: gates are code, not vibes. Failure samples are published, not hidden.

## Proof (as of v0.21.0-beta, 2026-09-17)

| Claim | Evidence |
|---|---|
| Real assemblies from one sentence | 1:100 three-stage gearbox: 8 parts, 53 steps, 758s, 0 unexempted collisions (deepseek-class LLM, replayable logs) |
| The gates actually bite | First gearbox attempt was blocked by the interference gate; agent redid shaft/gear poses. Negative-control benchmark tasks deliberately teach the model to fake features — the contract gate rejects them |
| Not a toy kernel | Real involute gears, parametric feature history (edit a feature → full recompute), XCAF named-product assembly STEP |
| Engineering rigor | 468 backend + 92 frontend + ~390 kernel tests, real-worker E2E |
| Honest scope | No 2D drawings, no constraint solver, `production_ready` always false. Stated everywhere |

## Ask (per channel — never all at once)

- HN / Reddit: "here's how our validation gates caught our own lies" + benchmark link. No download-links-as-post.
- LinkedIn/X: product identity + build-in-public weekly proof posts.
- PH (later): hosted zero-install experience required first.

## Links

- Repo: https://github.com/vanyu0710/aicad (AGPL-3.0-or-later, commercial dual-license)
- Beta download: https://github.com/vanyu0710/aicad/releases/tag/v0.21.0-beta
- Landing: https://vanyu0710.github.io/aicad/
- Design-partner application: https://github.com/vanyu0710/aicad/issues/new?template=beta_application.yml
- Failure report (→ public benchmark): https://github.com/vanyu0710/aicad/issues/new?template=task_failure.yml
- Run records: https://github.com/vanyu0710/aicad/tree/main/benchmark/results

## Numbers you may quote (with source)

- Windows desktop beta, 181 MB bundle, first-run to first STEP ≤15 min (to be validated in blind test — do not quote until 5 users pass)
- 53 steps / 758s / 8 parts / 0 hard collisions — gearbox run
- 26-part 5-speed manual transmission assembly, 325 interference pairs checked, programmatic housing audit FAIL=0
- Zoo charges $399/user/mo for "data excluded from training + audit". Varen: free, because it's local. (source: zoo.dev/pricing, 2026-09-17 snapshot)

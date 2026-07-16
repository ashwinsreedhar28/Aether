### Added
- A2 shadow checker (#392; ADR `decisions/2026-07-16-a2-shadow-mode.md`):
  every PR merged to main now gets a machine verdict comment — `A2-SHADOW:
  AGREE (class-1)` / `OUT-OF-CLASS` / `DISAGREE (reason)` — posted by
  `scripts/a2-shadow-check.mjs` (spawned from `.github/workflows/
  a2-shadow.yml` on merged-PR close) from machine-checkable conditions only:
  ARCHITECT RATIFICATION on the Closes-issue predating its first GATE
  REPORT, `REVIEWER: APPROVE` whose Reviewed SHA equals the merged head, CI
  green on that head, an all-pass mechanical auto-review, every touched path
  inside the new `scripts/a2-classes.json` class-1 allowlist (docs-only
  surfaces — enforced by path, never judgment), and no HOLD label. The
  checker takes no action — it builds the agreement record that arms A2;
  `--tally` folds the record into per-verdict counts and the trailing
  non-DISAGREE streak the arming condition (10 consecutive, a future
  ADR-gated lane) reads. Verdict core is pure and fixture-tested; the tests
  run in CI via `node --test scripts/*.test.mjs`.

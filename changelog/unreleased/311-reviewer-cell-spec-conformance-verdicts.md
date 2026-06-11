### Added
- Reviewer cell on the PR path (#311) — `.github/workflows/claude-spec-review.yml`,
  a sibling to the mechanical auto-review: on PR open/synchronize it resolves the
  Closes-issue, reads the ratified ARCHITECT SPEC (+ ADDENDUM comments), reviews
  the diff against FIX/SMOKE/OUT-OF-SCOPE, verifies the PR title against the
  issue, and checks §7 claims against diff reality. Exactly one verdict comment
  per head SHA (sticky, superseded in place): `REVIEWER: APPROVE`,
  `REVIEWER: CONCERNS —` itemized, or `REVIEWER: NO SPEC FOUND` (spec-less PRs
  are never approved). Advisory by design — CLAUDE.md §1 now documents the merge
  condition as CI green + REVIEWER: APPROVE + the Director's button; NOT a
  required status check (that promotion is autonomy-ladder decision A2, untaken).

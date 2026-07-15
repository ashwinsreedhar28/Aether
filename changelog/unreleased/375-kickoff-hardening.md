### Changed
- Lane kickoff hardening (#375): the kickoff template now binds the spec
  gate to a Director-signed ratification comment (a body spec alone is
  insufficient — self-filed issues share the Director's gh identity; missing
  ratification halts exactly like a missing spec) and requires executable
  evidence in the GATE REPORT for lanes touching `nodes/` or mesh wiring
  (the #366 harness transcript, `HARNESS RESULT` line at minimum — prose
  claims insufficient), with both clauses pinned in the kickoff test.
  `.lane-kickoff.md` is now gitignored and ship-it stages lane files
  explicitly by path instead of `git add -A`, so kickoff scaffolding can
  never ship (the PR #379 near-miss).

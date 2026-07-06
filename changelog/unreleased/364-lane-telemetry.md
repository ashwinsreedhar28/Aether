### Added
- Lane telemetry family — per-lane token, cycle, and outcome capture (#364;
  ADR `decisions/2026-07-06-lane-telemetry-capture.md`). The measurement
  substrate for the self-improvement loop: when a lane's teardown completes,
  the executor writes ONE kind-tagged `telemetry` line to the spawn ledger —
  issue, spawn/close timestamps, wall seconds, model, token sums scraped from
  the lane's Claude Code session transcripts (path convention and usage
  schema pinned against CC 2.1.201 with a fixture test; entries dedupe by
  message id), gate-report count from one gh issue read, revise/proceed
  counts from the ledger's own relay lines, `git diff main...HEAD
  --shortstat` captured before the worktree is removed (zero-commit lanes
  record zeros), and a merged-or-abandoned outcome from the same PR surface
  the teardown guards consult. Three laws govern it: capture facts, classify
  later; analytics never blocks teardown (any scrape failure records null
  fields plus an error note and the closeout proceeds — fault-injection
  tested); null over guess (`effort` is null by binding — the pinned CC
  version records none). The family folds segregated (`listTelemetry()` /
  `findTelemetry(issue)`, no ghost spawn records, no capacity impact); the
  ledger JSONL is the v1 read surface (jq) — no renderer surface yet.

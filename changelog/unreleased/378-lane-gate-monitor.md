### Added
- Lane gate monitor (#378, Rung 2.5 — executes #310's explicitly deferred
  background poller; lane #372's 8-day-unseen gate is the motivating
  failure, reproduced in the tests): a main-process `laneMonitor` polls
  each open lane's issue thread every 60s over the existing shell →
  github.get_issue edge and folds phase with the SAME laneGate code the
  card uses — now imported by main (export-never-duplicate; the
  no-shared-imports era ends for the fold, while the pinned prefix-literal
  copies stay as drift tripwires). Each observed transition lands as a new
  ledger `gate` family line ({id, ts, kind:'gate', issue, phase, prev} —
  telemetry's posture: no status field, inert in every other fold, TS and
  Python, never holding lane capacity; one mixed-family fixture pins all
  six folds). Last-known phase is DERIVED from the gate fold — no side
  state file — so the first successful tick after boot naturally announces
  transitions that happened while the shell was down. Host notifications
  ("Lane #372 at gate" / "revising" / "PR opened") ride the shell →
  host_notifications.notify edge; single-shot age alarms — one reminder
  when a lane sits at-gate/revising ≥ AETHER_AGE_REMIND_MIN (default
  120m), one when it is still working with no report ≥ AETHER_STALL_MIN
  (default 240m) after spawn — are themselves ledger gate lines
  (reminder:true), so restarts never re-fire them. The monitor pushes
  `spawn:gate-update` over IPC and the card merges it live; REFRESH stays
  as the manual override. Observation only — no autonomous action of any
  kind. Closes #378.

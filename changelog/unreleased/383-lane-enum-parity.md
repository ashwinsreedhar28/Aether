### Fixed
- Voice lane enumeration blind to a live lane (#383): all three Python
  per-issue ledger folds (`lane_gate_tool._live_lanes`,
  `lane_proceed_tool._lane_status` — which lane_revise inherits —
  `close_lane_tool._lane_status`) resolved the NEWEST record per issue and
  then checked its status, so a dead newer duplicate (the July-14 shape: a
  repeated "spawn a lane on issue 374" armed a second batch that failed
  preflight and was dismissed) masked the live lane beside it —
  whats_ready_to_test counted 1 lane where the shell rendered 2, and voice
  proceed/revise/close would have refused the live lane. The law is now the
  TS executor's own (`spawnService.liveLane`): status FIRST, newest among
  the live — liveness is a property of records, not issues; with no live
  record the newest record's status still shapes the spoken refusal.
  `laneMonitor.openLanes()` had copied the inverted law from the Python
  doctrine and is fixed the same way (selection rule only; polling and
  notification behavior untouched). One mixed-family duplicate-request
  fixture — the incident's own table — is parity-pinned on both sides
  (raven-core `tests/lane_fixtures.py` ↔ `spawnLedger.test.ts`, plus the
  lane-family subset in `laneMonitor.test.ts`). Ledger reconciliation
  confirmed no outcome write was ever lost (the "missing" spawned line was
  a serializer-blind grep); `work_on_issue._committed_count` is per-record
  and needed no change. Closes #383.

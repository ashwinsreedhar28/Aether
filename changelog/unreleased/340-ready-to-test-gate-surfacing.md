### Added
- READY TO TEST surfacing (#340, R1 of the revision loop) — a lane reaching
  its gate now announces itself instead of folding silently. At the existing
  AT GATE detection point (the pull-based card fold, #310) the shell emits
  ONE `host_notifications.notify` toast per gate arrival — "Lane N is ready
  to test — <issue title>" — keyed by the report comment's `created_at`, so
  re-gates (a new GATE REPORT comment) toast again while refreshes of an
  already-gated lane stay silent; the dedupe is session-scoped (no ledger
  change), riding the existing `shell → host_notifications.notify` edge.
  raven gains two READ-ONLY voice tools (`lane_gate_tool.py`, neither
  confirm-gated per the standing #225 reversibility ruling — they touch
  nothing): `whats_ready_to_test()` folds the spawn ledger for live lanes,
  reads each issue thread over the existing `raven → github.get_issue` edge
  with a Python mirror of the shell's gate fold (strictly newer than the
  spawned event; PR OPENED upgrades past the gate), and speaks who's waiting
  ("Lane 334 is ready, sir: playlists, recently-played, and app controls.");
  `read_test_steps(number)` fetches the LATEST gate report comment, extracts
  its SMOKE/Director-smoke section, and speaks the steps as a numbered
  walkthrough — a lane with no gate report (or a report with no smoke
  section) gets a spoken line naming the miss. prompts.json gains a minimal
  "Lanes at the gate" section plus two worked examples via unique-anchor
  edits, JSON-validated. No relay or gate-protocol changes — additive
  surfacing only. Closes #340.

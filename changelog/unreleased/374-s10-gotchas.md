### Added
- Four field gotchas banked into the §10 canon (#374, governance-log
  2026-07-14 batch): manual worktree teardown passes `--force` — on git
  2.37.1 (Apple) the submodule guard fires only without it (the July-6 die
  class; the service path already carries the #365 fallback); Electron ≥22's
  legacy webview `new-window` event is dead code — window-open interception
  is `setWindowOpenHandler` dispositions in main (the #336 discovery), never
  the old event path; app-spawned lanes close out THROUGH the app (card
  CLOSE OUT or `lane-done`) — manual tmux/worktree/branch teardown leaves
  the spawn-ledger record active, so `whats_ready_to_test` and lane counts
  go stale (observed 2026-07-14, lane-372); and tmux mouse mode (#324/#328)
  breaks drag text-selection — Option-drag bypasses mouse reporting for a
  native selection (field, 2026-06-12). `.lane-kickoff.md` staging
  hardening is cross-referenced to #375's amended scope, not restated.

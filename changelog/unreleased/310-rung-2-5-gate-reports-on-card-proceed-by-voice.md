### Added
- Rung 2.5 — gate reports reach the card, clean-proceed by voice (#310): the
  lane kickoff now dictates the machine-readable lane channel — the lane
  posts its full gate report to its issue thread ("GATE REPORT — " prefix)
  before stopping at the gate, and "PR OPENED — #N <url>" once its PR is up.
  A spawned lane's card folds that thread pull-based (one `github.get_issue`
  read on card open + explicit REFRESH over a new `shell → github.get_issue`
  edge; only comments newer than the spawn count; no background poller) into
  LANE AT GATE with the report inline, then LANE PR OPENED with an OPEN PR
  link. New confirm-gated raven tool `lane_proceed` (alias `proceed_lane`)
  appends a `kind:"relay"` request to the spawn ledger; the shell enforces
  the v1 allowlist (the literal "clean, proceed" ONLY), types it into the
  lane's tmux pane via the pane-id send machinery, and records the
  relayed/failed outcome (the card's RELAY row). The card's PROCEED button
  on AT GATE rides the same ledger path; relays found pending at boot are
  failed by name, never auto-sent; relay lines hold no lane capacity on
  either fold (TS + Python).

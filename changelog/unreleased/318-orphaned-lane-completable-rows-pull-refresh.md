### Fixed
- Orphaned-lane affordances: completable rows, pull-based freshness (#318).
  Every orphan reattach row backed by a live (`spawned`) ledger record now
  carries a ghost COMPLETE beside REATTACH (one shared row component behind
  the per-card strip and the standalone ORPHANED LANES card) with the full
  #305/#308 warn-and-force semantics — a live-session refusal arms COMPLETE
  ANYWAY on that row, never a silent terminal write. The orphan list itself
  became a pull-refreshed cache instead of a boot snapshot: a new
  `spawn:refresh-orphans` IPC re-probes tmux on Lanes open, card summon, and
  explicit refresh (no background poller — the Rung 2.5 philosophy); entries
  whose session died or whose newest matching record is terminal drop from
  every strip without a relaunch, attachment is read from tmux itself
  (`#{session_attached}`), and a successful complete drops its row
  synchronously.

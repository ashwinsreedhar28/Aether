### Added
- Voice lane closeout — guarded teardown as the spawn's mirror (#317): new
  confirm-gated raven tool `close_lane` (alias `close_out_lane`) appends a
  `kind:"teardown"` request to the spawn ledger; the card's CLOSE OUT button
  (two-beat confirm) rides the same line. The shell executes the canonical
  cleanup block itself — tmux kill-session → rm `.lane-kickoff.md` →
  submodule deinit → `git worktree remove --force` → `git branch -D` →
  restore main's submodules — behind ordered guards: an open PR on the
  record's branch refuses (`pr-open`, no force path), a pane still off the
  bare shell refuses (`lane-busy`, no force path), and a dirty worktree or
  unpushed branch draws the warn whose explicit CLOSE ANYWAY (card-only
  force, #308 law) proceeds. `closed` is written only after every step
  succeeds; a failed step writes the new `teardown_failed` status (a retry
  card with the failing step + the copyable block), and capacity is freed
  only by `closed` on both folds (TS + Python). Boot-pending teardowns are
  failed by name, never auto-executed. ADR supersedes the v1.1 copy-only
  cleanup clause; the copyable block remains the manual escape hatch.

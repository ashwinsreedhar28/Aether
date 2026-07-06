### Fixed
- Lane teardown survives git's submodule guard (#363): `git worktree remove`
  dies with `working trees containing submodules cannot be moved or removed`
  on any worktree whose admin dir carries submodule git dirs — every lane
  worktree qualifies, because the spawn recipe's `git submodule update
  --init --recursive` (the §13.12 step, kept: pattern-lift lanes read
  `_ingest/`) populates `.git/worktrees/<lane>/modules/_ingest/*`, and the
  pre-remove `submodule deinit` deliberately leaves that admin dir behind.
  When the die fires, the teardown executor now engages the recovery the
  manual fix applied by hand: `rm -rf` the worktree path, `git worktree
  prune`, then the existing `git branch -D` — prune strictly before branch
  delete, since checked-out status is read from `.git/worktrees/*/HEAD`. The
  fallback runs only after the pr-open/lane-busy refusals and the dirty warn
  have passed, and only on that one die (any other remove failure still
  fails the step); a teardown that finds the worktree dir already gone
  prunes before branch -D so an interrupted fallback resumes cleanly on
  retry. Closes #363.

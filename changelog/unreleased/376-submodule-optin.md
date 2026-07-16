### Changed
- Submodule init is opt-in per spawn (#376, default OFF): both spawn recipes
  skip `git submodule update --init --recursive` unless the lane's ARCHITECT
  SPEC (or a draft's text) carries a `Submodules: on` line, which
  work_on_issue_tool records as `submodules: true` on the ledger's lane
  request line. The #376 audit found nothing in a lane's build, runtime, or
  RAG-bootstrap path reads `_ingest/` from the worktree (CI builds with
  `submodules: false`); pattern-lift guidance now points at the main
  checkout's populated `_ingest/`. Ordinary lanes cut faster and never arm
  git's submodule teardown die (#363).

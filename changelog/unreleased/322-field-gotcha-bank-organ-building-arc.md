### Added
- Field-gotcha bank (#322) — four §10-class gotchas from the organ-building arc
  banked in `docs/governance-log.md` (2026-06-11 batch): claude-code-action's
  silent self-skip when the calling workflow file differs from main (green run,
  no verdict; #314), python.org macOS builds lacking sqlite3 loadable-extension
  support (RAG venvs built from Homebrew/Anaconda python; #319), the same builds
  lacking wired system CAs (use certifi when available; #319), and merge-pulls
  into a running dev server's checkout hot-swapping main-process code under a
  live renderer (black screen; quit first or run from a dedicated worktree —
  now one line in CLAUDE.md §13.12).

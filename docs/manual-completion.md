# Manual Completion Pattern

When a Claude Code (CC) Implementer session cannot land a lane due to
API hostility — typically 5+ retry stalls in the read phase per
CLAUDE.md §13.7 — the Architect and Director collaborate to complete
the lane manually. This document describes the mechanics.

## When to use

- A CC session has stalled per §13.7 (5 retries in read phase) AND a
  restart hits the same wall.
- The lane's content is well-specified (locked architectural decisions,
  clear pattern to mirror — typically a NEW-NODE lane mirroring an
  existing node, or a GOVERNANCE lane with Architect-authored content).
- The Director is available to paste blocks into the worktree and run
  verification.

## When NOT to use

- CC stalled once, no restart attempted (try restart first).
- The lane requires substantive architectural exploration (use CC for
  that; manual completion is mechanical execution).
- The Director isn't available (defer the lane).

## Mechanics

1. **Director triage.** Run `git status` on the worktree (per Sprint 4
   Wave 2 governance-log entry 4) — apparent stalls often have partial
   writes. If files were written, proceed to (3). If empty, proceed to
   (2).

2. **Director pastes reference files.** For a NEW-NODE lane: typically
   `nodes/clipboard_history/` source files + any directly-referenced
   shell hook files (`secrets.ts`, `paths.ts`, `coreManager.ts`,
   `nodeManager.ts`). For a GOVERNANCE lane: typically `CLAUDE.md §13`,
   existing skills, current `docs/governance-log.md`.

3. **Architect dictates new content.** Source files go in `cat > path
   << 'EOF' ... EOF` blocks. Targeted file edits (str_replace patterns)
   go in Python scripts using `open().read()` + `s.replace()`. The
   Architect tracks anchor strings carefully — every patch script
   verifies anchor presence before applying.

4. **Director applies and verifies.** Pastes the blocks, runs the
   verify-build skill. If verify is clean, proceeds to ship-it. If
   verify fails, pastes the error to the Architect for a fix patch.

5. **Director ships.** Standard ship-it sequence (`pnpm install` first,
   explicit per-path `git add` second — never `git add -A` (#375) — then
   commit + push + PR). PR body's
   "Risks / TODOs / Skipped" section notes the lane was completed
   manually due to CC unavailability, with an attribution like:
   "CC session stalled; lane completed via Director-Architect manual
   completion pattern (see docs/manual-completion.md)."

## File type guidance

- **TypeScript / Markdown / JSON**: cat-heredoc with `'EOF'` (single-quoted)
  to prevent shell variable expansion. Special characters like `«»` in
  AppleScript strings pass through cleanly.
- **YAML**: cat-heredoc fine for new files. For edits to existing YAML
  (manifest.yaml), use Python str_replace with multi-line anchors to
  preserve formatting.
- **Files with literal `$` or backticks**: still use `'EOF'` heredoc;
  the single-quoted form prevents shell expansion of those characters.

## Reference

Manual completion was used three times in Sprint 4:

- **PR #73 (clipboard_history)**: full manual completion after three CC
  sessions stalled. ~45 min including diagnosis.
- **PR #74 (macos_messages)**: triaged as a stall; `git status` revealed
  the CC session had completed substantial writes. Verified + shipped in
  ~20 min. Lesson banked as governance-log entry 4.
- **PR #75 (macos_mail + AppleScript bridge)**: CC session terminated
  mid-write; bridge package + node scaffolding complete, 4 src files
  + shell hooks missing. Manual completion of the missing pieces.

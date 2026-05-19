# Implementer Prompt Template

The canonical skeleton every Architect-drafted Implementer prompt is built from. See `CLAUDE.md` §13 for the discipline rules.

## Skeleton

```text
You are an Implementer working on the Aether project. Read CLAUDE.md
operations rules first.

ultrathink

LANE TYPE: <TUNING | NEW-SURFACE | NEW-NODE | REFACTOR | CHORE | DOCS>

Branch: <branch-name>
Worktree: ~/aether-<short> (rebased to <latest main state>)
GitHub Issue: #<issue-number>

PRE-FLIGHT READS COMPLETED BY ARCHITECT:
- <subsystem fact 1, with file path + line range>
- <subsystem fact 2, with file path + line range>
- <decision the Architect made and why>

LARGE-FILE CAUTION (do NOT full-read):
- <file path> (<line count> lines): grep -n "<anchor>" <path>, then
  sed -n 'X,Yp' for a small window. str_replace with the anchor.
  (repeat for each file > 400 lines in scope)
- Do NOT read files outside this lane's scope.

GOAL: <one-paragraph user/system-visible outcome>

PRE-STAGED CONTENT (write verbatim):

### CONTENT 1 — <description>
<content>

### CONTENT 2 — <description>
<content>

IMPLEMENTATION STEPS:

1. <step>

2. <step>

VERIFICATION:
Use the verify-build skill. Paste output. Wait for "clean, proceed."

SHIPPING:
Use the ship-it skill. PR title: <type>(<scope>): <imperative summary>.
PR body uses §7 format and includes Closes #<issue>.
Drop the PR number when complete.
```

## Rules of use

- Pre-staging is **mandatory** when ANY of: hostile-API window, 5+ file reads, scope includes a choke file.
- The "PRE-FLIGHT READS COMPLETED" section is mandatory regardless of lane type. If the Architect skipped pre-flight, stop and re-draft.
- The `ultrathink` keyword belongs immediately after the rule-reading instruction — it gates extended reasoning before lane work begins.
- For lanes touching unfamiliar subsystems without pre-staged content, delegate the read phase to `aether-explorer`.
- Before opening any PR, delegate the pre-commit walk-through to `aether-reviewer`.

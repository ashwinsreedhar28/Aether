<!--
Fill out every section honestly. CLAUDE.md §7 — a PR without a filled
template will be rejected at first review. Delete the HTML comments
before submitting if you like; leaving them in is fine too.
-->

## What changed
<!-- one paragraph — what's different about the codebase after this PR -->

## Why
<!-- one paragraph — the goal from the lane's GitHub Issue, and how this PR meets it -->

## How (high level)
<!-- 2-4 bullets — the design decisions, not a file-by-file walkthrough -->

## Risks / TODOs / Skipped
<!--
honest list. If you skipped tests, say so. If you used a workaround, say so.
If something obviously-related-but-out-of-scope is now load-bearing, say so.
-->

## Out-of-scope work explicitly avoided
<!--
list things you noticed could be improved but deliberately did not touch,
with a one-line rationale each. Architect uses this to confirm scope
discipline (CLAUDE.md §13.5).
-->

## Pre-PR heuristics
<!--
Confirm you've considered each item in CLAUDE.md §11 Architect Review
Heuristics. The `aether-reviewer` subagent (CLAUDE.md §13.10) can run
this walk-through automatically.
-->

## Verification
<!-- Output of the `verify-build` skill (CLAUDE.md §13.11). -->
- `pnpm build` ✅
- `pnpm typecheck` ✅
- `pnpm lint` ✅

## Open questions for Architect
<!-- if any. Be specific. "Should X be Y or Z?" not "thoughts on X?". -->

Closes #<issue>

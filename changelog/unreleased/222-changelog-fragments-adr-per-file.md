### Changed
- Per-lane changelog fragments + ADR-per-file split (#222): the two shared
  append surfaces stop being rebase magnets. Lanes no longer edit
  CHANGELOG.md or DECISIONS.md — each lane writes ONE fragment at
  `changelog/unreleased/<issue>-<slug>.md` (house format: `### Section` +
  the entry bullet) and lands any decision as a new file at
  `decisions/<date>-<slug>.md` (same header + six required fields).
  `CHANGELOG.md`'s `[Unreleased]` body is now a generated stub —
  `scripts/roll-changelog.mjs --version X.Y.Z` compiles fragments in stable
  order (ascending issue number) into the version section and deletes them;
  DECISIONS.md is now a generated index over `decisions/`
  (`scripts/gen-decisions-index.mjs`, `--check` in CI). The 32 existing
  ADRs migrated byte-preserved; the 6 open `[Unreleased]` entries migrated
  to fragments verbatim. Contract repointed across CLAUDE.md §8 (+§7
  pointer), the lane kickoff text, the mechanical auto-review's checks
  #2/#3 (fragment presence; ADR-file format — root hand-edits flagged), the
  rebase playbook, and `CORPUS_GLOBS` (+ the #200 set-equality tripwire)
  which gains `changelog/unreleased/*.md` and `decisions/*.md`.

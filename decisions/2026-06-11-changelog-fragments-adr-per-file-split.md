## [2026-06-11] ADR: per-lane changelog fragments + ADR-per-file split — the two shared append surfaces stop being rebase magnets (#222)

**Status:** accepted

**Decided by:** Architect (spec on #222), Director-approved; applied by Implementer on `lane/issue-222`.

**Context:** Every parallel lane appended to the same two regions —
CHANGELOG.md's `[Unreleased]` body and the top of DECISIONS.md — so every
rebase between lanes conflicted there by construction (six conflicts in one
day at peak), and the rebase playbook had to carry standing resolution rules
(keep-all unions) for what was really a storage-shape problem. The two roots
were the only *systematic* collision left in the lane model.

**Decision:** Kill the shared append regions; both roots become generated.

1. **Changelog fragments.** Each lane writes ONE file,
   `changelog/unreleased/<issue>-<slug>.md` (house format: `### Added` /
   `Changed` / `Fixed` / `Removed` heading + the entry bullet), and never
   edits CHANGELOG.md. `CHANGELOG.md`'s `[Unreleased]` body is a generated
   stub; a release lane runs `node scripts/roll-changelog.mjs --version
   X.Y.Z`, which compiles fragments in stable order (ascending issue
   number, filename tiebreak; sections in canonical order) into the new
   version section and deletes them. The roll is deterministic — CI runs
   the dry-run twice and diffs.
2. **ADR-per-file.** ADRs live one per file under
   `decisions/<date>-<slug>.md` (the existing `## [YYYY-MM-DD] <Title>`
   header + six required fields, unchanged). DECISIONS.md is a generated
   index (`node scripts/gen-decisions-index.mjs`, with `--check` in CI).
   The append-only law becomes trivial: a new decision is a new file; a
   supersession flips one old file's `Status:` line and adds one new file.
   Because two parallel lanes regenerating the index insert adjacent single
   lines, `.gitattributes` gives DECISIONS.md `merge=union` — the rebase
   stays conflict-free, and any unioned ordering drift is caught by the CI
   `--check` and fixed by rerunning the generator (safe only because the
   file is generated; union merging must never extend to hand-written
   files).
   The 32 pre-split ADRs were migrated byte-preserved (reassembly of
   preamble + entry bodies + separators reproduced the original
   DECISIONS.md exactly; each migrated file's body is a verbatim substring
   of the original).
3. **Contract repointing.** CLAUDE.md §8 (+ a §7 pointer), the lane
   kickoff text (`spawnService.ts laneKickoff()`), and the mechanical
   auto-review's checks #2/#3 now demand fragment/ADR-file presence and
   flag hand-edits to the two roots. `CORPUS_GLOBS` gains
   `changelog/unreleased/*.md` and `decisions/*.md` (Python tuple + TS
   mirror + the #200 set-equality tripwire, updated together).

**Consequences:** Two lanes adding a changelog entry and an ADR each touch
four distinct new files and zero shared regions — the rebase conflict class
disappears (the playbook's keep-all rule survives only for released
sections and legacy branches). The roll script becomes release-lane
machinery: a version cut now runs a script instead of hand-rolling
`[Unreleased]`. DECISIONS.md and CHANGELOG.md remain in the RAG corpus as
index/history; fragments and per-file ADRs are indexed individually.
Intra-date ordering in the generated index is filename-ascending
(presentation only); the pre-split file's newest-first-within-date ordering
and the #203 ADR's bottom-of-file position are not preserved — per-file
dates carry the record. The reviewer cell's prompt still references
CHANGELOG.md-line/DECISIONS.md expectations and is repointed in a follow-up
(explicitly out of scope here).

**Alternatives considered:** Keeping the roots hand-edited with smarter
merge drivers (`.gitattributes` union merge) — rejected: union merges
corrupt interleaved multi-line bullets and do nothing for DECISIONS.md
field structure. Fragments under `changes/<branch-slug>.md` with
DECISIONS.md frozen behind a banner and `docs/decisions/NNN-slug.md` going
forward (the 06-10 draft spec) — superseded by the 06-11 spec: issue-number
filenames give the roll a stable order, date-slug ADR filenames match the
existing header format, and a full byte-preserved migration beats a frozen
split-brain root. One combined script — rejected: the two surfaces roll on
different triggers (release vs. every decisions/ change).

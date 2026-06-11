# changelog/ — per-lane fragments (#222)

`CHANGELOG.md`'s `[Unreleased]` body is **generated** — no lane edits it.
Each lane records its entry as ONE fragment file here instead, so parallel
lanes never collide on a shared append region.

## Fragment format

Path: `changelog/unreleased/<issue>-<slug>.md` — `<issue>` is the lane's
GitHub issue number (it is the roll's stable sort key), `<slug>` is
kebab-case.

Content: the entry's Keep-a-Changelog section heading, then the bullet
exactly as it should appear in CHANGELOG.md (multi-line continuations
indented two spaces):

```markdown
### Added
- The thing this lane shipped (#NNN): one rich bullet, house style,
  continuation lines indented.
```

Allowed sections: `Added`, `Changed`, `Fixed`, `Removed`. Usually one
section per fragment; multiple section blocks are legal when a lane
genuinely spans them.

## The roll

A release lane runs:

```sh
node scripts/roll-changelog.mjs --dry-run            # preview, no writes
node scripts/roll-changelog.mjs --version X.Y.Z      # fold + delete fragments
```

The roll compiles fragments — sections in canonical order, fragments within
a section by ascending issue number (filename tiebreak) — into the new
`## [X.Y.Z]` section of CHANGELOG.md and deletes the fragment files. It is
deterministic; CI dry-runs it twice and diffs the outputs. Released
CHANGELOG.md sections are never rewritten.

Law: CLAUDE.md §8. ADR: `decisions/2026-06-11-changelog-fragments-adr-per-file-split.md`.

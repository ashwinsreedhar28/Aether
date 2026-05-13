# Changelog

All notable changes to homeOS are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme).

## [Unreleased]

### Added

- Markdown app (`shell/src/apps/markdown/`, order: 70, icon: `FileText`):
  opens `.md` / `.markdown` files via native dialog, renders with
  `react-markdown` + `remark-gfm` + holographic-tinted styles. Bundled
  About page on first launch.
- `AppDefinition` gains optional `fileTypes: string[]` and
  `iconForFile?: (path) => string` for file-based apps. App registry
  gains `getAppsForFileType(ext)` helper for future file-route routing
  (no consumers wired yet).
- Preload gains `window.homeOS.files` surface (`openDialog`, `readText`
  with 1 MiB cap and home/userData/downloads/temp allowlist guard).

### Changed

- Workflow refactor: Architect↔Implementer reviews now ride on PR
  comments (Director relays one paste per round-trip, down from ~four).
  §11 First Task removed and replaced with an Architect Review
  Heuristics checklist self-applied before each PR. §7 self-review
  template gains a heuristics-check section.

### Fixed

### Removed

## [0.0.3] - 2026-05-12

### Added

- App-discovery system (`import.meta.glob` of `src/apps/*`,
  `AppDefinition` shape adopted from VIEWER). Drop a folder into
  `src/apps/<name>/` with an `index.ts` exporting an `AppDefinition`
  and it auto-registers. (Apps declare an optional `order: number`
  for nav placement; default 100.)
- First content app: `news` with three hardcoded faked articles
  (Jarvis-feeling categories spanning finance/tech/sports, urgency
  and category styling via holographic theme). Faked data — no
  polling, no mesh, no real source yet.
- Welcome window refactored into the `welcome` app, discovered the
  same way as every other app.

### Changed

### Fixed

- Top nav no longer clashes with macOS traffic-light buttons under
  `titleBarStyle: 'hiddenInset'`; nav now respects an 80px left
  inset on macOS and exposes the empty strip as a drag region.

### Removed

## [0.0.2] - 2026-05-12

### Added

### Changed

- Converted `_ingest/{Pulse, RAVEN_MESH, NEXUS, VIEWER}` from gitignored
  clones to git submodules pinned to specific SHAs (see DECISIONS.md).

### Fixed

- Removed leftover `_ingest/` entry from `.gitignore` that PR #2 intended
  to delete but never staged (PR #3, no functional change — gitlinks
  override ignore rules).

### Removed

## [0.0.1] - 2026-05-12

### Added

- Electron shell skeleton (`shell/`) with `electron-vite`, React 19,
  Tailwind 4, TypeScript strict. `pnpm dev` boots a single holographic
  welcome window via splash → renderer-ready → reveal sequence (pattern
  lifted from Pulse's main/index.ts; theme values from VIEWER).
- macOS tray icon with deterministic stdlib-only PNG generator
  (`scripts/gen-tray-icon.mjs`, adapted from Pulse). Clicking the tray
  opens/focuses the welcome window.
- Holographic theme as CSS variables under `shell/src/theme/holographic.css`.
- `DECISIONS.md` initialised with the three week-1 ADRs (top-down strategy,
  pnpm adopted, holographic theme adopted from VIEWER).

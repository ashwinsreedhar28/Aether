# Changelog

All notable changes to homeOS are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning per
CLAUDE.md §6 (honest pre-1.0 scheme).

## [Unreleased]

### Added

### Changed

### Fixed

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

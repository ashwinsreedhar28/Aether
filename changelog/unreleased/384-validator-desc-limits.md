### Fixed
- Manifest validator startup ERROR spam silenced (#384): trimmed all seven
  over-limit `metadata.description` blocks (github, research, visualizer,
  viewer_desktop, sports, calendar, music) to ≤280-char summaries
  cross-refing each node's README — boot now produces zero
  manifest_validator schema errors. viewer_desktop's displaced prose lives
  in its new `nodes/viewer_desktop/README.md`.

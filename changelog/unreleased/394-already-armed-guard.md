### Added
- work_on_issue already-armed guard (#394): a spoken arm targeting an issue
  that already holds a requested-or-live lane record (requested | spawned |
  teardown_failed — the capacity set) now refuses at the source and points
  at the existing state ("already armed, sir — approve the card" / "lane #N
  is already live") instead of minting a duplicate batch — the July-14
  double-arm shape (#383, issue 374 armed twice 29s apart). Per-issue
  resolution is status FIRST over the arming set, so a dead newer duplicate
  never masks the live lane and dead records alone never block a fresh arm;
  batch calls filter per-issue (arm the rest, name the skipped, zero API
  reads for skipped issues) and run the guard before the capacity check so
  held slots never inflate the capacity ask. Not overridable by
  `confirmed`. The #397 fold makes duplicates harmless; this makes them
  rare. Guard tests pin both duplicate directions against the #383 parity
  fixture. Closes #394.

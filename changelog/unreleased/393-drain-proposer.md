### Added
- Drain proposer — self-staffing v0, propose-only (#393): a shell-main
  service (laneMonitor's sibling) that notices ratified, unclaimed work and
  proposes it, while the Director's tap remains the ONLY spawn trigger. On
  boot, every 30 min (`AETHER_DRAIN_TICK_MIN`), and on lane close-out (a
  live-count drop on spawnService's 'changed' broadcast) it scans the open
  `label:lane` board over the existing shell → github edges: no live or
  pending lane record in the ledger fold, no HOLD label (any casing, the
  a2-shadow rule), an ARCHITECT RATIFICATION comment on the thread —
  oldest-first, per-issue get_issue, stopping at capacity
  (`AETHER_DRAIN_MAX_LANES`, default 3 = the human-gated cap; 'requested'
  holds a slot too, mirroring raven's _committed_count). Candidates arm ONE
  batch through the EXISTING work_on_issue machinery — byte-shape-identical
  lane request lines (targets from the latest ARCHITECT SPEC text or the
  #268 defaults, ~ unexpanded; sparse `submodules` per #376), one fsynced
  append, the same watcher → card → approve/dismiss → recipe — plus a host
  notification ("Drain proposal: capacity M — spawn #a, #b?"). One proposal
  in flight ever; a dismissed card writes a drain-family dismissal line that
  suppresses its candidates for 24h across restarts. The new kind:'drain'
  ledger family follows the gate/telemetry inertness posture — no `status`
  field, so every existing fold on BOTH sides ignores it with zero
  raven-core edits (pinned in the mixed-family fixtures and a per-fold
  inertness sweep; the parity table itself stays byte-identical to its
  Python twin). Closes #393.

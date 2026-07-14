### Fixed
- Raven's gate fold learns the R2 revision loop (#372, a #241 sibling-drift
  specimen): `lane_gate_tool.py` now mirrors `laneGate.ts` `gatePhase()`
  exactly — the third lane-channel prefix (DIRECTOR FEEDBACK), the REVISING
  phase (feedback strictly newer than the report), the post-revision report
  superseding back to at-gate with zero clearing logic, and the
  newer-than-spawn guard extended to the third prefix. Voice's "what's ready
  to test" no longer counts a REVISING lane as at-gate — it owes a revision
  and is counted as still working. A pinned phase-parity table (the literal
  #339 fixture bodies and timestamps from `laneGate.test.ts`) plus the third
  prefix literal now sit in both sides' tests, so a drift on either side
  fails a test instead of silently splitting the lane channel.

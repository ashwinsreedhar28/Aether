### Changed
- Extracted the relative-time helper (`relTime`) the Gaps, Lanes, and News
  boards each inlined into one shared `shell/src/utils/relTime.ts` (#349),
  clearing §15's rule-of-three flagged in the News PR (#346). Behavior-
  preserving: the buckets/thresholds (s/m/h/d) were already byte-identical
  across the three; the shared helper keys on epoch ms with a per-caller
  invalid sentinel (Gaps/Lanes show '—', News shows '') and News parses its
  ISO timestamp at the call site, matching the Gaps board's existing
  created_at call. No visible change in any of the three apps. Closes #349.

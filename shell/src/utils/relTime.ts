// One relative-time helper for the read-only boards (#349, clearing §15's
// rule-of-three flagged in the News PR #346). Was inlined identically in the
// Gaps, Lanes, and News apps; the buckets/thresholds below were byte-identical
// across all three.

/**
 * "12m ago" from an epoch-ms timestamp. Buckets: <60s → seconds, <1h → minutes,
 * <1d → hours, else days.
 *
 * `invalid` is returned for a falsy or NaN `ms` (0, a null-coalesced 0, or an
 * unparseable date) — the Gaps and Lanes boards show '—' (the default); the
 * News row passes '' so an undatable article renders as just its feed name.
 * Callers holding an ISO string parse at the call site
 * (`relTime(Date.parse(iso), '')`), matching the Gaps board's existing
 * created_at call.
 */
export function relTime(ms: number, invalid = '—'): string {
  if (!ms || Number.isNaN(ms)) return invalid;
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

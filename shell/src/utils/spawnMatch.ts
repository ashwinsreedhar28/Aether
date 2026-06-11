import type { SpawnView } from '../types/aether'

// One matcher for "which spawn record does this lane mean?" — shared by the
// clickable Lanes rows and the show-lane-card voice path (#305) so a click and
// "show me lane N's card" always raise the SAME record. Match keys per the
// spec: issue number and branch; lane-kind branches follow the #268 default
// `lane/issue-N`, so a branch alone still yields an issue to match on.

// Parse the issue number out of a #268-default lane branch, else null.
export function laneIssueOf(branch: string): number | null {
  const m = /^lane\/issue-(\d+)$/.exec(branch)
  return m ? Number(m[1]) : null
}

/**
 * The record a lane query (issue and/or branch) names. Several records can
 * share a branch across the ledger's history (a dismissed request, then a
 * re-arm); prefer the one with a live card worth raising — requested, spawned,
 * or a teardown_failed record still holding its capacity slot (#317) — and
 * fall back to the newest match (`spawns` arrives newest-request-first from
 * the ledger fold). Null when nothing matches: not every worktree row has a
 * spawn record (the main checkout, hand-made worktrees).
 */
export function matchSpawnRecord(
  spawns: SpawnView[],
  query: { issue?: number; branch?: string },
): SpawnView | null {
  const issue = query.issue ?? (query.branch ? laneIssueOf(query.branch) : null)
  const matches = spawns.filter(
    (s) =>
      (issue != null && s.issue === issue) ||
      (query.branch != null && (s.branch ?? s.targetBranch) === query.branch),
  )
  return (
    matches.find(
      (s) =>
        s.status === 'requested' || s.status === 'spawned' || s.status === 'teardown_failed',
    ) ??
    matches[0] ??
    null
  )
}

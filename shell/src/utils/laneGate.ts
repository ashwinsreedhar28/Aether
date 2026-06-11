// The machine-readable lane channel, renderer side (#310). A spawned lane
// posts to ITS OWN issue thread with fixed comment prefixes — the kickoff
// (spawnService.laneKickoff) dictates them, this file folds them into the
// card's gate state. Prefix convention ONLY: nothing inside the report body
// is parsed (out of scope in v1 by spec). The prefix literals are duplicated
// here and in the kickoff template — main-process and renderer code don't
// share imports — and each side pins its copy in tests.
//
// Pull-based by spec: the card runs one github.get_issue read on open plus an
// explicit refresh (the `shell → github.get_issue` manifest edge); there is
// no background poller.

export const GATE_REPORT_PREFIX = 'GATE REPORT'
export const PR_OPENED_PREFIX = 'PR OPENED'

// The comment shape github.get_issue serves (nodes/github, RawComment).
// Fields land as unknown because the payload crosses the mesh as plain JSON.
export interface GateStateInput {
  body?: unknown
  created_at?: unknown
}

export interface LaneGateState {
  // The latest GATE REPORT comment posted after the spawn, verbatim (shown
  // inline on the AT GATE card). Null while the lane is still working.
  report: string | null
  // The latest PR OPENED comment posted after the spawn — upgrades the card
  // past AT GATE; `url` is the first link in the comment (the kickoff dictates
  // "PR OPENED — #<pr-number> <pr-url>").
  pr: { body: string; url: string | null } | null
}

/**
 * Fold an issue's comments (oldest-first, as github.get_issue serves them)
 * into the lane's gate state. Only comments STRICTLY NEWER than the record's
 * spawned event count — a respawn on the same issue must never resurrect the
 * previous run's report — and an unparseable timestamp (either side) never
 * passes the guard. Latest matching comment wins per prefix.
 */
export function foldGateComments(comments: unknown, spawnedAtIso: string): LaneGateState {
  const state: LaneGateState = { report: null, pr: null }
  const spawnedAt = Date.parse(spawnedAtIso)
  if (!Array.isArray(comments) || !Number.isFinite(spawnedAt)) return state
  for (const c of comments as GateStateInput[]) {
    if (typeof c?.body !== 'string' || typeof c?.created_at !== 'string') continue
    const at = Date.parse(c.created_at)
    if (!Number.isFinite(at) || at <= spawnedAt) continue
    const lead = c.body.trimStart()
    if (lead.startsWith(GATE_REPORT_PREFIX)) {
      state.report = c.body
    } else if (lead.startsWith(PR_OPENED_PREFIX)) {
      state.pr = { body: c.body, url: firstUrl(c.body) }
    }
  }
  return state
}

// First http(s) link in a PR OPENED comment. Trailing punctuation a sentence
// might pin to the URL (closing bracket, period) is excluded from the match.
function firstUrl(s: string): string | null {
  const m = /https?:\/\/[^\s)\]>]+/.exec(s)
  if (!m) return null
  return m[0].replace(/[.,;]+$/, '')
}

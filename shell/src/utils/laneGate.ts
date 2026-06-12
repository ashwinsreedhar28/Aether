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
  // The report comment's created_at, verbatim — the identity of THIS gate
  // arrival. A re-gate posts a new comment (new created_at); a refresh of an
  // already-gated lane re-serves the same one. The toast dedupe below keys
  // on it (#340).
  reportAt: string | null
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
  const state: LaneGateState = { report: null, reportAt: null, pr: null }
  const spawnedAt = Date.parse(spawnedAtIso)
  if (!Array.isArray(comments) || !Number.isFinite(spawnedAt)) return state
  for (const c of comments as GateStateInput[]) {
    if (typeof c?.body !== 'string' || typeof c?.created_at !== 'string') continue
    const at = Date.parse(c.created_at)
    if (!Number.isFinite(at) || at <= spawnedAt) continue
    const lead = c.body.trimStart()
    if (lead.startsWith(GATE_REPORT_PREFIX)) {
      state.report = c.body
      state.reportAt = c.created_at
    } else if (lead.startsWith(PR_OPENED_PREFIX)) {
      state.pr = { body: c.body, url: firstUrl(c.body) }
    }
  }
  return state
}

// ---- READY TO TEST toast dedupe (#340) ---------------------------------------
// One toast per GATE ARRIVAL: the first fold that sees a given report comment
// (keyed by issue + the comment's created_at) claims the toast; every refresh
// re-serving the same report stays silent, and a re-gate (a NEW report
// comment) claims a fresh one. Session-scoped on purpose — the memory lives
// with the pull-based fold, not the ledger (gate-state changes are out of
// scope by spec), so an app relaunch re-announces a still-gated lane once.
const toastedReportAt = new Map<number, string>()

/**
 * True exactly once per gate arrival — and claiming is the side effect:
 * a true return RECORDS the announce, so the caller must actually fire the
 * toast on it. False whenever the lane is not at its gate (no report, or a
 * PR OPENED already upgraded it past the gate) or this report was announced.
 */
export function shouldToastGate(issue: number, gate: LaneGateState): boolean {
  if (!gate.report || gate.reportAt === null || gate.pr) return false
  if (toastedReportAt.get(issue) === gate.reportAt) return false
  toastedReportAt.set(issue, gate.reportAt)
  return true
}

// Test-only: clear the session dedupe memory between cases.
export function _resetGateToasts(): void {
  toastedReportAt.clear()
}

// First http(s) link in a PR OPENED comment. Trailing punctuation a sentence
// might pin to the URL (closing bracket, period) is excluded from the match.
function firstUrl(s: string): string | null {
  const m = /https?:\/\/[^\s)\]>]+/.exec(s)
  if (!m) return null
  return m[0].replace(/[.,;]+$/, '')
}

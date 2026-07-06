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
// The third prefix (#339, the R2 revision loop): the Director's freeform
// feedback on a gated lane, posted to the issue thread (by the card's REVISE
// path, or by hand). Freeform content travels the THREAD only — the pane
// never receives anything but allowlisted sentences (spawnLedger.ts).
export const DIRECTOR_FEEDBACK_PREFIX = 'DIRECTOR FEEDBACK'

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
  // The latest DIRECTOR FEEDBACK comment posted after the spawn, verbatim
  // (#339 — shown inline on the REVISING card). Latest-comment-only by
  // doctrine: earlier feedback is history, never accumulated.
  feedback: string | null
  // The feedback comment's created_at — compared against reportAt to resolve
  // the REVISING phase (feedback strictly newer than the report). A fresh
  // post-revision GATE REPORT is newer again, so latest-wins flips the card
  // back to AT GATE with zero clearing logic: supersession IS the clear.
  feedbackAt: string | null
}

/**
 * Fold an issue's comments (oldest-first, as github.get_issue serves them)
 * into the lane's gate state. Only comments STRICTLY NEWER than the record's
 * spawned event count — a respawn on the same issue must never resurrect the
 * previous run's report — and an unparseable timestamp (either side) never
 * passes the guard. Latest matching comment wins per prefix.
 */
export function foldGateComments(comments: unknown, spawnedAtIso: string): LaneGateState {
  const state: LaneGateState = { report: null, reportAt: null, pr: null, feedback: null, feedbackAt: null }
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
    } else if (lead.startsWith(DIRECTOR_FEEDBACK_PREFIX)) {
      state.feedback = c.body
      state.feedbackAt = c.created_at
    }
  }
  return state
}

// ---- gate phase (#339) --------------------------------------------------------

export type GatePhase = 'working' | 'at-gate' | 'revising' | 'pr-opened'

/**
 * Resolve a folded gate state to the card's phase. Pure precedence, no
 * clearing logic anywhere: PR OPENED wins outright; a report with feedback
 * STRICTLY newer than it is REVISING (the lane owes a revision); a report
 * otherwise is AT GATE; anything else — including preemptive feedback posted
 * before any report — is still working.
 */
export function gatePhase(gate: LaneGateState | null): GatePhase {
  if (!gate) return 'working'
  if (gate.pr) return 'pr-opened'
  if (!gate.report) return 'working'
  if (
    gate.feedbackAt !== null &&
    gate.reportAt !== null &&
    Date.parse(gate.feedbackAt) > Date.parse(gate.reportAt)
  ) {
    return 'revising'
  }
  return 'at-gate'
}

// ---- the card's REVISE decision (#339) ----------------------------------------
// Pure so the AC3 semantics are testable without React: typed feedback is
// posted to the thread then relayed; an empty press against fresh thread
// feedback (the REVISING phase) relays only; an empty press with nothing to
// revise against is a NAMED refusal — the relay sentence points the lane at
// "the latest DIRECTOR FEEDBACK", so firing it with no such comment would be
// an order with no contract behind it.

export type ReviseAction =
  | { kind: 'post-and-relay'; text: string }
  | { kind: 'relay-only' }
  | { kind: 'refuse'; error: string }

export function resolveReviseAction(gate: LaneGateState | null, input: string): ReviseAction {
  const text = input.trim()
  if (text) return { kind: 'post-and-relay', text }
  if (gatePhase(gate) === 'revising') return { kind: 'relay-only' }
  return {
    kind: 'refuse',
    error:
      'nothing to revise against — type feedback above, or post a DIRECTOR FEEDBACK comment on the issue thread first',
  }
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
 * toast on it. False whenever the lane is not at its gate (no report, a
 * PR OPENED already upgraded it past the gate, or fresh DIRECTOR FEEDBACK
 * holds it REVISING — a revising lane is not ready to test) or this report
 * was announced. A post-revision GATE REPORT is a new comment with a new
 * reportAt, so the re-gate claims a fresh toast (#339 keeps #340's key).
 */
export function shouldToastGate(issue: number, gate: LaneGateState): boolean {
  if (gatePhase(gate) !== 'at-gate' || gate.reportAt === null) return false
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

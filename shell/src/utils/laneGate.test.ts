// Isolated test for the lane-channel fold (#310) — the prefix convention and
// the newer-than-spawn guard, against plain comment objects. No React, no
// mesh, no DOM.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/src/utils/laneGate.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  _resetGateToasts,
  DIRECTOR_FEEDBACK_PREFIX,
  foldGateComments,
  GATE_REPORT_PREFIX,
  gatePhase,
  PR_OPENED_PREFIX,
  resolveReviseAction,
  shouldToastGate,
} from './laneGate.ts'

const SPAWNED = '2026-06-11T10:00:00.000Z'
const comment = (body: string, created_at: string): { body: string; created_at: string } => ({
  body,
  created_at,
})

// The empty fold — every field null (the shape assertions below pin it).
const INERT = { report: null, reportAt: null, pr: null, feedback: null, feedbackAt: null }

test('prefix literals match the kickoff contract', () => {
  // The kickoff template (spawnService.laneKickoff) dictates these as the
  // comment leads; its own test pins the full "GATE REPORT — " / "PR OPENED — "
  // forms. DIRECTOR FEEDBACK is posted by the card's REVISE path
  // (spawnService pins the same literal on the main-process side). A drift on
  // either side breaks the lane channel.
  assert.equal(GATE_REPORT_PREFIX, 'GATE REPORT')
  assert.equal(PR_OPENED_PREFIX, 'PR OPENED')
  assert.equal(DIRECTOR_FEEDBACK_PREFIX, 'DIRECTOR FEEDBACK')
})

test('a gate report newer than the spawn flips AT GATE; older comments are inert', () => {
  const stale = comment('GATE REPORT — from a previous run', '2026-06-11T09:00:00Z')
  const fresh = comment('GATE REPORT — verify clean: build ✓ typecheck ✓', '2026-06-11T11:00:00Z')
  assert.deepEqual(foldGateComments([stale], SPAWNED), INERT)
  const folded = foldGateComments([stale, fresh], SPAWNED)
  assert.equal(folded.report, fresh.body)
  // The report's created_at rides along — the toast dedupe's gate-arrival key.
  assert.equal(folded.reportAt, fresh.created_at)
  assert.equal(folded.pr, null)
})

test('the latest report wins; PR OPENED upgrades the state and carries the first URL', () => {
  const folded = foldGateComments(
    [
      comment('GATE REPORT — first pass', '2026-06-11T11:00:00Z'),
      comment('GATE REPORT — second pass after fixup', '2026-06-11T12:00:00Z'),
      comment('PR OPENED — #311 https://github.com/x/aether/pull/311.', '2026-06-11T13:00:00Z'),
    ],
    SPAWNED,
  )
  assert.equal(folded.report, 'GATE REPORT — second pass after fixup')
  assert.equal(folded.pr?.url, 'https://github.com/x/aether/pull/311')
})

test('non-channel comments, garbage shapes, and bad timestamps never pass', () => {
  const folded = foldGateComments(
    [
      comment('just chatting about the GATE REPORT idea', '2026-06-11T11:00:00Z'),
      comment('GATE REPORT — unparseable time', 'not-a-date'),
      { body: 42, created_at: '2026-06-11T11:00:00Z' },
      null,
    ],
    SPAWNED,
  )
  assert.deepEqual(folded, INERT)
  // Non-array payloads and an unparseable spawn time degrade to inert.
  assert.deepEqual(foldGateComments(undefined, SPAWNED), INERT)
  assert.deepEqual(
    foldGateComments([comment('GATE REPORT — x', '2026-06-11T11:00:00Z')], 'bad-spawn-ts'),
    INERT,
  )
})

// ---- the R2 revision loop (#339): DIRECTOR FEEDBACK + phase resolution --------

test('feedback newer than the report resolves REVISING; a post-revision report flips back to AT GATE', () => {
  const report = comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')
  const feedback = comment('DIRECTOR FEEDBACK — the toast fires twice, fix the dedupe', '2026-06-11T12:00:00Z')
  const revising = foldGateComments([report, feedback], SPAWNED)
  assert.equal(revising.feedback, feedback.body)
  assert.equal(revising.feedbackAt, feedback.created_at)
  assert.equal(gatePhase(revising), 'revising')
  // The post-revision report is newer than the feedback — latest-wins IS the
  // clearing mechanism: no field resets, phase alone flips back.
  const regate = comment('GATE REPORT — pass 2, dedupe fixed', '2026-06-11T13:00:00Z')
  const back = foldGateComments([report, feedback, regate], SPAWNED)
  assert.equal(gatePhase(back), 'at-gate')
  // The stale feedback still rides the fold verbatim (history, not contract).
  assert.equal(back.feedback, feedback.body)
  // PR OPENED outranks everything, feedback included.
  const pr = comment('PR OPENED — #400 https://github.com/x/aether/pull/400', '2026-06-11T14:00:00Z')
  assert.equal(gatePhase(foldGateComments([report, feedback, regate, pr], SPAWNED)), 'pr-opened')
})

test('preemptive feedback before any report leaves the phase at working', () => {
  const early = foldGateComments(
    [comment('DIRECTOR FEEDBACK — while you are in there, rename the flag', '2026-06-11T11:00:00Z')],
    SPAWNED,
  )
  assert.equal(early.feedback?.includes('rename the flag'), true)
  assert.equal(early.report, null)
  assert.equal(gatePhase(early), 'working')
  assert.equal(gatePhase(null), 'working')
})

test('the newer-than-spawn guard covers DIRECTOR FEEDBACK — a previous run\'s feedback is inert', () => {
  const stale = comment('DIRECTOR FEEDBACK — from the previous run', '2026-06-11T09:00:00Z')
  assert.deepEqual(foldGateComments([stale], SPAWNED), INERT)
  // The latest feedback comment wins, exactly like the report fold.
  const f1 = comment('DIRECTOR FEEDBACK — first round', '2026-06-11T11:00:00Z')
  const f2 = comment('DIRECTOR FEEDBACK — consolidated round two', '2026-06-11T12:00:00Z')
  assert.equal(foldGateComments([f1, f2], SPAWNED).feedback, f2.body)
})

test('resolveReviseAction: typed feedback posts-and-relays; empty against REVISING relays only; empty otherwise is a named refusal', () => {
  const report = comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')
  const feedback = comment('DIRECTOR FEEDBACK — fix it', '2026-06-11T12:00:00Z')
  const atGate = foldGateComments([report], SPAWNED)
  const revising = foldGateComments([report, feedback], SPAWNED)
  // Typed text wins in every phase (whitespace trimmed before posting).
  assert.deepEqual(resolveReviseAction(atGate, '  the button mislabels  '), {
    kind: 'post-and-relay',
    text: 'the button mislabels',
  })
  // Empty press with fresh thread feedback (posted by hand, or a prior REVISE
  // whose relay failed): the relay alone re-fires.
  assert.deepEqual(resolveReviseAction(revising, ''), { kind: 'relay-only' })
  // Empty press with nothing to revise against: refused by name, no relay.
  const refused = resolveReviseAction(atGate, '   ')
  assert.equal(refused.kind, 'refuse')
  assert.match(refused.kind === 'refuse' ? refused.error : '', /nothing to revise against/)
  assert.equal(resolveReviseAction(null, '').kind, 'refuse')
})

test('toast fires once per gate arrival; refreshes of the same report stay silent', () => {
  _resetGateToasts()
  const atGate = foldGateComments([comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')], SPAWNED)
  // First fold that sees the report claims the toast; the identical re-fold
  // (an explicit REFRESH, a card remount) does not.
  assert.equal(shouldToastGate(310, atGate), true)
  assert.equal(shouldToastGate(310, atGate), false)
  assert.equal(
    shouldToastGate(310, foldGateComments([comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')], SPAWNED)),
    false,
  )
  // Per-issue memory: another lane's identical-timestamp report still toasts.
  assert.equal(shouldToastGate(311, atGate), true)
})

test('a re-gate (new report comment) toasts again; working and PR-opened lanes never do', () => {
  _resetGateToasts()
  // Still working — nothing to announce.
  assert.equal(shouldToastGate(310, foldGateComments([], SPAWNED)), false)
  const first = comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')
  assert.equal(shouldToastGate(310, foldGateComments([first], SPAWNED)), true)
  // The re-gate is a NEW comment — a fresh arrival, a fresh toast.
  const regate = comment('GATE REPORT — pass 2 after fixup', '2026-06-11T12:00:00Z')
  assert.equal(shouldToastGate(310, foldGateComments([first, regate], SPAWNED)), true)
  // PR OPENED upgrades past the gate: the lane is no longer "ready to test".
  const pr = comment('PR OPENED — #341 https://github.com/x/aether/pull/341', '2026-06-11T13:00:00Z')
  assert.equal(shouldToastGate(310, foldGateComments([first, regate, pr], SPAWNED)), false)
})

test('the revision loop and the toast (#339): REVISING never toasts; the post-revision report toasts once', () => {
  _resetGateToasts()
  const report = comment('GATE REPORT — pass 1', '2026-06-11T11:00:00Z')
  assert.equal(shouldToastGate(339, foldGateComments([report], SPAWNED)), true)
  // Feedback lands → REVISING. Same reportAt, and not at the gate anyway.
  const feedback = comment('DIRECTOR FEEDBACK — broken on wide displays', '2026-06-11T12:00:00Z')
  assert.equal(shouldToastGate(339, foldGateComments([report, feedback], SPAWNED)), false)
  // A REVISING lane stays silent even with fresh session memory (the app
  // relaunch case): it is not ready to test, nothing to announce.
  _resetGateToasts()
  assert.equal(shouldToastGate(339, foldGateComments([report, feedback], SPAWNED)), false)
  // The post-revision report is a new comment — new reportAt, new arrival,
  // ONE fresh toast (the dedupe keys on reportAt).
  const regate = comment('GATE REPORT — pass 2, wide displays fixed', '2026-06-11T13:00:00Z')
  assert.equal(shouldToastGate(339, foldGateComments([report, feedback, regate], SPAWNED)), true)
  assert.equal(shouldToastGate(339, foldGateComments([report, feedback, regate], SPAWNED)), false)
})

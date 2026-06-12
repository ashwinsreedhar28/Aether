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
  foldGateComments,
  GATE_REPORT_PREFIX,
  PR_OPENED_PREFIX,
  shouldToastGate,
} from './laneGate.ts'

const SPAWNED = '2026-06-11T10:00:00.000Z'
const comment = (body: string, created_at: string): { body: string; created_at: string } => ({
  body,
  created_at,
})

test('prefix literals match the kickoff contract', () => {
  // The kickoff template (spawnService.laneKickoff) dictates these as the
  // comment leads; its own test pins the full "GATE REPORT — " / "PR OPENED — "
  // forms. A drift on either side breaks the lane channel.
  assert.equal(GATE_REPORT_PREFIX, 'GATE REPORT')
  assert.equal(PR_OPENED_PREFIX, 'PR OPENED')
})

test('a gate report newer than the spawn flips AT GATE; older comments are inert', () => {
  const stale = comment('GATE REPORT — from a previous run', '2026-06-11T09:00:00Z')
  const fresh = comment('GATE REPORT — verify clean: build ✓ typecheck ✓', '2026-06-11T11:00:00Z')
  assert.deepEqual(foldGateComments([stale], SPAWNED), { report: null, reportAt: null, pr: null })
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
  assert.deepEqual(folded, { report: null, reportAt: null, pr: null })
  // Non-array payloads and an unparseable spawn time degrade to inert.
  assert.deepEqual(foldGateComments(undefined, SPAWNED), { report: null, reportAt: null, pr: null })
  assert.deepEqual(
    foldGateComments([comment('GATE REPORT — x', '2026-06-11T11:00:00Z')], 'bad-spawn-ts'),
    { report: null, reportAt: null, pr: null },
  )
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

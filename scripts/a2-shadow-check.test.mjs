// Fixture-payload tests for the A2 shadow checker's pure verdict core (#392).
// Shapes mirror the GitHub API payloads the live fetchers hand to evaluate().
// Run: node --test scripts/

import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, inClass, verdictComment } from './a2-shadow-check.mjs'

const SHA = 'a'.repeat(40)
const ALLOW = ['docs/retros/**', 'docs/governance-log.md', 'docs/**.md', 'changelog/unreleased/**', 'decisions/**', 'DECISIONS.md']

const fixture = () => ({
  headSha: SHA,
  files: ['docs/retros/2026-07-15-sprint.md', 'docs/governance-log.md', 'docs/releases/v0.12.0.md', 'changelog/unreleased/390-x.md', 'decisions/2026-07-16-y.md', 'DECISIONS.md'],
  prComments: [
    { body: `REVIEWER: APPROVE\nReviewed ${SHA} against issue #390.`, created_at: '2026-07-15T12:00:00Z' },
    { body: '## Auto-review (mechanical checks)\n**1.** ✓ all headings\n**3.** ⊘ no ADR', created_at: '2026-07-15T12:05:00Z' },
  ],
  checkRuns: [
    { name: 'checks', status: 'completed', conclusion: 'success' },
    { name: 'auto-review', status: 'completed', conclusion: 'skipped' },
    { name: 'shadow / A2 Shadow', status: 'in_progress', conclusion: null },
  ],
  linkedIssues: [{
    number: 390,
    labels: ['lane'],
    comments: [
      { body: 'ARCHITECT RATIFICATION — cleared to spawn. (Director)', created_at: '2026-07-14T10:00:00Z' },
      { body: 'GATE REPORT — all green', created_at: '2026-07-14T20:00:00Z' },
    ],
  }],
})

test('class-1 merge with all conditions green → AGREE', () => {
  assert.deepEqual(evaluate(fixture()), { verdict: 'AGREE', reasons: [] })
})

test('any touched file outside the allowlist → OUT-OF-CLASS, other conditions unjudged', () => {
  const f = fixture()
  f.files.push('shell/src/stores/laneGate.ts')
  f.prComments = []
  const r = evaluate(f)
  assert.equal(r.verdict, 'OUT-OF-CLASS')
  assert.deepEqual(r.reasons, ['shell/src/stores/laneGate.ts outside class-1 allowlist'])
})

test('allowlist is path-match only: md under docs/ in, non-md out, retros/** any type in', () => {
  assert.equal(inClass('docs/releases/v0.12.0.md', ALLOW), true)
  assert.equal(inClass('docs/img/topology.png', ALLOW), false)
  assert.equal(inClass('docs/retros/board.png', ALLOW), true)
  assert.equal(inClass('scripts/a2-classes.json', ALLOW), false)
  assert.equal(inClass('DECISIONS.md', ALLOW), true)
})

test('missing ratification → DISAGREE', () => {
  const f = fixture()
  f.linkedIssues[0].comments = f.linkedIssues[0].comments.slice(1)
  assert.deepEqual(evaluate(f), { verdict: 'DISAGREE', reasons: ['issue #390: no ARCHITECT RATIFICATION comment'] })
})

test('ratification postdating the first gate report → DISAGREE', () => {
  const f = fixture()
  f.linkedIssues[0].comments[0].created_at = '2026-07-14T21:00:00Z'
  assert.equal(evaluate(f).verdict, 'DISAGREE')
})

test('no gate report to order ratification against → DISAGREE', () => {
  const f = fixture()
  f.linkedIssues[0].comments = f.linkedIssues[0].comments.slice(0, 1)
  assert.deepEqual(evaluate(f).reasons, ['issue #390: no GATE REPORT comment to order ratification against'])
})

test('REVIEWER: APPROVE with a different Reviewed SHA → DISAGREE', () => {
  const f = fixture()
  f.prComments[0].body = `REVIEWER: APPROVE\nReviewed ${'b'.repeat(40)} against issue #390.`
  assert.deepEqual(evaluate(f).reasons, [`no REVIEWER: APPROVE with Reviewed SHA ${SHA}`])
})

test('red or unfinished check run on the merged head → DISAGREE; own run excluded', () => {
  const f = fixture()
  f.checkRuns[0].conclusion = 'failure'
  assert.deepEqual(evaluate(f).reasons, ['check run "checks" not green (failure)'])
})

test('auto-review missing, or latest one carrying ⚠ → DISAGREE', () => {
  const f = fixture()
  f.prComments[1].body += '\n**2.** ⚠ changelog fragment missing'
  assert.deepEqual(evaluate(f).reasons, ['mechanical auto-review has ⚠ concerns'])
  f.prComments = f.prComments.slice(0, 1)
  assert.deepEqual(evaluate(f).reasons, ['no mechanical auto-review comment'])
})

test('HOLD label on the linked issue → DISAGREE', () => {
  const f = fixture()
  f.linkedIssues[0].labels.push('HOLD')
  assert.deepEqual(evaluate(f).reasons, ['issue #390: HOLD label present'])
})

test('no Closes-issue → DISAGREE', () => {
  const f = fixture()
  f.linkedIssues = []
  assert.deepEqual(evaluate(f).reasons, ['no Closes-issue referenced from the PR body'])
})

test('verdict comments open with the exact A2-SHADOW marker --tally parses', () => {
  assert.match(verdictComment({ verdict: 'AGREE', reasons: [] }, SHA), /^A2-SHADOW: AGREE \(class-1\)/)
  assert.match(verdictComment({ verdict: 'OUT-OF-CLASS', reasons: ['x outside class-1 allowlist'] }, SHA), /^A2-SHADOW: OUT-OF-CLASS/)
  assert.match(verdictComment({ verdict: 'DISAGREE', reasons: ['r1', 'r2'] }, SHA), /^A2-SHADOW: DISAGREE \(r1; r2\)/)
})

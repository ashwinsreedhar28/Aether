// Isolated tests for the login-shell capture extraction (#302 defect 6) —
// rc files print banners around probe output, so a single value read from a
// `-l`/`-lic` capture is extracted, never trim()-trusted.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/shellCapture.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickBinaryLine } from './shellCapture.ts'

test('verbatim field fixture: Apple Terminal banner above the path', () => {
  // The exact capture that poisoned tmuxBin in the field (defect 6).
  assert.equal(
    pickBinaryLine('Restored session: Thu Jun 11 02:22:13 PDT 2026\n/opt/homebrew/bin/tmux'),
    '/opt/homebrew/bin/tmux',
  )
})

test('clean single-line capture passes through', () => {
  assert.equal(pickBinaryLine('/opt/homebrew/bin/tmux\n'), '/opt/homebrew/bin/tmux')
})

test('rc noise trailing the path: last PATH line wins, not literally the last line', () => {
  assert.equal(
    pickBinaryLine('/opt/homebrew/bin/tmux\nso long from ~/.zlogout-style noise\n'),
    '/opt/homebrew/bin/tmux',
  )
})

test('all-noise capture yields null', () => {
  assert.equal(pickBinaryLine('Restored session: Thu Jun 11 02:22:13 PDT 2026\nno path here\n'), null)
  assert.equal(pickBinaryLine(''), null)
})

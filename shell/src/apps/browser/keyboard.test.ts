// Unit tests for the Browser app's key → action decision (#336) — pure, no
// React, no DOM.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/src/apps/browser/keyboard.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserKeyAction } from './keyboard.ts'

const cmd = (key: string) => ({ key, metaKey: true, ctrlKey: false })
const ctrl = (key: string) => ({ key, metaKey: false, ctrlKey: true })
const plain = (key: string) => ({ key, metaKey: false, ctrlKey: false })

test('cmd+t and ctrl+t open a new tab', () => {
  assert.equal(browserKeyAction(cmd('t')), 'new-tab')
  assert.equal(browserKeyAction(ctrl('t')), 'new-tab')
})

test('the pre-existing bindings are preserved: cmd+r refresh, cmd+[ back, cmd+] forward', () => {
  assert.equal(browserKeyAction(cmd('r')), 'refresh')
  assert.equal(browserKeyAction(cmd('[')), 'back')
  assert.equal(browserKeyAction(cmd(']')), 'forward')
})

test('cmd+w stays UNBOUND — the shell owns close-tab (viewerMenu CmdOrCtrl+W → menu:close-tab)', () => {
  assert.equal(browserKeyAction(cmd('w')), null)
  assert.equal(browserKeyAction(ctrl('w')), null)
})

test('unmodified keys and unknown combos are ignored', () => {
  assert.equal(browserKeyAction(plain('t')), null)
  assert.equal(browserKeyAction(plain('r')), null)
  assert.equal(browserKeyAction(cmd('x')), null)
  // Shifted keys arrive as different `key` values ('T', '{') and stay unbound,
  // matching the pre-refactor handler exactly.
  assert.equal(browserKeyAction(cmd('T')), null)
  assert.equal(browserKeyAction(cmd('{')), null)
})

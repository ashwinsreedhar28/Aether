// Unit tests for the webview window-open disposition router (#336) — pure
// decision logic, no React, no Electron, no DOM.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/src/apps/browser/windowOpenRouter.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routeWindowOpen,
  TAB_DISPOSITIONS,
  type WindowOpenHandlers,
} from './windowOpenRouter.ts'
import { BLOCKED_PROTOCOLS } from './constants.ts'

interface Recorded {
  tabs: { url: string; background: boolean }[]
  inPlace: string[]
}

const recordingHandlers = (): { rec: Recorded; handlers: WindowOpenHandlers } => {
  const rec: Recorded = { tabs: [], inPlace: [] }
  return {
    rec,
    handlers: {
      openTab: (url, opts) => rec.tabs.push({ url, background: opts.background }),
      loadInPlace: (url) => rec.inPlace.push(url),
    },
  }
}

test('each tab disposition opens a new shell tab at the URL', () => {
  for (const disposition of TAB_DISPOSITIONS) {
    const { rec, handlers } = recordingHandlers()
    const outcome = routeWindowOpen({ url: 'https://example.com/page', disposition }, handlers)
    assert.equal(outcome, 'tab', disposition)
    assert.equal(rec.tabs.length, 1, disposition)
    assert.equal(rec.tabs[0]?.url, 'https://example.com/page', disposition)
    assert.equal(rec.inPlace.length, 0, disposition)
  }
})

test('only background-tab rides in the background; foreground-tab and new-window take focus', () => {
  const { rec, handlers } = recordingHandlers()
  routeWindowOpen({ url: 'https://a.example', disposition: 'foreground-tab' }, handlers)
  routeWindowOpen({ url: 'https://b.example', disposition: 'background-tab' }, handlers)
  routeWindowOpen({ url: 'https://c.example', disposition: 'new-window' }, handlers)
  assert.deepEqual(
    rec.tabs.map((t) => t.background),
    [false, true, false],
  )
})

test('the default disposition keeps the same-webview load', () => {
  for (const disposition of ['default', 'other', 'save-to-disk']) {
    const { rec, handlers } = recordingHandlers()
    const outcome = routeWindowOpen({ url: 'https://example.com', disposition }, handlers)
    assert.equal(outcome, 'in-place', disposition)
    assert.deepEqual(rec.inPlace, ['https://example.com'], disposition)
    assert.equal(rec.tabs.length, 0, disposition)
  }
})

test('blocked protocols are refused on BOTH paths, exactly as will-navigate refuses them', () => {
  // One representative URL per blocked protocol, exercised under a tab
  // disposition and the default disposition.
  const urls: Record<string, string> = {
    'file:': 'file:///etc/passwd',
    'javascript:': 'javascript:alert(1)',
    'data:': 'data:text/html,<script>alert(1)</script>',
  }
  // The catalog above must cover the real list — if BLOCKED_PROTOCOLS grows,
  // this test fails until a representative URL is added.
  assert.deepEqual(Object.keys(urls).sort(), [...BLOCKED_PROTOCOLS].sort())

  for (const [protocol, url] of Object.entries(urls)) {
    for (const disposition of ['foreground-tab', 'default']) {
      const { rec, handlers } = recordingHandlers()
      const outcome = routeWindowOpen({ url, disposition }, handlers)
      assert.equal(outcome, 'blocked', `${protocol} / ${disposition}`)
      assert.equal(rec.tabs.length, 0, `${protocol} / ${disposition}`)
      assert.equal(rec.inPlace.length, 0, `${protocol} / ${disposition}`)
    }
  }
})

test('an unparseable URL is blocked, never routed', () => {
  const { rec, handlers } = recordingHandlers()
  const outcome = routeWindowOpen({ url: 'not a url', disposition: 'foreground-tab' }, handlers)
  assert.equal(outcome, 'blocked')
  assert.equal(rec.tabs.length + rec.inPlace.length, 0)
})

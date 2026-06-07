// Isolated test for the spawn ledger — fold + lifecycle + concurrency gate,
// exercised against a throwaway temp ledger. No Electron, no spawn recipe.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/spawnLedger.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpawnLedger, slugForName } from './spawnLedger.ts'

function freshLedger(): { ledger: SpawnLedger; path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-ledger-'))
  const path = join(dir, 'spawns', 'requests.jsonl')
  return { ledger: new SpawnLedger(path), path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('slugForName matches the Python tool shape', () => {
  assert.equal(slugForName('smart home'), 'smart-home')
  assert.equal(slugForName('  Timers!  '), 'timers')
  assert.equal(slugForName(''), 'lane')
  assert.equal(slugForName('Smart-Home Control'), 'smart-home-control')
})

test('request → requested, not busy', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('smart-home', '/drafts/smart-home-X.md')
    const list = ledger.list()
    assert.equal(list.length, 1)
    assert.equal(list[0]?.status, 'requested')
    assert.equal(list[0]?.draftName, 'smart-home')
    assert.equal(list[0]?.draftPath, '/drafts/smart-home-X.md')
    assert.equal(ledger.busy(), false)
    assert.equal(ledger.find(rec.id)?.status, 'requested')
  } finally {
    cleanup()
  }
})

test('spawned sets busy + carries worktree/branch; closed releases it', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('timers', '/drafts/timers-X.md')
    ledger.markSpawned(rec.id, '/Users/x/aether-timers', 'feat/timers')
    let folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'spawned')
    assert.equal(folded?.worktree, '/Users/x/aether-timers')
    assert.equal(folded?.branch, 'feat/timers')
    assert.equal(ledger.busy(), true)

    ledger.markClosed(rec.id)
    folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'closed')
    // draft identity survives the fold across lifecycle events
    assert.equal(folded?.draftName, 'timers')
    assert.equal(ledger.busy(), false)
  } finally {
    cleanup()
  }
})

test('failed carries step + error and does NOT keep the gate busy', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('news', '/drafts/news-X.md')
    ledger.markFailed(rec.id, 'pnpm install', 'exit 1')
    const folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'failed')
    assert.equal(folded?.step, 'pnpm install')
    assert.equal(folded?.error, 'exit 1')
    assert.equal(ledger.busy(), false)
  } finally {
    cleanup()
  }
})

test('dismissed is terminal and non-busy', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('voice', '/drafts/voice-X.md')
    ledger.markDismissed(rec.id)
    assert.equal(ledger.find(rec.id)?.status, 'dismissed')
    assert.equal(ledger.busy(), false)
  } finally {
    cleanup()
  }
})

test('malformed lines are skipped, valid records survive', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    ledger.request('a', '/drafts/a.md')
    // hand-append a junk line, then a good one
    appendFileSync(path, 'not json at all\n')
    ledger.request('b', '/drafts/b.md')
    const list = ledger.list()
    assert.equal(list.length, 2)
    assert.deepEqual(
      list.map((r) => r.draftName).sort(),
      ['a', 'b'],
    )
  } finally {
    cleanup()
  }
})

test('list is newest-request-first across multiple spawns', async () => {
  const { ledger, cleanup } = freshLedger()
  try {
    ledger.request('first', '/drafts/first.md')
    await new Promise((r) => setTimeout(r, 5))
    ledger.request('second', '/drafts/second.md')
    const list = ledger.list()
    assert.equal(list[0]?.draftName, 'second')
    assert.equal(list[1]?.draftName, 'first')
  } finally {
    cleanup()
  }
})

test('concurrency gate: one spawned blocks busy regardless of other requests', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const a = ledger.request('a', '/drafts/a.md')
    ledger.request('b', '/drafts/b.md') // a second pending request
    ledger.markSpawned(a.id, '/wt/a', 'feat/a')
    assert.equal(ledger.busy(), true) // the live spawn holds the gate
    ledger.markClosed(a.id)
    assert.equal(ledger.busy(), false) // gate released; b can now be approved
  } finally {
    cleanup()
  }
})

test('on-disk log is append-only JSONL (never rewritten)', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    const rec = ledger.request('z', '/drafts/z.md')
    ledger.markSpawned(rec.id, '/wt/z', 'feat/z')
    ledger.markClosed(rec.id)
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    assert.equal(lines.length, 3) // request + spawned + closed, all retained
  } finally {
    cleanup()
  }
})

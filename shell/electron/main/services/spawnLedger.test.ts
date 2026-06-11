// Isolated test for the spawn ledger — fold + lifecycle + capacity counting,
// exercised against a throwaway temp ledger. No Electron, no spawn recipe.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/spawnLedger.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  SpawnLedger,
  slugForName,
  parseDraftTargets,
  targetsForDraft,
  targetsForLane,
  cleanupBlock,
  pythonCandidates,
  pickFirstCapable,
} from './spawnLedger.ts'

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

test('request → requested, nothing live', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('smart-home', '/drafts/smart-home-X.md')
    const list = ledger.list()
    assert.equal(list.length, 1)
    assert.equal(list[0]?.status, 'requested')
    assert.equal(list[0]?.draftName, 'smart-home')
    assert.equal(list[0]?.draftPath, '/drafts/smart-home-X.md')
    assert.equal(ledger.liveCount(), 0)
    assert.equal(ledger.find(rec.id)?.status, 'requested')
  } finally {
    cleanup()
  }
})

test('spawned counts live + carries worktree/branch; closed releases it', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('timers', '/drafts/timers-X.md')
    ledger.markSpawned(rec.id, '/Users/x/aether-timers', 'feat/timers')
    let folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'spawned')
    assert.equal(folded?.worktree, '/Users/x/aether-timers')
    assert.equal(folded?.branch, 'feat/timers')
    assert.equal(ledger.liveCount(), 1)

    ledger.markClosed(rec.id)
    folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'closed')
    // draft identity survives the fold across lifecycle events
    assert.equal(folded?.draftName, 'timers')
    assert.equal(ledger.liveCount(), 0)
  } finally {
    cleanup()
  }
})

test('failed carries step + error and does NOT count live', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('news', '/drafts/news-X.md')
    ledger.markFailed(rec.id, 'pnpm install', 'exit 1')
    const folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'failed')
    assert.equal(folded?.step, 'pnpm install')
    assert.equal(folded?.error, 'exit 1')
    assert.equal(ledger.liveCount(), 0)
  } finally {
    cleanup()
  }
})

test('dismissed is terminal and not live', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('voice', '/drafts/voice-X.md')
    ledger.markDismissed(rec.id)
    assert.equal(ledger.find(rec.id)?.status, 'dismissed')
    assert.equal(ledger.liveCount(), 0)
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

test('liveCount tracks live spawns only — requests and closures do not count', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const a = ledger.request('a', '/drafts/a.md')
    ledger.request('b', '/drafts/b.md') // a second pending request
    ledger.markSpawned(a.id, '/wt/a', 'feat/a')
    assert.equal(ledger.liveCount(), 1) // one live lane holds one capacity slot
    ledger.markClosed(a.id)
    assert.equal(ledger.liveCount(), 0) // slot released; b can now be approved
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

// ---- the slug contract: parse the draft's own Branch:/Worktree: lines -------

test('parseDraftTargets reads the draft_lane single-line header verbatim', () => {
  const draft = [
    '=== LANE — TIMERS ===',
    'Branch: feat/timers   Worktree: ~/aether-timers',
    'GOAL: ...',
  ].join('\n')
  const t = parseDraftTargets(draft)
  assert.equal(t.branch, 'feat/timers')
  assert.equal(t.worktree, join(homedir(), 'aether-timers'))
})

test('parseDraftTargets keeps branch and worktree independent (this very lane)', () => {
  // The worktree is NOT derivable from the branch slug — the whole reason to
  // parse the draft rather than re-derive: feat/spawn-v1.1 → ~/aether-spawn11.
  const draft = 'Branch: feat/spawn-v1.1   Worktree: ~/aether-spawn11'
  const t = parseDraftTargets(draft)
  assert.equal(t.branch, 'feat/spawn-v1.1')
  assert.equal(t.worktree, join(homedir(), 'aether-spawn11'))
})

test('parseDraftTargets tolerates Branch/Worktree on separate lines', () => {
  const t = parseDraftTargets('Branch: feat/news\nWorktree: ~/aether-news\n')
  assert.equal(t.branch, 'feat/news')
  assert.equal(t.worktree, join(homedir(), 'aether-news'))
})

test('parseDraftTargets rejects unsafe worktree paths and shell-meta branches', () => {
  // Outside $HOME, traversal, and a metachar-bearing branch all fall to undefined
  // so targetsForDraft uses the safe derived fallback instead.
  assert.equal(parseDraftTargets('Worktree: /etc/passwd').worktree, undefined)
  assert.equal(parseDraftTargets('Worktree: ~/../../etc').worktree, undefined)
  assert.equal(parseDraftTargets('Branch: feat/x;rm -rf').branch, undefined)
})

test('targetsForDraft falls back to the documented derivation when the draft lacks the lines', () => {
  // No parseable header → feat/<slug> + ~/aether-<slug> from the recorded name.
  const t = targetsForDraft('Smart-Home Control', 'no header here')
  assert.equal(t.branch, 'feat/smart-home-control')
  assert.equal(t.worktree, join(homedir(), 'aether-smart-home-control'))
})

test('targetsForDraft: the draft wins over the spoken-name slug (the divergence fix)', () => {
  // Spoken name slugged to 'smart-home' (recorded draftName), but the draft was
  // authored as smart-home-control. The draft is the contract → it wins.
  const draft = 'Branch: feat/smart-home-control   Worktree: ~/aether-smart-home-control'
  const t = targetsForDraft('smart-home', draft)
  assert.equal(t.branch, 'feat/smart-home-control')
  assert.equal(t.worktree, join(homedir(), 'aether-smart-home-control'))
})

// ---- ledger-driven cleanup block --------------------------------------------

test('cleanupBlock encodes the §13.12 teardown order with recorded paths', () => {
  const block = cleanupBlock('/Users/x/aether', '/Users/x/aether-timers', 'feat/timers')
  // deinit must come BEFORE worktree remove; branch -D and the submodule restore
  // both present; all built from the recorded (not re-derived) worktree/branch.
  const deinitAt = block.indexOf('submodule deinit')
  const removeAt = block.indexOf('worktree remove')
  assert.ok(deinitAt !== -1 && removeAt !== -1 && deinitAt < removeAt)
  assert.match(block, /aether-timers/)
  assert.match(block, /git branch -D 'feat\/timers'/)
  assert.match(block, /git submodule update --init --recursive/)
})

// ---- RAG bootstrap outcome folds onto the spawned event ---------------------

test('markSpawned records a successful rag bootstrap', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('rag-ok', '/drafts/rag-ok.md')
    ledger.markSpawned(rec.id, '/wt/rag', 'feat/rag', { ok: true })
    const folded = ledger.find(rec.id)
    assert.equal(folded?.ragBootstrap, 'ok')
    assert.equal(folded?.ragStep, undefined)
  } finally {
    cleanup()
  }
})

test('markSpawned records a failed rag bootstrap with the failing step', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('rag-bad', '/drafts/rag-bad.md')
    ledger.markSpawned(rec.id, '/wt/rag', 'feat/rag', { ok: false, step: 'rag: pip install' })
    const folded = ledger.find(rec.id)
    // The spawn still landed (status spawned, busy) — RAG is best-effort.
    assert.equal(folded?.status, 'spawned')
    assert.equal(ledger.liveCount(), 1)
    assert.equal(folded?.ragBootstrap, 'failed')
    assert.equal(folded?.ragStep, 'rag: pip install')
  } finally {
    cleanup()
  }
})

// ---- rag interpreter probe: ordering + fallbacks ----------------------------

test('pickFirstCapable returns the first capable candidate and short-circuits', async () => {
  const probed: string[] = []
  const isCapable = async (py: string): Promise<boolean> => {
    probed.push(py)
    return py === 'b' // only the 2nd candidate passes the capability test
  }
  const chosen = await pickFirstCapable(['a', 'b', 'c'], isCapable)
  assert.equal(chosen, 'b')
  assert.deepEqual(probed, ['a', 'b']) // never probes 'c' — first pass wins
})

test('pickFirstCapable prefers the highest-priority capable candidate', async () => {
  // Even when a later candidate is also capable, the earlier one wins (priority).
  const chosen = await pickFirstCapable(['first', 'second'], async () => true)
  assert.equal(chosen, 'first')
})

test('pickFirstCapable returns null when no candidate passes', async () => {
  const chosen = await pickFirstCapable(['a', 'b'], async () => false)
  assert.equal(chosen, null)
})

test('pythonCandidates falls back to homebrew + PATH when the repo has no rag venv', () => {
  // A repoRoot with no daemons/aether-rag/.venv → candidate (a) is skipped, so
  // only the fixed (b) homebrew and (c) PATH fallbacks remain, in that order.
  const dir = mkdtempSync(join(tmpdir(), 'no-rag-venv-'))
  try {
    assert.deepEqual(pythonCandidates(dir), ['/opt/homebrew/bin/python3', 'python3'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- lane-kind records (#268): fold, sanitize, batch, tmux session ----------

// The exact on-disk shape raven's work_on_issue tool appends — keep in sync
// with daemons/raven-core/raven_core/tools/work_on_issue_tool.py.
function laneLine(over: Record<string, unknown> = {}): string {
  return (
    JSON.stringify({
      id: Math.random().toString(16).slice(2, 18),
      ts: new Date().toISOString(),
      kind: 'lane',
      batch_id: 'batch-1',
      issue: 271,
      issue_title: 'gap(smart-home): dim the lights',
      branch: 'lane/issue-271',
      worktree: '~/aether-lane-271',
      status: 'requested',
      ...over,
    }) + '\n'
  )
}

test('lane request line folds with issue identity and expanded targets', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    appendFileSync(path, laneLine({ id: 'lane-a' }))
    const rec = ledger.find('lane-a')
    assert.equal(rec?.kind, 'lane')
    assert.equal(rec?.status, 'requested')
    assert.equal(rec?.issue, 271)
    assert.equal(rec?.issueTitle, 'gap(smart-home): dim the lights')
    assert.equal(rec?.batchId, 'batch-1')
    assert.equal(rec?.laneBranch, 'lane/issue-271')
    assert.equal(rec?.laneWorktree, join(homedir(), 'aether-lane-271'))
  } finally {
    cleanup()
  }
})

test('garbled lane targets fall back to the documented lane derivation', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    // Shell-meta branch and an outside-$HOME worktree must not survive the fold.
    appendFileSync(
      path,
      laneLine({ id: 'lane-bad', issue: 280, branch: 'x;rm -rf', worktree: '/etc' }),
    )
    const rec = ledger.find('lane-bad')
    assert.equal(rec?.laneBranch, 'lane/issue-280')
    assert.equal(rec?.laneWorktree, join(homedir(), 'aether-lane-280'))
  } finally {
    cleanup()
  }
})

test('requestedBatch returns only still-requested members, oldest first', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    appendFileSync(path, laneLine({ id: 'b1', issue: 1, ts: '2026-06-11T00:00:01Z' }))
    appendFileSync(path, laneLine({ id: 'b2', issue: 2, ts: '2026-06-11T00:00:02Z' }))
    appendFileSync(path, laneLine({ id: 'other', issue: 9, batch_id: 'batch-2' }))
    assert.deepEqual(
      ledger.requestedBatch('batch-1').map((r) => r.id),
      ['b1', 'b2'],
    )
    // A spawned member leaves the approval unit; the sibling remains.
    ledger.markSpawned('b1', join(homedir(), 'aether-lane-1'), 'lane/issue-1')
    assert.deepEqual(
      ledger.requestedBatch('batch-1').map((r) => r.id),
      ['b2'],
    )
  } finally {
    cleanup()
  }
})

test('lane spawned event records the tmux session and counts live with drafts', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    appendFileSync(path, laneLine({ id: 'lane-t', issue: 271 }))
    ledger.markSpawned(
      'lane-t',
      join(homedir(), 'aether-lane-271'),
      'lane/issue-271',
      { ok: true },
      'lane-271',
    )
    const rec = ledger.find('lane-t')
    assert.equal(rec?.status, 'spawned')
    assert.equal(rec?.tmuxSession, 'lane-271')
    // lane identity survives the lifecycle fold
    assert.equal(rec?.issue, 271)
    assert.equal(rec?.kind, 'lane')
    // both kinds hold capacity slots (#268 ruling)
    const draft = ledger.request('draft-x', '/drafts/x.md')
    ledger.markSpawned(draft.id, '/wt/x', 'feat/x')
    assert.equal(ledger.liveCount(), 2)
  } finally {
    cleanup()
  }
})

test('targetsForLane sanitizes and defaults like the draft path does', () => {
  assert.deepEqual(targetsForLane(42, 'lane/issue-42', '~/aether-lane-42'), {
    branch: 'lane/issue-42',
    worktree: join(homedir(), 'aether-lane-42'),
  })
  // Spec-supplied targets win (the #268 Branch:/Worktree: contract).
  assert.equal(targetsForLane(268, 'feat/spawn-lanes', '~/aether-spawn').branch, 'feat/spawn-lanes')
  assert.equal(
    targetsForLane(268, 'feat/spawn-lanes', '~/aether-spawn').worktree,
    join(homedir(), 'aether-spawn'),
  )
  // Hostile values fall back to the derivation.
  assert.deepEqual(targetsForLane(7, 'bad;branch', '/etc/passwd'), {
    branch: 'lane/issue-7',
    worktree: join(homedir(), 'aether-lane-7'),
  })
})

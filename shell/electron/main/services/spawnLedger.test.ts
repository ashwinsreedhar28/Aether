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
  RELAY_TEXT,
  REVISE_TEXT,
  RELAY_ALLOWLIST,
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
  // No tmux session recorded → no kill-session line.
  assert.ok(!block.includes('tmux'))
})

test('cleanupBlock leads with kill-session for a recorded tmux session (#305)', () => {
  const block = cleanupBlock('/Users/x/aether', '/Users/x/aether-lane-232', 'lane/issue-232', 'lane-232')
  // Closing the record never stops the session (the #305 audit), so the
  // teardown must — before the worktree the session sits in is removed.
  // '=' pins exact-name matching; `|| true` tolerates an already-dead session.
  const killAt = block.indexOf("tmux kill-session -t '=lane-232' || true")
  const removeAt = block.indexOf('worktree remove')
  assert.ok(killAt !== -1 && removeAt !== -1 && killAt < removeAt)
})

test('cleanupBlock carries the #363 submodule-die fallback lines in the load-bearing order', () => {
  const block = cleanupBlock('/Users/x/aether', '/Users/x/aether-lane-339', 'lane/issue-339')
  // The fallback the executor automates, offered to the manual operator too:
  // rm -rf → worktree prune → the branch -D that follows. Commented lines —
  // they engage only when the remove dies on submodules, never by default.
  const removeAt = block.indexOf('git worktree remove')
  const rmAt = block.indexOf("#   rm -rf '/Users/x/aether-lane-339'")
  const pruneAt = block.indexOf('#   git worktree prune')
  const branchAt = block.indexOf("git branch -D 'lane/issue-339'")
  assert.ok(removeAt !== -1 && rmAt !== -1 && pruneAt !== -1 && branchAt !== -1)
  // Order is load-bearing (#363): remove first, rm -rf before prune (prune
  // must observe the dir gone), prune before branch -D (checked-out status is
  // read from the stale admin dir until the prune).
  assert.ok(removeAt < rmAt && rmAt < pruneAt && pruneAt < branchAt)
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

// The July-14 duplicate-request shape (#383) — the parity fixture's TS copy.
// raven-core's tests/lane_fixtures.py carries the Python twin (same ids,
// timestamps, statuses; laneMonitor.test.ts seeds the lane-family subset).
// Editing either side alone is the #241 sibling-drift bug. Lane 371: one
// record, live. Lane 374: an older record that SPAWNED and a newer record
// that failed preflight and was dismissed (the second voice arm, 32s after
// the first). Relay / gate / teardown / telemetry lines interleaved to prove
// family inertness.
const DUPLICATE_LANE_LINES: Array<Record<string, unknown>> = [
  { id: 'arm-371', ts: '2026-07-14T23:44:10+00:00', kind: 'lane', batch_id: 'batch-371', issue: 371, issue_title: 'fix(sdk): deny payload spread order', branch: 'lane/issue-371', worktree: '~/aether-lane-371', status: 'requested' },
  { id: 'arm-371', ts: '2026-07-14T23:46:24+00:00', status: 'spawned', worktree: '/Users/x/aether-lane-371', branch: 'lane/issue-371', tmux_session: 'lane-371' },
  { id: 'arm-374-a', ts: '2026-07-14T23:46:52+00:00', kind: 'lane', batch_id: 'batch-374-a', issue: 374, issue_title: 'chore(docs): §10 gotchas', branch: 'lane/issue-374', worktree: '~/aether-lane-374', status: 'requested' },
  { id: 'arm-374-b', ts: '2026-07-14T23:47:24+00:00', kind: 'lane', batch_id: 'batch-374-b', issue: 374, issue_title: 'chore(docs): §10 gotchas', branch: 'lane/issue-374', worktree: '~/aether-lane-374', status: 'requested' },
  { id: 'arm-374-a', ts: '2026-07-14T23:49:19+00:00', status: 'spawned', worktree: '/Users/x/aether-lane-374', branch: 'lane/issue-374', tmux_session: 'lane-374' },
  { id: 'arm-374-b', ts: '2026-07-14T23:56:15+00:00', status: 'failed', step: 'preflight', error: 'worktree path already exists: /Users/x/aether-lane-374' },
  { id: 'arm-374-b', ts: '2026-07-14T23:56:17+00:00', status: 'dismissed' },
  { id: 'relay-374', ts: '2026-07-14T23:56:28+00:00', kind: 'relay', issue: 374, text: REVISE_TEXT, status: 'requested' },
  { id: 'relay-374', ts: '2026-07-14T23:56:29+00:00', kind: 'relay', status: 'relayed' },
  { id: 'gate-374', ts: '2026-07-15T00:10:00+00:00', kind: 'gate', issue: 374, phase: 'at-gate', prev: 'working' },
  { id: 'td-372', ts: '2026-07-15T00:11:00+00:00', kind: 'teardown', issue: 372, status: 'requested' },
  { id: 'tel-372', ts: '2026-07-15T00:12:00+00:00', kind: 'telemetry', issue: 372 },
]

test('duplicate lane arms fold per record — a dead newer arm never masks the live older one (#383)', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    for (const line of DUPLICATE_LANE_LINES) appendFileSync(path, JSON.stringify(line) + '\n')
    const lanes = ledger.list().filter((r) => r.kind === 'lane')
    assert.equal(lanes.length, 3)
    const byId = new Map(lanes.map((r) => [r.id, r]))
    assert.equal(byId.get('arm-371')?.status, 'spawned')
    assert.equal(byId.get('arm-374-a')?.status, 'spawned')
    assert.equal(byId.get('arm-374-b')?.status, 'dismissed')
    // Capacity is per-record: the dead duplicate holds nothing (raven's
    // _committed_count pins the same 2 on the Python side of the fixture).
    assert.equal(ledger.liveCount(), 2)
    // The live record closes → its slot frees; the dead duplicate stays inert.
    appendFileSync(
      path,
      JSON.stringify({ id: 'arm-374-a', ts: '2026-07-15T00:28:09+00:00', status: 'closed' }) + '\n',
    )
    assert.equal(ledger.liveCount(), 1)

    // Drain lines (#393) land in the same mixed table and change NOTHING for
    // any family above — raw on-disk shapes, appended after the parity table
    // so DUPLICATE_LANE_LINES itself stays byte-identical to its Python twin
    // (raven-core's tests/lane_fixtures.py; extending the twin is fenced to a
    // raven-core lane).
    appendFileSync(
      path,
      JSON.stringify({ id: 'drain-1', ts: '2026-07-15T00:30:00+00:00', kind: 'drain', batch_id: 'batch-drain-1', issues: [390, 391] }) +
        '\n' +
        JSON.stringify({ id: 'drain-1', ts: '2026-07-15T00:31:00+00:00', kind: 'drain', dismissed: true }) +
        '\n',
    )
    const refolded = ledger.list().filter((r) => r.kind === 'lane')
    assert.equal(refolded.length, 3)
    assert.equal(refolded.find((r) => r.id === 'arm-374-b')?.status, 'dismissed')
    assert.equal(ledger.liveCount(), 1)
    assert.equal(ledger.listRelays().length, 1)
    assert.equal(ledger.listGates().length, 1)
    assert.equal(ledger.listTeardowns().length, 1)
    assert.equal(ledger.listTelemetry().length, 1)
    const drains = ledger.listDrains()
    assert.equal(drains.length, 1)
    assert.deepEqual(drains[0]?.issues, [390, 391])
    assert.equal(drains[0]?.dismissedTs, '2026-07-15T00:31:00+00:00')
  } finally {
    cleanup()
  }
})

// ---- relay family (#310): kind-tagged lines, segregated folds ----------------

test('the relay allowlist literals (Python tool parity)', () => {
  // Pinned: lane_proceed_tool.py / lane_revise_tool.py duplicate these
  // strings; a drift on either side is a relay the shell would refuse.
  assert.equal(RELAY_TEXT, 'clean, proceed')
  assert.equal(REVISE_TEXT, 'revise per the latest DIRECTOR FEEDBACK, then re-gate')
  assert.deepEqual([...RELAY_ALLOWLIST], [RELAY_TEXT, REVISE_TEXT])
})

test('requestRelay accepts exactly the two allowlisted texts and refuses anything else (#339)', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    assert.equal(ledger.requestRelay(339, RELAY_TEXT).text, RELAY_TEXT)
    assert.equal(ledger.requestRelay(339, REVISE_TEXT).text, REVISE_TEXT)
    // Off-list text never even reaches the JSONL — no freeform crosses the
    // relay, not even as a recorded-then-refused line.
    assert.throws(
      () => ledger.requestRelay(339, 'please also refactor the store'),
      /not allowlisted/,
    )
    assert.throws(() => ledger.requestRelay(339, ''), /not allowlisted/)
    assert.equal(ledger.listRelays().length, 2)
  } finally {
    cleanup()
  }
})

test('relay lines fold separately and never touch spawn records', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const relay = ledger.requestRelay(310)
    // Invisible to the spawn fold: no ghost 'requested' card, no capacity.
    assert.equal(ledger.list().length, 0)
    assert.equal(ledger.liveCount(), 0)
    // Visible to the relay fold, carrying the fixed text.
    assert.equal(ledger.findRelay(relay.id)?.status, 'requested')
    assert.equal(ledger.findRelay(relay.id)?.issue, 310)
    assert.equal(ledger.findRelay(relay.id)?.text, RELAY_TEXT)
    assert.equal(ledger.pendingRelays().length, 1)

    ledger.markRelayed(relay.id)
    assert.equal(ledger.findRelay(relay.id)?.status, 'relayed')
    assert.equal(ledger.pendingRelays().length, 0)

    // A FAILED relay outcome must not seed a SPAWN FAILED stub either.
    const r2 = ledger.requestRelay(311)
    ledger.markRelayFailed(r2.id, 'no live lane')
    assert.equal(ledger.findRelay(r2.id)?.status, 'failed')
    assert.equal(ledger.findRelay(r2.id)?.error, 'no live lane')
    assert.equal(ledger.list().length, 0)
  } finally {
    cleanup()
  }
})

test('relay outcomes for unknown ids are dropped; listRelays is newest-first', async () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    // An outcome with no request line has no issue to execute against — drop.
    appendFileSync(
      path,
      JSON.stringify({ id: 'ghost', ts: '2026-06-11T00:00:00Z', kind: 'relay', status: 'failed', error: 'x' }) + '\n',
    )
    assert.equal(ledger.findRelay('ghost'), undefined)
    assert.equal(ledger.listRelays().length, 0)

    const a = ledger.requestRelay(301)
    await new Promise((r) => setTimeout(r, 5))
    const b = ledger.requestRelay(302)
    assert.deepEqual(
      ledger.listRelays().map((r) => r.id),
      [b.id, a.id],
    )
  } finally {
    cleanup()
  }
})

// ---- teardown family (#317): kind-tagged lines, segregated fold --------------

test('teardown lines fold separately and never touch spawn records', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const td = ledger.requestTeardown(317)
    // Invisible to the spawn fold: no ghost 'requested' card, no capacity.
    assert.equal(ledger.list().length, 0)
    assert.equal(ledger.liveCount(), 0)
    // Visible to the teardown fold; force defaults false (voice shape).
    assert.equal(ledger.findTeardown(td.id)?.status, 'requested')
    assert.equal(ledger.findTeardown(td.id)?.issue, 317)
    assert.equal(ledger.findTeardown(td.id)?.force, false)
    assert.equal(ledger.pendingTeardowns().length, 1)

    ledger.markTeardownDone(td.id)
    assert.equal(ledger.findTeardown(td.id)?.status, 'done')
    assert.equal(ledger.pendingTeardowns().length, 0)

    // A FAILED teardown outcome must not seed a SPAWN FAILED stub either,
    // and its guard code + step fold back for the card.
    const t2 = ledger.requestTeardown(318, true)
    assert.equal(ledger.findTeardown(t2.id)?.force, true)
    ledger.markTeardownFailed(t2.id, 'worktree has uncommitted changes', { code: 'dirty' })
    assert.equal(ledger.findTeardown(t2.id)?.status, 'failed')
    assert.equal(ledger.findTeardown(t2.id)?.code, 'dirty')
    assert.equal(ledger.list().length, 0)

    const t3 = ledger.requestTeardown(319)
    ledger.markTeardownFailed(t3.id, 'boom', { step: 'git worktree remove' })
    assert.equal(ledger.findTeardown(t3.id)?.step, 'git worktree remove')
  } finally {
    cleanup()
  }
})

test('teardown outcomes for unknown ids are dropped; the voice line shape folds', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    // An outcome with no request line has no issue to execute against — drop.
    appendFileSync(
      path,
      JSON.stringify({ id: 'ghost', ts: '2026-06-11T00:00:00Z', kind: 'teardown', status: 'failed', error: 'x' }) + '\n',
    )
    assert.equal(ledger.findTeardown('ghost'), undefined)
    // The exact line close_lane_tool.py appends (no force key) folds clean.
    appendFileSync(
      path,
      JSON.stringify({ id: 'td-voice', ts: '2026-06-11T00:01:00Z', kind: 'teardown', issue: 317, status: 'requested' }) + '\n',
    )
    const td = ledger.findTeardown('td-voice')
    assert.equal(td?.issue, 317)
    assert.equal(td?.force, false)
    assert.equal(td?.status, 'requested')
  } finally {
    cleanup()
  }
})

test('teardown_failed keeps holding capacity; only closed frees it (#317)', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('demo', '/drafts/demo.md')
    ledger.markSpawned(rec.id, '/Users/x/aether-lane-317', 'lane/issue-317', undefined, 'lane-317')
    assert.equal(ledger.liveCount(), 1)

    ledger.markRecordTeardownFailed(rec.id, 'git worktree remove', 'boom')
    const folded = ledger.find(rec.id)
    assert.equal(folded?.status, 'teardown_failed')
    assert.equal(folded?.step, 'git worktree remove')
    assert.equal(folded?.error, 'boom')
    // The failed teardown did NOT free the slot...
    assert.equal(ledger.liveCount(), 1)

    // ...and the recorded worktree/branch survive the flip for the retry.
    assert.equal(folded?.worktree, '/Users/x/aether-lane-317')
    assert.equal(folded?.branch, 'lane/issue-317')

    ledger.markClosed(rec.id)
    assert.equal(ledger.find(rec.id)?.status, 'closed')
    assert.equal(ledger.liveCount(), 0)
  } finally {
    cleanup()
  }
})

// ---- telemetry family (#364) ---------------------------------------------------

test('writeTelemetry appends one kind-tagged, status-less line; list/find fold it back', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    const rec = ledger.writeTelemetry({
      issue: 364,
      spawnedAt: '2026-07-06T00:00:00.000Z',
      model: 'claude-opus-4-8',
      effort: null,
      tokens: { input: 4315, output: 6324, cacheRead: 466269, cacheWrite: 108810 },
      gateReports: 2,
      revises: 1,
      proceeds: 1,
      diff: { filesChanged: 3, insertions: 120, deletions: 15 },
      outcome: 'merged',
    })
    // wallSeconds is spawn→close arithmetic on the two recorded facts.
    assert.equal(typeof rec.wallSeconds, 'number')
    assert.ok((rec.wallSeconds ?? 0) > 0)
    assert.equal(rec.closedAt, rec.ts)

    const listed = ledger.listTelemetry()
    assert.equal(listed.length, 1)
    assert.deepEqual(listed[0], rec)
    assert.deepEqual(ledger.findTelemetry(364), rec)
    assert.equal(ledger.findTelemetry(999), undefined)

    // On-disk shape: kind-tagged, snake_case, and deliberately NO `status`
    // field — the Python capacity folds key lifecycle lines on a string
    // status, so a status-less line is invisible to them without edits.
    const line = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>
    assert.equal(line.kind, 'telemetry')
    assert.equal('status' in line, false)
    assert.equal(line.issue, 364)
    assert.equal(line.spawned_at, '2026-07-06T00:00:00.000Z')
    assert.deepEqual(line.tokens, {
      input: 4315,
      output: 6324,
      cache_read: 466269,
      cache_write: 108810,
    })
    assert.deepEqual(line.diff, { files_changed: 3, insertions: 120, deletions: 15 })
    assert.equal(line.gate_reports, 2)
    assert.equal(line.outcome, 'merged')
  } finally {
    cleanup()
  }
})

test('telemetry lines fold separately and never touch spawn records (#364 segregation)', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('demo', '/drafts/demo.md')
    ledger.markSpawned(rec.id, '/Users/x/aether-lane-364', 'lane/issue-364')
    assert.equal(ledger.liveCount(), 1)

    ledger.writeTelemetry({
      issue: 364,
      spawnedAt: null,
      model: null,
      effort: null,
      tokens: null,
      gateReports: null,
      revises: null,
      proceeds: null,
      diff: null,
      outcome: null,
    })

    // No ghost spawn record, capacity untouched, sibling folds untouched.
    assert.equal(ledger.list().length, 1)
    assert.equal(ledger.list()[0]?.id, rec.id)
    assert.equal(ledger.liveCount(), 1)
    assert.equal(ledger.listRelays().length, 0)
    assert.equal(ledger.listTeardowns().length, 0)
    assert.equal(ledger.listTelemetry().length, 1)

    // Conversely: spawn, relay, and teardown lines never leak into the
    // telemetry fold.
    ledger.requestRelay(364)
    ledger.requestTeardown(364)
    assert.equal(ledger.listTelemetry().length, 1)
  } finally {
    cleanup()
  }
})

test('an all-null capture folds back null-for-null with the error note (resilience law)', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    ledger.writeTelemetry({
      issue: 232,
      spawnedAt: null,
      model: null,
      effort: null,
      tokens: null,
      gateReports: null,
      revises: null,
      proceeds: null,
      diff: null,
      outcome: null,
      error: 'tokens: no Claude Code project dir; outcome: gh timed out',
    })
    const t = ledger.findTelemetry(232)
    assert.ok(t)
    assert.equal(t.spawnedAt, null)
    assert.equal(t.wallSeconds, null)
    assert.equal(t.model, null)
    assert.equal(t.effort, null)
    assert.equal(t.tokens, null)
    assert.equal(t.gateReports, null)
    assert.equal(t.revises, null)
    assert.equal(t.proceeds, null)
    assert.equal(t.diff, null)
    assert.equal(t.outcome, null)
    assert.equal(t.error, 'tokens: no Claude Code project dir; outcome: gh timed out')
  } finally {
    cleanup()
  }
})

test('countRelayTexts counts DELIVERED sentences for the issue, strictly newer than spawn', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    const since = '2026-07-01T00:00:00.000Z'
    const relay = (id: string, issue: number, text: string, ts: string): string =>
      JSON.stringify({ id, ts, kind: 'relay', issue, text, status: 'requested' }) + '\n'
    const outcome = (id: string, status: string, ts: string): string =>
      JSON.stringify({ id, ts, kind: 'relay', status }) + '\n'
    appendFileSync(
      path,
      // Two delivered revises + one delivered proceed, all after spawn: count.
      relay('r1', 364, REVISE_TEXT, '2026-07-02T00:00:00.000Z') +
        outcome('r1', 'relayed', '2026-07-02T00:00:01.000Z') +
        relay('r2', 364, REVISE_TEXT, '2026-07-03T00:00:00.000Z') +
        outcome('r2', 'relayed', '2026-07-03T00:00:01.000Z') +
        relay('p1', 364, RELAY_TEXT, '2026-07-04T00:00:00.000Z') +
        outcome('p1', 'relayed', '2026-07-04T00:00:01.000Z') +
        // Failed: never reached the pane — no cycle, not counted.
        relay('rf', 364, REVISE_TEXT, '2026-07-02T06:00:00.000Z') +
        outcome('rf', 'failed', '2026-07-02T06:00:01.000Z') +
        // Still 'requested': not delivered, not counted.
        relay('pq', 364, RELAY_TEXT, '2026-07-04T06:00:00.000Z') +
        // Delivered but BEFORE spawn (a previous run on a respawned issue):
        // excluded by the strictly-newer guard.
        relay('old', 364, RELAY_TEXT, '2026-06-20T00:00:00.000Z') +
        outcome('old', 'relayed', '2026-06-20T00:00:01.000Z') +
        // Another issue's relay: not this lane's cycle.
        relay('ox', 999, REVISE_TEXT, '2026-07-02T00:00:00.000Z') +
        outcome('ox', 'relayed', '2026-07-02T00:00:01.000Z'),
    )
    assert.deepEqual(ledger.countRelayTexts(364, since), { revises: 2, proceeds: 1 })
    // An unparseable anchor counts nothing (the caller nulls the fields
    // before ever getting here — this is the belt under that).
    assert.deepEqual(ledger.countRelayTexts(364, 'not-a-time'), { revises: 0, proceeds: 0 })
  } finally {
    cleanup()
  }
})

test("the spawned event's own timestamp survives later flips as spawnedTs (#364 anchor)", () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const rec = ledger.request('demo', '/drafts/demo.md')
    assert.equal(ledger.find(rec.id)?.spawnedTs, undefined)
    ledger.markSpawned(rec.id, '/Users/x/aether-demo', 'feat/demo')
    const spawned = ledger.find(rec.id)
    assert.ok(spawned)
    assert.ok(spawned.spawnedTs)
    assert.equal(spawned.spawnedTs, spawned.ts)

    // A later lifecycle flip moves `ts` but never the spawn anchor.
    ledger.markRecordTeardownFailed(rec.id, 'git worktree remove', 'boom')
    const after = ledger.find(rec.id)
    assert.equal(after?.spawnedTs, spawned.spawnedTs)
    assert.notEqual(after?.ts, undefined)
    assert.equal(after?.status, 'teardown_failed')
  } finally {
    cleanup()
  }
})

test('listTelemetry is newest-first; findTelemetry takes the newest line for a respawned issue', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    const line = (id: string, issue: number, ts: string): string =>
      JSON.stringify({
        id,
        ts,
        kind: 'telemetry',
        issue,
        spawned_at: null,
        closed_at: ts,
        wall_seconds: null,
        model: null,
        effort: null,
        tokens: null,
        gate_reports: null,
        revises: null,
        proceeds: null,
        diff: null,
        outcome: null,
      }) + '\n'
    appendFileSync(
      path,
      line('t-old', 364, '2026-07-01T00:00:00.000Z') +
        line('t-new', 364, '2026-07-05T00:00:00.000Z') +
        line('t-mid', 200, '2026-07-03T00:00:00.000Z'),
    )
    assert.deepEqual(
      ledger.listTelemetry().map((t) => t.id),
      ['t-new', 't-mid', 't-old'],
    )
    assert.equal(ledger.findTelemetry(364)?.id, 't-new')
  } finally {
    cleanup()
  }
})

test('malformed or issue-less telemetry lines are skipped by the fold', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    appendFileSync(
      path,
      'not json at all\n' +
        JSON.stringify({ id: 'no-issue', ts: '2026-07-01T00:00:00.000Z', kind: 'telemetry' }) +
        '\n' +
        JSON.stringify({ ts: '2026-07-01T00:00:00.000Z', kind: 'telemetry', issue: 5 }) +
        '\n',
    )
    assert.equal(ledger.listTelemetry().length, 0)
    // And none of it seeded a spawn record either.
    assert.equal(ledger.list().length, 0)
  } finally {
    cleanup()
  }
})

// ---- gate family (#378) --------------------------------------------------------

test('gate transitions fold to last-known phase; reminders record their ts but never move it', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    assert.equal(ledger.lastGatePhases().size, 0)
    ledger.writeGateTransition(372, 'at-gate', 'working')
    let st = ledger.lastGatePhases().get(372)
    assert.equal(st?.phase, 'at-gate')
    assert.equal(typeof st?.transitionTs, 'string')
    assert.equal(st?.reminderTs, null)
    // A reminder arms the dedupe without touching the phase.
    ledger.writeGateReminder(372, 'at-gate')
    st = ledger.lastGatePhases().get(372)
    assert.equal(st?.phase, 'at-gate')
    assert.equal(typeof st?.reminderTs, 'string')
    // The next transition starts a fresh sitting: the reminder slot re-arms.
    ledger.writeGateTransition(372, 'revising', 'at-gate')
    st = ledger.lastGatePhases().get(372)
    assert.equal(st?.phase, 'revising')
    assert.equal(st?.reminderTs, null)
    const gates = ledger.listGates()
    assert.deepEqual(
      gates.map((g) => g.reminder),
      [false, true, false],
    )
    assert.equal(gates[0]?.prev, 'working')
    assert.equal(gates[1]?.prev, null)
  } finally {
    cleanup()
  }
})

test('a stall reminder with no prior transition seeds the fold without inventing one', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    ledger.writeGateReminder(378, 'working')
    const st = ledger.lastGatePhases().get(378)
    assert.equal(st?.phase, 'working')
    assert.equal(st?.transitionTs, null)
    assert.equal(typeof st?.reminderTs, 'string')
  } finally {
    cleanup()
  }
})

test('malformed gate lines never fabricate a transition', () => {
  const { ledger, path, cleanup } = freshLedger()
  try {
    appendFileSync(
      path,
      JSON.stringify({ id: 'g1', ts: '2026-07-01T00:00:00.000Z', kind: 'gate', issue: 372, phase: 'shipped' }) +
        '\n' + // off-list phase
        JSON.stringify({ id: 'g2', ts: '2026-07-01T00:00:00.000Z', kind: 'gate', phase: 'at-gate' }) +
        '\n' + // no issue
        JSON.stringify({ ts: '2026-07-01T00:00:00.000Z', kind: 'gate', issue: 372, phase: 'at-gate' }) +
        '\n', // no id
    )
    assert.equal(ledger.listGates().length, 0)
    assert.equal(ledger.lastGatePhases().size, 0)
    // And none of it seeded a spawn record either.
    assert.equal(ledger.list().length, 0)
  } finally {
    cleanup()
  }
})

test('mixed-family fixture: every fold sees only its own family, and gate lines hold no capacity (#378)', () => {
  // One ledger holding all six families — the #310 discrimination law's pin,
  // extended per #378 task 3: each fold below must count exactly its own.
  const { ledger, path, cleanup } = freshLedger()
  try {
    // Lane request + spawned lifecycle (the Python work_on_issue shapes).
    appendFileSync(
      path,
      JSON.stringify({
        id: 'lane-1',
        ts: '2026-07-01T00:00:00.000Z',
        kind: 'lane',
        issue: 372,
        issue_title: 'feat(x): a thing',
        branch: 'lane/issue-372',
        worktree: '~/aether-lane-372',
        status: 'requested',
      }) +
        '\n' +
        JSON.stringify({ id: 'lane-1', ts: '2026-07-01T00:01:00.000Z', status: 'spawned' }) +
        '\n',
    )
    ledger.request('draft-x', '/drafts/x.md')
    ledger.requestRelay(372)
    ledger.requestTeardown(372)
    ledger.writeTelemetry({
      issue: 372,
      spawnedAt: '2026-07-01T00:01:00.000Z',
      model: null,
      effort: null,
      tokens: null,
      gateReports: null,
      revises: null,
      proceeds: null,
      diff: null,
      outcome: null,
    })
    ledger.writeGateTransition(372, 'at-gate', 'working')
    ledger.writeGateReminder(372, 'at-gate')

    // Spawn fold: the lane + the draft, nothing seeded by the other families.
    assert.equal(ledger.list().length, 2)
    assert.equal(ledger.find('lane-1')?.status, 'spawned')
    // Gate lines hold no capacity: only the spawned lane is live.
    assert.equal(ledger.liveCount(), 1)
    // Each family's own fold sees exactly its own lines.
    assert.equal(ledger.listRelays().length, 1)
    assert.equal(ledger.listTeardowns().length, 1)
    assert.equal(ledger.listTelemetry().length, 1)
    assert.equal(ledger.listGates().length, 2)
    assert.equal(ledger.lastGatePhases().get(372)?.phase, 'at-gate')

    // The seventh family (#393): a drain proposal adds its bookkeeping line
    // PLUS one ordinary lane request — the request is live machinery (the
    // card), the drain line is inert bookkeeping in every fold above.
    const { proposalId } = ledger.armDrainProposal([
      { issue: 373, title: 'feat(y): queued thing', branch: 'lane/issue-373', worktree: '~/aether-lane-373' },
    ])
    ledger.markDrainDismissed(proposalId)
    assert.equal(ledger.list().length, 3) // + the armed lane request, nothing else
    assert.equal(ledger.liveCount(), 1) // drain lines hold no capacity
    assert.equal(ledger.listRelays().length, 1)
    assert.equal(ledger.listTeardowns().length, 1)
    assert.equal(ledger.listTelemetry().length, 1)
    assert.equal(ledger.listGates().length, 2)
    assert.equal(ledger.listDrains().length, 1)
    assert.ok(ledger.listDrains()[0]?.dismissedTs)
  } finally {
    cleanup()
  }
})

test('drain family (#393): proposal + batch in one unit, folded by id, dismissal anchors — and the EXISTING approval unit resolves the batch', () => {
  const { ledger, cleanup } = freshLedger()
  try {
    const { proposalId, batchId } = ledger.armDrainProposal([
      { issue: 400, title: 'feat(a): x', branch: 'lane/issue-400', worktree: '~/aether-lane-400' },
      { issue: 402, title: 'feat(b): y', branch: 'feat/custom', worktree: '~/aether-custom', submodules: true },
    ])
    const drains = ledger.listDrains()
    assert.equal(drains.length, 1)
    assert.equal(drains[0]?.batchId, batchId)
    assert.deepEqual(drains[0]?.issues, [400, 402])
    assert.equal(drains[0]?.dismissedTs, null)
    // The armed lanes ARE the work_on_issue approval unit — one card,
    // approve-all or cancel-all, resolved by the existing batch fold.
    const batch = ledger.requestedBatch(batchId)
    assert.equal(batch.length, 2)
    assert.equal(batch[1]?.submodules, true)
    assert.equal(ledger.liveCount(), 0) // requested awaits the tap; drain holds nothing
    ledger.markDrainDismissed(proposalId)
    assert.ok(ledger.listDrains()[0]?.dismissedTs)
    // A dismissal for an id no proposal seeded is dropped (the relay rule).
    ledger.markDrainDismissed('no-such-proposal')
    assert.equal(ledger.listDrains().length, 1)
  } finally {
    cleanup()
  }
})

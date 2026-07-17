// Isolated test for the drain proposer (#393) — candidate scan, capacity
// respect, single-proposal law, suppress-on-dismiss, the close-out trigger,
// and on-disk parity with the work_on_issue request-line shapes — against a
// throwaway temp ledger and a scripted mesh invoke. No Electron, no timers
// (tick() driven by hand), no network.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/drainProposer.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  DrainProposer,
  DRAIN_MAX_LANES,
  DRAIN_TICK_MIN,
  DRAIN_SUPPRESS_HOURS,
} from './drainProposer.ts'
import { SpawnLedger } from './spawnLedger.ts'

// The Python work_on_issue request line + the shell's spawned lifecycle —
// the on-disk shapes the live flows write (laneMonitor.test.ts's helper).
function laneLines(issue: number, spawnedTs = '2026-07-01T10:00:00.000Z'): Array<Record<string, unknown>> {
  return [
    { id: `lane-${issue}`, ts: '2026-07-01T09:59:00.000Z', kind: 'lane', issue, issue_title: 'feat(x): a thing', batch_id: `b-${issue}`, branch: `lane/issue-${issue}`, worktree: `~/aether-lane-${issue}`, status: 'requested' },
    { id: `lane-${issue}`, ts: spawnedTs, status: 'spawned', worktree: `/x/aether-lane-${issue}`, branch: `lane/issue-${issue}` },
  ]
}

// One open board row (github.list_issues shape) and one full issue
// (github.get_issue shape). Ratified issues carry the Director-visible
// ARCHITECT RATIFICATION comment; the body carries the ARCHITECT SPEC marker
// unless overridden.
function boardRow(number: number, created_at: string, labels: string[] = ['lane']): Record<string, unknown> {
  return { number, title: `feat(x): issue ${number}`, labels, state: 'open', created_at }
}

function fullIssue(
  number: number,
  opts: { ratified?: boolean; labels?: string[]; state?: string; body?: string; extraComments?: string[] } = {},
): Record<string, unknown> {
  const comments: Array<Record<string, unknown>> = []
  if (opts.ratified ?? true) {
    comments.push({ author: 'director', body: 'ARCHITECT RATIFICATION — the body spec is the ratified contract.', created_at: '2026-07-02T00:00:00.000Z' })
  }
  for (const body of opts.extraComments ?? []) {
    comments.push({ author: 'architect', body, created_at: '2026-07-03T00:00:00.000Z' })
  }
  return {
    ok: true,
    number,
    title: `feat(x): issue ${number}`,
    state: opts.state ?? 'open',
    labels: opts.labels ?? ['lane'],
    body: opts.body ?? `ARCHITECT SPEC — build the thing for issue ${number}.`,
    comments,
  }
}

interface Harness {
  proposer: DrainProposer
  ledger: SpawnLedger
  path: string
  state: {
    board: Array<Record<string, unknown>>
    issues: Map<number, Record<string, unknown>>
    fail: boolean
    calls: Array<{ target: string; payload: Record<string, unknown> }>
    notifications: string[]
    nowMs: number
  }
  cleanup: () => void
}

function freshHarness(opts: { seed?: Array<Record<string, unknown>>; maxLanes?: number } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'drain-proposer-'))
  const path = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(path) // ctor mkdirs the spawns dir
  for (const line of opts.seed ?? []) {
    appendFileSync(path, JSON.stringify(line) + '\n')
  }
  const state: Harness['state'] = {
    board: [],
    issues: new Map(),
    fail: false,
    calls: [],
    notifications: [],
    // Real epoch base (laneMonitor.test.ts's rule): the ledger stamps its
    // lines with the real clock, so a fixed fake base would never expire.
    nowMs: Date.now(),
  }
  const proposer = new DrainProposer({
    ledgerPath: path,
    invoke: (target, payload) => {
      state.calls.push({ target, payload })
      if (state.fail) return Promise.resolve({ ok: false })
      if (target === 'github.list_issues') {
        return Promise.resolve({ ok: true, envelope: { payload: { issues: state.board } } })
      }
      assert.equal(target, 'github.get_issue')
      const issue = state.issues.get(payload.number as number)
      if (!issue) return Promise.resolve({ ok: false })
      return Promise.resolve({ ok: true, envelope: { payload: issue } })
    },
    notify: (body) => state.notifications.push(body),
    maxLanes: opts.maxLanes,
    now: () => state.nowMs,
  })
  return { proposer, ledger, path, state, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// onLedgerChanged fires tick() without awaiting it (the 'changed' listener
// can't) — settle the microtask chain so the test observes its outcome.
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

test('the spec constants pin: cap 3, 30min tick, 24h suppression', () => {
  assert.equal(DRAIN_MAX_LANES, 3)
  assert.equal(DRAIN_TICK_MIN, 30)
  assert.equal(DRAIN_SUPPRESS_HOURS, 24)
})

test('boot scan: oldest ratified candidates up to free capacity, one batch through the work_on_issue shapes, spec-fixed notification', async () => {
  // One live lane → free = 2. Board (newest-first, as the node serves it):
  // #404 ratified (newest), #402 ratified, #403 HOLD-labeled, #401 open but
  // unratified, #400 ratified (oldest). Expect picks #400 then #402 —
  // oldest-first, the unratified skipped after a fetch, the HELD skipped
  // WITHOUT a fetch, #404 never fetched (stop at capacity).
  const h = freshHarness({ seed: laneLines(372) })
  try {
    h.state.board = [
      boardRow(404, '2026-07-05T00:00:00Z'),
      boardRow(402, '2026-07-04T00:00:00Z'),
      boardRow(403, '2026-07-03T00:00:00Z', ['lane', 'HOLD']),
      boardRow(401, '2026-07-02T00:00:00Z'),
      boardRow(400, '2026-07-01T00:00:00Z'),
    ]
    h.state.issues.set(400, fullIssue(400))
    h.state.issues.set(401, fullIssue(401, { ratified: false }))
    h.state.issues.set(402, fullIssue(402))
    h.state.issues.set(404, fullIssue(404))
    await h.proposer.tick()

    assert.deepEqual(
      h.state.calls.map((c) => c.target),
      ['github.list_issues', 'github.get_issue', 'github.get_issue', 'github.get_issue'],
    )
    assert.deepEqual(h.state.calls.slice(1).map((c) => c.payload.number), [400, 401, 402])

    const drains = h.ledger.listDrains()
    assert.equal(drains.length, 1)
    assert.deepEqual(drains[0]?.issues, [400, 402])
    assert.equal(drains[0]?.dismissedTs, null)

    // The armed lanes are ordinary work_on_issue-shaped records: the EXISTING
    // approval unit resolves the batch, targets fold to the #268 defaults.
    const batch = h.ledger.requestedBatch(drains[0]!.batchId)
    assert.deepEqual(batch.map((r) => r.issue), [400, 402])
    assert.equal(batch[0]?.status, 'requested')
    assert.equal(batch[0]?.laneBranch, 'lane/issue-400')
    assert.equal(batch[0]?.laneWorktree, join(homedir(), 'aether-lane-400'))
    // Drain bookkeeping holds no capacity: still just the seeded live lane.
    assert.equal(h.ledger.liveCount(), 1)

    assert.deepEqual(h.state.notifications, ['Drain proposal: capacity 2 — spawn #400, #402?'])
  } finally {
    h.cleanup()
  }
})

test('capacity-respect: a full board scans nothing, and pending requests hold slots too', async () => {
  // 3 live = at the cap → the scan short-circuits before ANY github call.
  const h = freshHarness({ seed: [...laneLines(370), ...laneLines(371), ...laneLines(372)] })
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(400, fullIssue(400))
    await h.proposer.tick()
    assert.equal(h.state.calls.length, 0)
    assert.equal(h.ledger.listDrains().length, 0)
    assert.equal(h.state.notifications.length, 0)
  } finally {
    h.cleanup()
  }

  // 1 live + 2 'requested' (a manual work_on_issue batch awaiting the tap) —
  // the _committed_count mirror: requested claims a slot, so free = 0.
  const h2 = freshHarness({
    seed: [
      ...laneLines(372),
      { id: 'm-1', ts: '2026-07-10T00:00:00Z', kind: 'lane', issue: 380, issue_title: 't', batch_id: 'mb', branch: 'lane/issue-380', worktree: '~/aether-lane-380', status: 'requested' },
      { id: 'm-2', ts: '2026-07-10T00:00:00Z', kind: 'lane', issue: 381, issue_title: 't', batch_id: 'mb', branch: 'lane/issue-381', worktree: '~/aether-lane-381', status: 'requested' },
    ],
  })
  try {
    h2.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h2.state.issues.set(400, fullIssue(400))
    await h2.proposer.tick()
    assert.equal(h2.state.calls.length, 0)
    assert.equal(h2.ledger.listDrains().length, 0)
  } finally {
    h2.cleanup()
  }
})

test('no-double-propose: while a drain card sits undecided the next tick is silent — no fetch, no second batch', async () => {
  const h = freshHarness()
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(400, fullIssue(400))
    await h.proposer.tick()
    assert.equal(h.ledger.listDrains().length, 1)
    const callsAfterFirst = h.state.calls.length

    await h.proposer.tick()
    assert.equal(h.state.calls.length, callsAfterFirst) // pendingProposal short-circuits
    assert.equal(h.ledger.listDrains().length, 1)
    assert.equal(h.ledger.list().filter((r) => r.kind === 'lane').length, 1)
    assert.equal(h.state.notifications.length, 1)
  } finally {
    h.cleanup()
  }
})

test('suppress-on-dismiss: a dismissed card writes the drain line and holds its candidates out for 24h', async () => {
  const h = freshHarness()
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(400, fullIssue(400))
    await h.proposer.tick()
    const drain = h.ledger.listDrains()[0]
    assert.ok(drain)

    // The Director taps dismiss: spawnService.dismiss marks the whole batch.
    for (const rec of h.ledger.requestedBatch(drain.batchId)) h.ledger.markDismissed(rec.id)
    h.proposer.onLedgerChanged() // the 'changed' broadcast — bookkeeping runs
    await settle()
    const after = h.ledger.listDrains()[0]
    assert.ok(after?.dismissedTs, 'dismissal line written — the durable suppression anchor')

    // Within the window: #400 is filtered off the board before any get_issue.
    const calls = h.state.calls.length
    await h.proposer.tick()
    assert.equal(h.state.calls.length, calls + 1) // list_issues only
    assert.equal(h.ledger.listDrains().length, 1)

    // Past the window: proposed again.
    h.state.nowMs += (DRAIN_SUPPRESS_HOURS + 1) * 3_600_000
    await h.proposer.tick()
    assert.equal(h.ledger.listDrains().length, 2)
    assert.deepEqual(h.ledger.listDrains()[0]?.issues, [400])
  } finally {
    h.cleanup()
  }
})

test('close-out trigger: a live-count drop scans immediately; a no-drop change only runs bookkeeping', async () => {
  const h = freshHarness({ seed: [...laneLines(370), ...laneLines(371), ...laneLines(372)] })
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(400, fullIssue(400))

    // A change with no drop (a gate line landing, say): no scan.
    h.proposer.onLedgerChanged()
    await settle()
    assert.equal(h.state.calls.length, 0)

    // Lane #372 closes out → its slot frees → the scan fires on the change.
    h.ledger.markClosed('lane-372')
    h.proposer.onLedgerChanged()
    await settle()
    assert.ok(h.state.calls.length >= 2, 'close-out triggered a scan')
    assert.equal(h.ledger.listDrains().length, 1)
    assert.deepEqual(h.ledger.listDrains()[0]?.issues, [400])
    assert.deepEqual(h.state.notifications, ['Drain proposal: capacity 1 — spawn #400?'])
  } finally {
    h.cleanup()
  }
})

test('a failed board fetch fabricates nothing; the next tick proposes', async () => {
  const h = freshHarness()
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(400, fullIssue(400))
    h.state.fail = true
    await h.proposer.tick()
    assert.equal(h.ledger.listDrains().length, 0)
    assert.equal(h.state.notifications.length, 0)
    h.state.fail = false
    await h.proposer.tick()
    assert.equal(h.ledger.listDrains().length, 1)
  } finally {
    h.cleanup()
  }
})

test('spec targets ride the request line: Branch:/Worktree:/Submodules: parsed from the latest spec text, recorded ~ unexpanded', async () => {
  const h = freshHarness()
  try {
    h.state.board = [boardRow(400, '2026-07-01T00:00:00Z')]
    h.state.issues.set(
      400,
      fullIssue(400, {
        extraComments: [
          'ARCHITECT SPEC — amended.\nBranch: feat/custom-slug\nWorktree: ~/aether-custom\nSubmodules: on',
        ],
      }),
    )
    await h.proposer.tick()
    const raw = readFileSync(h.path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
    const laneLine = raw.find((o) => o.kind === 'lane')
    // Byte-shape parity with the Python tool's record: parsed targets, ~
    // unexpanded (the fold is the one expansion authority), sparse submodules.
    assert.equal(laneLine?.branch, 'feat/custom-slug')
    assert.equal(laneLine?.worktree, '~/aether-custom')
    assert.equal(laneLine?.submodules, true)
    assert.equal(laneLine?.status, 'requested')
    const folded = h.ledger.list().find((r) => r.issue === 400)
    assert.equal(folded?.laneBranch, 'feat/custom-slug')
    assert.equal(folded?.laneWorktree, join(homedir(), 'aether-custom'))
    assert.equal(folded?.submodules, true)
  } finally {
    h.cleanup()
  }
})

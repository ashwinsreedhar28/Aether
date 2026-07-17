// Isolated test for the lane gate monitor (#378) — transitions, the dedupe
// rule, the boot diff (#372 reproduced), and the single-shot alarms, against
// a throwaway temp ledger and a scripted mesh invoke. No Electron, no timers
// (tick() driven by hand), no network.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/laneMonitor.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LaneMonitor,
  AGE_REMIND_MIN,
  GATE_POLL_MS,
  STALL_MIN,
  type GateUpdate,
} from './laneMonitor.ts'
import { SpawnLedger } from './spawnLedger.ts'

const SPAWNED = '2026-07-01T10:00:00.000Z'

const comment = (body: string, created_at: string): { body: string; created_at: string } => ({
  body,
  created_at,
})

// The Python work_on_issue request line + the shell's spawned lifecycle —
// the on-disk shapes the live flows write.
function laneLines(issue: number, spawnedTs = SPAWNED): Array<Record<string, unknown>> {
  return [
    {
      id: `lane-${issue}`,
      ts: '2026-07-01T09:59:00.000Z',
      kind: 'lane',
      issue,
      issue_title: 'feat(x): a thing',
      batch_id: 'b1',
      branch: `lane/issue-${issue}`,
      worktree: `~/aether-lane-${issue}`,
      status: 'requested',
    },
    {
      id: `lane-${issue}`,
      ts: spawnedTs,
      status: 'spawned',
      worktree: `/x/aether-lane-${issue}`,
      branch: `lane/issue-${issue}`,
    },
  ]
}

interface Harness {
  monitor: LaneMonitor
  makeMonitor: () => LaneMonitor
  ledger: SpawnLedger
  state: {
    comments: unknown
    fail: boolean
    calls: Array<Record<string, unknown>>
    notifications: string[]
    updates: GateUpdate[]
    nowMs: number
  }
  cleanup: () => void
}

function freshHarness(
  opts: { seed?: Array<Record<string, unknown>>; ageRemindMin?: number; stallMin?: number } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'lane-monitor-'))
  const path = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(path) // ctor mkdirs the spawns dir
  for (const line of opts.seed ?? laneLines(372)) {
    appendFileSync(path, JSON.stringify(line) + '\n')
  }
  const state: Harness['state'] = {
    comments: [],
    fail: false,
    calls: [],
    notifications: [],
    updates: [],
    nowMs: Date.now(),
  }
  const makeMonitor = (): LaneMonitor =>
    new LaneMonitor({
      ledgerPath: path,
      invoke: (target, payload) => {
        state.calls.push(payload)
        assert.equal(target, 'github.get_issue')
        if (state.fail) return Promise.resolve({ ok: false })
        return Promise.resolve({ ok: true, envelope: { payload: { comments: state.comments } } })
      },
      notify: (body) => state.notifications.push(body),
      onGateUpdate: (update) => state.updates.push(update),
      ageRemindMin: opts.ageRemindMin,
      stallMin: opts.stallMin,
      now: () => state.nowMs,
    })
  return {
    monitor: makeMonitor(),
    makeMonitor,
    ledger,
    state,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('the spec constants pin: 60s poll, 120m age reminder, 240m stall', () => {
  assert.equal(GATE_POLL_MS, 60_000)
  assert.equal(AGE_REMIND_MIN, 120)
  assert.equal(STALL_MIN, 240)
})

test('a fresh GATE REPORT transitions working → at-gate once: ledger line, notification, card push — the identical next tick is silent', async () => {
  const h = freshHarness()
  try {
    h.state.comments = [comment('GATE REPORT — verify clean', '2026-07-01T11:00:00.000Z')]
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 1)
    assert.equal(gates[0]?.issue, 372)
    assert.equal(gates[0]?.phase, 'at-gate')
    assert.equal(gates[0]?.prev, 'working')
    assert.equal(gates[0]?.reminder, false)
    // Spec-fixed copy shape.
    assert.deepEqual(h.state.notifications, ['Lane #372 at gate'])
    // The folded gate state rides the push so the card merges without a fetch.
    assert.equal(h.state.updates.length, 1)
    assert.equal(h.state.updates[0]?.phase, 'at-gate')
    assert.equal(h.state.updates[0]?.gate.report, 'GATE REPORT — verify clean')
    // The dedupe rule: same folded phase → no new line, no re-announce.
    await h.monitor.tick()
    assert.equal(h.ledger.listGates().length, 1)
    assert.equal(h.state.notifications.length, 1)
    assert.equal(h.state.updates.length, 1)
  } finally {
    h.cleanup()
  }
})

test('the boot diff (#372 reproduced): a transition that happened while the shell was down announces on the first successful tick', async () => {
  // The previous session recorded AT GATE; while the app was down the lane
  // posted PR OPENED. A fresh monitor's first tick diffs the ledger's
  // last-known phase against the fresh fold — no side state file to lose.
  const h = freshHarness({
    seed: [
      ...laneLines(372),
      {
        id: 'g1',
        ts: '2026-07-01T12:00:00.000Z',
        kind: 'gate',
        issue: 372,
        phase: 'at-gate',
        prev: 'working',
      },
    ],
  })
  try {
    h.state.comments = [
      comment('GATE REPORT — verify clean', '2026-07-01T11:30:00.000Z'),
      comment('PR OPENED — #400 https://github.com/x/aether/pull/400', '2026-07-02T09:00:00.000Z'),
    ]
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 2)
    assert.equal(gates[1]?.phase, 'pr-opened')
    assert.equal(gates[1]?.prev, 'at-gate')
    assert.deepEqual(h.state.notifications, ['Lane #372 PR opened'])
  } finally {
    h.cleanup()
  }
})

test('DIRECTOR FEEDBACK newer than the report announces REVISING', async () => {
  const h = freshHarness({
    seed: [
      ...laneLines(372),
      {
        id: 'g1',
        ts: '2026-07-01T11:01:00.000Z',
        kind: 'gate',
        issue: 372,
        phase: 'at-gate',
        prev: 'working',
      },
    ],
  })
  try {
    h.state.comments = [
      comment('GATE REPORT — verify clean', '2026-07-01T11:00:00.000Z'),
      comment('DIRECTOR FEEDBACK — the toast fires twice', '2026-07-01T12:00:00.000Z'),
    ]
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 2)
    assert.equal(gates[1]?.phase, 'revising')
    assert.deepEqual(h.state.notifications, ['Lane #372 revising'])
  } finally {
    h.cleanup()
  }
})

test('a dead newer duplicate never hides the live lane from the monitor (#383)', async () => {
  // The July-14 374 shape — the lane-family subset of the parity fixture
  // (spawnLedger.test.ts and raven-core's tests/lane_fixtures.py carry the
  // full table): an older arm that spawned, a newer arm that failed
  // preflight and was dismissed. The monitor must poll the LIVE record —
  // under the old newest-record-first law this lane was invisible: no poll,
  // no at-gate alarm, no gate line.
  const h = freshHarness({
    seed: [
      { id: 'arm-374-a', ts: '2026-07-14T23:46:52+00:00', kind: 'lane', issue: 374, issue_title: 'chore(docs): §10 gotchas', batch_id: 'batch-374-a', branch: 'lane/issue-374', worktree: '~/aether-lane-374', status: 'requested' },
      { id: 'arm-374-b', ts: '2026-07-14T23:47:24+00:00', kind: 'lane', issue: 374, issue_title: 'chore(docs): §10 gotchas', batch_id: 'batch-374-b', branch: 'lane/issue-374', worktree: '~/aether-lane-374', status: 'requested' },
      { id: 'arm-374-a', ts: '2026-07-14T23:49:19+00:00', status: 'spawned', worktree: '/x/aether-lane-374', branch: 'lane/issue-374' },
      { id: 'arm-374-b', ts: '2026-07-14T23:56:15+00:00', status: 'failed', step: 'preflight', error: 'worktree path already exists' },
      { id: 'arm-374-b', ts: '2026-07-14T23:56:17+00:00', status: 'dismissed' },
      // A drain proposal line (#393) rides the same ledger and is invisible
      // to the monitor — the assertions below hold unchanged.
      { id: 'drain-1', ts: '2026-07-14T23:57:00+00:00', kind: 'drain', batch_id: 'batch-drain-1', issues: [390] },
    ],
  })
  try {
    h.state.comments = [comment('GATE REPORT — verify clean', '2026-07-15T00:10:00.000Z')]
    await h.monitor.tick()
    // Exactly one poll, addressed to the lane the LIVE record names.
    assert.deepEqual(h.state.calls, [{ number: 374 }])
    assert.deepEqual(h.state.notifications, ['Lane #374 at gate'])
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 1)
    assert.equal(gates[0]?.issue, 374)
    assert.equal(gates[0]?.phase, 'at-gate')
  } finally {
    h.cleanup()
  }
})

test('a failed fetch fabricates nothing; the next successful tick announces', async () => {
  const h = freshHarness()
  try {
    h.state.comments = [comment('GATE REPORT — verify clean', '2026-07-01T11:00:00.000Z')]
    h.state.fail = true
    await h.monitor.tick()
    assert.equal(h.ledger.listGates().length, 0)
    assert.equal(h.state.notifications.length, 0)
    h.state.fail = false
    await h.monitor.tick()
    assert.equal(h.ledger.listGates().length, 1)
    assert.deepEqual(h.state.notifications, ['Lane #372 at gate'])
  } finally {
    h.cleanup()
  }
})

test('a transition back to working is recorded and pushed, never announced', async () => {
  // A respawn's fresh spawnedTs (or a deleted comment) folds the thread back
  // to working: the ledger self-heals with a recorded transition, but there
  // is nothing for the Director to act on — no notification.
  const h = freshHarness({
    seed: [
      ...laneLines(372),
      {
        id: 'g1',
        ts: '2026-07-01T11:01:00.000Z',
        kind: 'gate',
        issue: 372,
        phase: 'at-gate',
        prev: 'working',
      },
    ],
  })
  try {
    h.state.comments = []
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 2)
    assert.equal(gates[1]?.phase, 'working')
    assert.equal(gates[1]?.prev, 'at-gate')
    assert.equal(h.state.notifications.length, 0)
    assert.equal(h.state.updates.length, 1)
  } finally {
    h.cleanup()
  }
})

test('the age alarm: one reminder per sitting, itself a ledger line — restarts never re-fire it (smoke 4)', async () => {
  const h = freshHarness()
  try {
    h.state.comments = [comment('GATE REPORT — verify clean', '2026-07-01T11:00:00.000Z')]
    await h.monitor.tick() // the at-gate transition, observed "now"
    // Just under the threshold: silent.
    h.state.nowMs = Date.now() + 119 * 60_000
    await h.monitor.tick()
    assert.equal(h.ledger.listGates().length, 1)
    // Past it: exactly one reminder line + one reminder notification.
    h.state.nowMs = Date.now() + 121 * 60_000
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 2)
    assert.equal(gates[1]?.reminder, true)
    assert.equal(gates[1]?.phase, 'at-gate')
    assert.match(h.state.notifications[1] ?? '', /Lane #372 still at gate/)
    // Later ticks stay silent — the sitting already reminded.
    h.state.nowMs = Date.now() + 300 * 60_000
    await h.monitor.tick()
    assert.equal(h.ledger.listGates().length, 2)
    assert.equal(h.state.notifications.length, 2)
    // A restarted monitor (fresh instance, same ledger) refolds the reminder
    // line and stays silent too — the dedupe is durable, not in-memory.
    await h.makeMonitor().tick()
    assert.equal(h.ledger.listGates().length, 2)
    assert.equal(h.state.notifications.length, 2)
  } finally {
    h.cleanup()
  }
})

test('the stall alarm: still working with no report STALL_MIN after spawn — one reminder, restart-proof', async () => {
  const spawnedIso = new Date(Date.now() - 241 * 60_000).toISOString()
  const h = freshHarness({ seed: laneLines(372, spawnedIso) })
  try {
    h.state.comments = []
    await h.monitor.tick()
    const gates = h.ledger.listGates()
    assert.equal(gates.length, 1)
    assert.equal(gates[0]?.reminder, true)
    assert.equal(gates[0]?.phase, 'working')
    assert.match(h.state.notifications[0] ?? '', /Lane #372 stalled/)
    // Re-tick and restart: the reminder line dedupes both.
    await h.monitor.tick()
    await h.makeMonitor().tick()
    assert.equal(h.ledger.listGates().length, 1)
    assert.equal(h.state.notifications.length, 1)
  } finally {
    h.cleanup()
  }
  // Under the threshold nothing fires.
  const young = freshHarness({
    seed: laneLines(373, new Date(Date.now() - 100 * 60_000).toISOString()),
  })
  try {
    young.state.comments = []
    await young.monitor.tick()
    assert.equal(young.ledger.listGates().length, 0)
    assert.equal(young.state.notifications.length, 0)
  } finally {
    young.cleanup()
  }
})

test('only the newest spawned arm per issue polls; drafts, closed lanes, and old arms never do', async () => {
  const oldArm = [
    {
      id: 'old-arm',
      ts: '2026-07-01T09:00:00.000Z',
      kind: 'lane',
      issue: 372,
      issue_title: 'feat(x): a thing',
      branch: 'lane/issue-372',
      worktree: '~/aether-lane-372',
      status: 'requested',
    },
    { id: 'old-arm', ts: '2026-07-01T09:01:00.000Z', status: 'dismissed' },
  ]
  const closedLane = [
    ...laneLines(400),
    { id: 'lane-400', ts: '2026-07-01T12:00:00.000Z', status: 'closed' },
  ]
  const draft = [
    {
      id: 'd1',
      ts: '2026-07-01T09:30:00.000Z',
      draft_path: '/drafts/x.md',
      draft_name: 'x',
      status: 'requested',
    },
  ]
  const h = freshHarness({ seed: [...oldArm, ...laneLines(372), ...closedLane, ...draft] })
  try {
    h.state.comments = []
    await h.monitor.tick()
    assert.deepEqual(
      h.state.calls.map((c) => c.number),
      [372],
    )
  } finally {
    h.cleanup()
  }
})

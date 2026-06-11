// Isolated tests for the #300 spawn fixes — the fixed send-keys argv (kickoff
// content never rides a shell; the claude line reaches tmux as one raw
// element) and the terminal-dispatch race (a renderer reply that never comes
// degrades to false instead of pinning the recipe). No Electron, no tmux, no
// live recipe.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/spawnService.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SpawnService,
  LANE_CLAUDE_CMD,
  laneSendKeysArgs,
  laneKickoff,
  parsePaneId,
  withTimeout,
} from './spawnService.ts'
import { SpawnLedger } from './spawnLedger.ts'

// ---- kickoff delivery is file-based: the send-keys argv is FIXED ------------

test('laneSendKeysArgs varies the pane id and nothing else', () => {
  // %pane_id, not '='+session: run-4 field matrix — send-keys refuses the
  // '=' exact-match targets that display -p and list-panes accept.
  assert.deepEqual(laneSendKeysArgs('%0'), [
    'send-keys',
    '-t',
    '%0',
    'claude --dangerously-skip-permissions "$(cat .lane-kickoff.md)"',
    'Enter',
  ])
})

test('the send-keys argv carries zero kickoff content; the claude element is byte-identical to LANE_CLAUDE_CMD', () => {
  const args = laneSendKeysArgs('%3')
  // The #298 failure mode: kickoff prose riding shell quoting layers. No
  // fragment of laneKickoff may appear anywhere in the argv, and the line
  // tmux types into the pane must be exactly the exported constant.
  const flat = args.join(' ')
  assert.ok(!flat.includes('Implementer'))
  assert.ok(!flat.includes(laneKickoff(219).slice(0, 24)))
  assert.equal(args[3], LANE_CLAUDE_CMD)
})

test('parsePaneId takes the first line and enforces the %N shape', () => {
  assert.equal(parsePaneId('%0\n', 'lane-300'), '%0')
  assert.equal(parsePaneId('%12\n%13\n', 'lane-300'), '%12')
  // Anything that is not an immutable pane id is a named throw — never a
  // garbage target handed to send-keys.
  assert.throws(() => parsePaneId('', 'lane-300'), /no usable pane id/)
  assert.throws(() => parsePaneId('lane-300\n', 'lane-300'), /no usable pane id/)
  assert.throws(() => parsePaneId('%abc\n', 'lane-300'), /no usable pane id/)
})

// ---- the dispatch race: a silent renderer must not hang the recipe ----------

test('withTimeout resolves null when the promise never settles', async () => {
  const never = new Promise<never>(() => {})
  assert.equal(await withTimeout(never, 25), null)
})

test('withTimeout passes through a settled value and a rejection', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok')
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000), /boom/)
})

// ---- terminal writes on live-session records (#305 dismiss-semantics audit) -

// A service over a ledger holding one spawned record with a recorded tmux
// session, with the probe stubbed to report it alive/dead — no tmux, no
// Electron (the same private-access cast the dispatch test uses).
function spawnedServiceFixture(sessionAlive: boolean): {
  svc: SpawnService
  id: string
  ledger: SpawnLedger
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-service-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  const rec = ledger.request('demo', join(dir, 'demo.md'))
  ledger.markSpawned(rec.id, join(dir, 'wt'), 'lane/issue-232', undefined, 'lane-232')
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const open = svc as unknown as {
    tmuxOk: boolean
    tmuxHasSession: (session: string) => Promise<boolean>
  }
  open.tmuxOk = true
  open.tmuxHasSession = async () => sessionAlive
  return { svc, id: rec.id, ledger, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('complete refuses a live-session record without force — never a silent terminal write', async () => {
  const { svc, id, ledger, cleanup } = spawnedServiceFixture(true)
  try {
    const res = await svc.complete(id)
    assert.equal(res.ok, false)
    assert.equal(res.code, 'live-session')
    // The refusal wrote nothing: the record still holds its capacity slot.
    assert.equal(ledger.find(id)?.status, 'spawned')
    assert.equal(ledger.liveCount(), 1)
    // The same action, forced, is the deliberate path the card's warning offers.
    const forced = await svc.complete(id, true)
    assert.equal(forced.ok, true)
    assert.equal(ledger.find(id)?.status, 'closed')
  } finally {
    cleanup()
  }
})

test('complete closes a dead-session record without ceremony', async () => {
  const { svc, id, ledger, cleanup } = spawnedServiceFixture(false)
  try {
    const res = await svc.complete(id)
    assert.equal(res.ok, true)
    assert.equal(ledger.find(id)?.status, 'closed')
  } finally {
    cleanup()
  }
})

test('dismiss refuses a spawned record outright (#305 audit: blocked, not non-terminal)', async () => {
  const { svc, id, ledger, cleanup } = spawnedServiceFixture(true)
  try {
    const res = svc.dismiss(id)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /cannot dismiss a spawned spawn/)
    assert.equal(ledger.find(id)?.status, 'spawned')
  } finally {
    cleanup()
  }
})

test('openLaneTerminal resolves false against a never-resolving dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-service-'))
  try {
    const svc = new SpawnService({
      repoRoot: dir,
      ledgerPath: join(dir, 'spawns', 'requests.jsonl'),
      // The field failure mode (#298): the renderer never replies.
      dispatch: () => new Promise(() => {}),
    })
    const opened = await (
      svc as unknown as {
        openLaneTerminal: (
          cwd: string,
          command: string,
          title: string,
          timeoutMs?: number,
        ) => Promise<boolean>
      }
    ).openLaneTerminal(dir, 'echo hi', 'Lane #300', 25)
    assert.equal(opened, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

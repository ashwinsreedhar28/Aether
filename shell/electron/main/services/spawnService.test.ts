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
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SpawnService,
  LANE_CLAUDE_CMD,
  laneSendKeysArgs,
  laneKickoff,
  parsePaneId,
  relaySendKeysArgs,
  withTimeout,
} from './spawnService.ts'
import { SpawnLedger, RELAY_TEXT } from './spawnLedger.ts'

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

// ---- gate relays (#310): fixed text, named refusals, no auto-proceed ---------

test('relaySendKeysArgs varies the pane id and nothing else — the text is the allowlist literal', () => {
  assert.deepEqual(relaySendKeysArgs('%4'), ['send-keys', '-t', '%4', 'clean, proceed', 'Enter'])
  // The argv has no text parameter to vary: the literal IS the v1 scope fence.
  assert.equal(relaySendKeysArgs('%9')[3], RELAY_TEXT)
})

test('laneKickoff dictates the machine-readable lane channel (#310 prefixes)', () => {
  const k = laneKickoff(310)
  // Prefix literals kept in sync with shell/src/utils/laneGate.ts (its own
  // test pins the same strings on the fold side).
  assert.ok(k.includes('"GATE REPORT — "'))
  assert.ok(k.includes('PR OPENED — '))
  assert.ok(k.includes('gh issue comment 310'))
  assert.ok(k.includes('Closes #310'))
})

// A service over a ledger holding one live lane record (issue 232, tmux
// session recorded), tmux fully stubbed: requireTmuxBin resolves to
// /usr/bin/true, so the send-keys exec really runs — and exits 0 — without a
// tmux server anywhere near the test.
function liveLaneFixture(): {
  svc: SpawnService
  ledger: SpawnLedger
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-relay-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  appendFileSync(
    ledgerPath,
    JSON.stringify({
      id: 'lane-rec',
      ts: '2026-06-11T00:00:00.000Z',
      kind: 'lane',
      batch_id: 'b1',
      issue: 232,
      issue_title: 'demo lane',
      branch: 'lane/issue-232',
      worktree: '~/aether-lane-232',
      status: 'requested',
    }) + '\n',
  )
  ledger.markSpawned('lane-rec', join(dir, 'wt'), 'lane/issue-232', undefined, 'lane-232')
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const open = svc as unknown as {
    tmuxOk: boolean
    tmuxHasSession: (session: string) => Promise<boolean>
    resolveLanePaneId: (session: string) => Promise<string>
    requireTmuxBin: () => string
  }
  open.tmuxOk = true
  open.tmuxHasSession = async () => true
  open.resolveLanePaneId = async () => '%7'
  open.requireTmuxBin = () => '/usr/bin/true'
  return { svc, ledger, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('proceed relays to a live lane and records the relayed outcome', async () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    const res = await svc.proceed(232)
    assert.equal(res.ok, true)
    const relay = ledger.listRelays()[0]
    assert.equal(relay?.issue, 232)
    assert.equal(relay?.text, RELAY_TEXT)
    assert.equal(relay?.status, 'relayed')
    // The relay never touched the spawn record.
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
  } finally {
    cleanup()
  }
})

test('proceed with no live lane fails by name and the failure is on the ledger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-relay-'))
  try {
    const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
    const svc = new SpawnService({ repoRoot: dir, ledgerPath })
    const res = await svc.proceed(999)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /no live \(spawned\) lane record for issue #999/)
    const relay = new SpawnLedger(ledgerPath).listRelays()[0]
    assert.equal(relay?.status, 'failed')
    assert.match(relay?.error ?? '', /no live/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('executeRelay refuses non-allowlisted text — a hand-edited ledger line cannot type into a pane', async () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    const rogue = ledger.requestRelay(232, 'rm -rf / # not the literal')
    const res = await (
      svc as unknown as { executeRelay: (id: string) => Promise<{ ok: boolean; error?: string }> }
    ).executeRelay(rogue.id)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /not allowlisted/)
    assert.equal(ledger.findRelay(rogue.id)?.status, 'failed')
  } finally {
    cleanup()
  }
})

test('armRelays fails boot-pending relays instead of sending them (no auto-proceed)', () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    ledger.requestRelay(232)
    ;(svc as unknown as { armRelays: () => void }).armRelays()
    assert.equal(ledger.pendingRelays().length, 0)
    const relay = ledger.listRelays()[0]
    assert.equal(relay?.status, 'failed')
    assert.match(relay?.error ?? '', /never auto-sent/)
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

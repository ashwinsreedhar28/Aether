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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

// ---- guarded teardown (#317): refusals, warn-and-force, canonical execution --

// A live lane (issue 232) whose worktree really exists on disk (with the
// recipe's untracked kickoff file in it), every guard probe stubbed CLEAN and
// every git step recorded instead of executed — each test flips exactly one
// stub to draw its refusal. tmux is /usr/bin/true, as in liveLaneFixture.
interface TeardownOpen {
  tmuxOk: boolean
  tmuxHasSession: (session: string) => Promise<boolean>
  requireTmuxBin: () => string
  probeOpenPr: (branch: string) => Promise<{ number?: number; url?: string } | null>
  paneBusyCommand: (session: string | undefined) => Promise<string | null>
  worktreeDirty: (worktree: string) => Promise<string | null>
  branchUnpushed: (branch: string) => Promise<number>
  branchExists: (branch: string) => Promise<boolean>
  runShell: (cmd: string, cwd: string) => Promise<void>
  armTeardowns: () => void
}

function teardownFixture(): {
  svc: SpawnService
  ledger: SpawnLedger
  repoRoot: string
  worktree: string
  commands: Array<{ cmd: string; cwd: string }>
  open: TeardownOpen
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-teardown-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  const worktree = join(dir, 'wt')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(join(worktree, '.lane-kickoff.md'), 'kickoff')
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
  ledger.markSpawned('lane-rec', worktree, 'lane/issue-232', undefined, 'lane-232')
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const commands: Array<{ cmd: string; cwd: string }> = []
  const open = svc as unknown as TeardownOpen
  open.tmuxOk = true
  open.tmuxHasSession = async () => true
  open.requireTmuxBin = () => '/usr/bin/true'
  open.probeOpenPr = async () => null
  open.paneBusyCommand = async () => null
  open.worktreeDirty = async () => null
  open.branchUnpushed = async () => 0
  open.branchExists = async () => true
  open.runShell = async (cmd: string, cwd: string) => {
    commands.push({ cmd, cwd })
  }
  return {
    svc,
    ledger,
    repoRoot: dir,
    worktree,
    commands,
    open,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('closeLane runs the canonical cleanup order and closes the record', async () => {
  const { svc, ledger, repoRoot, worktree, commands, cleanup } = teardownFixture()
  try {
    const res = await svc.closeLane(232)
    assert.equal(res.ok, true)
    // closed written, capacity freed, teardown settled done.
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.equal(ledger.liveCount(), 0)
    assert.equal(ledger.listTeardowns()[0]?.status, 'done')
    // The kickoff file was really removed (the one non-git step).
    assert.equal(existsSync(join(worktree, '.lane-kickoff.md')), false)
    // The cleanup block's exact order: deinit (in the worktree) BEFORE
    // remove, then branch -D, then main's submodules restored (§13.12).
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git submodule deinit -f --all',
        `git worktree remove --force '${worktree}'`,
        "git branch -D 'lane/issue-232'",
        'git submodule update --init --recursive',
      ],
    )
    assert.equal(commands[0]?.cwd, worktree)
    assert.equal(commands[1]?.cwd, repoRoot)
    assert.equal(commands[3]?.cwd, repoRoot)
  } finally {
    cleanup()
  }
})

test('closeLane refuses while a PR is open on the branch — code pr-open, nothing destroyed', async () => {
  const { svc, ledger, worktree, commands, open, cleanup } = teardownFixture()
  try {
    open.probeOpenPr = async () => ({ number: 99, url: 'https://x' })
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.equal(res.code, 'pr-open')
    assert.match(res.error ?? '', /PR #99 is open/)
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
    assert.equal(ledger.listTeardowns()[0]?.code, 'pr-open')
    assert.equal(commands.length, 0)
    assert.equal(existsSync(join(worktree, '.lane-kickoff.md')), true)
    // No force path past pr-open: CLOSE ANYWAY semantics do not apply here.
    const forced = await svc.closeLane(232, true)
    assert.equal(forced.ok, false)
    assert.equal(forced.code, 'pr-open')
  } finally {
    cleanup()
  }
})

test('closeLane fails closed when the PR probe errors — never destroy on unknown PR state', async () => {
  const { svc, ledger, commands, open, cleanup } = teardownFixture()
  try {
    open.probeOpenPr = async () => {
      throw new Error('gh: command not found')
    }
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.equal(res.code, undefined)
    assert.match(res.error ?? '', /refusing to close out while PR state is unknown/)
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
    assert.equal(commands.length, 0)
  } finally {
    cleanup()
  }
})

test('closeLane refuses a busy pane — code lane-busy, and it outranks the dirty warn', async () => {
  const { svc, ledger, commands, open, cleanup } = teardownFixture()
  try {
    open.paneBusyCommand = async () => 'node'
    // Both guards trip: the hard refusal must surface FIRST, so a CLOSE
    // ANYWAY can never land on a subsequent refusal.
    open.worktreeDirty = async () => '?? src/new.ts'
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.equal(res.code, 'lane-busy')
    assert.match(res.error ?? '', /still running node/)
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
    assert.equal(commands.length, 0)
  } finally {
    cleanup()
  }
})

test('dirty worktree warns (code dirty) and only an explicit force proceeds — #308 warn-and-force', async () => {
  const { svc, ledger, open, cleanup } = teardownFixture()
  try {
    open.worktreeDirty = async () => '?? src/new.ts'
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.equal(res.code, 'dirty')
    assert.match(res.error ?? '', /uncommitted changes/)
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
    // The same action, forced — the card's CLOSE ANYWAY.
    const forced = await svc.closeLane(232, true)
    assert.equal(forced.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
  } finally {
    cleanup()
  }
})

test('unpushed commits warn with the same dirty code', async () => {
  const { svc, open, cleanup } = teardownFixture()
  try {
    open.branchUnpushed = async () => 2
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.equal(res.code, 'dirty')
    assert.match(res.error ?? '', /2 commit\(s\) on no remote/)
  } finally {
    cleanup()
  }
})

test('a failing step writes teardown_failed naming it, holds capacity, and a retry resumes', async () => {
  const { svc, ledger, commands, open, cleanup } = teardownFixture()
  try {
    open.runShell = async (cmd: string, cwd: string) => {
      commands.push({ cmd, cwd })
      if (cmd.startsWith('git worktree remove')) throw new Error('worktree is locked')
    }
    const res = await svc.closeLane(232)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /git worktree remove/)
    const rec = ledger.find('lane-rec')
    assert.equal(rec?.status, 'teardown_failed')
    assert.equal(rec?.step, 'git worktree remove')
    // Capacity freed only by closed (#317): the failed teardown still holds it.
    assert.equal(ledger.liveCount(), 1)
    assert.equal(ledger.listTeardowns()[0]?.status, 'failed')
    assert.equal(ledger.listTeardowns()[0]?.step, 'git worktree remove')

    // Retry (the card's CLOSE OUT on the TEARDOWN FAILED state): steps are
    // precondition-guarded, so the run resumes and completes.
    open.runShell = async (cmd: string, cwd: string) => {
      commands.push({ cmd, cwd })
    }
    const retry = await svc.closeLane(232)
    assert.equal(retry.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.equal(ledger.liveCount(), 0)
  } finally {
    cleanup()
  }
})

test('armTeardowns fails boot-pending teardowns instead of executing them (no auto-destroy)', () => {
  const { svc, ledger, worktree, open, cleanup } = teardownFixture()
  try {
    ledger.requestTeardown(232)
    open.armTeardowns()
    assert.equal(ledger.pendingTeardowns().length, 0)
    const td = ledger.listTeardowns()[0]
    assert.equal(td?.status, 'failed')
    assert.match(td?.error ?? '', /never auto-executed/)
    // Nothing was destroyed and the record is untouched.
    assert.equal(ledger.find('lane-rec')?.status, 'spawned')
    assert.equal(existsSync(join(worktree, '.lane-kickoff.md')), true)
    void svc
  } finally {
    cleanup()
  }
})

test('closeLane with no live lane fails by name and the failure is on the ledger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-teardown-'))
  try {
    const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
    const svc = new SpawnService({ repoRoot: dir, ledgerPath })
    const res = await svc.closeLane(999)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /no live lane record for issue #999/)
    const td = new SpawnLedger(ledgerPath).listTeardowns()[0]
    assert.equal(td?.status, 'failed')
    assert.match(td?.error ?? '', /no live/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- pull-based orphan freshness (#318) --------------------------------------

// A ledger holding three session-bearing histories — lane-1 live ('spawned'),
// lane-2 force-closed (terminal), lane-3 teardown_failed (NOT terminal, #317)
// — with the tmux enumeration stubbed to the given detached-session list: no
// tmux server anywhere near the test.
function orphanFixture(detached: string[]): {
  svc: SpawnService
  ledger: SpawnLedger
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-orphans-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  const laneLine = (id: string, issue: number): string =>
    JSON.stringify({
      id,
      ts: `2026-06-11T00:0${issue}:00.000Z`,
      kind: 'lane',
      batch_id: 'b1',
      issue,
      issue_title: 'demo',
      branch: `lane/issue-${issue}`,
      worktree: `~/aether-lane-${issue}`,
      status: 'requested',
    }) + '\n'
  appendFileSync(ledgerPath, laneLine('rec-1', 1))
  appendFileSync(ledgerPath, laneLine('rec-2', 2))
  appendFileSync(ledgerPath, laneLine('rec-3', 3))
  ledger.markSpawned('rec-1', join(dir, 'wt1'), 'lane/issue-1', undefined, 'lane-1')
  ledger.markSpawned('rec-2', join(dir, 'wt2'), 'lane/issue-2', undefined, 'lane-2')
  ledger.markSpawned('rec-3', join(dir, 'wt3'), 'lane/issue-3', undefined, 'lane-3')
  ledger.markClosed('rec-2')
  ledger.markRecordTeardownFailed('rec-3', 'tmux kill-session', 'kill refused')
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const open = svc as unknown as {
    tmuxOk: boolean
    tmuxHasSession: (session: string) => Promise<boolean>
    listDetachedLaneSessions: () => Promise<string[]>
  }
  open.tmuxOk = true
  open.tmuxHasSession = async () => true
  open.listDetachedLaneSessions = async () => detached
  return { svc, ledger, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('refreshOrphans keeps live-record sessions (with recordId), drops terminal-record sessions, keeps hand-made ones', async () => {
  const { svc, cleanup } = orphanFixture(['lane-1', 'lane-2', 'lane-3', 'lane-9'])
  try {
    const snap = await svc.refreshOrphans()
    // lane-2's newest record is closed — its lifecycle is over, no row.
    assert.deepEqual(
      snap.orphans.map((o) => o.session),
      ['lane-1', 'lane-3', 'lane-9'],
    )
    // The live row is actionable: it names the record the card can complete.
    assert.equal(snap.orphans[0]?.recordId, 'rec-1')
    assert.equal(snap.orphans[0]?.issue, 1)
    // teardown_failed is NOT terminal (#317: retryable, holds capacity) — its
    // surviving session stays reattachable, but closeout is the card's CLOSE
    // OUT retry, never COMPLETE: no recordId.
    assert.equal(snap.orphans[1]?.issue, 3)
    assert.equal(snap.orphans[1]?.recordId, undefined)
    // The hand-made session has no record to complete — reattach-only.
    assert.equal(snap.orphans[2]?.recordId, undefined)
  } finally {
    cleanup()
  }
})

test('refreshOrphans drops sessions that died since the last probe — no relaunch needed', async () => {
  const { svc, cleanup } = orphanFixture(['lane-1'])
  try {
    const seeded = await svc.refreshOrphans()
    assert.equal(seeded.orphans.length, 1)
    // The session is killed in a terminal; the next pull sees it gone.
    ;(svc as unknown as { listDetachedLaneSessions: () => Promise<string[]> }).listDetachedLaneSessions =
      async () => []
    const snap = await svc.refreshOrphans()
    assert.deepEqual(snap.orphans, [])
  } finally {
    cleanup()
  }
})

test('a failed enumeration keeps the cache — a flaky probe must not blank real reattach offers', async () => {
  const { svc, cleanup } = orphanFixture(['lane-1'])
  try {
    await svc.refreshOrphans()
    ;(svc as unknown as { listDetachedLaneSessions: () => Promise<string[]> }).listDetachedLaneSessions =
      async () => {
        throw new Error('tmux exploded')
      }
    const snap = await svc.refreshOrphans()
    assert.equal(snap.orphans.length, 1)
    assert.equal(snap.orphans[0]?.session, 'lane-1')
  } finally {
    cleanup()
  }
})

test('a forced complete drops the record orphan row synchronously — no re-probe needed', async () => {
  const { svc, cleanup } = orphanFixture(['lane-1'])
  try {
    await svc.refreshOrphans()
    const res = await svc.complete('rec-1', true)
    assert.equal(res.ok, true)
    assert.deepEqual(svc.snapshot().orphans, [])
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

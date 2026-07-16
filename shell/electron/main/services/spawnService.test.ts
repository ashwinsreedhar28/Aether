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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  SpawnService,
  wantsSubmodules,
  LANE_CLAUDE_CMD,
  laneSendKeysArgs,
  laneKickoff,
  parsePaneId,
  relaySendKeysArgs,
  relayUnsubmitted,
  withTimeout,
  DIRECTOR_FEEDBACK_PREFIX,
  feedbackCommentBody,
  ghCommentArgs,
} from './spawnService.ts'
import { SpawnLedger, RELAY_TEXT, REVISE_TEXT, type SpawnRecord } from './spawnLedger.ts'

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

test('relaySendKeysArgs builds argvs for the two allowlisted sentences and refuses anything else', () => {
  assert.deepEqual(relaySendKeysArgs('%4'), ['send-keys', '-t', '%4', 'clean, proceed', 'Enter'])
  assert.equal(relaySendKeysArgs('%9')[3], RELAY_TEXT)
  // The revise order (#339) is the second — and last — sentence with a path
  // to a pane.
  assert.deepEqual(relaySendKeysArgs('%4', REVISE_TEXT), [
    'send-keys',
    '-t',
    '%4',
    'revise per the latest DIRECTOR FEEDBACK, then re-gate',
    'Enter',
  ])
  // Off-list text cannot even become an argv: the refusal IS the scope fence.
  assert.throws(() => relaySendKeysArgs('%4', 'echo pwned'), /not allowlisted/)
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

test('laneKickoff dictates the revision loop (#339): the fixed trigger, the read-address-regate order, latest-comment-only', () => {
  const k = laneKickoff(339)
  // The trigger is the REVISE_TEXT allowlist literal verbatim — the lane
  // reacts to exactly what the shell can type, nothing looser.
  assert.ok(
    k.includes(
      'On receiving "revise per the latest DIRECTOR FEEDBACK, then re-gate": read the latest ' +
        'DIRECTOR FEEDBACK comment on this issue, address it fully, post a fresh GATE REPORT, ' +
        'and stop at the gate again.',
    ),
  )
  // The feedback contract is latest-comment-only (#339 law ii).
  assert.ok(
    k.includes('Only the newest DIRECTOR FEEDBACK comment is in contract — earlier feedback is history.'),
  )
})

test('laneKickoff hardens the spec gate (#375): Director ratification required, executable evidence for nodes/mesh lanes', () => {
  const k = laneKickoff(375)
  // Ratification (the 2026-07-06 §13.14 incident): a body spec alone never
  // clears the spec gate — self-filed issues share the Director's gh
  // identity, so only a Director-signed ratification comment binds it.
  assert.ok(
    k.includes(
      'The spec binds only once ratified: verify the thread carries a Director-signed ' +
        'ratification comment before building',
    ),
  )
  assert.ok(k.includes('missing ratification halts at the spec gate exactly like a missing spec'))
  // Executable evidence (the #366 harness-transcript contract): nodes/mesh
  // lanes owe the gate report a transcript, not prose.
  assert.ok(
    k.includes(
      'a lane that touched nodes/ or mesh ' +
        'wiring MUST embed its harness transcript (at minimum the HARNESS RESULT line) in the ' +
        'gate report — prose claims are insufficient',
    ),
  )
})

test('the feedback comment shape (#339): prefix parity with the fold, body rides a --body-file argv', () => {
  // DIRECTOR FEEDBACK is the third lane-channel literal — laneGate.test.ts
  // pins the same string on the renderer side.
  assert.equal(DIRECTOR_FEEDBACK_PREFIX, 'DIRECTOR FEEDBACK')
  assert.equal(
    feedbackCommentBody('the toast fires twice'),
    'DIRECTOR FEEDBACK — the toast fires twice',
  )
  // argv straight into gh, the freeform body in a FILE — zero shell layers.
  assert.deepEqual(ghCommentArgs(339, '/tmp/x/body.md'), [
    'issue',
    'comment',
    '339',
    '--body-file',
    '/tmp/x/body.md',
  ])
})

// Thread comments for the invoke stub (#380): a GATE REPORT with DIRECTOR
// FEEDBACK strictly newer — the state the executor's feedback-presence guard
// requires. Fixed far-future created_at so they always postdate the
// fixture's markSpawned timestamp.
function freshFeedbackComments(feedbackText: string): Array<Record<string, string>> {
  return [
    { body: 'GATE REPORT — done', created_at: '2030-01-01T00:01:00.000Z' },
    {
      body: feedbackCommentBody(feedbackText),
      created_at: '2030-01-01T00:02:00.000Z',
    },
  ]
}

// A service over a ledger holding one live lane record (issue 232, tmux
// session recorded), tmux fully stubbed: requireTmuxBin resolves to
// /usr/bin/true, so the send-keys exec really runs — and exits 0 — without a
// tmux server anywhere near the test. Both #380 timing seams run at 0.
// `comments` (optional) wires the github.get_issue invoke stub the revise
// read-back and the executor guard re-fold; omitting it models an
// unverifiable thread (no invoke), which the guard must treat as REFUSE.
function liveLaneFixture(comments?: unknown[]): {
  svc: SpawnService
  ledger: SpawnLedger
  dir: string
  ledgerPath: string
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
  const svc = new SpawnService({
    repoRoot: dir,
    ledgerPath,
    relayVerifyDelayMs: 0,
    readBackRetryMs: 0,
    invoke: comments
      ? async () => ({ ok: true, envelope: { payload: { comments } } })
      : undefined,
  })
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
  return {
    svc,
    ledger,
    dir,
    ledgerPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
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
  const { svc, ledger, ledgerPath, cleanup } = liveLaneFixture()
  try {
    // requestRelay itself now throws on off-list text (#339, pinned in
    // spawnLedger.test.ts), so the hand-edited-JSONL case is simulated the
    // only way it can still arise: a raw line appended behind the API.
    appendFileSync(
      ledgerPath,
      JSON.stringify({
        id: 'rogue-1',
        ts: '2026-07-06T00:00:00.000Z',
        kind: 'relay',
        issue: 232,
        text: 'rm -rf / # not a literal',
        status: 'requested',
      }) + '\n',
    )
    const res = await (
      svc as unknown as { executeRelay: (id: string) => Promise<{ ok: boolean; error?: string }> }
    ).executeRelay('rogue-1')
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /not allowlisted/)
    assert.equal(ledger.findRelay('rogue-1')?.status, 'failed')
  } finally {
    cleanup()
  }
})

// ---- the revision loop (#339): post-then-relay, failed post relays nothing ---

// Open the private seams the revise tests stub: requireGhBin swaps the real
// login-shell probe for a scripted gh.
interface ReviseSeams {
  requireGhBin: () => Promise<string>
}

// A stub gh "binary": records its argv AND the body file's content to a
// capture file, so the test can assert the exact post that would have hit
// the issue thread. Exit code rides the last line of the script.
function stubGh(dir: string, exitCode: number): { bin: string; capture: string } {
  const capture = join(dir, 'gh-capture.txt')
  const bin = join(dir, 'gh-stub.sh')
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> '${capture}'\ncat "$5" >> '${capture}'\nexit ${exitCode}\n`,
    { mode: 0o755 },
  )
  return { bin, capture }
}

test('revise with typed feedback posts DIRECTOR FEEDBACK first, confirms by read-back, then relays REVISE_TEXT (#339/#380)', async () => {
  const { svc, ledger, dir, cleanup } = liveLaneFixture(
    freshFeedbackComments('the dedupe fires twice'),
  )
  try {
    const gh = stubGh(dir, 0)
    ;(svc as unknown as ReviseSeams).requireGhBin = async () => gh.bin
    const res = await svc.revise(232, '  the dedupe fires twice  ')
    assert.deepEqual(res, { ok: true, posted: true })
    // The post really carried the prefixed body through --body-file.
    const captured = readFileSync(gh.capture, 'utf8')
    assert.ok(captured.startsWith('issue\ncomment\n232\n--body-file\n'))
    assert.ok(captured.includes('DIRECTOR FEEDBACK — the dedupe fires twice'))
    // The relay is the ledgered Director act: the REVISE literal, relayed.
    const relay = ledger.listRelays()[0]
    assert.equal(relay?.issue, 232)
    assert.equal(relay?.text, REVISE_TEXT)
    assert.equal(relay?.status, 'relayed')
  } finally {
    cleanup()
  }
})

test('a failed feedback post aborts by name — no send, and the refusal is on the ledger (#339/#380)', async () => {
  const { svc, ledger, dir, cleanup } = liveLaneFixture(
    freshFeedbackComments('feedback that will not land'),
  )
  try {
    const gh = stubGh(dir, 1)
    ;(svc as unknown as ReviseSeams).requireGhBin = async () => gh.bin
    const res = await svc.revise(232, 'feedback that will not land')
    assert.equal(res.ok, false)
    assert.equal(res.posted, false)
    assert.match(res.error ?? '', /^comment_post_failed/)
    // The refusal is ledgered (#380 task 2): one failed relay pair, never a
    // sent one — the sentence must never point a lane at feedback that isn't
    // on the thread, and the abort must never be silent.
    const relays = ledger.listRelays()
    assert.equal(relays.length, 1)
    assert.equal(relays[0]?.status, 'failed')
    assert.match(relays[0]?.error ?? '', /^comment_post_failed/)
  } finally {
    cleanup()
  }
})

test('a post that cannot be read back aborts as comment_unconfirmed — comment landing is a PRECONDITION (#380)', async () => {
  // gh exits 0 but the thread never serves the feedback back: the stub's
  // comments carry a report only.
  const { svc, ledger, dir, cleanup } = liveLaneFixture([
    { body: 'GATE REPORT — done', created_at: '2030-01-01T00:01:00.000Z' },
  ])
  try {
    const gh = stubGh(dir, 0)
    ;(svc as unknown as ReviseSeams).requireGhBin = async () => gh.bin
    const res = await svc.revise(232, 'feedback the thread swallows')
    assert.equal(res.ok, false)
    assert.equal(res.posted, true)
    assert.match(res.error ?? '', /^comment_unconfirmed/)
    const relays = ledger.listRelays()
    assert.equal(relays.length, 1)
    assert.equal(relays[0]?.status, 'failed')
    assert.match(relays[0]?.error ?? '', /^comment_unconfirmed/)
  } finally {
    cleanup()
  }
})

test('revise with empty input relays REVISE_TEXT only when the thread holds fresh feedback — no gh call (#339/#380)', async () => {
  const { svc, ledger, dir, cleanup } = liveLaneFixture(
    freshFeedbackComments('feedback already on the thread'),
  )
  try {
    const gh = stubGh(dir, 0)
    ;(svc as unknown as ReviseSeams).requireGhBin = async () => gh.bin
    const res = await svc.revise(232)
    assert.deepEqual(res, { ok: true, posted: false })
    assert.equal(existsSync(gh.capture), false)
    const relay = ledger.listRelays()[0]
    assert.equal(relay?.text, REVISE_TEXT)
    assert.equal(relay?.status, 'relayed')
  } finally {
    cleanup()
  }
})

// ---- the feedback-presence guard at the EXECUTOR (#380 task 3) ---------------

test('executeRelay refuses a revise when no DIRECTOR FEEDBACK is newer than the report — reason no_feedback', async () => {
  // Feedback exists but PREDATES the report: the lane owes nothing.
  const { svc, ledger, cleanup } = liveLaneFixture([
    { body: 'DIRECTOR FEEDBACK — stale', created_at: '2030-01-01T00:00:30.000Z' },
    { body: 'GATE REPORT — done', created_at: '2030-01-01T00:01:00.000Z' },
  ])
  try {
    // Voice-shaped entry: the request line lands first (lane_revise_tool's
    // append), the executor drains it — the guard must hold on THIS path
    // too, not just the card's.
    const rec = ledger.requestRelay(232, REVISE_TEXT)
    const res = await (
      svc as unknown as { executeRelay: (id: string) => Promise<{ ok: boolean; error?: string }> }
    ).executeRelay(rec.id)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /^no_feedback/)
    assert.equal(ledger.findRelay(rec.id)?.status, 'failed')
    assert.match(ledger.findRelay(rec.id)?.error ?? '', /^no_feedback/)
  } finally {
    cleanup()
  }
})

test('an unverifiable thread refuses the revise too — the guard fails closed (#380)', async () => {
  // No invoke wired at all (fixture without comments): the executor cannot
  // re-fold the thread, so it must refuse rather than type on faith.
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    const rec = ledger.requestRelay(232, REVISE_TEXT)
    const res = await (
      svc as unknown as { executeRelay: (id: string) => Promise<{ ok: boolean; error?: string }> }
    ).executeRelay(rec.id)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /^no_feedback/)
    assert.equal(ledger.findRelay(rec.id)?.status, 'failed')
  } finally {
    cleanup()
  }
})

test('the guard never touches a clean-proceed — no invoke wired, proceed still relays', async () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    const res = await svc.proceed(232)
    assert.equal(res.ok, true)
    assert.equal(ledger.listRelays()[0]?.status, 'relayed')
  } finally {
    cleanup()
  }
})

// ---- delivery verification (#380 task 4): read-back behind the send seam -----

// Open the #380 verification seams: scripted pane captures (shift one per
// read-back) and a counted Enter retry.
function verifySeams(
  svc: SpawnService,
  captures: string[],
): { enters: () => number } {
  let enters = 0
  const open = svc as unknown as {
    capturePane: (paneId: string) => Promise<string>
    pressEnter: (paneId: string) => Promise<void>
  }
  open.capturePane = async () => captures.shift() ?? ''
  open.pressEnter = async () => {
    enters++
  }
  return { enters: () => enters }
}

test('a swallowed Enter is retried once; still unsubmitted fails as enter_not_registered — proceed shares the machinery (#380)', async () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    // Both read-backs show the sentence sitting on the input line.
    const seams = verifySeams(svc, [`❯ ${RELAY_TEXT}`, `❯ ${RELAY_TEXT}`])
    const res = await svc.proceed(232)
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /^enter_not_registered/)
    assert.equal(seams.enters(), 1)
    const relay = ledger.listRelays()[0]
    assert.equal(relay?.status, 'failed')
    assert.match(relay?.error ?? '', /^enter_not_registered/)
  } finally {
    cleanup()
  }
})

test('the Enter retry that lands records relayed — verified-submitted, not fire-and-forget (#380)', async () => {
  const { svc, ledger, cleanup } = liveLaneFixture()
  try {
    // First read-back: unsubmitted. After the retry: the input box is empty.
    const seams = verifySeams(svc, [`❯ ${RELAY_TEXT}`, '❯ '])
    const res = await svc.proceed(232)
    assert.equal(res.ok, true)
    assert.equal(seams.enters(), 1)
    assert.equal(ledger.listRelays()[0]?.status, 'relayed')
  } finally {
    cleanup()
  }
})

test('relayUnsubmitted reads only the pane tail and only the input line', () => {
  // The signature: sentence sharing a tail line with the ❯ input glyph.
  assert.equal(relayUnsubmitted(`some output\n❯ ${REVISE_TEXT}\n`, REVISE_TEXT), true)
  // A submitted sentence echoes without the glyph.
  assert.equal(relayUnsubmitted(`> ${REVISE_TEXT}\nworking…\n❯ \n`, REVISE_TEXT), false)
  // The kickoff quotes both literals in the scrollback — beyond the 12-line
  // tail they must never read as unsubmitted.
  const scrollback = `On receiving "${REVISE_TEXT}": …\n❯ quoted above\n${'\n'.repeat(14)}❯ \n`
  assert.equal(relayUnsubmitted(scrollback, REVISE_TEXT), false)
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
  const { svc, ledger, worktree, commands, open, cleanup } = teardownFixture()
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
    // A non-submodule die does NOT engage the #363 fallback: the worktree
    // dir survives for the retry — nothing was rm -rf'd.
    assert.equal(existsSync(worktree), true)
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

test('the submodule die engages the #363 fallback: rm -rf → worktree prune → branch -D, in that order', async () => {
  const { svc, ledger, repoRoot, worktree, open, cleanup } = teardownFixture()
  try {
    // Record every shell step with whether the worktree dir was still on
    // disk when it ran — the ordering proof: prune must observe the rm -rf
    // (the REAL rmSync, not a stub) already done, and branch -D follows it.
    const calls: Array<{ cmd: string; cwd: string; wtGone: boolean }> = []
    open.runShell = async (cmd: string, cwd: string) => {
      calls.push({ cmd, cwd, wtGone: !existsSync(worktree) })
      if (cmd.startsWith('git worktree remove')) {
        throw new Error(
          `${cmd} — fatal: working trees containing submodules cannot be moved or removed`,
        )
      }
    }
    const res = await svc.closeLane(232)
    assert.equal(res.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.equal(ledger.liveCount(), 0)
    assert.equal(ledger.listTeardowns()[0]?.status, 'done')
    assert.equal(existsSync(worktree), false)
    assert.deepEqual(
      calls.map((c) => c.cmd),
      [
        'git submodule deinit -f --all',
        `git worktree remove --force '${worktree}'`,
        'git worktree prune',
        "git branch -D 'lane/issue-232'",
        'git submodule update --init --recursive',
      ],
    )
    // The load-bearing order (#363): rm -rf BEFORE prune (the worktree dir
    // was already gone when prune ran), prune BEFORE branch -D (array
    // order) — checked-out status reads from .git/worktrees/*/HEAD until
    // the prune drops the stale admin dir.
    assert.equal(calls[2]?.wtGone, true)
    assert.equal(calls[2]?.cwd, repoRoot)
    assert.equal(calls[3]?.cmd.startsWith('git branch -D'), true)
  } finally {
    cleanup()
  }
})

test('a teardown whose worktree dir is already gone prunes before branch -D — the fallback resume path', async () => {
  const { svc, ledger, worktree, commands, cleanup } = teardownFixture()
  try {
    // The state an interrupted fallback (or a half-applied hand-recovery)
    // leaves: path rm -rf'd, admin dir still registered. Without the prune,
    // branch -D reads the branch as checked out and the retry never resumes.
    rmSync(worktree, { recursive: true, force: true })
    const res = await svc.closeLane(232)
    assert.equal(res.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git worktree prune',
        "git branch -D 'lane/issue-232'",
        'git submodule update --init --recursive',
      ],
    )
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

// ---- lane telemetry at teardown (#364): capture, resilience, one line per close --

// teardownFixture, extended with the four telemetry stub points. The spawned
// event is re-dated into the past (a later 'spawned' line re-anchors the fold)
// so relays and comments seeded "now" are strictly newer than spawn. The
// default stubs are the happy path — each test flips what it probes; the diff
// stub records itself into `commands`, so capture-before-destruction is
// assertable against the real step order.
interface TelemetryOpen extends TeardownOpen {
  scrapeTokens: (
    worktree: string,
    sinceIso: string,
  ) => {
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
    model: string | null
  }
  captureDiffShortstat: (worktree: string) => Promise<string>
  fetchIssueComments: (issue: number) => Promise<Array<{ body?: unknown; created_at?: unknown }>>
  probeMergedPr: (branch: string) => Promise<boolean>
}

const TELEMETRY_SPAWNED_TS = '2026-06-20T00:00:00.000Z'

function telemetryFixture(): ReturnType<typeof teardownFixture> & { open: TelemetryOpen } {
  const fx = teardownFixture()
  // Re-anchor the spawn into the past: the fold takes the LAST spawned
  // event's ts as spawnedTs, and absent fields keep their folded values.
  appendFileSync(
    join(fx.repoRoot, 'spawns', 'requests.jsonl'),
    JSON.stringify({ id: 'lane-rec', ts: TELEMETRY_SPAWNED_TS, status: 'spawned' }) + '\n',
  )
  const open = fx.open as TelemetryOpen
  open.scrapeTokens = () => ({
    tokens: { input: 116, output: 77, cacheRead: 1033, cacheWrite: 244 },
    model: 'claude-opus-4-8',
  })
  open.captureDiffShortstat = async (worktree: string) => {
    fx.commands.push({ cmd: 'git diff main...HEAD --shortstat', cwd: worktree })
    return ' 3 files changed, 120 insertions(+), 15 deletions(-)'
  }
  open.fetchIssueComments = async () => []
  open.probeMergedPr = async () => true
  return { ...fx, open }
}

test('closeLane writes exactly ONE telemetry line carrying the captured facts (#364 AC1/AC3)', async () => {
  const { svc, ledger, worktree, commands, cleanup } = telemetryFixture()
  const fx = { svc, ledger, worktree, commands }
  try {
    const open = svc as unknown as TelemetryOpen
    // Seeded thread: one report from before spawn (a previous run — never
    // counted), two gate arrivals after (initial + re-gate), plus feedback
    // and chatter that never count.
    open.fetchIssueComments = async () => [
      { body: 'GATE REPORT — previous run', created_at: '2026-06-01T00:00:00.000Z' },
      { body: 'GATE REPORT — verify clean', created_at: '2026-07-01T00:00:00.000Z' },
      { body: 'DIRECTOR FEEDBACK — tighten it', created_at: '2026-07-02T00:00:00.000Z' },
      { body: 'GATE REPORT — re-gated', created_at: '2026-07-03T00:00:00.000Z' },
      { body: 'ship it when green', created_at: '2026-07-03T01:00:00.000Z' },
    ]
    // Seeded ledger cycles: one delivered revise, one delivered proceed
    // (requestRelay stamps "now" — strictly newer than the re-dated spawn).
    const r1 = fx.ledger.requestRelay(232, REVISE_TEXT)
    fx.ledger.markRelayed(r1.id)
    const p1 = fx.ledger.requestRelay(232, RELAY_TEXT)
    fx.ledger.markRelayed(p1.id)

    const res = await fx.svc.closeLane(232)
    assert.equal(res.ok, true)
    assert.equal(fx.ledger.find('lane-rec')?.status, 'closed')

    const lines = fx.ledger.listTelemetry()
    assert.equal(lines.length, 1)
    const t = lines[0]!
    assert.equal(t.issue, 232)
    assert.equal(t.spawnedAt, TELEMETRY_SPAWNED_TS)
    assert.ok((t.wallSeconds ?? 0) > 0)
    assert.deepEqual(t.tokens, { input: 116, output: 77, cacheRead: 1033, cacheWrite: 244 })
    assert.equal(t.model, 'claude-opus-4-8')
    // No structured effort field on the pinned CC version: null by binding.
    assert.equal(t.effort, null)
    assert.equal(t.gateReports, 2)
    assert.equal(t.revises, 1)
    assert.equal(t.proceeds, 1)
    assert.deepEqual(t.diff, { filesChanged: 3, insertions: 120, deletions: 15 })
    assert.equal(t.outcome, 'merged')
    assert.equal(t.error, undefined)

    // AC5 ordering: the diff was captured BEFORE the worktree left the disk.
    const cmds = fx.commands.map((c) => c.cmd)
    const diffAt = cmds.indexOf('git diff main...HEAD --shortstat')
    const removeAt = cmds.findIndex((c) => c.startsWith('git worktree remove'))
    assert.ok(diffAt !== -1 && removeAt !== -1 && diffAt < removeAt)
    // And it ran in the worktree, not the main checkout.
    assert.equal(fx.commands[diffAt]?.cwd, fx.worktree)
  } finally {
    cleanup()
  }
})

test('every scrape failing still closes the lane — null fields plus the note (#364 AC4)', async () => {
  const { svc, ledger, cleanup, open } = telemetryFixture()
  try {
    open.scrapeTokens = () => {
      throw new Error('no Claude Code project dir at /nope')
    }
    open.captureDiffShortstat = async () => {
      throw new Error('git died')
    }
    open.fetchIssueComments = async () => {
      throw new Error('gh unreachable')
    }
    open.probeMergedPr = async () => {
      throw new Error('gh pr list timed out')
    }

    const res = await svc.closeLane(232)
    // The resilience law: analytics NEVER blocks teardown.
    assert.equal(res.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.equal(ledger.listTeardowns()[0]?.status, 'done')
    assert.equal(ledger.liveCount(), 0)

    const t = ledger.findTelemetry(232)
    assert.ok(t)
    assert.equal(t.tokens, null)
    assert.equal(t.model, null)
    assert.equal(t.diff, null)
    assert.equal(t.gateReports, null)
    assert.equal(t.outcome, null)
    // The ledger's own relay fold did not fail — counts are still facts.
    assert.equal(t.revises, 0)
    assert.equal(t.proceeds, 0)
    // Every failed scrape left its name in the note.
    for (const field of ['tokens:', 'gateReports:', 'diff:', 'outcome:']) {
      assert.ok(t.error?.includes(field), `note missing ${field} (got: ${t.error})`)
    }
  } finally {
    cleanup()
  }
})

test('a zero-commit lane records diff zeros — empty shortstat is the fact, not a failure (#364 AC5)', async () => {
  const { svc, ledger, cleanup, open } = telemetryFixture()
  try {
    open.captureDiffShortstat = async () => ''
    open.probeMergedPr = async () => false

    const res = await svc.closeLane(232)
    assert.equal(res.ok, true)
    const t = ledger.findTelemetry(232)
    assert.ok(t)
    assert.deepEqual(t.diff, { filesChanged: 0, insertions: 0, deletions: 0 })
    // No merged PR on the branch ⇒ the lane was abandoned.
    assert.equal(t.outcome, 'abandoned')
    assert.equal(t.error, undefined)
  } finally {
    cleanup()
  }
})

test('a failed teardown writes NO telemetry line; the successful retry writes exactly one (#364 AC1)', async () => {
  const { svc, ledger, commands, cleanup, open } = telemetryFixture()
  try {
    const realRunShell = open.runShell
    open.runShell = async (cmd: string, cwd: string) => {
      if (cmd.startsWith('git branch -D')) throw new Error('branch delete died')
      return realRunShell(cmd, cwd)
    }
    const first = await svc.closeLane(232)
    assert.equal(first.ok, false)
    assert.equal(ledger.find('lane-rec')?.status, 'teardown_failed')
    // The lane did not close — no telemetry line (one line per CLOSED lane).
    assert.equal(ledger.listTelemetry().length, 0)

    // Retry resumes destruction; capture runs again and the line lands once.
    open.runShell = realRunShell
    commands.length = 0
    const second = await svc.closeLane(232)
    assert.equal(second.ok, true)
    assert.equal(ledger.find('lane-rec')?.status, 'closed')
    assert.equal(ledger.listTelemetry().length, 1)
    assert.equal(ledger.findTelemetry(232)?.outcome, 'merged')
  } finally {
    cleanup()
  }
})

// ---- spawn recipes: submodule init is opt-in (#376) --------------------------

// The recipes' shell-step order, pinned hermetically: runShell records instead
// of executing, so `git worktree add` never creates the directory and the
// recipe dies deterministically at its first real filesystem write ('write
// kickoff' for lanes, 'write LANE.md' for drafts) — AFTER every shell step
// this section asserts on has been recorded. Nothing under $HOME is ever
// touched (sanitizeWorktree constrains targets to $HOME, so executing would).
interface RecipeOpen {
  tmuxOk: boolean
  runShell: (cmd: string, cwd: string) => Promise<void>
  runLaneRecipe: (rec: SpawnRecord, tag: string) => Promise<boolean>
  runRecipe: (rec: SpawnRecord) => Promise<void>
}

function recipeFixture(lineExtra: Record<string, unknown> = {}): {
  ledger: SpawnLedger
  dir: string
  commands: Array<{ cmd: string; cwd: string }>
  open: RecipeOpen
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-recipe-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  appendFileSync(
    ledgerPath,
    JSON.stringify({
      id: 'lane-rec',
      ts: '2026-07-16T00:00:00.000Z',
      kind: 'lane',
      batch_id: 'b1',
      issue: 990376,
      issue_title: 'submodule opt-in demo',
      branch: 'lane/issue-990376',
      worktree: '~/aether-lane-990376',
      status: 'requested',
      ...lineExtra,
    }) + '\n',
  )
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const commands: Array<{ cmd: string; cwd: string }> = []
  const open = svc as unknown as RecipeOpen
  open.tmuxOk = false
  open.runShell = async (cmd: string, cwd: string) => {
    commands.push({ cmd, cwd })
  }
  return {
    ledger,
    dir,
    commands,
    open,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('lane recipe default: NO submodule init step (#376)', async () => {
  const { ledger, commands, open, cleanup } = recipeFixture()
  try {
    const rec = ledger.find('lane-rec')
    assert.ok(rec)
    assert.equal(rec.submodules, undefined)
    const ok = await open.runLaneRecipe(rec, '')
    assert.equal(ok, false)
    const wt = join(homedir(), 'aether-lane-990376')
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git fetch origin',
        `git worktree add '${wt}' -b 'lane/issue-990376' origin/main`,
        'pnpm install',
      ],
    )
    // Died at the hermetic wall, past every shell step — the skipped init
    // never short-circuited the recipe upstream of the kickoff write.
    assert.equal(ledger.find('lane-rec')?.status, 'failed')
    assert.equal(ledger.find('lane-rec')?.step, 'write kickoff')
  } finally {
    cleanup()
  }
})

test('lane recipe with submodules:true on the request line: init runs, in the worktree', async () => {
  const { ledger, commands, open, cleanup } = recipeFixture({ submodules: true })
  try {
    const rec = ledger.find('lane-rec')
    assert.ok(rec)
    // The fold carried the request line's opt-in onto the record.
    assert.equal(rec.submodules, true)
    await open.runLaneRecipe(rec, '')
    const wt = join(homedir(), 'aether-lane-990376')
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git fetch origin',
        `git worktree add '${wt}' -b 'lane/issue-990376' origin/main`,
        'git submodule update --init --recursive',
        'pnpm install',
      ],
    )
    assert.equal(commands[2]?.cwd, wt)
  } finally {
    cleanup()
  }
})

function draftRecipeFixture(draftText: string): {
  ledger: SpawnLedger
  rec: SpawnRecord
  commands: Array<{ cmd: string; cwd: string }>
  open: RecipeOpen
  cleanup: () => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'spawn-recipe-'))
  const ledgerPath = join(dir, 'spawns', 'requests.jsonl')
  const ledger = new SpawnLedger(ledgerPath)
  const draftPath = join(dir, 'draft.md')
  writeFileSync(draftPath, draftText)
  const rec = ledger.request('sub demo', draftPath)
  const svc = new SpawnService({ repoRoot: dir, ledgerPath })
  const commands: Array<{ cmd: string; cwd: string }> = []
  const open = svc as unknown as RecipeOpen
  open.tmuxOk = false
  open.runShell = async (cmd: string, cwd: string) => {
    commands.push({ cmd, cwd })
  }
  return {
    ledger,
    rec,
    commands,
    open,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('draft recipe default: NO submodule init step (#376)', async () => {
  const { ledger, rec, commands, open, cleanup } = draftRecipeFixture(
    'Branch: feat/sub-demo Worktree: ~/aether-sub-demo\ndo the thing\n',
  )
  try {
    await open.runRecipe(rec)
    const wt = join(homedir(), 'aether-sub-demo')
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git fetch origin',
        `git worktree add '${wt}' -b 'feat/sub-demo' origin/main`,
        'pnpm install',
      ],
    )
    assert.equal(ledger.find(rec.id)?.status, 'failed')
    assert.equal(ledger.find(rec.id)?.step, 'write LANE.md')
  } finally {
    cleanup()
  }
})

test('draft recipe with a `Submodules: on` line: init runs, in the worktree', async () => {
  const { commands, open, rec, cleanup } = draftRecipeFixture(
    'Branch: feat/sub-demo Worktree: ~/aether-sub-demo\nSubmodules: on\ndo the thing\n',
  )
  try {
    await open.runRecipe(rec)
    const wt = join(homedir(), 'aether-sub-demo')
    assert.deepEqual(
      commands.map((c) => c.cmd),
      [
        'git fetch origin',
        `git worktree add '${wt}' -b 'feat/sub-demo' origin/main`,
        'git submodule update --init --recursive',
        'pnpm install',
      ],
    )
    assert.equal(commands[2]?.cwd, wt)
  } finally {
    cleanup()
  }
})

test('wantsSubmodules: only a `Submodules: on` token opts in', () => {
  assert.equal(wantsSubmodules('Submodules: on'), true)
  // Inline with the Branch:/Worktree: header line — the Worktree:-regex shape.
  assert.equal(wantsSubmodules('Branch: feat/x Worktree: ~/w Submodules: on'), true)
  assert.equal(wantsSubmodules('Submodules: off'), false)
  // Case-sensitive, like Branch:/Worktree:.
  assert.equal(wantsSubmodules('submodules: on'), false)
  assert.equal(wantsSubmodules('no header at all'), false)
  assert.equal(wantsSubmodules(''), false)
  assert.equal(wantsSubmodules(null), false)
  assert.equal(wantsSubmodules(undefined), false)
})

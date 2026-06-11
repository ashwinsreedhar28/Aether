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

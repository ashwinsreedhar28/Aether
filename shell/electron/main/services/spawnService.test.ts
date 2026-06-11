// Isolated tests for the #300 spawn fixes — the fixed send-keys line (kickoff
// content never rides the shell again) and the terminal-dispatch race (a
// renderer reply that never comes degrades to false instead of pinning the
// recipe). No Electron, no tmux, no live recipe.
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
  laneSendKeys,
  laneKickoff,
  withTimeout,
} from './spawnService.ts'

// ---- kickoff delivery is file-based: the sent line is FIXED -----------------

test('laneSendKeys interpolates the session name and nothing else', () => {
  assert.equal(
    laneSendKeys('lane-300'),
    `tmux send-keys -t '=lane-300' 'claude --dangerously-skip-permissions "$(cat .lane-kickoff.md)"' Enter`,
  )
})

test('the send-keys line carries zero kickoff content', () => {
  const cmd = laneSendKeys('lane-219')
  // The #298 failure mode: kickoff prose riding three quoting layers. No
  // fragment of laneKickoff may appear in what send-keys transports.
  assert.ok(!cmd.includes('Implementer'))
  assert.ok(!cmd.includes(laneKickoff(219).slice(0, 24)))
})

test('LANE_CLAUDE_CMD stays single-quote-free so sq() wraps it verbatim', () => {
  assert.ok(!LANE_CLAUDE_CMD.includes(`'`))
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

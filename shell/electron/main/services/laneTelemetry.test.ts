// Isolated test for the lane telemetry scrapers (#364) — the pinned Claude
// Code transcript fixture (AC2), the shortstat parser, and the gate-report
// counter. No Electron, no spawn service.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/laneTelemetry.test.ts
//
// THE FIXTURE PIN: the transcript lines below mirror the on-disk shape
// observed under Claude Code 2.1.201 (the installed version this lane bound
// against) — type:'assistant' entries carrying message.{id,model,usage} plus
// a top-level timestamp, with one API response spanning multiple lines that
// share a message.id and repeat the same usage object. If a CC upgrade
// changes the shape, THIS file is where the drift surfaces.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeProjectDirFor,
  scrapeTranscriptTokens,
  parseShortstat,
  countGateReports,
  GATE_REPORT_PREFIX,
} from './laneTelemetry.ts'

test('claudeProjectDirFor pins the 2.1.201 munge: every non-alphanumeric → dash', () => {
  assert.equal(
    claudeProjectDirFor('/root', '/Users/x/aether-lane-364'),
    join('/root', '-Users-x-aether-lane-364'),
  )
  // Dots, underscores, and spaces all flatten; case and digits survive.
  assert.equal(
    claudeProjectDirFor('/root', '/Users/x/My_app.v2 beta'),
    join('/root', '-Users-x-My-app-v2-beta'),
  )
})

// The worktree whose munged name the fixture directory carries.
const WT = '/Users/x/aether-lane-364'
const SINCE = '2026-07-06T10:00:00.000Z'

// One assistant transcript line in the observed 2.1.201 shape.
function assistantLine(opts: {
  id?: string
  requestId?: string
  model?: string
  ts: string
  usage?: { input: number; output: number; read: number; write: number }
}): string {
  const message: Record<string, unknown> = { role: 'assistant', type: 'message' }
  if (opts.id) message.id = opts.id
  if (opts.model) message.model = opts.model
  if (opts.usage) {
    message.usage = {
      input_tokens: opts.usage.input,
      output_tokens: opts.usage.output,
      cache_read_input_tokens: opts.usage.read,
      cache_creation_input_tokens: opts.usage.write,
      // Extra keys the real transcripts carry ride along, unparsed.
      service_tier: 'standard',
      server_tool_use: { web_search_requests: 0 },
    }
  }
  const line: Record<string, unknown> = {
    type: 'assistant',
    timestamp: opts.ts,
    sessionId: 'fixture',
    message,
  }
  if (opts.requestId) line.requestId = opts.requestId
  return JSON.stringify(line) + '\n'
}

function fixtureDir(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lane-telemetry-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('scrapeTranscriptTokens sums the pinned fixture: dedupe by message id, since-guard, restarts (AC2)', () => {
  const { root, cleanup } = fixtureDir()
  try {
    const dir = claudeProjectDirFor(root, WT)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session-a.jsonl'),
      // Non-assistant entries never count.
      JSON.stringify({ type: 'user', timestamp: '2026-07-06T10:00:05.000Z' }) +
        '\n' +
        // One API response, TWO lines sharing msg_A (one per content block,
        // usage repeated verbatim — the observed 2.1.201 shape): counts ONCE.
        assistantLine({
          id: 'msg_A',
          model: 'claude-opus-4-8',
          ts: '2026-07-06T10:00:10.000Z',
          usage: { input: 100, output: 50, read: 1000, write: 200 },
        }) +
        assistantLine({
          id: 'msg_A',
          model: 'claude-opus-4-8',
          ts: '2026-07-06T10:00:11.000Z',
          usage: { input: 100, output: 50, read: 1000, write: 200 },
        }) +
        assistantLine({
          id: 'msg_B',
          model: 'claude-opus-4-8',
          ts: '2026-07-06T10:05:00.000Z',
          usage: { input: 10, output: 20, read: 30, write: 40 },
        }) +
        // Older than the spawn anchor (a previous run in a reused worktree
        // path): excluded by the strictly-newer guard.
        assistantLine({
          id: 'msg_OLD',
          model: 'claude-opus-4-8',
          ts: '2026-07-06T09:00:00.000Z',
          usage: { input: 9999, output: 9999, read: 9999, write: 9999 },
        }) +
        // Id-less lines sharing a requestId pin the dedupe fallback.
        assistantLine({
          requestId: 'req_X',
          ts: '2026-07-06T10:10:00.000Z',
          usage: { input: 5, output: 5, read: 0, write: 0 },
        }) +
        assistantLine({
          requestId: 'req_X',
          ts: '2026-07-06T10:10:01.000Z',
          usage: { input: 5, output: 5, read: 0, write: 0 },
        }) +
        // Malformed line and a usage-less assistant entry: skipped.
        'not json\n' +
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-07-06T10:11:00.000Z',
          message: { role: 'assistant' },
        }) +
        '\n',
    )
    // A session restart is still the lane's cost: second file sums in.
    writeFileSync(
      join(dir, 'session-b.jsonl'),
      assistantLine({
        id: 'msg_C',
        model: 'claude-opus-4-8',
        ts: '2026-07-06T11:00:00.000Z',
        usage: { input: 1, output: 2, read: 3, write: 4 },
      }),
    )
    // Non-jsonl files are not transcripts.
    writeFileSync(join(dir, 'notes.txt'), 'not a transcript')

    const scraped = scrapeTranscriptTokens(root, WT, SINCE)
    assert.deepEqual(scraped.tokens, {
      input: 116,
      output: 77,
      cacheRead: 1033,
      cacheWrite: 244,
    })
    // Exactly one distinct model across counted entries: recovered.
    assert.equal(scraped.model, 'claude-opus-4-8')
  } finally {
    cleanup()
  }
})

test('a session that mixed models recovers null — which one WAS the lane model is a guess', () => {
  const { root, cleanup } = fixtureDir()
  try {
    const dir = claudeProjectDirFor(root, WT)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.jsonl'),
      assistantLine({
        id: 'msg_A',
        model: 'claude-opus-4-8',
        ts: '2026-07-06T10:01:00.000Z',
        usage: { input: 1, output: 1, read: 0, write: 0 },
      }) +
        assistantLine({
          id: 'msg_B',
          model: 'claude-sonnet-5',
          ts: '2026-07-06T10:02:00.000Z',
          usage: { input: 1, output: 1, read: 0, write: 0 },
        }),
    )
    const scraped = scrapeTranscriptTokens(root, WT, SINCE)
    assert.equal(scraped.model, null)
    // The tokens are still facts — both responses cost what they cost.
    assert.deepEqual(scraped.tokens, { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 })
  } finally {
    cleanup()
  }
})

test('scrape throws by name on every would-be-a-guess condition (null-over-guess)', () => {
  const { root, cleanup } = fixtureDir()
  try {
    // No project dir at all (also what a future munge-convention drift
    // looks like — null-with-note, never wrong numbers).
    assert.throws(() => scrapeTranscriptTokens(root, WT, SINCE), /no Claude Code project dir/)

    // Dir exists, no transcripts.
    const dir = claudeProjectDirFor(root, WT)
    mkdirSync(dir, { recursive: true })
    assert.throws(() => scrapeTranscriptTokens(root, WT, SINCE), /no session transcripts/)

    // Transcripts exist, but nothing newer than spawn: a reused worktree
    // path serving only a previous run's sessions.
    writeFileSync(
      join(dir, 'session.jsonl'),
      assistantLine({
        id: 'msg_A',
        model: 'claude-opus-4-8',
        ts: '2026-07-06T09:00:00.000Z',
        usage: { input: 1, output: 1, read: 0, write: 0 },
      }),
    )
    assert.throws(() => scrapeTranscriptTokens(root, WT, SINCE), /no usage entries newer than/)

    // An unparseable anchor can't scope anything.
    assert.throws(() => scrapeTranscriptTokens(root, WT, 'not-a-time'), /unparseable spawn timestamp/)
  } finally {
    cleanup()
  }
})

test('parseShortstat reads the git shapes: full, singulars, partials, empty ⇒ zeros', () => {
  assert.deepEqual(parseShortstat(' 3 files changed, 120 insertions(+), 15 deletions(-)'), {
    filesChanged: 3,
    insertions: 120,
    deletions: 15,
  })
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)'), {
    filesChanged: 1,
    insertions: 1,
    deletions: 1,
  })
  assert.deepEqual(parseShortstat(' 2 files changed, 7 insertions(+)'), {
    filesChanged: 2,
    insertions: 7,
    deletions: 0,
  })
  assert.deepEqual(parseShortstat(' 2 files changed, 4 deletions(-)'), {
    filesChanged: 2,
    insertions: 0,
    deletions: 4,
  })
  // Empty capture IS the zero-commit lane (shortstat prints nothing on an
  // empty diff) — zeros, not a failure (AC5).
  assert.deepEqual(parseShortstat(''), { filesChanged: 0, insertions: 0, deletions: 0 })
  assert.deepEqual(parseShortstat('\n\n'), { filesChanged: 0, insertions: 0, deletions: 0 })
  // -lic banner noise above the real line is skipped (capture hygiene).
  assert.deepEqual(parseShortstat('Welcome to zsh!\n 5 files changed, 9 insertions(+)'), {
    filesChanged: 5,
    insertions: 9,
    deletions: 0,
  })
})

test('countGateReports mirrors the laneGate fold guards: strictly newer, trimmed prefix, bad timestamps never pass', () => {
  // Prefix parity with shell/src/utils/laneGate.ts (renderer and main share
  // no imports; each side pins the literal — this is main's pin).
  assert.equal(GATE_REPORT_PREFIX, 'GATE REPORT')

  const spawnedAt = '2026-07-06T10:00:00.000Z'
  const comments = [
    // Before spawn: a previous run's report never counts.
    { body: 'GATE REPORT — old run', created_at: '2026-07-06T09:00:00.000Z' },
    // Exactly AT spawn: strictly-newer excludes it.
    { body: 'GATE REPORT — boundary', created_at: spawnedAt },
    // Two real gate arrivals (a re-gate after revision): both count — the
    // fold keeps the latest, the COUNT is the cycle record.
    { body: 'GATE REPORT — verify clean', created_at: '2026-07-06T11:00:00.000Z' },
    { body: '  GATE REPORT — re-gate after feedback', created_at: '2026-07-06T13:00:00.000Z' },
    // Other prefixes and freeform chatter never count.
    { body: 'DIRECTOR FEEDBACK — tighten the fold', created_at: '2026-07-06T12:00:00.000Z' },
    { body: 'PR OPENED — #99 https://x', created_at: '2026-07-06T14:00:00.000Z' },
    { body: 'looks good to me', created_at: '2026-07-06T11:30:00.000Z' },
    // Unparseable timestamp / missing fields never pass the guard.
    { body: 'GATE REPORT — ghost', created_at: 'not-a-time' },
    { body: 'GATE REPORT — ghost' },
    { created_at: '2026-07-06T15:00:00.000Z' },
  ]
  assert.equal(countGateReports(comments, spawnedAt), 2)
  // Non-array input and an unparseable anchor count zero (the caller nulls
  // the field before ever getting here — belt under that).
  assert.equal(countGateReports(null, spawnedAt), 0)
  assert.equal(countGateReports(comments, 'not-a-time'), 0)
})

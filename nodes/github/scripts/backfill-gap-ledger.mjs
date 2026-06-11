#!/usr/bin/env node
// One-time backfill (#258 / #255 item 7): migrate the retired intents gap
// ledger onto the GitHub gap board, then archive the ledger in place.
//
// Drives the COMPILED create_issue handler directly (no mesh hop — the same
// in-process pattern as smoke.mjs, per the Architect ruling: no temporary
// manifest edge for a one-shot script), so every filed issue inherits the
// surface's dedup, format, and key marker.
//
// What it does:
//   1. Reads $AETHER_DATA_DIR/intents/gaps.jsonl (default: the macOS shell
//      data root) and folds the event-sourced log — gap lines
//      { id, ts, text, context, status } flipped by closure events
//      { id, ts, closed: true } — exactly as the retired store did.
//   2. Files each still-OPEN gap (oldest → newest, preserving accrual order)
//      through create_issue with area 'backfill' (the ledger never recorded
//      an area; a synthetic one would be a guess — 'backfill' is honest
//      provenance and groups them on the board). The body's failure section
//      notes "backfilled from gap ledger" with the original timestamp and id;
//      closed gaps are answered history and are NOT filed.
//   3. Only when EVERY open gap filed (or deduped): renames gaps.jsonl →
//      gaps.jsonl.archived in place — write path already deleted with the
//      intents node, history kept (#258 ruling). On any failure the ledger
//      stays put and the exit code is 1; a re-run is safe — already-filed
//      gaps dedup against their key marker (they bump a comment rather than
//      duplicate).
//
// Requires AETHER_GITHUB_TOKEN (Issues RW) and a built dist/:
//   pnpm --filter @aether/github build
//   node nodes/github/scripts/backfill-gap-ledger.mjs [path/to/gaps.jsonl]

import { existsSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { GithubClient } from '../dist/github.js'
import { makeCreateIssueHandler } from '../dist/handlers.js'

const SUMMARY_MAX = 180 // mirrors gap.ts — text beyond this is in the utterance

const token = (process.env.AETHER_GITHUB_TOKEN ?? '').trim()
const repo = (process.env.AETHER_GITHUB_REPO ?? '').trim() || 'ashwinsreedhar28/Aether'
if (!token) {
  console.error('AETHER_GITHUB_TOKEN is required for the backfill.')
  process.exit(2)
}

const dataDir =
  (process.env.AETHER_DATA_DIR ?? '').trim() ||
  join(homedir(), 'Library', 'Application Support', 'Aether', 'data')
const ledgerPath = process.argv[2] ?? join(dataDir, 'intents', 'gaps.jsonl')

if (!existsSync(ledgerPath)) {
  console.error(`No ledger at ${ledgerPath} — nothing to backfill.`)
  process.exit(2)
}

// Fold the event-sourced log into current-state records, oldest → newest.
// Mirrors the retired GapStore.readAll(): malformed lines are skipped, a
// closure event flips its gap closed, absent/invalid status reads as open.
function foldLedger(raw) {
  const order = []
  const byId = new Map()
  const closedIds = new Set()
  for (const line of raw.split('\n')) {
    if (!line || line.trim().length === 0) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.closed === true && typeof obj.id === 'string') {
      closedIds.add(obj.id)
      continue
    }
    if (typeof obj.id === 'string' && typeof obj.text === 'string') {
      if (!byId.has(obj.id)) order.push(obj.id)
      byId.set(obj.id, {
        id: obj.id,
        ts: typeof obj.ts === 'string' ? obj.ts : '',
        text: obj.text,
        context: typeof obj.context === 'string' ? obj.context : null,
        status: obj.status === 'closed' ? 'closed' : 'open',
      })
    }
  }
  for (const id of closedIds) {
    const rec = byId.get(id)
    if (rec) rec.status = 'closed'
  }
  return order.map((id) => byId.get(id))
}

const all = foldLedger(readFileSync(ledgerPath, 'utf8'))
const open = all.filter((g) => g.status === 'open')
console.log(`${ledgerPath}: ${all.length} gap(s), ${open.length} open → backfilling open only`)

const truncate = (text, limit) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const envelope = (payload) => ({ payload })
const log = (msg) => console.log(`  [node] ${msg}`)
// One handler instance for the whole run, like the running node — its dedup
// memo also catches exact-duplicate ledger lines within this run.
const createIssue = makeCreateIssueHandler({ client: new GithubClient(repo, token), log })

let filed = 0
let deduped = 0
let failed = 0
for (const gap of open) {
  const note = `backfilled from gap ledger (recorded ${gap.ts || 'unknown'}, id ${gap.id})`
  const payload = {
    area: 'backfill',
    summary: truncate(gap.text, SUMMARY_MAX),
    // The old sensor never captured the spoken utterance separately; its
    // free-text record is the closest surviving artifact.
    utterance: gap.text,
    failure: gap.context ? `${note}\n\noriginal context: ${gap.context}` : note,
  }
  try {
    const result = await createIssue(envelope(payload))
    if (result.deduped) {
      deduped += 1
      console.log(`DEDUP  #${result.number}  ${payload.summary}`)
    } else {
      filed += 1
      console.log(`FILED  #${result.number}  ${payload.summary}`)
    }
  } catch (err) {
    failed += 1
    console.error(`FAIL   ${payload.summary} — ${err?.reason ?? err?.message ?? err}`)
  }
  // Pace the creates — GitHub's secondary rate limits dislike write bursts.
  await sleep(2000)
}

console.log(`\n${filed} filed, ${deduped} deduped, ${failed} failed of ${open.length} open gap(s).`)

if (failed > 0) {
  console.error('Ledger NOT archived — fix the failures and re-run (re-runs dedup safely).')
  process.exit(1)
}

const archived = `${ledgerPath}.archived`
renameSync(ledgerPath, archived)
console.log(`Ledger archived in place: ${archived}`)

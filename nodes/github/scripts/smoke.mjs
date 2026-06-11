#!/usr/bin/env node
// Live smoke for the github node (#256 SMOKE) — drives the COMPILED handlers
// directly (no mesh hop; the mesh transport is exercised by every other node)
// against the REAL GitHub API:
//
//   1. create a uniquely-keyed test gap issue   → { deduped: false }
//   2. create SAME key, same handler instance   → { deduped: true } (memo path —
//      GitHub's filtered list is eventually consistent; this is the
//      back-to-back voice "ask again" case)
//   3. list_issues shows it (bounded retry — list visibility of a fresh issue
//      is legitimately eventually consistent for readers)
//   4. comment_issue lands a comment            → ok
//   5. create SAME key, FRESH handler instance  → { deduped: true } (scan path —
//      no memo; the list is consistent by now per step 3)
//   6. no-token handlers                        → clean degraded payloads
//
// Cleanup closes the test issue via the REST API directly — close is not a
// node surface by design (#255 ruling 3: gaps close through the merge rail).
//
// Requires: AETHER_GITHUB_TOKEN (Issues RW) and a built dist/:
//   pnpm --filter @aether/github build && pnpm --filter @aether/github smoke

import { GithubClient } from '../dist/github.js'
import {
  makeCommentIssueHandler,
  makeCreateIssueHandler,
  makeListIssuesHandler,
} from '../dist/handlers.js'

const token = (process.env.AETHER_GITHUB_TOKEN ?? '').trim()
const repo = (process.env.AETHER_GITHUB_REPO ?? '').trim() || 'ashwinsreedhar28/Aether'
if (!token) {
  console.error('AETHER_GITHUB_TOKEN is required for the live smoke.')
  process.exit(2)
}

const envelope = (payload) => ({ payload })
const log = (msg) => console.log(`  [node] ${msg}`)
const client = new GithubClient(repo, token)
const live = { client, log }
const degraded = { client: null, log }

const failures = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const stamp = Date.now()
const key = `smoke-test-${stamp}`
const gap = {
  area: 'smoke',
  summary: `smoke-test artifact ${stamp} (will be closed)`,
  utterance: 'smoke: verbatim utterance, do not action',
  failure: 'none — scripted smoke per #256',
  session_id: `smoke-${stamp}`,
  capability_key: key,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let issueNumber = null
try {
  // One instance per surface, like the running node — the create handler's
  // dedup memo lives in its closure.
  const createIssue = makeCreateIssueHandler(live)
  const listIssues = makeListIssuesHandler(live)
  const commentIssue = makeCommentIssueHandler(live)

  // 1. create — fresh key, expect a real issue
  const created = await createIssue(envelope(gap))
  issueNumber = created.number
  check('create_issue files new gap', created.ok === true && created.deduped === false && Number.isInteger(created.number), `#${created.number}`)

  // 2. same key, same instance, immediately — the memo path
  const memoRepeat = await createIssue(
    envelope({ ...gap, utterance: 'smoke: asked again immediately, expect memo dedup' }),
  )
  check('back-to-back repeat dedups (memo)', memoRepeat.deduped === true && memoRepeat.number === issueNumber, `#${memoRepeat.number}`)

  // 3. list — the new issue reaches the open board. TWO delays stack here:
  // GitHub's filtered list is eventually consistent (seconds), and the
  // handler serves from its 30s cache, so the first post-TTL refetch is the
  // earliest the fresh issue can appear. Poll past a full TTL window — the
  // panel's real 60s cadence never notices any of this.
  let onBoard = false
  let attempts = 0
  for (; attempts < 18 && !onBoard; attempts += 1) {
    if (attempts > 0) await sleep(5000)
    const listed = await listIssues(envelope({ labels: 'gap', limit: 100 }))
    onBoard = listed.token_available === true && listed.issues.some((i) => i.number === issueNumber)
  }
  check('list_issues shows it', onBoard, `attempt ${attempts}`)

  // 4. comment by number
  const commented = await commentIssue(
    envelope({ number: issueNumber, body: 'smoke: comment_issue check' }),
  )
  check('comment_issue lands', commented.ok === true && Number.isInteger(commented.comment_id))

  // 5. same key on a FRESH handler instance (no memo) — the scan path,
  // now that step 3 confirmed list visibility
  const scanRepeat = await makeCreateIssueHandler(live)(
    envelope({ ...gap, utterance: 'smoke: asked again cross-instance, expect scan dedup' }),
  )
  check('cross-instance repeat dedups (scan)', scanRepeat.deduped === true && scanRepeat.number === issueNumber, `#${scanRepeat.number}`)

  // 6. degraded (no token): clean payload + capability denies
  const degradedList = await makeListIssuesHandler(degraded)(envelope({}))
  check(
    'degraded list is clean no-token payload',
    degradedList.token_available === false && degradedList.issues.length === 0,
  )
  const denied = await makeCreateIssueHandler(degraded)(envelope(gap)).then(
    () => null,
    (err) => err,
  )
  check('degraded create denies github_no_token', denied?.reason === 'github_no_token')
} catch (err) {
  check('smoke run', false, err?.stack ?? String(err))
} finally {
  if (issueNumber !== null) {
    // Cleanup: close the artifact. Direct REST on purpose — see header.
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
    })
    console.log(`  cleanup: closed #${issueNumber} (${res.status})`)
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke step(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll smoke steps passed.')

#!/usr/bin/env node
// a2-shadow-check — A2 shadow checker (#392).
//
// Scores a PR merged to main against the class-1 self-merge conditions and
// posts one machine verdict comment: `A2-SHADOW: AGREE (class-1)` /
// `A2-SHADOW: OUT-OF-CLASS` / `A2-SHADOW: DISAGREE (reason)`. SHADOW ONLY —
// the checker takes NO merge action at any verdict; it builds the agreement
// record that arms A2. Arming (future, separate ADR-gated lane): 10
// consecutive AGREE/OUT-OF-CLASS verdicts with zero DISAGREE on class-1
// merges. Conditions are machine-checkable only; class membership is path
// match against scripts/a2-classes.json, never judgment.
// ADR: decisions/2026-07-16-a2-shadow-mode.md.
//
// Usage:
//   node scripts/a2-shadow-check.mjs <pr-number>   # score one merge (CI)
//   node scripts/a2-shadow-check.mjs --tally       # summarize the record
// Env: GITHUB_TOKEN (required), GITHUB_REPOSITORY (owner/name).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLASSES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'a2-classes.json'), 'utf8'),
)
const GREEN = new Set(['success', 'neutral', 'skipped'])
const CLOSES = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi

export function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)
}

export function inClass(path, patterns) {
  return patterns.some((p) => globToRegExp(p).test(path))
}

// Pure verdict core — fixture-testable; input shapes mirror the GitHub API
// payloads the live fetchers below produce.
export function evaluate({ headSha, files, prComments, checkRuns, linkedIssues }) {
  const outside = files.filter((f) => !inClass(f, CLASSES['class-1'].allow))
  if (outside.length) {
    return { verdict: 'OUT-OF-CLASS', reasons: outside.map((f) => `${f} outside class-1 allowlist`) }
  }
  const reasons = []
  if (!linkedIssues.length) reasons.push('no Closes-issue referenced from the PR body')
  for (const issue of linkedIssues) {
    const stamps = (re) =>
      issue.comments.filter((c) => re.test(c.body)).map((c) => Date.parse(c.created_at))
    const ratified = stamps(/ARCHITECT RATIFICATION/)
    const gated = stamps(/^GATE REPORT/m)
    if (!ratified.length) reasons.push(`issue #${issue.number}: no ARCHITECT RATIFICATION comment`)
    else if (!gated.length) reasons.push(`issue #${issue.number}: no GATE REPORT comment to order ratification against`)
    else if (Math.min(...ratified) >= Math.min(...gated))
      reasons.push(`issue #${issue.number}: ratification does not predate the first GATE REPORT`)
    if (issue.labels.some((l) => l.toUpperCase() === 'HOLD'))
      reasons.push(`issue #${issue.number}: HOLD label present`)
  }
  const approved = prComments.some(
    (c) => c.body.includes('REVIEWER: APPROVE') && (c.body.match(/Reviewed ([0-9a-f]{40})/) || [])[1] === headSha,
  )
  if (!approved) reasons.push(`no REVIEWER: APPROVE with Reviewed SHA ${headSha}`)
  // Exclude this checker's own in-flight run from the CI-green sweep.
  const runs = checkRuns.filter((r) => !/a2.shadow/i.test(r.name))
  if (!runs.length) reasons.push('no check runs on merged head SHA')
  for (const r of runs)
    if (r.status !== 'completed' || !GREEN.has(r.conclusion))
      reasons.push(`check run "${r.name}" not green (${r.conclusion ?? r.status})`)
  const autos = prComments.filter((c) => c.body.includes('## Auto-review (mechanical checks)'))
  const auto = autos[autos.length - 1]
  if (!auto) reasons.push('no mechanical auto-review comment')
  else if (auto.body.includes('⚠')) reasons.push('mechanical auto-review has ⚠ concerns')
  return reasons.length ? { verdict: 'DISAGREE', reasons } : { verdict: 'AGREE', reasons: [] }
}

export function verdictComment({ verdict, reasons }, headSha) {
  const head =
    verdict === 'AGREE' ? 'A2-SHADOW: AGREE (class-1)'
    : verdict === 'OUT-OF-CLASS' ? 'A2-SHADOW: OUT-OF-CLASS'
    : `A2-SHADOW: DISAGREE (${reasons.join('; ')})`
  const detail = verdict === 'OUT-OF-CLASS' ? ['', ...reasons.map((r) => `- ${r}`)] : []
  return [head, ...detail, '', `Scored ${headSha} against scripts/a2-classes.json class-1 conditions. Shadow only — no action taken (#392).`].join('\n')
}

async function gh(path, init) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`)
  return res.json()
}

async function page(path, pick = (x) => x) {
  const all = []
  for (let p = 1; ; p++) {
    const batch = pick(await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`))
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

async function score(R, n) {
  const pr = await gh(`${R}/pulls/${n}`)
  if (!pr.merged) return console.log(`PR #${n} is not merged — nothing to score`)
  const linkedIssues = []
  for (const num of new Set([...(pr.body || '').matchAll(CLOSES)].map((m) => Number(m[1])))) {
    const issue = await gh(`${R}/issues/${num}`)
    linkedIssues.push({
      number: num,
      labels: issue.labels.map((l) => l.name),
      comments: await page(`${R}/issues/${num}/comments`),
    })
  }
  const result = evaluate({
    headSha: pr.head.sha,
    files: (await page(`${R}/pulls/${n}/files`)).map((f) => f.filename),
    prComments: await page(`${R}/issues/${n}/comments`),
    checkRuns: await page(`${R}/commits/${pr.head.sha}/check-runs`, (x) => x.check_runs),
    linkedIssues,
  })
  const body = verdictComment(result, pr.head.sha)
  await gh(`${R}/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  console.log(body)
}

// The record so far, oldest merge first: per-PR verdict lines, counts, and
// the trailing non-DISAGREE streak the arming condition reads.
async function tally(R) {
  const merged = (await page(`${R}/pulls?state=closed&base=main&sort=updated&direction=desc`))
    .filter((p) => p.merged_at).slice(0, 100)
    .sort((a, b) => (a.merged_at < b.merged_at ? -1 : 1))
  const record = []
  for (const p of merged) {
    const marks = (await page(`${R}/issues/${p.number}/comments`))
      .map((c) => c.body.match(/^A2-SHADOW: (AGREE|OUT-OF-CLASS|DISAGREE)/))
      .filter(Boolean)
    if (marks.length) record.push({ pr: p.number, merged_at: p.merged_at, verdict: marks[marks.length - 1][1] })
  }
  for (const r of record) console.log(`#${r.pr}  ${r.merged_at}  ${r.verdict}`)
  const count = (v) => record.filter((r) => r.verdict === v).length
  let streak = 0
  for (let i = record.length - 1; i >= 0 && record[i].verdict !== 'DISAGREE'; i--) streak++
  console.log(`tally: ${record.length} scored — AGREE ${count('AGREE')} · OUT-OF-CLASS ${count('OUT-OF-CLASS')} · DISAGREE ${count('DISAGREE')}`)
  console.log(`streak: ${streak} consecutive non-DISAGREE — arming threshold (10) ${streak >= 10 ? 'MET (arming remains a separate ADR-gated lane)' : 'not met'}`)
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  const arg = process.argv[2]
  if (!process.env.GITHUB_TOKEN || !repo || !arg) {
    console.error('usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/name node scripts/a2-shadow-check.mjs <pr-number>|--tally')
    process.exit(1)
  }
  const R = `/repos/${repo}`
  if (arg === '--tally') await tally(R)
  else await score(R, Number(arg))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`a2-shadow-check: ${e.message}`)
    process.exit(1)
  })
}

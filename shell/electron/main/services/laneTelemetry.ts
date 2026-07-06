import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LaneDiffStat, LaneTokenTotals } from './spawnLedger.ts'

// Pure scrape helpers for the lane telemetry family (#364) — no Electron
// imports, so the isolated tests (`node --test`) and the orchestrator
// (spawnService.ts) both consume them. spawnLedger.ts owns the line family
// itself; this module owns the fallible fact-scrapers the teardown executor
// runs, kept out of the ledger so the (already choke-listed) ledger file
// stays the fold, not the field work. Shared law: every function here either
// returns a fact or THROWS with a named reason — the caller records null plus
// the note (null-over-guess) and teardown proceeds regardless.

// ---- Claude Code session transcripts -------------------------------------------
// THE PATH BINDING (Claude Code 2.1.201, the installed version this lane
// pinned against): the CLI keeps one project directory per working directory
// under ~/.claude/projects/, named by replacing every character outside
// [A-Za-z0-9] in the cwd's absolute path with '-' (verified empirically:
// '/Users/x/aether-lane-364' → '-Users-x-aether-lane-364'; case and digits
// survive, the leading slash becomes a leading dash). Sessions land as
// <uuid>.jsonl inside it. If a future CC version changes the convention, the
// scrape throws "no Claude Code project dir" and the telemetry line records
// null tokens with that note — wrong-numbers-silently is the failure mode
// this binding refuses.
export function claudeProjectDirFor(projectsRoot: string, worktree: string): string {
  return join(projectsRoot, worktree.replace(/[^a-zA-Z0-9]/g, '-'))
}

export interface TranscriptScrape {
  tokens: LaneTokenTotals
  // The single distinct `message.model` across the counted entries; null when
  // the session mixed models (which one WAS "the lane's model"? — null, not a
  // vote) or none was recorded.
  model: string | null
}

// THE USAGE BINDING (Claude Code 2.1.201): token usage rides transcript
// entries with type:'assistant' at message.usage — {input_tokens,
// output_tokens, cache_read_input_tokens, cache_creation_input_tokens}. One
// API response spans MULTIPLE jsonl lines sharing one message.id (one line
// per content block, each repeating the same usage object — observed: 38
// assistant lines, 10 distinct message ids), so summing raw lines
// double-counts: entries dedupe by message.id (falling back to requestId).
// `effort` has NO structured transcript field on this version — the caller
// records null for it, never a guess.
//
// Scope: every *.jsonl in the project dir (session restarts and subagent
// transcripts are all the lane's cost), filtered to entries whose `timestamp`
// is STRICTLY newer than `sinceIso` (the record's spawned event) — the
// laneGate doctrine again: a respawned issue reuses its worktree path, so the
// project dir may hold a previous run's sessions. Throws (named) on a missing
// dir, no transcripts, an unparseable sinceIso, or zero matching entries —
// each a "the numbers would be a guess" condition for the caller to null.
export function scrapeTranscriptTokens(
  projectsRoot: string,
  worktree: string,
  sinceIso: string,
): TranscriptScrape {
  const since = Date.parse(sinceIso)
  if (!Number.isFinite(since)) {
    throw new Error(`unparseable spawn timestamp ${JSON.stringify(sinceIso)}`)
  }
  const dir = claudeProjectDirFor(projectsRoot, worktree)
  if (!existsSync(dir)) {
    throw new Error(`no Claude Code project dir at ${dir}`)
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  if (files.length === 0) {
    throw new Error(`no session transcripts (*.jsonl) under ${dir}`)
  }

  const seen = new Set<string>()
  const tokens: LaneTokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const models = new Set<string>()
  let counted = 0
  for (const f of files) {
    let raw: string
    try {
      raw = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue /* unreadable transcript — the others still count */
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue /* skip malformed line */
      }
      if (obj.type !== 'assistant') continue
      const at = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN
      if (!Number.isFinite(at) || at <= since) continue
      const msg = obj.message as Record<string, unknown> | undefined
      const usage = msg?.usage as Record<string, unknown> | undefined
      if (!usage || typeof usage !== 'object') continue
      const key =
        (typeof msg?.id === 'string' && msg.id) ||
        (typeof obj.requestId === 'string' && obj.requestId) ||
        null
      if (key) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      tokens.input += typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
      tokens.output += typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
      tokens.cacheRead +=
        typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
      tokens.cacheWrite +=
        typeof usage.cache_creation_input_tokens === 'number'
          ? usage.cache_creation_input_tokens
          : 0
      if (typeof msg?.model === 'string') models.add(msg.model)
      counted++
    }
  }
  if (counted === 0) {
    throw new Error(`no usage entries newer than spawn (${sinceIso}) under ${dir}`)
  }
  return { tokens, model: models.size === 1 ? [...models][0]! : null }
}

// ---- git diff shortstat ---------------------------------------------------------

// Parse `git diff main...HEAD --shortstat` capture into counts. shortstat
// prints ONE line ("3 files changed, 120 insertions(+), 15 deletions(-)" —
// insertions/deletions each optional, singulars at 1) and prints NOTHING on
// an empty diff, so no matching line ⇒ zeros: that IS the zero-commit lane
// (AC5), not a failure. git errors never reach here — the capture layer
// throws on a non-zero exit and the caller records null. Scanned newest-line-
// first for the -lic capture hygiene (rc banners) the other probes apply.
export function parseShortstat(out: string): LaneDiffStat {
  for (const line of out.split('\n').reverse()) {
    const files = /(\d+) files? changed/.exec(line)
    if (!files) continue
    const ins = /(\d+) insertions?\(\+\)/.exec(line)
    const del = /(\d+) deletions?\(-\)/.exec(line)
    return {
      filesChanged: parseInt(files[1]!, 10),
      insertions: ins ? parseInt(ins[1]!, 10) : 0,
      deletions: del ? parseInt(del[1]!, 10) : 0,
    }
  }
  return { filesChanged: 0, insertions: 0, deletions: 0 }
}

// ---- gate report count ----------------------------------------------------------

// Kept in sync with shell/src/utils/laneGate.ts (renderer and main share no
// imports; both sides pin the literal in tests — the established prefix-
// duplication pattern).
export const GATE_REPORT_PREFIX = 'GATE REPORT'

// Count GATE REPORT comments STRICTLY newer than the record's spawned event —
// the counting sibling of laneGate.ts's foldGateComments, with its exact
// guard semantics (unparseable timestamps never pass; prefix matches on the
// trimmed lead). Same input shape github.get_issue serves ({body,
// created_at}); the gh-CLI caller maps into it. Counts ALL matching comments
// where the fold keeps only the latest: the fold answers "what state is the
// lane in", this answers "how many gate cycles did it take" (#364).
export function countGateReports(comments: unknown, spawnedAtIso: string): number {
  const spawnedAt = Date.parse(spawnedAtIso)
  if (!Array.isArray(comments) || !Number.isFinite(spawnedAt)) return 0
  let n = 0
  for (const c of comments as Array<{ body?: unknown; created_at?: unknown }>) {
    if (typeof c?.body !== 'string' || typeof c?.created_at !== 'string') continue
    const at = Date.parse(c.created_at)
    if (!Number.isFinite(at) || at <= spawnedAt) continue
    if (c.body.trimStart().startsWith(GATE_REPORT_PREFIX)) n++
  }
  return n
}

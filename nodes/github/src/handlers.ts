// Surface handlers for the github Actor node, factored out of index.ts so the
// unit tests (fake IssueClient) and the live smoke script (real client, no
// mesh hop) can drive exactly the code the mesh serves.
//
// Degraded mode (#255 item 2): deps.client === null ⇔ AETHER_GITHUB_TOKEN is
// absent. list_issues then serves a clean { token_available: false } payload
// (the panel's no-token state); create_issue and comment_issue deny with
// `github_no_token` (the capability error). Nothing crashes.

import { MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { GithubApiError, type IssueClient } from './github'
import {
  AREA_MAX,
  CAPABILITY_KEY_RAW_MAX,
  FAILURE_MAX,
  GAP_LABEL,
  SESSION_ID_MAX,
  SUMMARY_MAX,
  UTTERANCE_MAX,
  buildDedupComment,
  buildGapBody,
  buildGapTitle,
  extractCapabilityKey,
  normalizeCapabilityKey,
} from './gap'
import type { IssueDetailPayload, IssueSummary, ListIssuesPayload, RawIssue } from './types'

export interface HandlerDeps {
  /** null ⇔ no token — degraded mode. */
  client: IssueClient | null
  log: (msg: string) => void
  /** Injectable clock for tests; defaults to wall time. */
  now?: () => Date
}

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 100
// Serve-from-cache window. The panel's poll (60s while visible, 4s hook
// default elsewhere) hits this cache, not GitHub; 30s mirrors lanes'
// staleness ratio and keeps worst-case API reads ~120/hr — far under the
// 5000/hr PAT budget.
const LIST_CACHE_TTL_MS = 30_000
// Dedup scans ONE API page of open gap-labeled issues. Past 100 open gaps the
// oldest stop being dedup candidates — acceptable: at that point the board
// has a much bigger problem than duplicates.
const DEDUP_SCAN_LIMIT = 100
const COMMENT_BODY_MAX = 4000
const LABELS_ARG_MAX = 200
// get_issue serves ONE page of comments, oldest-first. ARCHITECT SPEC
// addenda land within the first few comments on any sane issue; an issue
// past 100 comments has outgrown a voice-driven spawn anyway.
const GET_ISSUE_COMMENTS_LIMIT = 100

interface CreateIssueArgs {
  area?: unknown
  summary?: unknown
  utterance?: unknown
  failure?: unknown
  session_id?: unknown
  capability_key?: unknown
}

interface ListIssuesArgs {
  labels?: unknown
  limit?: unknown
}

interface CommentIssueArgs {
  number?: unknown
  body?: unknown
}

// Validation mirrors intents: clamp where harmless, deny where the caller is
// structurally wrong. Core validates against the schema first; these keep the
// node well-behaved if called raw.
function requireStr(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MeshDeny(`github_bad_${field}`, { [field]: value })
  }
  return value.trim().slice(0, max)
}

function optStr(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new MeshDeny(`github_bad_${field}`, { [field]: value })
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LIST_DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > LIST_MAX_LIMIT) return LIST_MAX_LIMIT
  return n
}

// API failures become denies the caller can read: status-bearing
// `github_api_error` for a reachable-but-unhappy GitHub, `github_unreachable`
// for network/timeout. MeshDeny passes through untouched.
function toMeshDeny(err: unknown): MeshDeny {
  if (err instanceof MeshDeny) return err
  if (err instanceof GithubApiError) {
    return new MeshDeny('github_api_error', { status: err.status, reason: err.message })
  }
  return new MeshDeny('github_unreachable', {
    reason: err instanceof Error ? err.message : String(err),
  })
}

function toSummary(raw: RawIssue): IssueSummary {
  // Explicit pick (not rest-destructure): the body stays node-internal, and a
  // future RawIssue field can't silently leak onto the wire.
  return {
    number: raw.number,
    title: raw.title,
    labels: raw.labels,
    state: raw.state,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    comments: raw.comments,
    url: raw.url,
    author: raw.author,
  }
}

export function makeCreateIssueHandler(deps: HandlerDeps) {
  // What this node instance already filed (or dedup-matched), by capability
  // key. GitHub's filtered list endpoint is EVENTUALLY consistent — an issue
  // filed moments ago may not appear in the next labels=gap scan — and
  // back-to-back re-asks (the voice "ask again" flow) must still dedup. This
  // node is the single write rail for gaps, so the local memo is authoritative
  // for its own writes; a memo hit is re-verified open via a direct by-number
  // read (strongly consistent) so a gap the Director closed re-files fresh
  // instead of bumping a closed record. Bounded by gaps touched per process
  // lifetime — tiny.
  const filedByKey = new Map<string, { number: number; url: string }>()

  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as CreateIssueArgs
    const area = requireStr(payload.area, 'area', AREA_MAX)
    const summary = requireStr(payload.summary, 'summary', SUMMARY_MAX)
    const utterance = requireStr(payload.utterance, 'utterance', UTTERANCE_MAX)
    const failure = optStr(payload.failure, 'failure', FAILURE_MAX)
    const sessionId = optStr(payload.session_id, 'session_id', SESSION_ID_MAX)
    const rawKey = optStr(payload.capability_key, 'capability_key', CAPABILITY_KEY_RAW_MAX)
    const key = normalizeCapabilityKey(rawKey ?? `${area} ${summary}`)
    if (!key) {
      throw new MeshDeny('github_bad_capability_key', {
        capability_key: rawKey ?? `${area} ${summary}`,
      })
    }
    if (!deps.client) throw new MeshDeny('github_no_token', {})

    const filedAt = (deps.now ?? (() => new Date()))()
    const dedupOnto = async (
      target: { number: number; url: string },
      via: string,
    ): Promise<Record<string, unknown>> => {
      const comment = await deps.client!.createComment(
        target.number,
        buildDedupComment({ utterance, sessionId, at: filedAt }),
      )
      deps.log(`dedup (${via}): key ${key} → comment ${comment.comment_id} on #${target.number}`)
      return {
        ok: true,
        deduped: true,
        number: target.number,
        url: target.url,
        comment_id: comment.comment_id,
        capability_key: key,
      }
    }

    try {
      // Memo first: closes the read-after-write race the list scan can't see.
      const memo = filedByKey.get(key)
      if (memo) {
        if ((await deps.client.getIssueState(memo.number)) === 'open') {
          return await dedupOnto(memo, 'memo')
        }
        // The gap was closed since we filed it — a fresh ask is a fresh record.
        filedByKey.delete(key)
      }

      // Scan reads GitHub fresh, never the list cache — deduping against a
      // stale board is exactly how duplicates get filed.
      const openGaps = await deps.client.listOpenIssues({
        labels: GAP_LABEL,
        perPage: DEDUP_SCAN_LIMIT,
      })
      const match = openGaps.find((issue) => extractCapabilityKey(issue.body) === key)
      if (match) {
        filedByKey.set(key, { number: match.number, url: match.url })
        return await dedupOnto(match, 'scan')
      }

      const created = await deps.client.createIssue({
        title: buildGapTitle(area, summary),
        body: buildGapBody({ utterance, failure, sessionId, key, filedAt }),
        labels: [GAP_LABEL],
      })
      filedByKey.set(key, created)
      deps.log(`filed gap #${created.number} (key ${key})`)
      return {
        ok: true,
        deduped: false,
        number: created.number,
        url: created.url,
        capability_key: key,
      }
    } catch (err) {
      throw toMeshDeny(err)
    }
  }
}

export function makeListIssuesHandler(deps: HandlerDeps) {
  // Cache keyed by the (labels, limit) arg pair so the gap-only and all-open
  // views don't evict each other. Entry count is bounded by the panel's
  // distinct filter combinations (single digits), not by traffic.
  const cache = new Map<string, { issues: IssueSummary[]; fetchedAtMs: number }>()

  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as ListIssuesArgs
    const labels = optStr(payload.labels, 'labels', LABELS_ARG_MAX)
    const limit = clampLimit(payload.limit)

    if (!deps.client) {
      const degraded: ListIssuesPayload = {
        issues: [],
        fetched_at_ms: 0,
        stale: false,
        token_available: false,
      }
      return degraded as unknown as Record<string, unknown>
    }

    const cacheKey = `${labels ?? ''}|${limit}`
    const cached = cache.get(cacheKey)
    const nowMs = Date.now()
    if (cached && nowMs - cached.fetchedAtMs < LIST_CACHE_TTL_MS) {
      return {
        issues: cached.issues,
        fetched_at_ms: cached.fetchedAtMs,
        stale: false,
        token_available: true,
      }
    }
    try {
      const raw = await deps.client.listOpenIssues({ labels, perPage: limit })
      const issues = raw.map(toSummary)
      cache.set(cacheKey, { issues, fetchedAtMs: nowMs })
      return { issues, fetched_at_ms: nowMs, stale: false, token_available: true }
    } catch (err) {
      if (cached) {
        // Offline render (#255 item 6): last good fetch, flagged stale.
        const reason = err instanceof Error ? err.message : String(err)
        deps.log(`list_issues fetch failed, serving cached: ${reason}`)
        return {
          issues: cached.issues,
          fetched_at_ms: cached.fetchedAtMs,
          stale: true,
          token_available: true,
        }
      }
      throw toMeshDeny(err)
    }
  }
}

export function makeGetIssueHandler(deps: HandlerDeps) {
  // No cache: get_issue backs work_on_issue's spec guard, which must read the
  // CURRENT body + comments (an ARCHITECT SPEC comment may have landed seconds
  // ago). By-number reads are strongly consistent and the call is human-paced
  // (one per spawn utterance), so the PAT budget doesn't care.
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as { number?: unknown }
    const number = payload.number
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
      throw new MeshDeny('github_bad_number', { number })
    }
    // Reads need the API too — tokenless deny mirrors create/comment, not
    // list's degraded payload: a tool call can error, a panel must render.
    if (!deps.client) throw new MeshDeny('github_no_token', {})
    try {
      const issue = await deps.client.getIssue(number)
      if (issue.pullRequest) {
        // GET /issues/:n serves PRs too; a lane spawned on a PR number is a
        // caller mistake, named as such.
        throw new MeshDeny('github_is_pull_request', { number })
      }
      const comments = await deps.client.listComments(number, GET_ISSUE_COMMENTS_LIMIT)
      const detail: IssueDetailPayload = {
        ok: true,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        body: issue.body ?? '',
        url: issue.url,
        author: issue.author,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        comments,
      }
      deps.log(`get_issue #${number} (${issue.state}, ${comments.length} comments)`)
      return detail as unknown as Record<string, unknown>
    } catch (err) {
      throw toMeshDeny(err)
    }
  }
}

export function makeCommentIssueHandler(deps: HandlerDeps) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as CommentIssueArgs
    const number = payload.number
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
      throw new MeshDeny('github_bad_number', { number })
    }
    const body = requireStr(payload.body, 'body', COMMENT_BODY_MAX)
    if (!deps.client) throw new MeshDeny('github_no_token', {})
    try {
      const comment = await deps.client.createComment(number, body)
      deps.log(`comment ${comment.comment_id} on #${number}`)
      return { ok: true, number, comment_id: comment.comment_id, url: comment.url }
    } catch (err) {
      throw toMeshDeny(err)
    }
  }
}

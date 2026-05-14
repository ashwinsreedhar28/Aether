import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@homeos/mesh-node-sdk'
import { FEEDS } from './feeds'
import { FeedPoller } from './fetcher'
import { ArticleStore } from './storage'
import { isCategory, isUrgency, type Category, type Urgency } from './types'

const NODE_ID = 'news_feeds'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
// Search results are read aloud by Gemini or rendered in a (future) UI
// list; capping at 50 keeps the response payload bounded and matches the
// schema's maximum. 20 is the default — same as recent — so a bare
// search({query:'X'}) call returns a comparable handful of headlines.
const SEARCH_DEFAULT_LIMIT = 20
const SEARCH_MAX_LIMIT = 50
const QUERY_MAX_LEN = 200
// Breaking surface caps. Default 10 — a short, spoken-friendly batch of
// the most urgent items. Max 50 matches the search surface's ceiling so
// a renderer-side "breaking" list page can request a meaningful slice
// without round-tripping a paginator that doesn't exist yet.
const BREAKING_DEFAULT_LIMIT = 10
const BREAKING_MAX_LIMIT = 50

interface RecentArgs {
  limit?: number
  since?: string
  category?: string | string[]
  urgency?: string | string[]
}

interface SearchArgs {
  query?: unknown
  limit?: number
  category?: string | string[]
  urgency?: string | string[]
}

interface BreakingArgs {
  limit?: number
}

// Normalise the schema-validated category field into a Category[] (or
// undefined for "no filter"). The JSON Schema enforces values; this is a
// belt-and-suspenders check so a misconfigured Core that ever stops
// validating doesn't leak unvetted strings into SQL. Returns undefined
// for missing or empty arrays — both mean "no filter".
function normaliseCategory(value: unknown): Category[] | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    if (!isCategory(value)) {
      throw new MeshDeny('news_feeds_bad_category', { category: value })
    }
    return [value]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    const out: Category[] = []
    for (const v of value) {
      if (!isCategory(v)) {
        throw new MeshDeny('news_feeds_bad_category', { category: v })
      }
      if (!out.includes(v)) out.push(v)
    }
    return out
  }
  throw new MeshDeny('news_feeds_bad_category', { category: value })
}

// Same shape as normaliseCategory, restricted to the three urgency
// buckets. The JSON Schema enum-validates upstream; this is the
// belt-and-suspenders mirror so a misconfigured Core ever stopping
// validation can't leak unvetted strings into the SQL IN clause.
function normaliseUrgency(value: unknown): Urgency[] | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    if (!isUrgency(value)) {
      throw new MeshDeny('news_feeds_bad_urgency', { urgency: value })
    }
    return [value]
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    const out: Urgency[] = []
    for (const v of value) {
      if (!isUrgency(v)) {
        throw new MeshDeny('news_feeds_bad_urgency', { urgency: v })
      }
      if (!out.includes(v)) out.push(v)
    }
    return out
  }
  throw new MeshDeny('news_feeds_bad_urgency', { urgency: value })
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with anyone speaking a structured
  // protocol — Core consumes the HTTP/SSE stream over loopback, not
  // stdout — so plain stdout is safe here. (See CLAUDE.md §10 "Stdout
  // pollution breaks JSON-RPC daemons" for the case where it isn't.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_LIMIT) return MAX_LIMIT
  return n
}

function clampSearchLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SEARCH_DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > SEARCH_MAX_LIMIT) return SEARCH_MAX_LIMIT
  return n
}

function clampBreakingLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return BREAKING_DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > BREAKING_MAX_LIMIT) return BREAKING_MAX_LIMIT
  return n
}

// FTS5 MATCH strings have their own grammar (column filters, NEAR,
// quoted phrases, * suffix). Letting user input through raw means a
// stray quote or parenthesis throws a sqlite syntax error rather than
// returning the obvious "no results"; worse, an unintended `*` or
// `NEAR` token alters the search semantics. We tokenise into bare
// alphanumeric runs, quote each as a literal phrase, and AND them
// together. Stemming still applies inside a quoted single token
// (FTS5 runs the tokenizer over the quoted text), so "wildfires"
// continues to match "wildfire".
//
// Returns null when sanitisation strips every character — handler
// surfaces that as MeshDeny so Gemini speaks a clean "no useful
// query" line rather than a sqlite error.
function sanitiseFtsQuery(raw: string): string | null {
  // Split on anything that isn't a letter, digit, or apostrophe.
  // Apostrophes inside words ("trump's") survive the split. The
  // resulting tokens are wrapped in double quotes so FTS5 treats each
  // as a literal — any leftover punctuation inside the token (which
  // shouldn't happen after the split, but defensively) gets escaped
  // by doubling internal double quotes.
  const tokens = raw
    .split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
  if (tokens.length === 0) return null
  return tokens.join(' ')
}

function makeSearchHandler(store: ArticleStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as SearchArgs
    const rawQuery = payload?.query
    if (typeof rawQuery !== 'string') {
      throw new MeshDeny('news_feeds_bad_query', { reason: 'query must be a string' })
    }
    const trimmed = rawQuery.trim()
    if (trimmed.length === 0) {
      throw new MeshDeny('news_feeds_bad_query', { reason: 'query is empty' })
    }
    if (trimmed.length > QUERY_MAX_LEN) {
      throw new MeshDeny('news_feeds_bad_query', {
        reason: `query exceeds ${QUERY_MAX_LEN} chars`,
      })
    }
    const match = sanitiseFtsQuery(trimmed)
    if (match === null) {
      // Caller sent only punctuation. Treat as "no useful query" — the
      // tool wrapper turns this into an empty articles list so Gemini
      // says "no headlines" rather than reading an error stack.
      return { articles: [] }
    }
    const limit = clampSearchLimit(payload?.limit ?? SEARCH_DEFAULT_LIMIT)
    const categories = normaliseCategory(payload?.category)
    const urgencies = normaliseUrgency(payload?.urgency)
    const articles = store.search({ match, limit, categories, urgencies })
    return { articles }
  }
}

function makeRecentHandler(store: ArticleStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as RecentArgs
    const limit = clampLimit(payload?.limit ?? DEFAULT_LIMIT)
    const since = typeof payload?.since === 'string' ? payload.since : undefined
    if (since !== undefined) {
      // Cheap parse-check so a malformed string falls out with a clean
      // MeshDeny rather than an opaque sqlite comparison.
      const t = Date.parse(since)
      if (Number.isNaN(t)) {
        throw new MeshDeny('news_feeds_bad_since', { since })
      }
    }
    const categories = normaliseCategory(payload?.category)
    const urgencies = normaliseUrgency(payload?.urgency)
    const articles = store.recent({ limit, since, categories, urgencies })
    return { articles }
  }
}

function makeBreakingHandler(store: ArticleStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as BreakingArgs
    const limit = clampBreakingLimit(payload?.limit ?? BREAKING_DEFAULT_LIMIT)
    const articles = store.breaking({ limit })
    return { articles }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_NEWS_FEEDS_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_NEWS_FEEDS_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const dataDir = process.env.HOMEOS_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] HOMEOS_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }

  const nodeDir = join(dataDir, 'news_feeds')
  mkdirSync(nodeDir, { recursive: true })
  const dbPath = join(nodeDir, 'news.db')
  const markerPath = join(nodeDir, 'running')

  const store = new ArticleStore(dbPath)
  log(`storage opened at ${dbPath} (existing rows=${store.count()})`)

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('recent', makeRecentHandler(store))
  node.on('search', makeSearchHandler(store))
  node.on('breaking', makeBreakingHandler(store))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  // Marker file: written after successful registration so the shell (or any
  // other external observer) can tell at a glance whether the node is up.
  // PID file is owned by the spawning shell process; this marker is owned
  // by the node itself, which makes it the right liveness signal — Core
  // would have rejected register() if the secret were wrong, so a marker
  // existing means the node is signed in and serving.
  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  const poller = new FeedPoller({ feeds: FEEDS, store, log })
  void poller.start()
  log(`poller started — ${FEEDS.length} feeds, first poll in-flight`)

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    try {
      unlinkSync(markerPath)
    } catch {
      /* already gone */
    }
    try {
      await poller.stop()
    } catch (e) {
      log(`poller stop error: ${(e as Error).message}`)
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    try {
      store.close()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})

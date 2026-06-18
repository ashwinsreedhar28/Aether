import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { searchPapers, S2Error } from './semanticScholar'
import { synthesizeBrief, SynthesisError } from './synthesize'
import { BriefStore } from './storage'
import type { ResearchBrief } from './types'

const NODE_ID = 'research'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const QUERY_MAX_LEN = 300
const RECENT_DEFAULT_LIMIT = 10
const RECENT_MAX_LIMIT = 50

interface SearchArgs {
  query?: unknown
}
interface BriefArgs {
  query?: unknown
}
interface RecentArgs {
  limit?: unknown
}

function log(msg: string): void {
  // Core consumes the HTTP/SSE stream over loopback, not stdout, so plain
  // stdout is safe for node logging (CLAUDE.md §10).
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

// Validate + normalise a free-text query argument shared by search/brief.
// Empty / non-string / oversize → MeshDeny so the caller speaks a clean
// reason rather than an opaque downstream error.
function requireQuery(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new MeshDeny('research_bad_query', { reason: 'query must be a string' })
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new MeshDeny('research_bad_query', { reason: 'query is empty' })
  }
  if (trimmed.length > QUERY_MAX_LEN) {
    throw new MeshDeny('research_bad_query', { reason: `query exceeds ${QUERY_MAX_LEN} chars` })
  }
  return trimmed
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RECENT_DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > RECENT_MAX_LIMIT) return RECENT_MAX_LIMIT
  return n
}

// Map an S2 failure to a clean MeshDeny — never a half-result. Returns
// `never` so it composes as a `.catch()` handler without TS definite-
// assignment complaints.
function denyForS2(err: unknown): never {
  if (err instanceof S2Error) {
    throw new MeshDeny('research_search_failed', { reason: err.message, code: err.code })
  }
  throw new MeshDeny('research_search_failed', {
    reason: err instanceof Error ? err.message : 'semantic scholar error',
  })
}

// Map a synthesis failure to a clean MeshDeny — never a brief with empty
// sections. SynthesisError carries the precise cause (no_api_key / no_papers
// / failed) for the caller to speak.
function denyForSynthesis(err: unknown): never {
  if (err instanceof SynthesisError) {
    throw new MeshDeny('research_synthesis_failed', { reason: err.message, code: err.code })
  }
  throw new MeshDeny('research_synthesis_failed', {
    reason: err instanceof Error ? err.message : 'synthesis error',
  })
}

function makeSearchHandler() {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const query = requireQuery((env.payload as SearchArgs)?.query)
    const papers = await searchPapers(query).catch(denyForS2)
    return { query, papers }
  }
}

function makeBriefHandler(store: BriefStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const query = requireQuery((env.payload as BriefArgs)?.query)
    const papers = await searchPapers(query).catch(denyForS2)
    if (papers.length === 0) {
      throw new MeshDeny('research_no_papers', { reason: `no papers found for "${query}"` })
    }
    const sections = await synthesizeBrief(query, papers).catch(denyForSynthesis)
    const brief: ResearchBrief = {
      query,
      sections,
      papers,
      generatedAt: new Date().toISOString(),
    }
    // Persist for recall; a write failure must not fail the live brief.
    try {
      store.save(brief)
    } catch (e) {
      log(`brief persist failed (returning live result): ${(e as Error).message}`)
    }
    return brief as unknown as Record<string, unknown>
  }
}

function makeRecentHandler(store: BriefStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const limit = clampLimit((env.payload as RecentArgs)?.limit)
    return { briefs: store.recent(limit) }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_RESEARCH_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_RESEARCH_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  const nodeDir = join(dataDir, 'research')
  mkdirSync(nodeDir, { recursive: true })
  const dbPath = join(nodeDir, 'research.db')
  const markerPath = join(nodeDir, 'running')

  const store = new BriefStore(dbPath)
  log(`storage opened at ${dbPath} (stored briefs=${store.count()})`)
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    // Boot degraded rather than refusing: research.search still works; only
    // research.brief denies (research_synthesis_failed/no_api_key) by name.
    log('ANTHROPIC_API_KEY not set — research.brief will deny until it is configured')
  }

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('search', makeSearchHandler())
  node.on('brief', makeBriefHandler(store))
  node.on('recent', makeRecentHandler(store))
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  // Liveness marker (data-node convention): written after register; Core
  // would have rejected register() on a bad secret, so its presence means
  // the node is signed in and serving.
  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

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

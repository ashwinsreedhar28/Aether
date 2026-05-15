import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Quote } from './types'

// Persistent on-disk mirror of the in-memory current-quote cache. The
// in-memory map (storage.ts) is the source of truth at runtime; this
// file exists so a cold start can serve `market_summary` / `sectors` /
// `market_overview` / `movers` immediately instead of returning empty
// for the ~10 minutes the first full poll cycle takes (21 tickers × 30s
// stagger). `finance.quote`, which has its own 5-min freshness window,
// still triggers an on-demand fetch on miss — the persisted entries
// arrive marked with their original fetchedAtMs and are honestly stale
// from the freshness check's point of view.
//
// 6-hour TTL ceiling. Beyond that the file is ignored — a laptop that
// was closed overnight should not surface yesterday's prices to a voice
// query as though they were live. Within 6h the data is useful for the
// dashboard surfaces (and `quote` will refresh per-symbol as needed).
//
// Schema is envelope-versioned: { version, written_at, data }. v1 is the
// initial shape and just passes the entry list through. A v2 (e.g.
// post-Quote-field-addition) would add a reader that migrates v1
// payloads on the fly; until then `version !== 1` invalidates the file.
//
// Why JSON, not SQLite: the cache is whole-file (no partial reads, no
// per-row queries) and tiny (~21 entries × ~200 bytes ≈ 4 KB). SQLite's
// WAL files would dominate the footprint and add a recovery surface for
// no read-side benefit. history.db stays SQLite for its actual
// time-series workload.

export const CACHE_VERSION = 1
export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000

const CACHE_FILENAME = 'cache.json'
const TMP_SUFFIX = '.tmp'

export interface CacheEntrySerialized {
  quote: Quote
  fetchedAtMs: number
}

interface CacheEnvelopeV1 {
  version: 1
  written_at: string
  data: CacheEntrySerialized[]
}

export interface LoadedCache {
  /** ms-since-epoch when the cache was written (envelope.written_at). */
  timestamp: number
  data: CacheEntrySerialized[]
}

export function cachePath(nodeDir: string): string {
  return join(nodeDir, CACHE_FILENAME)
}

// Atomic write: serialise → write to cache.json.tmp → rename(). POSIX
// rename(2) onto the same filesystem is atomic, so a SIGKILL (or panic,
// or power loss) between writeFileSync and renameSync leaves the
// previous cache.json intact. We deliberately do NOT fsync the tmp file
// before rename — on a real crash we may lose the most recent cycle's
// data but never see a partially-written file. That trade-off matches
// the rest of Aether (history.db relies on SQLite's WAL; the renderer's
// localStorage is similarly best-effort).
export function writeCache(
  nodeDir: string,
  entries: CacheEntrySerialized[],
  log: (msg: string) => void,
): void {
  const envelope: CacheEnvelopeV1 = {
    version: CACHE_VERSION,
    written_at: new Date().toISOString(),
    data: entries,
  }
  const body = JSON.stringify(envelope)
  const finalPath = cachePath(nodeDir)
  const tmpPath = finalPath + TMP_SUFFIX
  mkdirSync(dirname(finalPath), { recursive: true })
  writeFileSync(tmpPath, body, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmpPath, finalPath)
  log(`cache persisted (${entries.length} tickers, ${body.length} bytes)`)
}

// Returns the parsed cache when present, parseable, schema-matching,
// and within the TTL window. Any failure mode (missing file, IO error,
// bad JSON, malformed envelope, wrong version, stale) returns null —
// the caller falls through to "empty cache, first cycle fills it". The
// log distinguishes the cases so a corrupt cache shows up in spawn logs
// without crashing the node.
export function readCache(
  nodeDir: string,
  log: (msg: string) => void,
  maxAgeMs: number = CACHE_MAX_AGE_MS,
  now: number = Date.now(),
): LoadedCache | null {
  const finalPath = cachePath(nodeDir)
  let raw: string
  try {
    raw = readFileSync(finalPath, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      log('no cache found, first cycle fills it')
    } else {
      log(
        `cache read failed (${err.code ?? 'unknown'}), starting fresh: ${err.message}`,
      )
    }
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    log(`cache parse failed, starting fresh: ${(e as Error).message}`)
    return null
  }
  const envelope = parseEnvelope(parsed)
  if (!envelope) {
    log('cache parse failed, starting fresh: malformed envelope')
    return null
  }
  if (envelope.version !== CACHE_VERSION) {
    log(
      `cache version=${envelope.version} (expected ${CACHE_VERSION}), starting fresh`,
    )
    return null
  }
  const writtenAtMs = Date.parse(envelope.written_at)
  if (!Number.isFinite(writtenAtMs)) {
    log(
      `cache written_at unparseable (${envelope.written_at}), starting fresh`,
    )
    return null
  }
  const ageMs = now - writtenAtMs
  if (ageMs > maxAgeMs) {
    log(`cache too old (${formatAge(ageMs)}), starting fresh`)
    return null
  }
  log(
    `loaded cached data: ${envelope.data.length} tickers, age ${formatAge(ageMs)}`,
  )
  return { timestamp: writtenAtMs, data: envelope.data }
}

// Structural validation only — checks the envelope contract (version /
// written_at / data array). Individual entry shape is not validated
// here; the store's hydrate path is forgiving (an unparseable entry is
// dropped) so a partial schema mismatch degrades to a smaller cache
// rather than an outright reject.
function parseEnvelope(raw: unknown): CacheEnvelopeV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) return null
  if (typeof obj.written_at !== 'string') return null
  if (!Array.isArray(obj.data)) return null
  return obj as unknown as CacheEnvelopeV1
}

function formatAge(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

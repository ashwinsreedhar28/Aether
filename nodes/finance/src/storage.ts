import type { Quote } from './types'
import type { CacheEntrySerialized } from './cache'

// In-memory quote map. Primary source of truth at runtime — reads are a
// single Map.get() per call. Persisted to disk after each poll cycle by
// cache.ts (6-hour TTL); the persisted copy is loaded at startup so cold
// restarts can serve surfaces before the first poll completes. Individual
// entry freshness (maxAgeMs) is still checked per-read so the on-demand
// finance.quote path triggers a live fetch when a cached entry is stale.
const DEFAULT_MAX_AGE_MS = 5 * 60_000

interface CacheEntry {
  quote: Quote
  fetchedAtMs: number
}

export interface QuoteStoreOptions {
  /** How long an entry is considered fresh. Default 5 minutes. */
  maxAgeMs?: number
}

export class QuoteStore {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly maxAgeMs: number

  constructor(opts: QuoteStoreOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  }

  set(quote: Quote): void {
    this.entries.set(quote.symbol.toUpperCase(), {
      quote,
      fetchedAtMs: Date.now(),
    })
  }

  /** Cached quote if present AND fresh, else null. Used by finance.quote
   *  to decide whether to trigger an on-demand fetch. */
  getFresh(symbol: string): Quote | null {
    const entry = this.entries.get(symbol.toUpperCase())
    if (!entry) return null
    if (Date.now() - entry.fetchedAtMs > this.maxAgeMs) return null
    return entry.quote
  }

  /** All cached quotes, including stale ones. finance.market_summary
   *  returns whatever is in the cache — the poller refreshes the grid
   *  on its own cadence; the market_summary surface itself doesn't
   *  force a refresh. */
  getAll(): Quote[] {
    return Array.from(this.entries.values()).map((e) => e.quote)
  }

  size(): number {
    return this.entries.size
  }

  // Bulk-load from a persisted cache (called once at startup). Forgiving:
  // a malformed entry is silently dropped so a partial schema mismatch
  // (e.g. a Quote field added since the file was written) degrades to a
  // smaller in-memory cache rather than a failed startup.
  hydrate(entries: CacheEntrySerialized[]): void {
    for (const entry of entries) {
      try {
        const symbol = entry.quote.symbol.toUpperCase()
        this.entries.set(symbol, {
          quote: entry.quote,
          fetchedAtMs: entry.fetchedAtMs,
        })
      } catch {
        // skip malformed entry
      }
    }
  }

  serialize(): CacheEntrySerialized[] {
    return Array.from(this.entries.values())
  }
}

import type { Quote } from './types'

// In-memory cache. NOT SQLite — stock quotes are time-sensitive; persisting
// across restarts would surface stale prices to consumers that have no way
// to know they're stale. A cold start re-polls from upstream, and renderer
// + voice get a brief empty state until the first poll lands (handled by
// their respective loading states).
//
// Each entry tracks fetched-at-ms separately from quote.fetched_at so the
// freshness check is a single integer compare per call rather than a
// Date.parse on every read.
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
}

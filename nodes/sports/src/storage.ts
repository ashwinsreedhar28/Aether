// In-memory per-key TTL cache. The sports node is request-driven (no
// background poller): each surface fetches ESPN on demand and caches the
// result for a short window so repeat calls within the TTL are served
// from memory. Mirrors the per-surface caches Pulse kept (scoreboard ~15s,
// summary ~60s, teams ~24h) but as one reusable generic rather than three
// hand-rolled Maps. Nothing persists to disk — a cold start just refetches.

interface CacheEntry<T> {
  value: T
  fetchedAtMs: number
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly ttlMs: number

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs
  }

  /** Cached value if present AND within the TTL window, else null. */
  get(key: string, now: number = Date.now()): T | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (now - entry.fetchedAtMs > this.ttlMs) return null
    return entry.value
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.entries.set(key, { value, fetchedAtMs: now })
  }

  size(): number {
    return this.entries.size
  }
}

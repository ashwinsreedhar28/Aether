import type { QuoteClient } from './client'
import { QuoteClientError } from './client'
import type { QuoteStore } from './storage'
import type { QuoteHistory } from './history'
import { RETENTION_DAYS } from './history'
import type { TickerSource } from './tickers'

// 5-minute cycle: every five minutes we refresh every tracked ticker.
// One symbol per stagger slot. With 10 tickers × 30s stagger = exactly
// 5 minutes, so the next cycle begins immediately after the previous
// finishes — effectively continuous polling, but never more than ~2
// requests/min averaged across the cycle. Neither Yahoo nor Stooq
// publishes a hard rate limit for anonymous use, but staggering is
// kept (vs. burst fetching) to be polite, spread fetch latency across
// the cycle, and avoid bursts that might trip an anti-scrape heuristic
// on either upstream.
const POLL_CYCLE_MS = 5 * 60_000
const STAGGER_MS = 30_000

export interface PollerOptions {
  tickers: TickerSource[]
  client: QuoteClient
  store: QuoteStore
  /** Optional historical store. When provided, every successful fetch
   *  appends a row and each cycle starts with a retention prune.
   *  Failures inside the history writes are swallowed (logged at
   *  warning level) so a misbehaving DB cannot break the in-memory
   *  current-quote path. */
  history?: QuoteHistory
  log: (msg: string) => void
  /** Override the 5-min cycle. Used by tests; not exposed via env. */
  cycleMs?: number
  /** Override the per-symbol stagger. Used by tests. */
  staggerMs?: number
}

export class QuotePoller {
  private readonly opts: PollerOptions
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private inflight: Promise<void> | null = null

  constructor(opts: PollerOptions) {
    this.opts = opts
  }

  // Kicks off the first poll immediately so the renderer sees data within
  // (tickers × stagger) seconds of node startup, then schedules at the
  // cycle interval. Returns after scheduling — callers don't need to wait
  // for the first cycle to complete.
  start(): void {
    const cycle = this.opts.cycleMs ?? POLL_CYCLE_MS
    void this.runCycleOnce()
    this.timer = setInterval(() => {
      void this.runCycleOnce()
    }, cycle)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.inflight) {
      try {
        await this.inflight
      } catch {
        /* logged inside runCycle */
      }
    }
  }

  /** Trigger a fresh fetch for a single symbol (used by finance.quote
   *  when its cache miss falls through). Errors propagate to the
   *  handler, which maps them to MeshDeny. */
  async fetchOnce(symbol: string): Promise<void> {
    const quote = await this.opts.client.fetchQuote(symbol)
    this.opts.store.set(quote)
    this.persistHistory(quote)
  }

  private async runCycleOnce(): Promise<void> {
    if (this.inflight || this.stopped) return
    const p = this.runCycle()
    this.inflight = p
    try {
      await p
    } finally {
      if (this.inflight === p) this.inflight = null
    }
  }

  private async runCycle(): Promise<void> {
    const stagger = this.opts.staggerMs ?? STAGGER_MS
    const startedAt = Date.now()
    // Prune retention window at cycle start: cheap (one DELETE keyed on
    // the indexed column) and amortised across the 5-min cadence. Done
    // here rather than at startup so a long-running node still bounds
    // its on-disk size without needing a separate timer.
    this.pruneHistory()
    let ok = 0
    let failed = 0
    for (let i = 0; i < this.opts.tickers.length; i += 1) {
      if (this.stopped) break
      const t = this.opts.tickers[i]
      if (!t) continue
      try {
        const quote = await this.opts.client.fetchQuote(t.symbol)
        this.opts.store.set(quote)
        this.persistHistory(quote)
        ok += 1
      } catch (e) {
        failed += 1
        const reason = e instanceof QuoteClientError ? e.reason : 'unknown'
        this.opts.log(`fetch failed for ${t.symbol}: ${reason}`)
      }
      // Stagger: don't sleep after the last symbol, just exit.
      if (i < this.opts.tickers.length - 1 && !this.stopped) {
        await sleep(stagger)
      }
    }
    const elapsed = Date.now() - startedAt
    this.opts.log(
      `cycle done: ok=${ok} failed=${failed} in ${elapsed}ms ` +
        `(cache size=${this.opts.store.size()})`,
    )
  }

  // History writes are best-effort. A failing DB (corruption, disk full)
  // must NOT propagate up and break the in-memory current-quote path —
  // the renderer's grid stays useful even if the historical timeline
  // can't be appended to.
  private persistHistory(quote: {
    symbol: string
    price: number
    change: number
    change_percent: number
    fetched_at: string
  }): void {
    if (!this.opts.history) return
    try {
      this.opts.history.insert({
        symbol: quote.symbol,
        fetched_at: quote.fetched_at,
        price: quote.price,
        change: quote.change,
        change_percent: quote.change_percent,
      })
    } catch (e) {
      this.opts.log(
        `history insert failed for ${quote.symbol}: ${(e as Error).message}`,
      )
    }
  }

  private pruneHistory(): void {
    if (!this.opts.history) return
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    try {
      const pruned = this.opts.history.pruneOlderThan(cutoff)
      if (pruned > 0) {
        this.opts.log(
          `history pruned ${pruned} rows older than ${RETENTION_DAYS}d`,
        )
      }
    } catch (e) {
      this.opts.log(`history prune failed: ${(e as Error).message}`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

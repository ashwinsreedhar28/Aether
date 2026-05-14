import type { QuoteClient } from './client'
import { QuoteClientError } from './client'
import type { QuoteStore } from './storage'
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
    let ok = 0
    let failed = 0
    for (let i = 0; i < this.opts.tickers.length; i += 1) {
      if (this.stopped) break
      const t = this.opts.tickers[i]
      if (!t) continue
      try {
        const quote = await this.opts.client.fetchQuote(t.symbol)
        this.opts.store.set(quote)
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

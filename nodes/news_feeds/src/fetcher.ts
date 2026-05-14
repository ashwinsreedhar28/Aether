import { fetchFeed } from './parser'
import type { FeedSource } from './feeds'
import type { ArticleStore } from './storage'

// 15 minutes. Most of the feeds in feeds.ts publish many times an hour at
// peak (HN, BBC), but cumulative bandwidth + parse cost is what we're
// rate-limiting against — not freshness of any one feed.
const POLL_INTERVAL_MS = 15 * 60_000

export interface PollerOptions {
  feeds: FeedSource[]
  store: ArticleStore
  log: (msg: string) => void
  intervalMs?: number
}

export class FeedPoller {
  private readonly opts: PollerOptions
  private timer: NodeJS.Timeout | null = null
  private inflight: Promise<void> | null = null
  private stopped = false

  constructor(opts: PollerOptions) {
    this.opts = opts
  }

  // Kicks off an immediate poll (so first launch shows data within seconds
  // rather than 15 min) and then schedules at the interval. Returns when
  // the first poll completes — callers can ignore the promise if they
  // want startup to proceed in parallel.
  async start(): Promise<void> {
    const interval = this.opts.intervalMs ?? POLL_INTERVAL_MS
    // Fire and forget the immediate poll; do not block the surface from
    // coming online behind it. If the recent surface is invoked before
    // the first poll completes, it returns whatever is already in the
    // DB (empty on a clean install — handled in the renderer's empty
    // state).
    void this.pollOnce()
    this.timer = setInterval(() => {
      void this.pollOnce()
    }, interval)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Wait for any in-flight poll to finish so we don't kill mid-transaction.
    if (this.inflight) {
      try {
        await this.inflight
      } catch {
        /* logged inside pollOnce */
      }
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.inflight || this.stopped) return
    const p = this.runPoll()
    this.inflight = p
    try {
      await p
    } finally {
      if (this.inflight === p) this.inflight = null
    }
  }

  private async runPoll(): Promise<void> {
    const startedAt = Date.now()
    // Settled, not all: a single feed timing out (or returning malformed
    // XML on a bad deploy) must not poison the whole poll. Failures are
    // logged and the surviving feeds still upsert.
    const results = await Promise.allSettled(
      this.opts.feeds.map(async (feed) => {
        const articles = await fetchFeed(feed)
        return { feed, articles }
      }),
    )
    let totalInserted = 0
    let totalUpdated = 0
    let okFeeds = 0
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i]
      const feed = this.opts.feeds[i]
      if (!feed || !r) continue
      if (r.status === 'fulfilled') {
        const { inserted, updated } = this.opts.store.upsertMany(r.value.articles)
        totalInserted += inserted
        totalUpdated += updated
        okFeeds += 1
      } else {
        const reason = r.reason as Error | string | undefined
        const msg =
          reason instanceof Error
            ? reason.message
            : typeof reason === 'string'
              ? reason
              : 'unknown error'
        this.opts.log(`feed ${feed.name} failed: ${msg}`)
      }
    }
    const elapsed = Date.now() - startedAt
    this.opts.log(
      `poll done: ${okFeeds}/${this.opts.feeds.length} feeds ok, ` +
        `inserted=${totalInserted} updated=${totalUpdated} in ${elapsed}ms`,
    )
  }
}

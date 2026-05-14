import type { MeshNode, Envelope } from '@aether/mesh-node-sdk'
import type { BriefingResult, BriefingSection, TimeOfDay } from './types'

// Upstream payload shapes (subset). Not imported from the upstream
// packages — runtime coupling between mesh nodes is the exact wrong
// shape (see CLAUDE.md §2: `_ingest/` is read-only). The mesh contract
// is the JSON Schema + handler payload, not a TypeScript import.
interface ArticleLike {
  title?: unknown
  feed?: unknown
  category?: unknown
  summary?: unknown
}

interface QuoteLike {
  symbol?: unknown
  price?: unknown
  change?: unknown
  change_percent?: unknown
}

interface HistoryPointLike {
  price?: unknown
}

// Headline ETFs lead the market section ("how's the market"). The
// composer reads SPY/QQQ/DIA first — same convention as the voice
// market-summary readback in raven-core/tools/finance_tool.py.
const HEADLINE_TICKERS = ['SPY', 'QQQ', 'DIA'] as const
const NEWS_LIMIT = 5

// Per-upstream invoke timeout. The composer fans out in parallel and
// allSettled-collects results; one slow upstream should not block the
// briefing past this cap. 4s is roomy for a local mesh hop — Yahoo
// finance polls already happen in the background, so the read should
// hit the in-memory cache.
const UPSTREAM_TIMEOUT_MS = 4_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// MeshNode.invoke returns an Envelope on synchronous request/response
// or an {accepted} stub when wait=false. The composer always waits, so
// we narrow here and surface errors as rejections — allSettled on the
// caller side handles the rest.
async function invokeAndUnwrap(
  node: MeshNode,
  target: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await withTimeout(node.invoke(target, payload), UPSTREAM_TIMEOUT_MS, target)
  if (!('kind' in result)) {
    throw new Error(`${target}: response not received (accepted-only)`)
  }
  const env = result as Envelope
  if (env.kind === 'error') {
    const reason =
      typeof env.payload?.reason === 'string' ? (env.payload.reason as string) : 'mesh_error'
    throw new Error(`${target}: ${reason}`)
  }
  return env.payload
}

function formatNewsSection(
  articles: ArticleLike[],
  mode: 'breaking' | 'recent',
): BriefingSection {
  // Voice-readable prose. Lead with a one-line scope sentence, then
  // up to three headlines comma-joined as a single sentence so Gemini
  // can read the section as a coherent paragraph instead of a list.
  // Items[] carries the full N (capped at NEWS_LIMIT) for any future
  // structured renderer.
  //
  // `mode` controls two things:
  //   - The empty-state copy. For breaking, empty is a legitimate
  //     "nothing high-urgency right now" — the section is marked
  //     `available: true` with a graceful prose line. For recent,
  //     empty means the feed poller hasn't produced anything (cold
  //     start / first-run), which is closer to "upstream unavailable"
  //     than "by design," so we keep `available: false`.
  //   - The framing word in the non-empty summary: "breaking"
  //     headlines vs "headlines" plain.
  const items = articles
    .map((a) => ({
      title: isString(a.title) ? a.title : '',
      source: isString(a.feed) ? a.feed : '',
      category: isString(a.category) ? a.category : '',
      summary: isString(a.summary) ? a.summary : '',
    }))
    .filter((a) => a.title.length > 0)

  if (items.length === 0) {
    if (mode === 'breaking') {
      return {
        title: 'Top Breaking',
        summary: 'All quiet on the feeds this morning, sir — nothing breaking right now.',
        available: true,
        items: [],
      }
    }
    return {
      title: 'Top News',
      summary: 'No headlines available — the feed poller has not produced fresh articles yet.',
      available: false,
      items: [],
    }
  }

  const top = items.slice(0, 3)
  const phrased = top
    .map((a, i) => {
      const prefix = i === 0 ? 'Leading' : i === 1 ? 'next' : 'and'
      const sourceClause = a.source ? ` from ${a.source}` : ''
      return `${prefix}, ${a.title}${sourceClause}`
    })
    .join('; ')
  const noun = mode === 'breaking' ? 'breaking headlines' : 'headlines'
  const head = items.length === 1 ? (mode === 'breaking' ? 'breaking headline' : 'headline') : `${items.length} ${noun}`
  const summary = `Top ${head} across your feeds. ${phrased}.`
  const title = mode === 'breaking' ? 'Top Breaking' : 'Top News'
  return { title, summary, available: true, items }
}

function describeQuote(q: { symbol: string; price: number; change_percent: number }): string {
  const direction = q.change_percent >= 0 ? 'up' : 'down'
  return `${q.symbol} ${direction} ${Math.abs(q.change_percent).toFixed(1)} percent at $${q.price.toFixed(2)}`
}

function normaliseQuotes(raw: unknown): QuoteLike[] {
  return Array.isArray(raw) ? (raw as QuoteLike[]) : []
}

function pickQuote(quotes: QuoteLike[], symbol: string): { symbol: string; price: number; change_percent: number } | null {
  const match = quotes.find((q) => isString(q.symbol) && (q.symbol as string).toUpperCase() === symbol)
  if (!match) return null
  if (!isNumber(match.price) || !isNumber(match.change_percent)) return null
  return { symbol, price: match.price, change_percent: match.change_percent }
}

function formatMarketOpenSection(quotes: QuoteLike[]): BriefingSection {
  // The composer is called on-demand; "market open" framing is a
  // semantic choice for the morning briefing rather than a real
  // pre-market data path. We use whatever the finance node has cached.
  const headlines = HEADLINE_TICKERS
    .map((sym) => pickQuote(quotes, sym))
    .filter((q): q is { symbol: string; price: number; change_percent: number } => q !== null)

  if (headlines.length === 0) {
    return {
      title: 'Markets',
      summary:
        'Market data is refreshing — the finance node has not produced quotes for the headline ETFs yet. Check back shortly.',
      available: false,
      items: [],
    }
  }

  const phrased = headlines.map(describeQuote).join(', ')
  const summary = `Markets snapshot. ${phrased}.`
  return { title: 'Markets', summary, available: true, items: headlines }
}

function formatMarketCloseSection(
  quotes: QuoteLike[],
  spyHistory: HistoryPointLike[] | null,
): BriefingSection {
  // Evening framing: current quotes + day's range from finance.history
  // (SPY 1d). If history is missing or thin, drop back to the morning
  // shape — never fail the section.
  const headlines = HEADLINE_TICKERS
    .map((sym) => pickQuote(quotes, sym))
    .filter((q): q is { symbol: string; price: number; change_percent: number } => q !== null)

  if (headlines.length === 0) {
    return {
      title: 'Market Close',
      summary:
        'Market data is refreshing — the finance node has not produced quotes for the headline ETFs yet. Check back shortly.',
      available: false,
      items: [],
    }
  }

  let rangeClause = ''
  if (spyHistory && spyHistory.length >= 2) {
    const prices = spyHistory
      .map((p) => p.price)
      .filter((p): p is number => isNumber(p) && p > 0)
    if (prices.length >= 2) {
      const low = Math.min(...prices)
      const high = Math.max(...prices)
      rangeClause = ` SPY ranged $${low.toFixed(2)} to $${high.toFixed(2)} on the day.`
    }
  }

  const phrased = headlines.map(describeQuote).join(', ')
  const summary = `Market close summary. ${phrased}.${rangeClause}`
  return {
    title: 'Market Close',
    summary,
    available: true,
    items: [...headlines, ...(spyHistory ? [{ symbol: 'SPY', samples: spyHistory.length }] : [])],
  }
}

export interface ComposeOptions {
  node: MeshNode
  /** Override the auto-selected news source. Default selection by
   *  timeOfDay: morning → 'news_feeds.breaking' (urgency-filtered;
   *  what changed overnight that matters), evening → 'news_feeds.recent'
   *  (the day's chronological wrap-up). Override for tests or future
   *  variants. The downstream Article shape is identical across the
   *  two surfaces (urgency carries through on both), so the section
   *  formatter doesn't care which target produced the list. */
  newsTarget?: string
}

export async function composeBriefing(
  timeOfDay: TimeOfDay,
  opts: ComposeOptions,
): Promise<BriefingResult> {
  const node = opts.node
  const newsTarget =
    opts.newsTarget ?? (timeOfDay === 'morning' ? 'news_feeds.breaking' : 'news_feeds.recent')
  const newsMode: 'breaking' | 'recent' = newsTarget === 'news_feeds.breaking' ? 'breaking' : 'recent'

  // Parallel fan-out via allSettled. The evening briefing additionally
  // fetches finance.history(SPY, 1d) for the day's range; the morning
  // briefing skips that hop — fewer requests, faster turnaround, and
  // SPY 1d range is less interesting before market open.
  const newsP = invokeAndUnwrap(node, newsTarget, { limit: NEWS_LIMIT })
  const marketP = invokeAndUnwrap(node, 'finance.market_summary', {})
  const historyP =
    timeOfDay === 'evening'
      ? invokeAndUnwrap(node, 'finance.history', { symbol: 'SPY', period: '1d' })
      : Promise.resolve<Record<string, unknown> | null>(null)

  const [newsRes, marketRes, historyRes] = await Promise.allSettled([newsP, marketP, historyP])

  const sections: BriefingSection[] = []

  if (newsRes.status === 'fulfilled') {
    const raw = newsRes.value.articles
    const articles = Array.isArray(raw) ? (raw as ArticleLike[]) : []
    sections.push(formatNewsSection(articles, newsMode))
  } else {
    sections.push({
      title: newsMode === 'breaking' ? 'Top Breaking' : 'Top News',
      summary: `News is unavailable right now (${newsRes.reason instanceof Error ? newsRes.reason.message : 'upstream error'}).`,
      available: false,
      items: [],
    })
  }

  if (marketRes.status === 'fulfilled') {
    const quotes = normaliseQuotes(marketRes.value.quotes)
    if (timeOfDay === 'morning') {
      sections.push(formatMarketOpenSection(quotes))
    } else {
      const spyPoints =
        historyRes.status === 'fulfilled' && historyRes.value && Array.isArray(historyRes.value.points)
          ? (historyRes.value.points as HistoryPointLike[])
          : null
      sections.push(formatMarketCloseSection(quotes, spyPoints))
    }
  } else {
    const title = timeOfDay === 'morning' ? 'Markets' : 'Market Close'
    sections.push({
      title,
      summary: `Market data is unavailable right now (${marketRes.reason instanceof Error ? marketRes.reason.message : 'upstream error'}).`,
      available: false,
      items: [],
    })
  }

  return {
    briefing: sections,
    generated_at: new Date().toISOString(),
    time_of_day: timeOfDay,
  }
}

import { createHash } from 'node:crypto'
import RSSParser from 'rss-parser'
import type { FeedSource } from './feeds'
import { scoreUrgency } from './scorer'
import type { Category, Urgency } from './types'

// rss-parser is permissive — both Atom and RSS shapes flow through with most
// fields optional. We normalise here so storage + the recent surface see a
// single Article shape regardless of feed type.
export interface Article {
  id: string
  feed: string
  category: Category
  urgency: Urgency
  title: string
  summary: string
  url: string
  published_at: string
  fetched_at: string
}

// Summaries get HTML-stripped + collapsed + truncated. Gemini reads these
// aloud; a 600-char ceiling keeps the spoken reading under ~12 seconds per
// article and avoids tag noise leaking into TTS.
const SUMMARY_MAX = 600

const parser = new RSSParser({
  timeout: 15_000,
  headers: {
    'User-Agent': 'Aether-news-feeds/0.1 (+https://github.com/ashwinsreedhar/homeOS)',
  },
})

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function pickSummary(item: Record<string, unknown>): string {
  const candidates = [
    item.contentSnippet,
    item.summary,
    item.content,
    item['content:encoded'],
    item.description,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return truncate(stripHtml(c), SUMMARY_MAX)
    }
  }
  return ''
}

function pickPublished(item: Record<string, unknown>): string {
  const iso = item.isoDate
  if (typeof iso === 'string' && iso.length > 0) return iso
  const pub = item.pubDate
  if (typeof pub === 'string') {
    const d = new Date(pub)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  // Some feeds omit pubDate entirely. Use fetch time as a fallback so
  // the article still sorts in a sensible position.
  return new Date().toISOString()
}

function stableId(feedName: string, item: Record<string, unknown>): string {
  // Prefer guid (Atom: id) — feeds promise stability there. Fall back to link.
  const seed =
    typeof item.guid === 'string' && item.guid.length > 0
      ? item.guid
      : typeof item.id === 'string' && item.id.length > 0
        ? item.id
        : typeof item.link === 'string'
          ? item.link
          : `${feedName}:${item.title ?? Math.random()}`
  return createHash('sha1').update(`${feedName}::${seed}`).digest('hex').slice(0, 16)
}

export async function fetchFeed(source: FeedSource): Promise<Article[]> {
  const parsed = await parser.parseURL(source.url)
  const items = (parsed.items ?? []) as Record<string, unknown>[]
  const fetchedAt = new Date().toISOString()
  // Use a single `now` value across the whole batch so two articles
  // from the same poll on either side of a minute boundary don't get
  // different recency scores.
  const scoredAt = Date.parse(fetchedAt)
  const articles: Article[] = []
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const url = typeof item.link === 'string' ? item.link : ''
    if (!title || !url) continue
    const finalTitle = truncate(title, 300)
    const summary = pickSummary(item)
    const publishedAt = pickPublished(item)
    const { bucket } = scoreUrgency(
      { title: finalTitle, summary, published_at: publishedAt },
      source,
      scoredAt,
    )
    articles.push({
      id: stableId(source.name, item),
      feed: source.name,
      category: source.category,
      urgency: bucket,
      title: finalTitle,
      summary,
      url,
      published_at: publishedAt,
      fetched_at: fetchedAt,
    })
  }
  return articles
}

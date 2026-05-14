// Hardcoded feed list for v1. OPML / user-editable subscriptions are a
// follow-up — the goal of this PR is to prove the data substrate end-to-end,
// not solve subscription management. Add or remove entries here and rebuild
// the node; the storage layer dedupes by stable id so churn doesn't pile up
// duplicates.
//
// Selection criteria: well-formed feeds (full title + link + pubDate +
// summary), stable URLs, mainstream sources that won't 404 in a week.

export interface FeedSource {
  /** Display name used in the UI and surfaced to Gemini. */
  name: string
  /** RSS or Atom URL. rss-parser handles both. */
  url: string
}

export const FEEDS: FeedSource[] = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
]

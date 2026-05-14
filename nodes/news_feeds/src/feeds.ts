// Hardcoded feed list for v1. OPML / user-editable subscriptions are a
// follow-up — the goal of this node is to prove the data substrate end-to-end,
// not solve subscription management. Add or remove entries here and rebuild
// the node; the storage layer dedupes by stable id so churn doesn't pile up
// duplicates.
//
// Selection criteria: well-formed feeds (full title + link + pubDate +
// summary), stable URLs, mainstream sources that won't 404 in a week.
// Pulse's vendored news_feeds catalog under _ingest/ is empty in this
// checkout, so the list below is reconstructed from well-known public
// RSS/Atom endpoints rather than lifted directly. If a feed flakes, swap
// it for a comparable source in the same category.
//
// Categories ordering mirrors types.ts (world, us, tech, business, sports,
// science, local) — broad scope → specific. "local" is Bay Area in v1;
// user-configurable locale is future work.

import type { Category } from './types'

export interface FeedSource {
  /** Display name used in the UI and surfaced to Gemini. */
  name: string
  /** RSS or Atom URL. rss-parser handles both. */
  url: string
  /** Category this feed contributes articles to. Inherited by every
   * article fetched from this feed. */
  category: Category
}

export const FEEDS: FeedSource[] = [
  // world — international news
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world' },
  { name: 'Reuters World', url: 'https://feeds.reuters.com/Reuters/worldNews', category: 'world' },
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world' },
  { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'world' },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', category: 'world' },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world' },

  // us — national US news
  { name: 'NPR National', url: 'https://feeds.npr.org/1003/rss.xml', category: 'us' },
  { name: 'NYT US', url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', category: 'us' },
  { name: 'NPR Top Stories', url: 'https://feeds.npr.org/1001/rss.xml', category: 'us' },
  { name: 'Politico', url: 'https://www.politico.com/rss/politicopicks.xml', category: 'us' },
  { name: 'The Hill', url: 'https://thehill.com/news/feed/', category: 'us' },

  // tech — technology, software, hardware
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss', category: 'tech' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'tech' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'tech' },

  // business — markets, finance, corporate
  { name: 'NYT Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', category: 'business' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'business' },
  { name: 'NPR Business', url: 'https://feeds.npr.org/1006/rss.xml', category: 'business' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', category: 'business' },

  // sports
  { name: 'ESPN Top Stories', url: 'https://www.espn.com/espn/rss/news', category: 'sports' },
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sports' },
  { name: 'NYT Sports', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml', category: 'sports' },
  { name: 'The Guardian Sport', url: 'https://www.theguardian.com/sport/rss', category: 'sports' },

  // science — research, space, climate
  { name: 'Nature News', url: 'https://www.nature.com/nature.rss', category: 'science' },
  { name: 'Scientific American', url: 'https://rss.sciam.com/ScientificAmerican-Global', category: 'science' },
  { name: 'NYT Science', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', category: 'science' },
  { name: 'NASA Breaking News', url: 'https://www.nasa.gov/news-release/feed/', category: 'science' },
  { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', category: 'science' },

  // local — Bay Area in v1; locale configurability is future work
  { name: 'KQED News', url: 'https://www.kqed.org/news/feed', category: 'local' },
  { name: 'SFGate Bay Area', url: 'https://www.sfgate.com/rss/feed/Bay-Area-News-560.php', category: 'local' },
  { name: 'Mercury News', url: 'https://www.mercurynews.com/feed/', category: 'local' },
  { name: 'SFist', url: 'https://sfist.com/feed/', category: 'local' },
]

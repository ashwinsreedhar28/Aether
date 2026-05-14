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
//
// sourceWeight — feed's contribution (0–30) to the urgency score in
// scorer.ts. Three tiers, chosen for transparency over fine gradation:
//
//   • 30 — breaking-news wires whose headlines explicitly flag urgency
//     when it exists (Reuters World, Reuters Business). These desks
//     own the BREAKING: / URGENT: convention the title scorer also
//     keys off; a 30 here means a clean Reuters headline already
//     starts close to the medium-bucket floor.
//   • 20 — major outlets with a beat editor and a daily edit cycle
//     (BBC, NYT, NPR, Guardian, Al Jazeera, Politico, The Hill, Ars
//     Technica, The Verge, Wired, TechCrunch, MIT Tech Review, ESPN,
//     Nature, Scientific American, NASA, Quanta, KQED, SFGate,
//     Mercury News). Their headlines are reliably newsworthy but the
//     feed itself doesn't pre-signal urgency.
//   • 10 — aggregators / blogs / community feeds where item-level
//     newsworthiness varies widely (Hacker News, SFist). Urgent items
//     here still climb via the title-language + topic-keywords
//     signals; the low source baseline keeps merely-fresh items from
//     looking breaking.
//
// Adjust a single feed's weight by editing its entry; don't add a fourth
// tier on a whim — see DECISIONS.md 2026-05-13 "News urgency scoring via
// heuristic" for why the gradation is deliberately coarse.

import type { Category } from './types'

export interface FeedSource {
  /** Display name used in the UI and surfaced to Gemini. */
  name: string
  /** RSS or Atom URL. rss-parser handles both. */
  url: string
  /** Category this feed contributes articles to. Inherited by every
   * article fetched from this feed. */
  category: Category
  /** 0–30. Feed-level contribution to the urgency score in scorer.ts.
   * See the weight tier comment block above for the rationale behind
   * each value. */
  sourceWeight: number
}

export const FEEDS: FeedSource[] = [
  // world — international news
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world', sourceWeight: 20 },
  { name: 'Reuters World', url: 'https://feeds.reuters.com/Reuters/worldNews', category: 'world', sourceWeight: 30 },
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', sourceWeight: 20 },
  { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'world', sourceWeight: 20 },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml', category: 'world', sourceWeight: 20 },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'world', sourceWeight: 20 },

  // us — national US news
  { name: 'NPR National', url: 'https://feeds.npr.org/1003/rss.xml', category: 'us', sourceWeight: 20 },
  { name: 'NYT US', url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', category: 'us', sourceWeight: 20 },
  { name: 'NPR Top Stories', url: 'https://feeds.npr.org/1001/rss.xml', category: 'us', sourceWeight: 20 },
  { name: 'Politico', url: 'https://www.politico.com/rss/politicopicks.xml', category: 'us', sourceWeight: 20 },
  { name: 'The Hill', url: 'https://thehill.com/news/feed/', category: 'us', sourceWeight: 20 },

  // tech — technology, software, hardware
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss', category: 'tech', sourceWeight: 10 },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech', sourceWeight: 20 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech', sourceWeight: 20 },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech', sourceWeight: 20 },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'tech', sourceWeight: 20 },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'tech', sourceWeight: 20 },

  // business — markets, finance, corporate
  { name: 'NYT Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', category: 'business', sourceWeight: 20 },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'business', sourceWeight: 20 },
  { name: 'NPR Business', url: 'https://feeds.npr.org/1006/rss.xml', category: 'business', sourceWeight: 20 },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', category: 'business', sourceWeight: 30 },

  // sports
  { name: 'ESPN Top Stories', url: 'https://www.espn.com/espn/rss/news', category: 'sports', sourceWeight: 20 },
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sports', sourceWeight: 20 },
  { name: 'NYT Sports', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml', category: 'sports', sourceWeight: 20 },
  { name: 'The Guardian Sport', url: 'https://www.theguardian.com/sport/rss', category: 'sports', sourceWeight: 20 },

  // science — research, space, climate
  { name: 'Nature News', url: 'https://www.nature.com/nature.rss', category: 'science', sourceWeight: 20 },
  { name: 'Scientific American', url: 'https://rss.sciam.com/ScientificAmerican-Global', category: 'science', sourceWeight: 20 },
  { name: 'NYT Science', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', category: 'science', sourceWeight: 20 },
  { name: 'NASA Breaking News', url: 'https://www.nasa.gov/news-release/feed/', category: 'science', sourceWeight: 20 },
  { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', category: 'science', sourceWeight: 20 },

  // local — Bay Area in v1; locale configurability is future work
  { name: 'KQED News', url: 'https://www.kqed.org/news/feed', category: 'local', sourceWeight: 20 },
  { name: 'SFGate Bay Area', url: 'https://www.sfgate.com/rss/feed/Bay-Area-News-560.php', category: 'local', sourceWeight: 20 },
  { name: 'Mercury News', url: 'https://www.mercurynews.com/feed/', category: 'local', sourceWeight: 20 },
  { name: 'SFist', url: 'https://sfist.com/feed/', category: 'local', sourceWeight: 10 },
]

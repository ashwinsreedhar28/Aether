// Heuristic urgency scorer. Deterministic, no LLM, no external API
// calls — runs synchronously at fetch time per article. Inputs are
// fields the parser already has on hand (title, summary, feed metadata,
// published_at) plus the current time, so scoring adds no I/O to the
// poll cycle.
//
// The 0–100 score is built from four independent components, each
// capped individually so no single signal can carry an article into
// the high bucket on its own:
//
//   • Source weight   (0–30)  feed-level — see feeds.ts
//   • Title language  (0–30)  breaking-prefix / ALL CAPS / urgency words
//   • Recency         (0–25)  age relative to scoring time
//   • Topic keywords  (0–15)  always-urgent subject matter
//
// Total ceiling: 30 + 30 + 25 + 15 = 100. The bucket function maps the
// total to low (0–39) / medium (40–69) / high (70+). The boundaries
// are tuned so a clean breaking-news wire post within the hour about
// an always-urgent topic clears 70 reliably; a stale tech opinion
// piece from an aggregator stays at low even if the title shouts.
//
// All weight and threshold constants are exported so reviewers (and
// the DECISIONS.md ADR) can audit the heuristic without diving into
// the code, and so future tuning has a single dial-board to adjust.
// See DECISIONS.md 2026-05-13 "News urgency scoring via heuristic"
// for the motivation and the alternatives we rejected (LLM scoring,
// user-tunable weights).

import type { Urgency } from './types'

// --- bucket thresholds ----------------------------------------------------
// Total score ranges. High bucket starts at 70 — empirically the floor
// that requires *at least two* strong signals (e.g. breaking wire + recent
// + topic, or breaking-prefix title + recent on a major outlet) to clear.
// Tuning these moves the volume of "high" articles linearly; lower the
// HIGH_THRESHOLD if breaking() consistently surfaces too few rows.
export const MEDIUM_THRESHOLD = 40
export const HIGH_THRESHOLD = 70

// --- title-language scoring -----------------------------------------------
// Breaking/urgent prefix bonus. Matched case-insensitively at the start
// of the title with optional whitespace and a separating colon/dash/space.
// Newswires use this convention consistently when an item is genuinely
// urgent — a strong signal worth weighting.
export const TITLE_BREAKING_BONUS = 20

// All-caps title bonus. Some publishers shout the whole headline on
// truly major events; weighted slightly below the breaking prefix
// because it's also occasionally a stylistic tic (acronym-heavy
// headlines, tabloid voice). Combined with the breaking bonus,
// capped at TITLE_PREFIX_OR_CAPS_CAP to avoid double-counting both
// signals when a publisher is using both at once.
export const TITLE_ALLCAPS_BONUS = 15
export const TITLE_PREFIX_OR_CAPS_CAP = 20

// Per-word bonus for each urgency-language hit in the title, capped at
// TITLE_WORDS_CAP so a single sensational headline can't stack five
// keywords into the same bucket as breaking + recency + topic. The
// vocabulary is intentionally narrow — words that nearly always mean
// "something significant is happening right now," not just "this is
// dramatic." Tunable here; document additions in DECISIONS.md.
export const TITLE_WORD_BONUS = 5
export const TITLE_WORDS_CAP = 15
const TITLE_URGENCY_WORDS: readonly string[] = [
  'breaking',
  'urgent',
  'emergency',
  'crisis',
  'killed',
  'dead',
  'explosion',
  'attack',
  'evacuated',
  'collapsed',
]

// Cumulative cap across all title signals. Prevents prefix + allcaps + a
// full sweep of urgency words from collectively exceeding the title
// category's 30-point ceiling.
export const TITLE_TOTAL_CAP = 30

// --- recency scoring ------------------------------------------------------
// Brackets in ascending age — first match wins.
//   < 1h    → fresh, maximum recency contribution
//   1h–4h   → still developing
//   4h–12h  → today but cooling
//   ≥ 12h   → stale; recency contributes nothing
// Boundaries are minutes (not ms) for readable comparisons; the function
// computes (now - published) in minutes.
export const RECENCY_FRESH_MINUTES = 60
export const RECENCY_RECENT_MINUTES = 60 * 4
export const RECENCY_STALE_MINUTES = 60 * 12

export const RECENCY_FRESH_BONUS = 25
export const RECENCY_RECENT_BONUS = 15
export const RECENCY_STALE_BONUS = 5
// (No constant for older-than-stale; explicit zero in the function.)

// --- topic-keyword scoring ------------------------------------------------
// Always-urgent subjects. Matched case-insensitively against title +
// summary with word boundaries so "fire" inside "firearm" or "firefox"
// doesn't trigger. Hits are capped — five different topic words in one
// article doesn't matter more than two.
export const TOPIC_WORD_BONUS = 5
export const TOPIC_WORDS_CAP = 15
const TOPIC_URGENCY_WORDS: readonly string[] = [
  'war',
  'attack',
  'shooting',
  'earthquake',
  'hurricane',
  'wildfire',
  'evacuation',
  'recall',
  'outbreak',
  'tsunami',
]

// --- score / bucket types -------------------------------------------------
export interface UrgencyResult {
  score: number
  bucket: Urgency
}

export interface ScorableArticle {
  title: string
  summary: string
  published_at: string
}

export interface ScorableFeed {
  sourceWeight: number
}

// --- helpers --------------------------------------------------------------
// Build a single case-insensitive regex per word list. Word boundaries
// (\b) keep substring matches out — "fire" in "wildfire" still matches
// because \b sits between non-word and word characters, but "fire" in
// "firefox" doesn't (no word boundary in the middle). Multi-character
// terms like "war" are similarly bounded so "warning" doesn't trip the
// keyword scan.
function buildWordsRegex(words: readonly string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi')
}

const TITLE_WORDS_RE = buildWordsRegex(TITLE_URGENCY_WORDS)
const TOPIC_WORDS_RE = buildWordsRegex(TOPIC_URGENCY_WORDS)

// Breaking-prefix detection. Accepts "BREAKING:", "URGENT —", "Breaking:
// ", with optional whitespace before the colon/dash. Case-insensitive.
// The colon/dash/space requirement prevents words like "Breakingly" from
// matching the bare keyword test (which would also trigger via
// TITLE_WORDS_RE — kept separate so the prefix bonus is distinct from
// the per-word bonus).
const BREAKING_PREFIX_RE = /^\s*(?:breaking|urgent)\s*[:\-—]\s*/i

// Letter-content check for ALL CAPS. Requires the title to contain at
// least one letter and for every letter present to be uppercase. Numbers
// and punctuation are ignored. Skips trivially-short titles (<8 chars)
// — an all-caps two-word title is more often a stylistic acronym
// ("DOJ FILES") than a shout.
const MIN_ALLCAPS_LENGTH = 8
function isAllCapsTitle(title: string): boolean {
  if (title.length < MIN_ALLCAPS_LENGTH) return false
  let hasLetter = false
  for (const ch of title) {
    if (ch >= 'a' && ch <= 'z') return false
    if (ch >= 'A' && ch <= 'Z') hasLetter = true
  }
  return hasLetter
}

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(text) !== null) n += 1
  return n
}

// --- score components -----------------------------------------------------
export function scoreTitle(title: string): number {
  const breaking = BREAKING_PREFIX_RE.test(title)
  const allCaps = isAllCapsTitle(title)
  let prefixOrCaps = (breaking ? TITLE_BREAKING_BONUS : 0) + (allCaps ? TITLE_ALLCAPS_BONUS : 0)
  if (breaking && allCaps) prefixOrCaps = Math.min(prefixOrCaps, TITLE_PREFIX_OR_CAPS_CAP)

  // Strip the breaking-prefix before counting per-word hits so the
  // prefix-word ("breaking" / "urgent") doesn't get double-counted as
  // both the prefix bonus and a +5 per-word bonus.
  const body = breaking ? title.replace(BREAKING_PREFIX_RE, '') : title
  const wordHits = countMatches(TITLE_WORDS_RE, body)
  const wordsScore = Math.min(wordHits * TITLE_WORD_BONUS, TITLE_WORDS_CAP)

  return Math.min(prefixOrCaps + wordsScore, TITLE_TOTAL_CAP)
}

export function scoreRecency(publishedAtIso: string, nowMs: number): number {
  const t = Date.parse(publishedAtIso)
  if (Number.isNaN(t)) return 0
  // Future timestamps (feed timezone glitches) are treated as "just
  // now" rather than dropped — the article still wins recency, but the
  // other components decide whether it actually matters.
  const diffMin = Math.max(0, (nowMs - t) / 60_000)
  if (diffMin < RECENCY_FRESH_MINUTES) return RECENCY_FRESH_BONUS
  if (diffMin < RECENCY_RECENT_MINUTES) return RECENCY_RECENT_BONUS
  if (diffMin < RECENCY_STALE_MINUTES) return RECENCY_STALE_BONUS
  return 0
}

export function scoreTopic(title: string, summary: string): number {
  // Combine title + summary so a topic word that only appears in the
  // article body still scores. Title remains the primary signal via
  // scoreTitle; this is the topic-subject dimension.
  const haystack = `${title} ${summary}`
  const hits = countMatches(TOPIC_WORDS_RE, haystack)
  return Math.min(hits * TOPIC_WORD_BONUS, TOPIC_WORDS_CAP)
}

export function bucketFor(score: number): Urgency {
  if (score >= HIGH_THRESHOLD) return 'high'
  if (score >= MEDIUM_THRESHOLD) return 'medium'
  return 'low'
}

// --- public entry point ---------------------------------------------------
// Sums the four component scorers, clamps to [0, 100], and buckets.
// Pure: same inputs → same output. `now` is injected (defaulting to
// Date.now()) so tests / migrations can drive scoring at a fixed
// reference time.
export function scoreUrgency(
  article: ScorableArticle,
  feed: ScorableFeed,
  now: number = Date.now(),
): UrgencyResult {
  const source = Math.max(0, Math.min(30, feed.sourceWeight))
  const title = scoreTitle(article.title)
  const recency = scoreRecency(article.published_at, now)
  const topic = scoreTopic(article.title, article.summary)
  const total = Math.max(0, Math.min(100, source + title + recency + topic))
  return { score: total, bucket: bucketFor(total) }
}

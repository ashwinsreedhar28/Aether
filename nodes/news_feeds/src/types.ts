// Hardcoded taxonomy. Each feed declares exactly one category; articles
// inherit their feed's category at fetch time. No inference, no dynamic
// tagging, no per-article overrides. Adding a new category is a code
// change here + schema update + voice-prompt update — intentional friction
// so the set doesn't proliferate. See DECISIONS.md 2026-05-13.
//
// Ordering is semantic, not alphabetical: broad scope → specific scope.
// This same order is used by the JSON Schema enum, the voice prompt
// enumeration, and the UI chip row, so any reader of any of those sees
// the categories in a consistent sequence. If you add a category, place
// it where it semantically fits in that broad→specific spectrum, not at
// the end of the list.
export type Category =
  | 'world'
  | 'us'
  | 'tech'
  | 'business'
  | 'sports'
  | 'science'
  | 'local'

export const CATEGORIES: readonly Category[] = [
  'world',
  'us',
  'tech',
  'business',
  'sports',
  'science',
  'local',
] as const

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES)

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && CATEGORY_SET.has(value)
}

// Three-bucket urgency rating computed deterministically by scorer.ts at
// fetch time. Decouples "recency" from "importance" so voice queries like
// "what's breaking" return genuinely-newsworthy content instead of
// whatever happens to be freshest in the feed pool. Heuristic-only — no
// LLM, no external API calls; see scorer.ts for the weight constants and
// DECISIONS.md 2026-05-13 "News urgency scoring via heuristic" for the
// motivation.
//
// Ordering is semantic, ascending in intensity (low → medium → high) —
// the same direction the underlying 0–100 score moves. Used identically
// by the JSON Schema enum, the voice prompt enumeration, the recent /
// search / breaking surfaces' filter parameter, and the News app's
// urgency badge mapping; keep them in sync. If a future bucket lands
// (e.g. 'critical'), place it at the top of the intensity scale.
export type Urgency = 'low' | 'medium' | 'high'

export const URGENCIES: readonly Urgency[] = ['low', 'medium', 'high'] as const

const URGENCY_SET: ReadonlySet<string> = new Set(URGENCIES)

export function isUrgency(value: unknown): value is Urgency {
  return typeof value === 'string' && URGENCY_SET.has(value)
}

// Entity kinds extracted from article title + summary by the NER pass
// in extractor.ts. Person / place / organization is the same three-way
// split compromise's chainable matchers (.people / .places /
// .organizations) expose — narrower than the full OntoNotes set but
// good enough for "what's the latest on X" voice queries.
//
// Ordering mirrors the broad → specific spectrum used by Category:
// people first (most specific referents), then places, then
// organizations. The same order is reused by the JSON Schema enum,
// the SQL CHECK constraint, and the voice prompt enumeration so any
// reader sees a consistent sequence.
export type EntityKind = 'person' | 'place' | 'organization'

export const ENTITY_KINDS: readonly EntityKind[] = ['person', 'place', 'organization'] as const

export const isEntityKind = (s: string): s is EntityKind =>
  ENTITY_KINDS.includes(s as EntityKind)

export interface Entity {
  /** Canonical surface form as it appeared in the article, with
   * trailing punctuation / possessive 's stripped. Stored case-
   * preserved; searches LOWER() both sides for case-insensitive
   * match. */
  name: string
  kind: EntityKind
  /** Number of times this name surfaced across title + summary for
   * the article. Re-running extraction over the same text is
   * deterministic, so this is stable per (article, name). */
  mentions: number
}

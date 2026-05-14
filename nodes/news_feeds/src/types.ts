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

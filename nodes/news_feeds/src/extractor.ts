import nlp from 'compromise'
import { type Entity, type EntityKind } from './types'

// Lightweight NER over an article's title + summary, returning the
// person / place / organization entities mentioned. Pure function —
// re-running over identical input is deterministic; storage callers
// rely on that to avoid bumping mention counts on idempotent re-polls.
//
// compromise's chainable matchers (.people / .places / .organizations)
// each return the spans tagged with the corresponding part-of-speech.
// Coverage is approximate: it'll miss informal references and
// occasionally mis-tag (the README admits the trade-off in plain text).
// Acceptable v1 — better than nothing for entity-aware voice queries.
// See DECISIONS.md 2026-05-13 "News entity extraction via compromise"
// for why we landed here (and why wink-nlp's built-in NER, which the
// task spec initially named, didn't fit — it only ships DATE / TIME /
// MONEY / etc., not PERSON / ORG / LOC).
//
// Lifecycle: compromise has no separate model file — its lexicon and
// tagger ship with the module and are warm after the first require().
// No per-article init.

// compromise occasionally returns matches with trailing sentence
// punctuation or possessive 's stuck on the surface form. Strip those
// before storing so "Apple", "Apple's", and "Apple." all hash to the
// same canonical name.
function cleanSurface(raw: string): string {
  return raw
    .replace(/^\s+|\s+$/g, '')
    .replace(/^[\s.,;:!?'"()[\]]+/g, '')
    .replace(/[\s.,;:!?'"()[\]]+$/g, '')
    .replace(/['’]s$/i, '')
    .trim()
}

// Single article extraction. Empty or trivially-short input returns []
// without invoking compromise — there's nothing useful to extract from
// "" or " " and we'd rather not pay the parse cost. Any throw inside
// compromise (it's third-party; the lite-eng model is permissive but
// can in theory blow up on pathological input) is swallowed and the
// article gets zero entities; ingestion never fails because of NER.
export function extractEntities(title: string, summary: string): Entity[] {
  const text = `${title}. ${summary}`.trim()
  if (text.length < 2) return []

  let people: string[]
  let places: string[]
  let orgs: string[]
  try {
    const doc = nlp(text)
    people = doc.people().out('array') as string[]
    places = doc.places().out('array') as string[]
    orgs = doc.organizations().out('array') as string[]
  } catch {
    return []
  }

  // Aggregate by case-insensitive name. First-seen kind wins; later
  // occurrences in any kind only increment mentions. Iteration order is
  // person → place → organization so a name that appears across kinds
  // ends up tagged with whichever compromise saw first in that order.
  // That collapsing is required by the storage PRIMARY KEY (article_id,
  // entity_name) — see DECISIONS.md note on within-article name
  // collisions.
  const map = new Map<string, Entity>()

  const ingestOne = (rawSurface: string, kind: EntityKind): void => {
    const name = cleanSurface(rawSurface)
    if (name.length === 0) return
    // Drop trivially-short surfaces (single letters left after
    // stripping). compromise rarely returns these but defensively
    // skip — a one-letter "A" entity isn't useful for search.
    if (name.length < 2) return
    const key = name.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      existing.mentions += 1
    } else {
      map.set(key, { name, kind, mentions: 1 })
    }
  }

  const ingest = (rawSurface: string, kind: EntityKind): void => {
    // For places, compromise sometimes returns a city/state pair as a
    // single match ("Cupertino, California"). Split on commas so each
    // segment becomes its own searchable entity — a user asking "what's
    // the latest on California" should match.
    if (kind === 'place' && rawSurface.includes(',')) {
      for (const seg of rawSurface.split(',')) ingestOne(seg, kind)
    } else {
      ingestOne(rawSurface, kind)
    }
  }

  for (const p of people) ingest(p, 'person')
  for (const p of places) ingest(p, 'place')
  for (const o of orgs) ingest(o, 'organization')

  return Array.from(map.values())
}

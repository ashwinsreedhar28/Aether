// Gap issue format + dedup key (#255 item 3 and the #255 Architect rulings).
// Pure functions only: everything here is unit-testable without a token.
//
// A gap issue is a RECORD, not a contract: the body carries the verbatim
// triggering utterance and failure context, never spec content. The
// machine-readable capability-key marker in the body is what dedup matches
// on — the prose around it is for humans.

export const GAP_LABEL = 'gap'

// Field bounds. utterance mirrors the intents TEXT_MAX it replaces; summary
// is capped so `gap(<area>): <summary>` stays under GitHub's 256-char title
// limit at max area length.
export const AREA_MAX = 60
export const SUMMARY_MAX = 180
export const UTTERANCE_MAX = 2000
export const FAILURE_MAX = 2000
export const SESSION_ID_MAX = 100
export const CAPABILITY_KEY_RAW_MAX = 120
const KEY_NORMALIZED_MAX = 80

// `<!-- aether:gap-key:email-reading -->` — invisible in GitHub's rendered
// markdown, exact-matched (never fuzzy) by dedup.
const KEY_MARKER_RE = /<!--\s*aether:gap-key:([a-z0-9-]+)\s*-->/

/** Lowercase, fold to ascii-ish, collapse runs of non-alphanumerics to single
 *  hyphens, trim hyphens, cap length. Returns '' when nothing survives —
 *  callers must treat that as an invalid key, not a wildcard. */
export function normalizeCapabilityKey(raw: string): string {
  const key = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return key.slice(0, KEY_NORMALIZED_MAX).replace(/-+$/, '')
}

/** Default key when the caller supplies none: area + summary, normalized.
 *  Lane C should pass an explicit capability_key when raven can name the
 *  capability more stably than the summary wording. */
export function deriveCapabilityKey(area: string, summary: string): string {
  return normalizeCapabilityKey(`${area} ${summary}`)
}

export function buildGapTitle(area: string, summary: string): string {
  return `gap(${area}): ${summary}`
}

export function keyMarker(key: string): string {
  return `<!-- aether:gap-key:${key} -->`
}

export function extractCapabilityKey(body: string | null | undefined): string | null {
  if (!body) return null
  const match = KEY_MARKER_RE.exec(body)
  return match?.[1] ?? null
}

export interface GapFields {
  utterance: string
  failure: string | null
  sessionId: string | null
  key: string
  filedAt: Date
}

export function buildGapBody(fields: GapFields): string {
  const quoted = fields.utterance
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return [
    '**Utterance (verbatim):**',
    '',
    quoted,
    '',
    `**Attempted path / failure:** ${fields.failure ?? '—'}`,
    `**Session:** ${fields.sessionId ?? '—'}`,
    `**Filed:** ${fields.filedAt.toISOString()}`,
    '',
    // Lowercase "architect spec" on purpose: the raven-core spec guard
    // matches the all-caps marker, and a gap body must never carry it.
    '_A gap RECORD, not a contract — no implementer starts from this issue until an architect spec lands on it._',
    '',
    keyMarker(fields.key),
  ].join('\n')
}

/** The "+1 demand signal": a repeat ask comments the existing issue. */
export function buildDedupComment(fields: {
  utterance: string
  sessionId: string | null
  at: Date
}): string {
  const quoted = fields.utterance
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return [
    'asked again:',
    '',
    quoted,
    '',
    `**Session:** ${fields.sessionId ?? '—'} · **Filed:** ${fields.at.toISOString()}`,
  ].join('\n')
}

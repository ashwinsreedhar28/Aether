import { describe, it, expect } from 'vitest'
import {
  buildDedupComment,
  buildGapBody,
  buildGapTitle,
  deriveCapabilityKey,
  extractCapabilityKey,
  keyMarker,
  normalizeCapabilityKey,
} from '../src/gap'

describe('normalizeCapabilityKey', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(normalizeCapabilityKey('Email  Reading!')).toBe('email-reading')
    expect(normalizeCapabilityKey('set a timer; no timer surface')).toBe(
      'set-a-timer-no-timer-surface',
    )
  })

  it('trims leading/trailing separators', () => {
    expect(normalizeCapabilityKey('--email--')).toBe('email')
    expect(normalizeCapabilityKey('  spaced out  ')).toBe('spaced-out')
  })

  it('returns empty string when nothing survives', () => {
    expect(normalizeCapabilityKey('!!! ???')).toBe('')
    expect(normalizeCapabilityKey('')).toBe('')
  })

  it('caps length without a trailing hyphen', () => {
    const key = normalizeCapabilityKey(`${'a'.repeat(79)} b c d`)
    expect(key.length).toBeLessThanOrEqual(80)
    expect(key.endsWith('-')).toBe(false)
  })
})

describe('deriveCapabilityKey / buildGapTitle', () => {
  it('derives from area + summary', () => {
    expect(deriveCapabilityKey('email', 'no mail-reading surface')).toBe(
      'email-no-mail-reading-surface',
    )
  })

  it('builds the gap(<area>): <summary> title', () => {
    expect(buildGapTitle('email', 'no mail-reading surface')).toBe(
      'gap(email): no mail-reading surface',
    )
  })
})

describe('buildGapBody / extractCapabilityKey', () => {
  const filedAt = new Date('2026-06-10T12:00:00.000Z')

  it('carries the verbatim utterance, metadata, and a recoverable key marker', () => {
    const body = buildGapBody({
      utterance: 'read me my email',
      failure: 'no mail-reading surface',
      sessionId: 'sess-42',
      key: 'email-reading',
      filedAt,
    })
    expect(body).toContain('> read me my email')
    expect(body).toContain('no mail-reading surface')
    expect(body).toContain('sess-42')
    expect(body).toContain('2026-06-10T12:00:00.000Z')
    expect(body).toContain('RECORD, not a contract')
    expect(extractCapabilityKey(body)).toBe('email-reading')
  })

  it('blockquotes multi-line utterances line by line', () => {
    const body = buildGapBody({
      utterance: 'line one\nline two',
      failure: null,
      sessionId: null,
      key: 'k',
      filedAt,
    })
    expect(body).toContain('> line one\n> line two')
    expect(body).toContain('**Attempted path / failure:** —')
    expect(body).toContain('**Session:** —')
  })

  it('extractCapabilityKey returns null for absent/markerless bodies', () => {
    expect(extractCapabilityKey(null)).toBeNull()
    expect(extractCapabilityKey(undefined)).toBeNull()
    expect(extractCapabilityKey('no marker here')).toBeNull()
  })

  it('keyMarker round-trips through extraction with whitespace slack', () => {
    expect(extractCapabilityKey(keyMarker('a-b-c'))).toBe('a-b-c')
    expect(extractCapabilityKey('<!--  aether:gap-key:x-y  -->')).toBe('x-y')
  })
})

describe('buildDedupComment', () => {
  it('quotes the new utterance and stamps session + time', () => {
    const comment = buildDedupComment({
      utterance: 'read my email please',
      sessionId: 'sess-7',
      at: new Date('2026-06-10T13:00:00.000Z'),
    })
    expect(comment).toContain('asked again:')
    expect(comment).toContain('> read my email please')
    expect(comment).toContain('sess-7')
    expect(comment).toContain('2026-06-10T13:00:00.000Z')
  })
})

import { describe, it, expect } from 'vitest'

import { canonical, sign } from '../src/canonical'

// Regression tests for the undefined-valued-key divergence that 401'd every
// node response carrying an optional that resolved to undefined (#359).
// See decisions/2026-06-18-ts-sdk-canonical-undefined.md.
describe('canonical — undefined-valued keys', () => {
  it('omits an undefined-valued key entirely (not "key":null)', () => {
    const out = canonical({ a: 1, b: undefined, c: 2 })
    expect(out).toBe('{"a":1,"c":2}')
    // The bug encoded b as null; assert it is absent in either form.
    expect(out).not.toContain('"b"')
    expect(out).not.toContain('null')
  })

  it('matches the wire-roundtrip canonical for a payload with undefined optionals', () => {
    // A finance-shaped Quote: six optionals, some undefined on Stooq-fallback
    // rows / partial Yahoo responses — the exact heaviest-hitter from the bug.
    const envelope = {
      id: 'inv-1',
      correlation_id: 'corr-1',
      from: 'finance',
      to: 'core',
      kind: 'response' as const,
      payload: {
        symbol: 'AAPL',
        price: 295.95,
        pe_ratio: undefined,
        market_cap: undefined,
        day_high: 297.1,
        day_low: undefined,
        volume: 1234567,
        dividend_yield: undefined,
      },
      timestamp: '2026-06-18T00:00:00Z',
    }
    // The receiver (Core) re-canonicalizes what it parses off the wire, i.e.
    // JSON.parse(JSON.stringify(envelope)). canonical() over the original
    // object MUST agree with canonical() over that roundtripped object.
    const roundtripped = JSON.parse(JSON.stringify(envelope))
    expect(canonical(envelope)).toBe(canonical(roundtripped))
  })

  it('produces a signature that survives the wire roundtrip', () => {
    const secret = 'test-secret'
    const envelope = {
      id: 'inv-2',
      from: 'finance',
      to: 'core',
      payload: { symbol: 'MSFT', price: 410.2, pe_ratio: undefined },
      timestamp: '2026-06-18T00:00:01Z',
    }
    const roundtripped = JSON.parse(JSON.stringify(envelope))
    expect(sign(envelope, secret)).toBe(sign(roundtripped, secret))
  })

  it('still emits [null] for an undefined array element (array behavior unchanged)', () => {
    expect(canonical({ xs: [1, undefined, 3] })).toBe('{"xs":[1,null,3]}')
  })
})

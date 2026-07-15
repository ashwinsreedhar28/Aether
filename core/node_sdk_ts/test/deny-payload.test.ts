import { describe, it, expect } from 'vitest'

import { MeshDeny, denyPayload, canonical } from '../src'

// Wire-shape tests for the MeshDeny error payload (#371). The SDK used to
// build { reason: deny.reason, ...details }, so any `reason` key inside
// details clobbered the deny name on the wire — research hit it live in
// #366's harness (fixed for that node at fea4f49); this pins the SDK-level
// fix so the deny name ALWAYS wins.
//
// PARITY PIN: core/node_sdk/test_deny_payload.py builds the same fixture and
// asserts this exact canonical string. Keep the two literals identical.
const PARITY_CANONICAL = '{"code":7,"detail":"human-readable cause","reason":"example_denied"}'

function collidingDeny(): MeshDeny {
  return new MeshDeny('example_denied', {
    detail: 'human-readable cause',
    code: 7,
    reason: 'clobber', // must never reach the wire
  })
}

describe('denyPayload — deny name wins the reason key', () => {
  it('keeps the deny name when details carries a colliding reason key', () => {
    const payload = denyPayload(collidingDeny())
    expect(payload.reason).toBe('example_denied')
    expect(payload.detail).toBe('human-readable cause')
    expect(payload.code).toBe(7)
  })

  it('pins the canonical wire shape (parity with the Python SDK test)', () => {
    expect(canonical(denyPayload(collidingDeny()))).toBe(PARITY_CANONICAL)
  })

  it('spreads detail keys alongside the deny name for a collision-free deny', () => {
    const deny = new MeshDeny('finance_untracked_symbol', { symbol: 'ZZZZ' })
    expect(denyPayload(deny)).toEqual({ symbol: 'ZZZZ', reason: 'finance_untracked_symbol' })
  })
})

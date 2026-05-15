import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCache, readCache, cachePath, CACHE_VERSION, CACHE_MAX_AGE_MS } from '../src/cache'
import type { CacheEntrySerialized } from '../src/cache'
import type { Quote } from '../src/types'

function makeQuote(symbol: string): Quote {
  return {
    symbol,
    price: 150.0,
    change: 1.5,
    change_percent: 1.0,
    volume: 1_000_000,
    latest_trading_day: '2026-05-15',
    fetched_at: new Date().toISOString(),
  }
}

function makeEntry(symbol: string): CacheEntrySerialized {
  return { quote: makeQuote(symbol), fetchedAtMs: Date.now() }
}

describe('writeCache / readCache', () => {
  let nodeDir: string
  const logs: string[] = []
  const log = (msg: string): void => { logs.push(msg) }

  beforeEach(() => {
    nodeDir = join(tmpdir(), `aether-cache-test-${process.pid}-${Date.now()}`)
    mkdirSync(nodeDir, { recursive: true })
    logs.length = 0
  })

  afterEach(() => {
    rmSync(nodeDir, { recursive: true, force: true })
  })

  it('round-trips entries through write then read', () => {
    const entries = [makeEntry('AAPL'), makeEntry('MSFT'), makeEntry('SPY')]
    writeCache(nodeDir, entries, log)
    const loaded = readCache(nodeDir, log)
    expect(loaded).not.toBeNull()
    expect(loaded!.data).toHaveLength(3)
    const symbols = loaded!.data.map((e) => e.quote.symbol)
    expect(symbols).toEqual(expect.arrayContaining(['AAPL', 'MSFT', 'SPY']))
    expect(typeof loaded!.timestamp).toBe('number')
    expect(Number.isFinite(loaded!.timestamp)).toBe(true)
    // Log should confirm persist then load
    expect(logs.some((l) => l.includes('cache persisted'))).toBe(true)
    expect(logs.some((l) => l.includes('loaded cached data'))).toBe(true)
  })

  it('round-trips an empty entry list', () => {
    writeCache(nodeDir, [], log)
    const loaded = readCache(nodeDir, log)
    expect(loaded).not.toBeNull()
    expect(loaded!.data).toHaveLength(0)
  })

  it('returns null and logs ENOENT when cache file is absent', () => {
    const loaded = readCache(nodeDir, log)
    expect(loaded).toBeNull()
    expect(logs.some((l) => l.includes('no cache found'))).toBe(true)
  })

  it('returns null when cache file contains invalid JSON', () => {
    writeFileSync(cachePath(nodeDir), 'not-valid-json', 'utf8')
    const loaded = readCache(nodeDir, log)
    expect(loaded).toBeNull()
    expect(logs.some((l) => l.includes('cache parse failed'))).toBe(true)
  })

  it('returns null when envelope is missing written_at', () => {
    const bad = JSON.stringify({ version: CACHE_VERSION, data: [] })
    writeFileSync(cachePath(nodeDir), bad, 'utf8')
    const loaded = readCache(nodeDir, log)
    expect(loaded).toBeNull()
    expect(logs.some((l) => l.includes('malformed envelope'))).toBe(true)
  })

  it('returns null when envelope version is not 1', () => {
    const bad = JSON.stringify({
      version: 99,
      written_at: new Date().toISOString(),
      data: [],
    })
    writeFileSync(cachePath(nodeDir), bad, 'utf8')
    const loaded = readCache(nodeDir, log)
    expect(loaded).toBeNull()
  })

  it('returns null when cache age exceeds maxAgeMs (stale detection)', () => {
    writeCache(nodeDir, [makeEntry('AAPL')], log)
    // Simulate reading 7 hours later — past the 6-hour TTL ceiling.
    const futureNow = Date.now() + 7 * 60 * 60 * 1000
    const loaded = readCache(nodeDir, log, CACHE_MAX_AGE_MS, futureNow)
    expect(loaded).toBeNull()
    expect(logs.some((l) => l.includes('too old'))).toBe(true)
  })

  it('returns data when cache is within a custom maxAgeMs', () => {
    writeCache(nodeDir, [makeEntry('AAPL')], log)
    // 1-minute TTL, but now is right after write — should still be fresh.
    const loaded = readCache(nodeDir, log, 60_000, Date.now())
    expect(loaded).not.toBeNull()
    expect(loaded!.data).toHaveLength(1)
  })

  it('overwrites the previous cache file on a second write', () => {
    writeCache(nodeDir, [makeEntry('AAPL')], log)
    writeCache(nodeDir, [makeEntry('MSFT'), makeEntry('GOOG')], log)
    const loaded = readCache(nodeDir, log)
    expect(loaded).not.toBeNull()
    expect(loaded!.data).toHaveLength(2)
    expect(loaded!.data.map((e) => e.quote.symbol)).toEqual(
      expect.arrayContaining(['MSFT', 'GOOG']),
    )
  })
})

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

import { SpotifyAuth } from '../src/auth'
import { SpotifyClient, type PlaybackState, type Track } from '../src/spotify'
import { NowPlayingPoller } from '../src/nowPlaying'
import {
  makeNowPlayingHandler,
  makePauseHandler,
  makePlayHandler,
  makeQueueHandler,
  makeSearchHandler,
  makeSkipHandler,
  type PlayerClient,
} from '../src/handlers'

const envelope = (payload: Record<string, unknown> = {}): Envelope =>
  ({ payload }) as unknown as Envelope

const aTrack = (over: Partial<Track> = {}): Track => ({
  name: 'So What',
  artist: 'Miles Davis',
  album: 'Kind of Blue',
  uri: 'spotify:track:abc123',
  duration_ms: 545_000,
  ...over,
})

function fakeClient(over: Partial<PlayerClient> = {}): PlayerClient & {
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  const record =
    <T>(method: string, result: T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push({ method, args })
      return Promise.resolve(result)
    }
  return {
    calls,
    playbackState: record('playbackState', null as PlaybackState | null),
    play: record('play', undefined),
    pause: record('pause', undefined),
    skip: record('skip', undefined),
    queue: record('queue', undefined),
    searchTracks: record('searchTracks', [aTrack()]),
    ...over,
  }
}

// Poller with timers effectively disabled (huge pollMs) — tests drive
// observe() directly; arm() only flips internal state.
function quietPoller(over: Partial<ConstructorParameters<typeof NowPlayingPoller>[0]> = {}) {
  return new NowPlayingPoller({
    fetchState: () => Promise.resolve(null),
    onTrackChange: () => {},
    log: () => {},
    pollMs: 10_000_000,
    ...over,
  })
}

const pollers: NowPlayingPoller[] = []
const track = (p: NowPlayingPoller): NowPlayingPoller => {
  pollers.push(p)
  return p
}

afterEach(() => {
  for (const p of pollers.splice(0)) p.stop()
  vi.unstubAllGlobals()
})

function deps(client: PlayerClient, poller?: NowPlayingPoller) {
  return { client, poller: poller ?? track(quietPoller()), log: () => {} }
}

describe('music.play', () => {
  it('plays a spotify uri directly (no search)', async () => {
    const client = fakeClient()
    const res = await makePlayHandler(deps(client))(envelope({ uri: 'spotify:track:xyz' }))
    expect(res).toMatchObject({ ok: true, played: 'spotify:track:xyz' })
    expect(client.calls.map((c) => c.method)).toEqual(['play'])
  })

  it('normalizes an open.spotify.com link', async () => {
    const client = fakeClient()
    const res = await makePlayHandler(deps(client))(
      envelope({ uri: 'https://open.spotify.com/album/40uPnt8lt0F1WeJJZarfVF?si=x' }),
    )
    expect(res.played).toBe('spotify:album:40uPnt8lt0F1WeJJZarfVF')
  })

  it('denies music_bad_uri on garbage', async () => {
    await expect(
      makePlayHandler(deps(fakeClient()))(envelope({ uri: 'not-a-uri' })),
    ).rejects.toMatchObject({ reason: 'music_bad_uri' })
  })

  it('resolves a query via search and echoes the match', async () => {
    const client = fakeClient()
    const res = await makePlayHandler(deps(client))(envelope({ query: 'so what' }))
    expect(res).toMatchObject({
      ok: true,
      played: 'spotify:track:abc123',
      track: { name: 'So What', artist: 'Miles Davis', uri: 'spotify:track:abc123' },
    })
    expect(client.calls[0]).toMatchObject({ method: 'searchTracks', args: ['so what', 1, true] })
  })

  it('denies music_no_match when search finds nothing', async () => {
    const client = fakeClient({ searchTracks: () => Promise.resolve([]) })
    await expect(
      makePlayHandler(deps(client))(envelope({ query: 'zzz' })),
    ).rejects.toMatchObject({ reason: 'music_no_match' })
  })

  it('denies music_bad_args when neither query nor uri given', async () => {
    await expect(makePlayHandler(deps(fakeClient()))(envelope())).rejects.toMatchObject({
      reason: 'music_bad_args',
    })
  })
})

describe('music.pause / music.skip / music.queue', () => {
  it('pause issues the player command', async () => {
    const client = fakeClient()
    const res = await makePauseHandler(deps(client))(envelope())
    expect(res).toEqual({ ok: true, paused: true })
    expect(client.calls[0]?.method).toBe('pause')
  })

  it('skip defaults to next and validates direction', async () => {
    const client = fakeClient()
    const res = await makeSkipHandler(deps(client))(envelope())
    expect(res).toEqual({ ok: true, direction: 'next' })
    expect(client.calls[0]).toMatchObject({ method: 'skip', args: ['next', true] })
    await makeSkipHandler(deps(client))(envelope({ direction: 'prev' }))
    expect(client.calls[1]?.args[0]).toBe('prev')
    await expect(
      makeSkipHandler(deps(client))(envelope({ direction: 'sideways' })),
    ).rejects.toMatchObject({ reason: 'music_bad_direction' })
  })

  it('queue resolves a query then appends', async () => {
    const client = fakeClient()
    const res = await makeQueueHandler(deps(client))(envelope({ query: 'so what' }))
    expect(res).toMatchObject({ ok: true, queued: 'spotify:track:abc123' })
    expect(client.calls.map((c) => c.method)).toEqual(['searchTracks', 'queue'])
  })
})

describe('music.search', () => {
  it('requires a query', async () => {
    await expect(makeSearchHandler(deps(fakeClient()))(envelope())).rejects.toMatchObject({
      reason: 'music_bad_query',
    })
  })

  it('shapes tracks as name/artist/uri and clamps limit', async () => {
    const client = fakeClient()
    const res = await makeSearchHandler(deps(client))(envelope({ query: 'miles', limit: 99 }))
    expect(res.tracks).toEqual([
      { name: 'So What', artist: 'Miles Davis', uri: 'spotify:track:abc123' },
    ])
    expect(client.calls[0]).toMatchObject({ method: 'searchTracks', args: ['miles', 20, true] })
  })
})

describe('music.now_playing', () => {
  const playing = (uri: string): PlaybackState => ({
    is_playing: true,
    progress_ms: 1234,
    track: aTrack({ uri }),
  })

  it('serves a fresh snapshot from cache without touching the API', async () => {
    const client = fakeClient()
    let nowMs = 1_000_000
    const poller = track(quietPoller({ now: () => nowMs }))
    poller.observe(playing('spotify:track:abc123'))
    nowMs += 1_000
    const res = await makeNowPlayingHandler(deps(client, poller))(envelope())
    expect(res).toMatchObject({ is_playing: true, source: 'cache', position_ms: 1234 })
    expect(client.calls).toEqual([])
  })

  it('does a live (non-interactive) read when the snapshot is stale or absent', async () => {
    const client = fakeClient({
      playbackState: (interactive: boolean) => {
        expect(interactive).toBe(false)
        return Promise.resolve(playing('spotify:track:abc123'))
      },
    })
    const res = await makeNowPlayingHandler(deps(client))(envelope())
    expect(res).toMatchObject({ is_playing: true, source: 'live' })
    expect((res.track as { album: string }).album).toBe('Kind of Blue')
  })

  it('reports idle state as is_playing false, track null', async () => {
    const client = fakeClient({ playbackState: () => Promise.resolve(null) })
    const res = await makeNowPlayingHandler(deps(client))(envelope())
    expect(res).toMatchObject({ is_playing: false, track: null, source: 'live' })
  })
})

describe('NowPlayingPoller change events', () => {
  it('emits on an observed track change, never on first sight', () => {
    const changes: string[] = []
    const poller = track(
      quietPoller({ onTrackChange: (t) => changes.push(t.uri) }),
    )
    const state = (uri: string | null, isPlaying = true): PlaybackState | null =>
      uri === null ? null : { is_playing: isPlaying, progress_ms: 0, track: aTrack({ uri }) }
    poller.observe(state('spotify:track:one'))
    expect(changes).toEqual([])
    poller.observe(state('spotify:track:one'))
    expect(changes).toEqual([])
    poller.observe(state('spotify:track:two'))
    expect(changes).toEqual(['spotify:track:two'])
    poller.observe(state(null))
    poller.observe(state('spotify:track:three'))
    expect(changes).toEqual(['spotify:track:two', 'spotify:track:three'])
  })
})

describe('SpotifyAuth named refusals', () => {
  const tmp = (): string => mkdtempSync(join(tmpdir(), 'music-auth-'))

  it('denies music_no_client_id when SPOTIFY_CLIENT_ID is unset', async () => {
    const dir = tmp()
    const auth = new SpotifyAuth({ clientId: null, cacheDir: dir, log: () => {} })
    await expect(auth.getAccessToken({ interactive: true })).rejects.toMatchObject({
      reason: 'music_no_client_id',
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('denies music_not_authenticated on the non-interactive path with no cache', async () => {
    const dir = tmp()
    const auth = new SpotifyAuth({ clientId: 'cid', cacheDir: dir, log: () => {} })
    expect(auth.hasCachedToken()).toBe(false)
    await expect(auth.getAccessToken({ interactive: false })).rejects.toMatchObject({
      reason: 'music_not_authenticated',
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('refreshes from the cache, rotates the stored refresh token, keeps 0600', async () => {
    const dir = tmp()
    const cachePath = join(dir, 'spotify_tokens.json')
    writeFileSync(cachePath, JSON.stringify({ refresh_token: 'old-rt' }), { mode: 0o600 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const form = String(init?.body)
        expect(form).toContain('grant_type=refresh_token')
        expect(form).toContain('refresh_token=old-rt')
        return new Response(
          JSON.stringify({ access_token: 'at-1', expires_in: 3600, refresh_token: 'new-rt' }),
          { status: 200 },
        )
      }),
    )
    const auth = new SpotifyAuth({ clientId: 'cid', cacheDir: dir, log: () => {} })
    expect(auth.hasCachedToken()).toBe(true)
    await expect(auth.getAccessToken({ interactive: false })).resolves.toBe('at-1')
    const stored = JSON.parse(readFileSync(cachePath, 'utf8')) as { refresh_token: string }
    expect(stored.refresh_token).toBe('new-rt')
    expect(statSync(cachePath).mode & 0o777).toBe(0o600)
    rmSync(dir, { recursive: true, force: true })
  })

  it('drops a revoked cache and denies music_token_revoked', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'spotify_tokens.json'), JSON.stringify({ refresh_token: 'dead' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    )
    const auth = new SpotifyAuth({ clientId: 'cid', cacheDir: dir, log: () => {} })
    await expect(auth.getAccessToken({ interactive: false })).rejects.toMatchObject({
      reason: 'music_token_revoked',
    })
    expect(auth.hasCachedToken()).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('SpotifyClient error mapping', () => {
  const client = () =>
    new SpotifyClient({
      getToken: async () => 'tok',
      log: () => {},
    })

  it('maps a player 404 to the named no-active-device deny', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE', message: 'Player command failed' } }),
            { status: 404 },
          ),
      ),
    )
    const err = await client()
      .play('spotify:track:abc', true)
      .then(
        () => null,
        (e: MeshDeny) => e,
      )
    expect(err?.reason).toBe('music_no_active_device')
    expect(err?.details.message).toBe('no active Spotify device')
  })

  it('retries exactly once on 401 with a forced refresh', async () => {
    const tokenAsks: { interactive: boolean; forceRefresh?: boolean }[] = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const c = new SpotifyClient({
      getToken: async (opts) => {
        tokenAsks.push(opts)
        return 'tok'
      },
      log: () => {},
    })
    await c.pause(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tokenAsks).toEqual([
      { interactive: true, forceRefresh: false },
      { interactive: true, forceRefresh: true },
    ])
  })

  it('maps 429 to music_rate_limited with retry_after_s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })),
    )
    await expect(client().searchTracks('x', 5, false)).rejects.toMatchObject({
      reason: 'music_rate_limited',
      details: { retry_after_s: 7 },
    })
  })

  it('parses playback state and returns null on 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              is_playing: true,
              progress_ms: 42,
              item: {
                name: 'So What',
                uri: 'spotify:track:abc123',
                duration_ms: 545000,
                album: { name: 'Kind of Blue' },
                artists: [{ name: 'Miles' }, { name: 'Davis' }],
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    )
    const c = client()
    const state = await c.playbackState(false)
    expect(state).toEqual({
      is_playing: true,
      progress_ms: 42,
      track: {
        name: 'So What',
        artist: 'Miles, Davis',
        album: 'Kind of Blue',
        uri: 'spotify:track:abc123',
        duration_ms: 545000,
      },
    })
    expect(await c.playbackState(false)).toBeNull()
  })
})

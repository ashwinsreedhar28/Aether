import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

import { SpotifyAuth } from '../src/auth'
import {
  SpotifyClient,
  type PlaybackState,
  type PlayedTrack,
  type Playlist,
  type Track,
} from '../src/spotify'
import { NowPlayingPoller } from '../src/nowPlaying'
import {
  makeNowPlayingHandler,
  makePauseHandler,
  makePlayHandler,
  makePlaylistsHandler,
  makeQueueHandler,
  makeRecentlyPlayedHandler,
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

const aPlaylist = (over: Partial<Playlist> = {}): Playlist => ({
  name: 'Jazz Classics',
  uri: 'spotify:playlist:pl1',
  track_count: 42,
  ...over,
})

const aPlayedTrack = (over: Partial<PlayedTrack> = {}): PlayedTrack => ({
  name: 'Blue in Green',
  artist: 'Miles Davis',
  uri: 'spotify:track:big1',
  played_at: '2026-06-11T10:00:00.000Z',
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
    resume: record('resume', undefined),
    pause: record('pause', undefined),
    skip: record('skip', undefined),
    queue: record('queue', undefined),
    searchTracks: record('searchTracks', [aTrack()]),
    playlists: record('playlists', { playlists: [aPlaylist()], total: 1 }),
    recentlyPlayed: record('recentlyPlayed', [aPlayedTrack()]),
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

  it('resumes (bodyless play) when neither query nor uri given', async () => {
    const client = fakeClient()
    const res = await makePlayHandler(deps(client))(envelope())
    expect(res).toEqual({ ok: true, resumed: true })
    expect(client.calls.map((c) => c.method)).toEqual(['resume'])
  })

  it('treats an empty-string query as resume too', async () => {
    const client = fakeClient()
    const res = await makePlayHandler(deps(client))(envelope({ query: '  ' }))
    expect(res).toEqual({ ok: true, resumed: true })
    expect(client.calls.map((c) => c.method)).toEqual(['resume'])
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

  it('queue still denies music_bad_args when neither query nor uri given', async () => {
    await expect(makeQueueHandler(deps(fakeClient()))(envelope())).rejects.toMatchObject({
      reason: 'music_bad_args',
    })
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

describe('music.playlists / music.recently_played', () => {
  it('playlists shapes { playlists, total } and asks interactively', async () => {
    const client = fakeClient({
      playlists: (interactive: boolean) => {
        expect(interactive).toBe(true)
        return Promise.resolve({
          playlists: [aPlaylist(), aPlaylist({ name: 'Focus', uri: 'spotify:playlist:pl2' })],
          total: 14,
        })
      },
    })
    const res = await makePlaylistsHandler(deps(client))()
    expect(res).toMatchObject({
      ok: true,
      total: 14,
      playlists: [
        { name: 'Jazz Classics', uri: 'spotify:playlist:pl1', track_count: 42 },
        { name: 'Focus', uri: 'spotify:playlist:pl2', track_count: 42 },
      ],
    })
    expect(typeof res.fetched_at_ms).toBe('number')
  })

  it('recently_played defaults to limit 10 and shapes the history', async () => {
    const client = fakeClient()
    const res = await makeRecentlyPlayedHandler(deps(client))(envelope())
    expect(res).toMatchObject({
      ok: true,
      tracks: [
        {
          name: 'Blue in Green',
          artist: 'Miles Davis',
          uri: 'spotify:track:big1',
          played_at: '2026-06-11T10:00:00.000Z',
        },
      ],
    })
    expect(client.calls[0]).toMatchObject({ method: 'recentlyPlayed', args: [10, true] })
  })

  it('recently_played clamps limit to 1-50', async () => {
    const client = fakeClient()
    await makeRecentlyPlayedHandler(deps(client))(envelope({ limit: 99 }))
    expect(client.calls[0]?.args[0]).toBe(50)
    await makeRecentlyPlayedHandler(deps(client))(envelope({ limit: 0 }))
    expect(client.calls[1]?.args[0]).toBe(1)
  })
})

describe('music.now_playing', () => {
  const playing = (uri: string): PlaybackState => ({
    is_playing: true,
    progress_ms: 1234,
    track: aTrack({ uri }),
    album_art_url: 'https://i.scdn.co/image/large',
  })

  it('serves a fresh snapshot from cache without touching the API', async () => {
    const client = fakeClient()
    let nowMs = 1_000_000
    const poller = track(quietPoller({ now: () => nowMs }))
    poller.observe(playing('spotify:track:abc123'))
    nowMs += 1_000
    const res = await makeNowPlayingHandler(deps(client, poller))(envelope())
    expect(res).toMatchObject({
      is_playing: true,
      source: 'cache',
      position_ms: 1234,
      album_art_url: 'https://i.scdn.co/image/large',
    })
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
    expect(res).toMatchObject({
      is_playing: true,
      source: 'live',
      album_art_url: 'https://i.scdn.co/image/large',
    })
    expect((res.track as { album: string }).album).toBe('Kind of Blue')
  })

  it('reports idle state as is_playing false, track null, art null', async () => {
    const client = fakeClient({ playbackState: () => Promise.resolve(null) })
    const res = await makeNowPlayingHandler(deps(client))(envelope())
    expect(res).toMatchObject({
      is_playing: false,
      track: null,
      album_art_url: null,
      source: 'live',
    })
  })
})

describe('NowPlayingPoller change events', () => {
  it('emits on an observed track change, never on first sight', () => {
    const changes: string[] = []
    const poller = track(
      quietPoller({ onTrackChange: (t) => changes.push(t.uri) }),
    )
    const state = (uri: string | null, isPlaying = true): PlaybackState | null =>
      uri === null
        ? null
        : { is_playing: isPlaying, progress_ms: 0, track: aTrack({ uri }), album_art_url: null }
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

  it('parses playback state (largest album image wins) and returns null on 204', async () => {
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
                album: {
                  name: 'Kind of Blue',
                  images: [
                    { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
                    { url: 'https://i.scdn.co/image/large', width: 640, height: 640 },
                    { url: 'https://i.scdn.co/image/medium', width: 300, height: 300 },
                  ],
                },
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
      album_art_url: 'https://i.scdn.co/image/large',
    })
    expect(await c.playbackState(false)).toBeNull()
  })

  it('album_art_url is null when the album carries no images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              is_playing: true,
              progress_ms: 1,
              item: {
                name: 'So What',
                uri: 'spotify:track:abc123',
                duration_ms: 545000,
                album: { name: 'Kind of Blue' },
                artists: [{ name: 'Miles Davis' }],
              },
            }),
            { status: 200 },
          ),
      ),
    )
    const state = await client().playbackState(false)
    expect(state?.album_art_url).toBeNull()
  })

  it('plays a playlist uri as context_uri, not uris (#334 spec check)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await client().play('spotify:playlist:37i9dQZF1DXbITWG1ZJKYt', true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.spotify.com/v1/me/player/play')
    expect(JSON.parse(String(init.body))).toEqual({
      context_uri: 'spotify:playlist:37i9dQZF1DXbITWG1ZJKYt',
    })
  })

  it('parses playlists (drops uri-less items, keeps the account-wide total)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { name: 'Jazz Classics', uri: 'spotify:playlist:pl1', tracks: { total: 42 } },
                { name: 'broken', tracks: { total: 3 } },
                { name: 'Focus', uri: 'spotify:playlist:pl2', tracks: null },
              ],
              total: 14,
            }),
            { status: 200 },
          ),
      ),
    )
    await expect(client().playlists(false)).resolves.toEqual({
      playlists: [
        { name: 'Jazz Classics', uri: 'spotify:playlist:pl1', track_count: 42 },
        { name: 'Focus', uri: 'spotify:playlist:pl2', track_count: 0 },
      ],
      total: 14,
    })
  })

  it('parses recently-played items and passes the limit through', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                track: { name: 'Blue in Green', uri: 'spotify:track:big1', artists: [{ name: 'Miles Davis' }] },
                played_at: '2026-06-11T10:00:00.000Z',
              },
              { track: null, played_at: '2026-06-11T09:00:00.000Z' },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const tracks = await client().recentlyPlayed(10, false)
    expect(tracks).toEqual([
      {
        name: 'Blue in Green',
        artist: 'Miles Davis',
        uri: 'spotify:track:big1',
        played_at: '2026-06-11T10:00:00.000Z',
      },
    ])
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.spotify.com/v1/me/player/recently-played?limit=10')
  })

  it('a recently-played 404 is NOT mapped to music_no_active_device', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'gone' } }), { status: 404 })),
    )
    await expect(client().recentlyPlayed(10, false)).rejects.toMatchObject({
      reason: 'music_api_error',
    })
  })

  it('resume issues a bodyless PUT to player/play', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await client().resume(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.spotify.com/v1/me/player/play')
    expect(init.method).toBe('PUT')
    expect(init.body).toBeUndefined()
  })
})

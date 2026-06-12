// Surface handlers for the music Actor node, factored out of index.ts so the
// unit tests (fake client/poller) drive exactly the code the mesh serves
// (github-node precedent). Auth posture per #332: the five Actor surfaces
// are interactive (a missing token cache starts the PKCE browser grant);
// now_playing is the read path and never pops a browser — it denies
// `music_not_authenticated` by name instead.

import { MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import type { PlaybackState, Track } from './spotify'
import type { NowPlayingPoller, NowPlayingSnapshot } from './nowPlaying'

/** The slice of SpotifyClient the handlers use — fakeable in tests. */
export interface PlayerClient {
  playbackState(interactive: boolean): Promise<PlaybackState | null>
  play(uri: string, interactive: boolean): Promise<void>
  pause(interactive: boolean): Promise<void>
  skip(direction: 'next' | 'prev', interactive: boolean): Promise<void>
  queue(uri: string, interactive: boolean): Promise<void>
  searchTracks(query: string, limit: number, interactive: boolean): Promise<Track[]>
}

export interface HandlerDeps {
  client: PlayerClient
  poller: NowPlayingPoller
  log: (msg: string) => void
}

const QUERY_MAX = 300
const URI_MAX = 250
const SEARCH_DEFAULT_LIMIT = 5
const SEARCH_MAX_LIMIT = 20
// A snapshot younger than one poll interval (+ scheduling slack) is current;
// anything older triggers a live read so "readable on demand" holds while
// the poller is idle.
const SNAPSHOT_FRESH_MS = 4_000

const SPOTIFY_URI_SHAPE = /^spotify:(track|album|playlist|artist|show|episode):[A-Za-z0-9]+$/
const OPEN_URL_SHAPE =
  /^https:\/\/open\.spotify\.com\/(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/

function optStr(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new MeshDeny(`music_bad_${field}`, { [field]: value })
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

/** Normalize a caller-supplied URI (spotify: form or open.spotify.com URL). */
function normalizeUri(raw: string): string {
  if (SPOTIFY_URI_SHAPE.test(raw)) return raw
  const url = OPEN_URL_SHAPE.exec(raw)
  if (url) return `spotify:${url[1]}:${url[2]}`
  throw new MeshDeny('music_bad_uri', {
    uri: raw,
    message: 'expected spotify:<type>:<id> or an open.spotify.com link',
  })
}

interface Resolved {
  uri: string
  /** Set when the URI came from a search hit, so callers can echo the match. */
  track: Track | null
}

/** uri wins when both are present; a query resolves via search, first match. */
async function resolveTarget(
  payload: { uri?: unknown; query?: unknown },
  client: PlayerClient,
  surface: string,
): Promise<Resolved> {
  const uri = optStr(payload.uri, 'uri', URI_MAX)
  const query = optStr(payload.query, 'query', QUERY_MAX)
  if (uri) return { uri: normalizeUri(uri), track: null }
  if (!query) {
    throw new MeshDeny('music_bad_args', {
      message: `${surface} needs a query string or a spotify uri`,
    })
  }
  const hits = await client.searchTracks(query, 1, true)
  const hit = hits[0]
  if (!hit) throw new MeshDeny('music_no_match', { query })
  return { uri: hit.uri, track: hit }
}

function trackEcho(track: Track): Record<string, unknown> {
  return { name: track.name, artist: track.artist, uri: track.uri }
}

export function makePlayHandler(deps: HandlerDeps) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const resolved = await resolveTarget(env.payload ?? {}, deps.client, 'music.play')
    await deps.client.play(resolved.uri, true)
    deps.poller.arm()
    deps.log(`play ${resolved.uri}`)
    return {
      ok: true,
      played: resolved.uri,
      ...(resolved.track ? { track: trackEcho(resolved.track) } : {}),
    }
  }
}

export function makePauseHandler(deps: HandlerDeps) {
  return async (): Promise<Record<string, unknown>> => {
    await deps.client.pause(true)
    // Pause means playback WAS live — arm so the poller observes the pause
    // and the 60s idle window closes it out.
    deps.poller.arm()
    deps.log('pause')
    return { ok: true, paused: true }
  }
}

export function makeSkipHandler(deps: HandlerDeps) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as { direction?: unknown }
    const direction = payload.direction === undefined ? 'next' : payload.direction
    if (direction !== 'next' && direction !== 'prev') {
      throw new MeshDeny('music_bad_direction', { direction })
    }
    await deps.client.skip(direction, true)
    deps.poller.arm()
    deps.log(`skip ${direction}`)
    return { ok: true, direction }
  }
}

export function makeQueueHandler(deps: HandlerDeps) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const resolved = await resolveTarget(env.payload ?? {}, deps.client, 'music.queue')
    await deps.client.queue(resolved.uri, true)
    deps.poller.arm()
    deps.log(`queue ${resolved.uri}`)
    return {
      ok: true,
      queued: resolved.uri,
      ...(resolved.track ? { track: trackEcho(resolved.track) } : {}),
    }
  }
}

export function makeSearchHandler(deps: HandlerDeps) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as { query?: unknown; limit?: unknown }
    const query = optStr(payload.query, 'query', QUERY_MAX)
    if (!query) throw new MeshDeny('music_bad_query', { query: payload.query })
    let limit = SEARCH_DEFAULT_LIMIT
    if (typeof payload.limit === 'number' && Number.isFinite(payload.limit)) {
      limit = Math.min(Math.max(Math.floor(payload.limit), 1), SEARCH_MAX_LIMIT)
    }
    const tracks = await deps.client.searchTracks(query, limit, true)
    deps.log(`search "${query}" → ${tracks.length} tracks`)
    return {
      ok: true,
      tracks: tracks.map(trackEcho),
      fetched_at_ms: Date.now(),
    }
  }
}

function snapshotPayload(snap: NowPlayingSnapshot, source: 'cache' | 'live'): Record<string, unknown> {
  return {
    is_playing: snap.is_playing,
    track: snap.track
      ? {
          name: snap.track.name,
          artist: snap.track.artist,
          album: snap.track.album,
          uri: snap.track.uri,
          duration_ms: snap.track.duration_ms,
        }
      : null,
    position_ms: snap.position_ms,
    fetched_at_ms: snap.fetched_at_ms,
    source,
  }
}

export function makeNowPlayingHandler(deps: HandlerDeps) {
  return async (): Promise<Record<string, unknown>> => {
    const age = deps.poller.snapshotAgeMs()
    const cached = deps.poller.snapshot()
    if (cached && age !== null && age <= SNAPSHOT_FRESH_MS) {
      return snapshotPayload(cached, 'cache')
    }
    // Idle path: one live read, never interactive. observe() re-arms the
    // poller if this reveals active playback.
    const snap = deps.poller.observe(await deps.client.playbackState(false))
    return snapshotPayload(snap, 'live')
  }
}

// Thin typed wrapper over the Spotify Web API endpoints this node uses.
// Auth is delegated to SpotifyAuth via deps.getToken; a 401 retries exactly
// once after invalidating the cached access token. Player commands against
// an empty Spotify Connect session surface the spec's named condition
// ("no active Spotify device") instead of a bare 404.

import { MeshDeny } from '@aether/mesh-node-sdk'

const API_BASE = 'https://api.spotify.com/v1'

export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SpotifyApiError'
  }
}

export interface Track {
  name: string
  artist: string
  album: string
  uri: string
  duration_ms: number
}

export interface PlaybackState {
  is_playing: boolean
  progress_ms: number | null
  track: Track | null
  /** Largest album image from the currently-playing response; null when absent. */
  album_art_url: string | null
}

interface RawImage {
  url?: string
  width?: number | null
  height?: number | null
}

interface RawTrackItem {
  name?: string
  uri?: string
  duration_ms?: number
  album?: { name?: string; images?: RawImage[] }
  artists?: { name?: string }[]
}

export interface SpotifyClientDeps {
  /** Returns a live access token; forceRefresh drops the cached one first. */
  getToken: (opts: { interactive: boolean; forceRefresh?: boolean }) => Promise<string>
  log: (msg: string) => void
}

/** Largest by area; Spotify sends dimensioned images, but missing dims rank 0
 *  (first-listed wins ties — Spotify orders largest-first). */
function largestImageUrl(images: RawImage[] | undefined): string | null {
  let bestUrl: string | null = null
  let bestArea = -1
  for (const img of images ?? []) {
    if (typeof img.url !== 'string' || img.url.length === 0) continue
    const area = (img.width ?? 0) * (img.height ?? 0)
    if (area > bestArea) {
      bestUrl = img.url
      bestArea = area
    }
  }
  return bestUrl
}

function toTrack(item: RawTrackItem | null | undefined): Track | null {
  if (!item || typeof item.uri !== 'string') return null
  return {
    name: item.name ?? '',
    artist: (item.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
    album: item.album?.name ?? '',
    uri: item.uri,
    duration_ms: item.duration_ms ?? 0,
  }
}

export class SpotifyClient {
  constructor(private readonly deps: SpotifyClientDeps) {}

  /** GET /me/player — null when Spotify reports no playback state (204). */
  async playbackState(interactive: boolean): Promise<PlaybackState | null> {
    const res = await this.request('GET', '/me/player', { interactive })
    if (res.status === 204) return null
    const body = (await res.json()) as {
      is_playing?: boolean
      progress_ms?: number | null
      item?: RawTrackItem | null
    }
    return {
      is_playing: body.is_playing === true,
      progress_ms: typeof body.progress_ms === 'number' ? body.progress_ms : null,
      track: toTrack(body.item),
      album_art_url: largestImageUrl(body.item?.album?.images),
    }
  }

  /** PUT /me/player/play — track URIs ride `uris`, context URIs ride `context_uri`. */
  async play(uri: string, interactive: boolean): Promise<void> {
    const body = uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri }
    await this.playerCommand('PUT', '/me/player/play', { interactive, body })
  }

  /** Bodyless PUT /me/player/play — resume the active device's current context. */
  async resume(interactive: boolean): Promise<void> {
    await this.playerCommand('PUT', '/me/player/play', { interactive })
  }

  async pause(interactive: boolean): Promise<void> {
    await this.playerCommand('PUT', '/me/player/pause', { interactive })
  }

  async skip(direction: 'next' | 'prev', interactive: boolean): Promise<void> {
    await this.playerCommand(
      'POST',
      direction === 'next' ? '/me/player/next' : '/me/player/previous',
      { interactive },
    )
  }

  async queue(uri: string, interactive: boolean): Promise<void> {
    await this.playerCommand('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`, {
      interactive,
    })
  }

  /** GET /search?type=track — top tracks for a free-text query. */
  async searchTracks(query: string, limit: number, interactive: boolean): Promise<Track[]> {
    const qs = new URLSearchParams({ q: query, type: 'track', limit: String(limit) })
    const res = await this.request('GET', `/search?${qs.toString()}`, { interactive })
    const body = (await res.json()) as { tracks?: { items?: RawTrackItem[] } }
    return (body.tracks?.items ?? [])
      .map(toTrack)
      .filter((t): t is Track => t !== null)
  }

  // ---- plumbing --------------------------------------------------------------

  /** Player mutations: success is 200/202/204; no body to parse. */
  private async playerCommand(
    method: 'PUT' | 'POST',
    path: string,
    opts: { interactive: boolean; body?: Record<string, unknown> },
  ): Promise<void> {
    await this.request(method, path, opts)
  }

  private async request(
    method: string,
    path: string,
    opts: { interactive: boolean; body?: Record<string, unknown> },
    retried = false,
  ): Promise<Response> {
    const token = await this.deps.getToken({
      interactive: opts.interactive,
      forceRefresh: retried,
    })
    let res: Response
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
    } catch (err) {
      throw new MeshDeny('music_spotify_unreachable', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
    if (res.ok || res.status === 204) return res
    if (res.status === 401 && !retried) {
      // Stale access token — refresh once and replay. A second 401 falls
      // through to the named API error below.
      return this.request(method, path, opts, true)
    }
    const detail = await this.errorDetail(res)
    if (res.status === 404 && path.startsWith('/me/player')) {
      // Spotify Connect needs an active device; the player endpoints 404
      // (reason NO_ACTIVE_DEVICE) when there is none. Named per the spec —
      // never a silent failure.
      throw new MeshDeny('music_no_active_device', {
        message: 'no active Spotify device',
        detail,
      })
    }
    if (res.status === 429) {
      throw new MeshDeny('music_rate_limited', {
        message: 'Spotify API rate limit hit',
        retry_after_s: Number(res.headers.get('retry-after') ?? '') || null,
      })
    }
    if (res.status === 403) {
      // Most commonly: the Spotify account is not Premium (player commands
      // are Premium-only) or the app lacks a granted scope.
      throw new MeshDeny('music_forbidden', {
        message: `Spotify refused the request (HTTP 403)${detail ? `: ${detail}` : ''}`,
      })
    }
    throw new MeshDeny('music_api_error', { status: res.status, message: detail || res.statusText })
  }

  private async errorDetail(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: { message?: string; reason?: string } }
      return [body.error?.reason, body.error?.message].filter(Boolean).join(' — ')
    } catch {
      return ''
    }
  }
}

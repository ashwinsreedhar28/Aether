// now_playing state machine (#332 FIX item 4). Spotify is polled ONLY while
// playback is active or was active within the last 60s; outside that window
// the loop stops entirely (zero API traffic at rest). Every observation —
// poller tick or on-demand handler fetch — flows through observe(), which
// keeps the snapshot and emits the track-change event on an observed
// track→different-track transition (lanes-sensor precedent: prior state
// carried across observations, first sight never fires).

import type { PlaybackState, Track } from './spotify'

export interface NowPlayingSnapshot {
  is_playing: boolean
  track: Track | null
  album_art_url: string | null
  position_ms: number | null
  fetched_at_ms: number
}

export interface NowPlayingDeps {
  /** One GET /me/player read; never interactive (a poll must not pop a browser). */
  fetchState: () => Promise<PlaybackState | null>
  onTrackChange: (track: Track) => void
  log: (msg: string) => void
  pollMs?: number
  idleAfterMs?: number
  now?: () => number
}

const DEFAULT_POLL_MS = 3_000
const DEFAULT_IDLE_AFTER_MS = 60_000

export class NowPlayingPoller {
  private readonly deps: NowPlayingDeps
  private readonly pollMs: number
  private readonly idleAfterMs: number
  private snapshotState: NowPlayingSnapshot | null = null
  private prevTrackUri: string | null = null
  private lastActiveAt = 0
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private stopped = false

  constructor(deps: NowPlayingDeps) {
    this.deps = deps
    this.pollMs = deps.pollMs ?? DEFAULT_POLL_MS
    this.idleAfterMs = deps.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS
  }

  /** Last observation, if any. Freshness is the caller's call (snapshotAgeMs). */
  snapshot(): NowPlayingSnapshot | null {
    return this.snapshotState
  }

  snapshotAgeMs(): number | null {
    if (!this.snapshotState) return null
    return this.now() - this.snapshotState.fetched_at_ms
  }

  get polling(): boolean {
    return this.timer !== null
  }

  /**
   * Feed one playback-state reading in. Updates the snapshot, fires the
   * track-change event, and (re)arms the poll loop while playback is live.
   * Returns the snapshot it recorded.
   */
  observe(state: PlaybackState | null): NowPlayingSnapshot {
    const nowMs = this.now()
    const snap: NowPlayingSnapshot = {
      is_playing: state?.is_playing === true,
      track: state?.track ?? null,
      album_art_url: state?.album_art_url ?? null,
      position_ms: state?.progress_ms ?? null,
      fetched_at_ms: nowMs,
    }
    this.snapshotState = snap
    if (snap.is_playing) this.lastActiveAt = nowMs
    const uri = snap.track?.uri ?? null
    if (uri && this.prevTrackUri && uri !== this.prevTrackUri && snap.track) {
      this.deps.onTrackChange(snap.track)
    }
    if (uri) this.prevTrackUri = uri
    if (snap.is_playing) this.arm()
    return snap
  }

  /** Start the loop (idempotent). Actor surfaces call this after a command. */
  arm(): void {
    if (this.stopped) return
    // An arm is itself a liveness signal: a just-issued play/skip means
    // playback is (about to be) active even before the first poll lands.
    this.lastActiveAt = this.now()
    // Already looping (timer pending) or mid-tick (awaiting a fetch, timer
    // momentarily null) — bumping lastActiveAt above is enough; starting a
    // second loop here would double the poll rate forever.
    if (this.timer || this.ticking) return
    this.deps.log('now_playing poller armed')
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.pollMs)
  }

  private async tick(): Promise<void> {
    this.timer = null
    if (this.stopped) return
    this.ticking = true
    try {
      this.observe(await this.deps.fetchState())
    } catch (err) {
      // A failed poll (token expiry mid-flow, network blip, rate limit) must
      // not kill the loop — log and let the idle window decide its fate.
      this.deps.log(`now_playing poll failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.ticking = false
    }
    if (this.stopped) return
    if (this.now() - this.lastActiveAt > this.idleAfterMs) {
      this.deps.log('now_playing poller idle (no active playback for 60s)')
      return
    }
    this.schedule()
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}

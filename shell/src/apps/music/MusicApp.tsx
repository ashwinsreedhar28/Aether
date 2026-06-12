import { useEffect, useState } from 'react';
import { Music, Pause, Play, RefreshCw } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// Lane B of the music vertical (#225): a display-only now-playing card over
// music.now_playing. Voice is the remote (standing Architect ruling — no
// interactive panel kind), so there are no playback controls here. Polls
// every 3s while open; the node's own 3s poller makes that a cache hit
// during playback. Progress is interpolated client-side between polls from
// position_ms / duration_ms.

interface NowPlayingTrack {
  name: string;
  artist: string;
  album: string;
  uri: string;
  duration_ms: number;
}

interface NowPlayingPayload {
  is_playing: boolean;
  track: NowPlayingTrack | null;
  album_art_url: string | null;
  position_ms: number | null;
  /** Node-side epoch ms of the snapshot — the interpolation baseline. */
  fetched_at_ms: number;
  source: 'cache' | 'live';
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Walk position_ms forward from the snapshot's fetched_at_ms while playing
 * (node and renderer share the machine clock), clamped to the track length.
 * Paused snapshots render their position as-is.
 */
function useInterpolatedPosition(data: NowPlayingPayload | null): number | null {
  const playing = data?.is_playing === true && data.track !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!playing) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [playing]);

  if (!data?.track || data.position_ms === null) return null;
  if (!data.is_playing) return Math.min(data.position_ms, data.track.duration_ms);
  const elapsed = Math.max(0, nowMs - data.fetched_at_ms);
  return Math.min(data.position_ms + elapsed, data.track.duration_ms);
}

export function MusicApp() {
  const { data, error, loading, refreshing, refetch } = useMeshSurface<NowPlayingPayload>(
    'music.now_playing',
    {},
    3000,
  );
  const position = useInterpolatedPosition(data);

  const track = data?.track ?? null;
  const playing = data?.is_playing === true && track !== null;
  const progressPct =
    track && position !== null && track.duration_ms > 0
      ? Math.min(100, (position / track.duration_ms) * 100)
      : 0;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <Music size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Music</h1>
        {track && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--holo-muted)]">
            {playing ? <Play size={12} /> : <Pause size={12} />}
            {playing ? 'Playing' : 'Paused'}
          </span>
        )}
        <button
          onClick={refetch}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 overflow-y-auto">
        {loading && <p className="text-sm text-[var(--holo-muted)]">Reading playback…</p>}
        {!loading && error && <p className="text-sm text-amber-300 text-center">{error}</p>}

        {!loading && !error && !track && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Music size={48} className="text-[var(--holo-muted)]" />
            <p className="text-sm text-[var(--holo-muted)]">Nothing playing</p>
            <p className="text-xs text-[var(--holo-muted)]">
              Say “play something” — voice is the remote.
            </p>
          </div>
        )}

        {!loading && !error && track && (
          <div className="flex flex-col items-center gap-4 w-full max-w-xs">
            {data?.album_art_url ? (
              <img
                src={data.album_art_url}
                alt={`${track.album} album art`}
                className="w-56 h-56 rounded-lg object-cover border border-[var(--holo-border)] shadow-lg"
                draggable={false}
              />
            ) : (
              <div className="w-56 h-56 rounded-lg border border-[var(--holo-border)] bg-[var(--holo-panel)]/40 flex items-center justify-center">
                <Music size={56} className="text-[var(--holo-muted)]" />
              </div>
            )}

            <div className="text-center w-full">
              <p className="text-base font-medium truncate" title={track.name}>
                {track.name}
              </p>
              <p className="text-sm text-[var(--holo-muted)] truncate" title={track.artist}>
                {track.artist}
              </p>
              <p className="text-xs text-[var(--holo-muted)] truncate" title={track.album}>
                {track.album}
              </p>
            </div>

            <div className="w-full">
              <div className="h-1 rounded-full bg-[var(--holo-panel)] overflow-hidden">
                <div
                  className="h-full bg-[var(--holo-accent)] transition-[width] duration-500 ease-linear"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] font-mono text-[var(--holo-muted)]">
                <span>{position !== null ? formatMs(position) : '–:––'}</span>
                <span>{formatMs(track.duration_ms)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

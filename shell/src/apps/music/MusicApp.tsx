import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Music, Pause, Play, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';

// The music vertical's face. Lane B (#225) built this display-only; #334
// (ADR "apps are interactive MeshApps; panels stay display-only") adds the
// playback controls — prev / play-pause / next ride mesh.invoke over the
// manifest's shell → music.{play,pause,skip} edges, the same signed-envelope
// path as the devtools smoke. Reads poll music.now_playing every 3s while
// open; the node's own 3s poller makes that a cache hit during playback.
// Progress is interpolated client-side between polls from
// position_ms / duration_ms. Visual treatment per the #334 addendum: blurred
// album-art backdrop under an edge-dense gradient, 300ms art crossfade on
// track change, equalizer-as-state instead of a header chip.

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

/**
 * Stacked <img> layers that crossfade ~300ms when `url` changes: the
 * outgoing layer lingers under the incoming one for the animation, then
 * unmounts. Used by both the backdrop and the art card.
 */
function CrossfadeImage({
  url,
  alt,
  imgStyle,
}: {
  url: string;
  alt: string;
  imgStyle?: CSSProperties;
}) {
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const lastUrlRef = useRef(url);
  useEffect(() => {
    if (url === lastUrlRef.current) return;
    setPrevUrl(lastUrlRef.current);
    lastUrlRef.current = url;
    const timer = setTimeout(() => setPrevUrl(null), 320);
    return () => clearTimeout(timer);
  }, [url]);

  const base: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    ...imgStyle,
  };
  return (
    <>
      {prevUrl && <img src={prevUrl} alt="" style={base} draggable={false} />}
      <img
        key={url}
        src={url}
        alt={alt}
        style={{ ...base, animation: 'music-fade-in 300ms ease both' }}
        draggable={false}
      />
    </>
  );
}

/** 3-bar CSS equalizer — animates while playing, freezes when paused. */
function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden
      style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 18, flexShrink: 0 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: '100%',
            borderRadius: 1.5,
            background: 'var(--holo-accent)',
            transformOrigin: 'bottom',
            animation: `music-eq 0.9s ease-in-out ${i * 0.18}s infinite`,
            animationPlayState: playing ? 'running' : 'paused',
          }}
        />
      ))}
    </span>
  );
}

const GHOST_BUTTON =
  'rounded-full border flex items-center justify-center transition-colors ' +
  'hover:bg-white/10 disabled:opacity-35 disabled:pointer-events-none';
const GHOST_STYLE: CSSProperties = {
  borderColor: 'rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)',
};

function Controls({
  playing,
  disabled,
  onPrev,
  onToggle,
  onNext,
}: {
  playing: boolean;
  disabled: boolean;
  onPrev: () => void;
  onToggle: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-5">
      <button
        className={GHOST_BUTTON}
        style={{ ...GHOST_STYLE, width: 44, height: 44 }}
        onClick={onPrev}
        disabled={disabled}
        title="Previous track"
      >
        <SkipBack size={18} />
      </button>
      <button
        className={GHOST_BUTTON}
        style={{ ...GHOST_STYLE, width: 56, height: 56 }}
        onClick={onToggle}
        disabled={disabled}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: 2 }} />}
      </button>
      <button
        className={GHOST_BUTTON}
        style={{ ...GHOST_STYLE, width: 44, height: 44 }}
        onClick={onNext}
        disabled={disabled}
        title="Next track"
      >
        <SkipForward size={18} />
      </button>
    </div>
  );
}

export function MusicApp() {
  const { data, error, loading, refreshing, refetch } = useMeshSurface<NowPlayingPayload>(
    'music.now_playing',
    {},
    3000,
  );
  const position = useInterpolatedPosition(data);

  // Optimistic play/pause: the node's snapshot stays cache-fresh for up to
  // ~4s after a command, so the toggle would read stale for a beat without
  // this. Cleared when the polled state agrees, or after a 10s give-up.
  const [assumedPlaying, setAssumedPlaying] = useState<boolean | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const dataPlaying = data?.is_playing === true;
  useEffect(() => {
    if (assumedPlaying === null) return;
    if (dataPlaying === assumedPlaying) {
      setAssumedPlaying(null);
      return;
    }
    const timer = setTimeout(() => setAssumedPlaying(null), 10_000);
    return () => clearTimeout(timer);
  }, [assumedPlaying, dataPlaying]);

  const track = data?.track ?? null;
  const playing = (assumedPlaying ?? dataPlaying) && track !== null;
  const artUrl = data?.album_art_url ?? null;
  const progressPct =
    track && position !== null && track.duration_ms > 0
      ? Math.min(100, (position / track.duration_ms) * 100)
      : 0;

  const control = async (
    target: string,
    payload: Record<string, unknown>,
    assume?: boolean,
  ): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setControlError(null);
    if (assume !== undefined) setAssumedPlaying(assume);
    try {
      const res = await window.aether.mesh.invoke(target, payload);
      if (!res.ok) {
        setControlError(res.error?.message ?? `${target} unavailable`);
        if (assume !== undefined) setAssumedPlaying(null);
      }
    } catch (e) {
      setControlError(e instanceof Error ? e.message : `${target} unavailable`);
      if (assume !== undefined) setAssumedPlaying(null);
    } finally {
      pendingRef.current = false;
      refetch();
    }
  };

  // Bare music.play (no query/uri) is RESUME — the right inverse of pause.
  const onToggle = () =>
    void (playing ? control('music.pause', {}, false) : control('music.play', {}, true));
  const onPrev = () => void control('music.skip', { direction: 'prev' });
  const onNext = () => void control('music.skip', { direction: 'next' });

  return (
    <div className="relative w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)] overflow-hidden">
      <style>{`
        @keyframes music-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes music-eq { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
      `}</style>

      {/* Backdrop: the album art itself, oversized and blurred, under a
          gradient that is denser at the edges — every album recolors the
          room. Crossfades with the art. */}
      {artUrl && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden>
          <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.4)' }}>
            <CrossfadeImage url={artUrl} alt="" imgStyle={{ filter: 'blur(70px) saturate(0.75)' }} />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse at center, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.78) 60%, rgba(10,10,15,0.94) 100%)',
            }}
          />
        </div>
      )}

      <header className="relative z-10 flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <Music size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Music</h1>
        <button
          onClick={refetch}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-5 p-6 overflow-y-auto">
        {loading && <p className="text-sm text-[var(--holo-muted)]">Reading playback…</p>}
        {!loading && error && <p className="text-sm text-amber-300 text-center">{error}</p>}

        {!loading && !error && !track && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Music size={120} style={{ color: 'rgba(255,255,255,0.08)' }} />
            <p className="text-sm text-[var(--holo-muted)]">Nothing playing</p>
            <p className="text-xs text-[var(--holo-muted)]">
              Say “play something” — voice is the remote.
            </p>
            <div className="mt-2">
              <Controls
                playing={false}
                disabled
                onPrev={onPrev}
                onToggle={onToggle}
                onNext={onNext}
              />
            </div>
          </div>
        )}

        {!loading && !error && track && (
          <div className="flex flex-col items-center gap-5 w-full" style={{ maxWidth: 460 }}>
            <div
              className="relative"
              style={{ width: 'min(42vh, 420px)', maxWidth: '100%', aspectRatio: '1' }}
            >
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.5)',
                  filter: playing ? 'none' : 'brightness(0.85)',
                  transition: 'filter 300ms ease',
                  background: 'var(--holo-panel)',
                }}
              >
                {artUrl ? (
                  <CrossfadeImage url={artUrl} alt={`${track.album} album art`} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music size={56} className="text-[var(--holo-muted)]" />
                  </div>
                )}
              </div>
              {!playing && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ pointerEvents: 'none' }}
                >
                  <Pause
                    size={36}
                    style={{
                      color: 'rgba(255,255,255,0.85)',
                      filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
                    }}
                  />
                </div>
              )}
            </div>

            <div className="text-center w-full">
              <div className="flex items-center justify-center gap-2.5">
                <Equalizer playing={playing} />
                <p
                  className="truncate"
                  style={{
                    fontSize: 30,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.95)',
                    lineHeight: 1.2,
                    minWidth: 0,
                  }}
                  title={track.name}
                >
                  {track.name}
                </p>
              </div>
              <p
                className="truncate"
                style={{ fontSize: 17, color: 'rgba(255,255,255,0.70)', marginTop: 8 }}
                title={track.artist}
              >
                {track.artist}
              </p>
              <p
                className="truncate"
                style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}
                title={track.album}
              >
                {track.album}
              </p>
            </div>

            <div className="w-full">
              <div
                style={{
                  position: 'relative',
                  height: 6,
                  borderRadius: 9999,
                  background: 'rgba(255,255,255,0.12)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${progressPct}%`,
                    minWidth: 6,
                    borderRadius: 9999,
                    background: 'var(--holo-accent)',
                    transition: 'width 500ms linear',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      right: -1,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 0 6px rgba(0,0,0,0.5)',
                    }}
                  />
                </div>
              </div>
              <div
                className="flex justify-between"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.5)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{position !== null ? formatMs(position) : '–:––'}</span>
                <span>{formatMs(track.duration_ms)}</span>
              </div>
            </div>

            <Controls
              playing={playing}
              disabled={false}
              onPrev={onPrev}
              onToggle={onToggle}
              onNext={onNext}
            />
            {controlError && (
              <p className="text-xs text-amber-300 text-center" style={{ marginTop: -8 }}>
                {controlError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

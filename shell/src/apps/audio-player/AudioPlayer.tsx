import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack } from 'lucide-react';
import { useAppContext } from '../AppContext';
import type { AppProps } from '../types';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ filePath }: AppProps) {
  const { fileApi } = useAppContext();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const loadAudio = useCallback(async () => {
    if (!filePath) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fileApi.readFile(filePath);
      setAudioSrc(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audio');
    } finally {
      setLoading(false);
    }
  }, [filePath, fileApi]);

  useEffect(() => {
    loadAudio();
  }, [loadAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted, audioSrc]);

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => setError(err.message));
    } else {
      audio.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = parseFloat(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (v > 0 && isMuted) setIsMuted(false);
  };

  const handleToggleMute = () => setIsMuted((m) => !m);

  const handleRestart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--holo-muted)]">
        Loading audio...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        {error}
      </div>
    );
  }

  if (!audioSrc) {
    return null;
  }

  const fileName = filePath?.split('/').pop() || 'Audio';

  return (
    <div className="h-full flex flex-col bg-[var(--holo-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <span className="text-xs text-[var(--holo-muted)] truncate">{fileName}</span>
      </div>

      {/* Player body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <audio
          ref={audioRef}
          src={audioSrc}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Seek bar with time labels */}
        <div className="w-full flex items-center gap-2">
          <span className="text-xs text-[var(--holo-muted)] w-10 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 accent-[var(--holo-text)]"
          />
          <span className="text-xs text-[var(--holo-muted)] w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>

        {/* Transport + volume */}
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRestart}
              className="p-2 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
              title="Restart"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={handleTogglePlay}
              className="p-2 text-[var(--holo-text)] hover:opacity-80 transition-opacity border border-[var(--holo-border)] rounded-full"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleMute}
              className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={handleVolume}
              className="w-24 accent-[var(--holo-text)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

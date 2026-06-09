import { useEffect, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { RavenStatus, VoiceAvailability } from '../../types/aether';

// Persistent floating control for the raven voice assistant. Mute = stop the mic
// AND suppress the ambient auto-listen (handled in the main process), so it
// actually sticks. Reflects three states: unavailable (no GEMINI_API_KEY),
// listening (hot mic), and muted. Kept in sync with the ⌘/ console via the
// voice:muted-changed / voice:status-changed push channels.

export function VoiceMuteButton() {
  const [available, setAvailable] = useState<VoiceAvailability | null>(null);
  const [status, setStatus] = useState<RavenStatus>('stopped');
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let alive = true;
    window.aether.voice.availability().then((a) => alive && setAvailable(a));
    window.aether.voice.status().then((s) => alive && setStatus(s.status));
    window.aether.voice.muted().then((m) => alive && setMuted(m));

    const unsubs = [
      window.aether.voice.onAvailabilityChanged((a) => setAvailable(a)),
      window.aether.voice.onStatusChanged((s) => setStatus(s.status)),
      window.aether.voice.onMutedChanged((m) => setMuted(m)),
    ];
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, []);

  const isAvailable = available?.kind === 'available';
  const listening = !muted && isAvailable && (status === 'running' || status === 'starting');

  const label = !isAvailable
    ? `Voice assistant unavailable${available?.kind === 'unavailable' ? ` (${available.reason})` : ''}`
    : muted
      ? 'Aether muted — click to unmute'
      : listening
        ? 'Aether is listening — click to mute'
        : 'Click to mute Aether';

  const toggle = () => {
    if (!isAvailable) return;
    void window.aether.voice.setMuted(!muted);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!isAvailable}
      title={label}
      aria-label={label}
      aria-pressed={muted}
      className="fixed bottom-4 right-4 z-[9000] w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:cursor-default"
      style={{
        background: 'var(--holo-panel)',
        border: `1px solid ${muted ? 'rgba(255,122,140,0.6)' : listening ? 'var(--holo-accent)' : 'var(--holo-border)'}`,
        boxShadow: listening ? '0 0 14px var(--holo-glow)' : 'none',
        backdropFilter: 'blur(8px)',
        color: !isAvailable
          ? 'var(--holo-muted)'
          : muted
            ? '#ff7a8c'
            : listening
              ? 'var(--holo-accent)'
              : 'var(--holo-text)',
        opacity: isAvailable ? 1 : 0.5,
      }}
    >
      {/* Pulsing ring while actively listening */}
      {listening && (
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ border: '1px solid var(--holo-accent)', opacity: 0.4 }}
        />
      )}
      {muted || !isAvailable ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}

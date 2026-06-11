import { useEffect, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import type { RavenStatus, VoiceAvailability } from '../../types/aether';

// Persistent floating control for the raven voice assistant. Mute is a SOFT
// gate: the orchestrator drops mic frames while the Gemini session (and its
// conversation context) stays alive — main-process IPC handles it, plus
// suppressing the ambient auto-listen so the mute sticks. This is a sticky
// mute STATE, not push-to-talk: while muted the button expands into a red
// "MUTED" pill so the state can't be misread as "press to speak". Reflects
// three states: unavailable (no GEMINI_API_KEY), listening (hot mic), and
// muted. Kept in sync with the ⌘/ console via the voice:muted-changed /
// voice:status-changed push channels.

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
      ? "Muted — Aether can't hear you. Click to unmute."
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
      className={`fixed bottom-4 right-4 z-[9000] h-11 rounded-full flex items-center justify-center gap-2 transition-all disabled:cursor-default ${
        muted ? 'px-4' : 'w-11'
      }`}
      style={{
        background: 'var(--holo-panel)',
        border: `1px solid ${muted ? 'rgba(255,122,140,0.6)' : listening ? 'var(--holo-accent)' : 'var(--holo-border)'}`,
        boxShadow: muted
          ? '0 0 14px rgba(255,122,140,0.35)'
          : listening
            ? '0 0 14px var(--holo-glow)'
            : 'none',
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
      {/* Spelled-out state while muted: a bare mic icon reads as push-to-talk;
          the label makes the sticky mute state unmistakable. */}
      {muted && isAvailable && (
        <span className="text-[11px] font-mono font-semibold tracking-[0.18em]">MUTED</span>
      )}
    </button>
  );
}

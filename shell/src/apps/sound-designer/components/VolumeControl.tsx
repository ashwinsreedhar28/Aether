import { Volume2, VolumeX } from 'lucide-react';
import { useState, useEffect } from 'react';
import { soundEngine } from '../../../audio';

interface VolumeControlProps {
  onSave?: () => void;
}

export function VolumeControl({ onSave }: VolumeControlProps) {
  const [volume, setVolume] = useState(soundEngine.getMasterVolume());
  const [muted, setMuted] = useState(soundEngine.isMuted());

  useEffect(() => {
    soundEngine.setMasterVolume(volume);
  }, [volume]);

  useEffect(() => {
    soundEngine.setMuted(muted);
  }, [muted]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (onSave) onSave();
  };

  const toggleMute = () => {
    setMuted(!muted);
    if (onSave) onSave();
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggleMute}
        className={`p-1.5 rounded hover:bg-[var(--holo-border)] transition-colors ${
          muted ? 'text-rose-400' : 'text-[var(--holo-accent)]'
        }`}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={handleVolumeChange}
        disabled={muted}
        className={`w-32 h-1 accent-[var(--holo-accent)] bg-[var(--holo-border)] rounded-full appearance-none cursor-pointer ${
          muted ? 'opacity-50' : ''
        }`}
      />
      <span className="text-xs text-[var(--holo-muted)] w-10">
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}

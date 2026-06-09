import { Play } from 'lucide-react';
import { useCallback } from 'react';
import { soundEngine } from '../../../audio';

interface SoundPreviewProps {
  soundId: string;
  size?: 'sm' | 'md';
}

export function SoundPreview({ soundId, size = 'sm' }: SoundPreviewProps) {
  const handlePlay = useCallback(() => {
    soundEngine.playSound(soundId);
  }, [soundId]);

  const sizeClasses = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const iconSize = size === 'sm' ? 12 : 16;

  return (
    <button
      onClick={handlePlay}
      className={`${sizeClasses} flex items-center justify-center rounded-full bg-[var(--holo-accent)]/20 hover:bg-[var(--holo-accent)]/40 text-[var(--holo-accent)] transition-colors`}
      title="Preview sound"
    >
      <Play size={iconSize} />
    </button>
  );
}

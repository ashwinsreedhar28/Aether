/**
 * useSound Hook
 * Provides easy access to sound engine from React components.
 */

import { useCallback } from 'react';
import { soundEngine, type ViewerEvent } from '../audio';

export function useSound() {
  const playEvent = useCallback((event: ViewerEvent) => {
    soundEngine.playEvent(event);
  }, []);

  const playSound = useCallback((soundId: string) => {
    soundEngine.playSound(soundId);
  }, []);

  const setVolume = useCallback((volume: number) => {
    soundEngine.setMasterVolume(volume);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    soundEngine.setMuted(muted);
  }, []);

  return {
    playEvent,
    playSound,
    setVolume,
    setMuted,
    getVolume: soundEngine.getMasterVolume.bind(soundEngine),
    isMuted: soundEngine.isMuted.bind(soundEngine),
  };
}

export default useSound;

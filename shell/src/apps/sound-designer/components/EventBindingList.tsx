import { useState, useEffect, useCallback } from 'react';
import { soundEngine, ALL_EVENTS, EVENT_LABELS, type ViewerEvent } from '../../../audio';
import { SoundPreview } from './SoundPreview';

interface EventBindingListProps {
  onSave?: () => void;
}

export function EventBindingList({ onSave }: EventBindingListProps) {
  const [bindings, setBindings] = useState(soundEngine.getAllBindings());
  const allSounds = soundEngine.getAllSounds();

  // Refresh bindings from the sound engine when the component mounts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBindings(soundEngine.getAllBindings());
  }, []);

  const handleSoundChange = useCallback(
    (event: ViewerEvent, soundId: string) => {
      soundEngine.setEventBinding(event, soundId, true);
      setBindings(soundEngine.getAllBindings());
      if (onSave) onSave();
    },
    [onSave]
  );

  const handleToggleEnabled = useCallback(
    (event: ViewerEvent, enabled: boolean) => {
      soundEngine.setEventEnabled(event, enabled);
      setBindings(soundEngine.getAllBindings());
      if (onSave) onSave();
    },
    [onSave]
  );

  // Group events by category
  const eventGroups = {
    Window: ALL_EVENTS.filter((e) => e.startsWith('window:')),
    Tab: ALL_EVENTS.filter((e) => e.startsWith('tab:')),
    File: ALL_EVENTS.filter((e) => e.startsWith('file:') || e.startsWith('folder:')),
    Workspace: ALL_EVENTS.filter((e) => e.startsWith('workspace:')),
    Dialog: ALL_EVENTS.filter((e) => e.startsWith('dialog:')),
    Search: ALL_EVENTS.filter((e) => e.startsWith('search:')),
    Other: ALL_EVENTS.filter(
      (e) => e.startsWith('shortcut:') || e.startsWith('drag:')
    ),
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      {Object.entries(eventGroups).map(([group, events]) => (
        <div key={group}>
          <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
            {group}
          </h3>
          <div className="space-y-1">
            {events.map((event) => {
              const binding = bindings.find((b) => b.event === event);
              const soundId = binding?.soundId || '';
              const enabled = binding?.enabled ?? true;

              return (
                <div
                  key={event}
                  className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--holo-border)]/30"
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => handleToggleEnabled(event, e.target.checked)}
                    className="w-3.5 h-3.5 accent-[var(--holo-accent)]"
                  />
                  <span
                    className={`flex-1 text-sm ${
                      enabled ? '' : 'text-[var(--holo-muted)]'
                    }`}
                  >
                    {EVENT_LABELS[event]}
                  </span>
                  <select
                    value={soundId}
                    onChange={(e) => handleSoundChange(event, e.target.value)}
                    disabled={!enabled}
                    className={`w-40 px-2 py-1 text-xs bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] ${
                      !enabled ? 'opacity-50' : ''
                    }`}
                  >
                    <option value="">None</option>
                    {allSounds.map((sound) => (
                      <option key={sound.id} value={sound.id}>
                        {sound.name}
                      </option>
                    ))}
                  </select>
                  {soundId && enabled && <SoundPreview soundId={soundId} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

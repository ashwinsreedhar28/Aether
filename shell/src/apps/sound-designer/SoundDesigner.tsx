import { useState, useCallback } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { soundEngine } from '../../audio';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { EventBindingList } from './components/EventBindingList';
import { SoundLibrary } from './components/SoundLibrary';
import { AdvancedSoundEditor } from './components/AdvancedSoundEditor';
import { VolumeControl } from './components/VolumeControl';
import { WaveformVisualizer } from './components/WaveformVisualizer';

type Tab = 'bindings' | 'library' | 'custom' | 'visualizer';

export function SoundDesigner() {
  const [activeTab, setActiveTab] = useState<Tab>('bindings');
  const saveConfig = useWorkspaceStore((s) => s.saveConfig);

  const handleSave = useCallback(() => {
    saveConfig();
  }, [saveConfig]);

  const handleReset = useCallback(() => {
    soundEngine.resetToDefaults();
    saveConfig();
  }, [saveConfig]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'bindings', label: 'Event Bindings' },
    { id: 'library', label: 'Sound Library' },
    { id: 'custom', label: 'Sound Designer' },
    { id: 'visualizer', label: 'Visualizer' },
  ];

  return (
    <div className="h-full flex flex-col bg-[rgba(10,10,20,0.95)]">
      {/* Tab navigation */}
      <div className="flex border-b border-[var(--holo-border)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm transition-colors relative ${
              activeTab === tab.id
                ? 'text-[var(--holo-accent)]'
                : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--holo-accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'bindings' && <EventBindingList onSave={handleSave} />}
        {activeTab === 'library' && <SoundLibrary />}
        {activeTab === 'custom' && <AdvancedSoundEditor onSave={handleSave} />}
        {activeTab === 'visualizer' && (
          <div className="h-full p-4 flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
                Waveform
              </h3>
              <WaveformVisualizer height={150} type="waveform" />
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
                Frequency Spectrum
              </h3>
              <WaveformVisualizer height={200} type="frequency" />
            </div>
            <div>
              <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
                Combined View
              </h3>
              <WaveformVisualizer height={150} type="both" />
            </div>
          </div>
        )}
      </div>

      {/* Footer with global controls */}
      <div className="px-4 py-3 border-t border-[var(--holo-border)] flex items-center justify-between">
        <VolumeControl onSave={handleSave} />

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-[var(--holo-border)]/50 rounded transition-colors"
          >
            <RotateCcw size={14} />
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-80 transition-opacity"
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default SoundDesigner;

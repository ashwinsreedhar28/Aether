import { useState, useCallback } from 'react';
import { Play, Save, Trash2, Plus } from 'lucide-react';
import { soundEngine, playCustomSound, type ToneParameters, type SoundDefinition } from '../../../audio';
import { ParameterSlider } from './ParameterSlider';

interface CustomSoundEditorProps {
  onSave?: () => void;
}

const DEFAULT_PARAMS: ToneParameters = {
  frequency: 2400,
  duration: 0.05,
  type: 'sine',
  volume: 0.06,
  attack: 0.001,
  decay: 0.025,
};

export function CustomSoundEditor({ onSave }: CustomSoundEditorProps) {
  const [name, setName] = useState('');
  const [params, setParams] = useState<ToneParameters>(DEFAULT_PARAMS);
  const [editingId, setEditingId] = useState<string | null>(null);

  const customSounds = soundEngine.getCustomSounds();

  const handleParamChange = useCallback(
    (key: keyof ToneParameters, value: number | string) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handlePreview = useCallback(() => {
    playCustomSound([params]);
  }, [params]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleSave = useCallback(() => {
    if (!name.trim()) return;

    const id = editingId || `custom-${Date.now()}`;
    const sound: SoundDefinition = {
      id,
      name: name.trim(),
      category: 'tone',
      parameters: [params],
    };

    soundEngine.addCustomSound(sound);
    setName('');
    setParams(DEFAULT_PARAMS);
    setEditingId(null);
    if (onSave) onSave();
  }, [name, params, editingId, onSave]);

  const handleEdit = useCallback((sound: SoundDefinition) => {
    setEditingId(sound.id);
    setName(sound.name);
    if (sound.parameters && sound.parameters.length > 0) {
      setParams(sound.parameters[0]);
    }
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      soundEngine.removeCustomSound(id);
      if (editingId === id) {
        setEditingId(null);
        setName('');
        setParams(DEFAULT_PARAMS);
      }
      if (onSave) onSave();
    },
    [editingId, onSave]
  );

  const handleNew = useCallback(() => {
    setEditingId(null);
    setName('');
    setParams(DEFAULT_PARAMS);
  }, []);

  return (
    <div className="h-full flex">
      {/* Editor panel */}
      <div className="flex-1 p-4 border-r border-[var(--holo-border)] overflow-auto">
        <div className="mb-4">
          <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
            {editingId ? 'Edit Sound' : 'Create New Sound'}
          </h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sound name..."
            className="w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] mb-4"
          />
        </div>

        <div className="space-y-1">
          <ParameterSlider
            label="Frequency"
            value={params.frequency || 2400}
            min={200}
            max={8000}
            step={0.01}
            unit="Hz"
            logarithmic
            onChange={(v) => handleParamChange('frequency', v)}
          />
          <ParameterSlider
            label="Duration"
            value={params.duration || 0.05}
            min={0.01}
            max={0.5}
            step={0.001}
            unit="s"
            onChange={(v) => handleParamChange('duration', v)}
          />
          <ParameterSlider
            label="Volume"
            value={params.volume || 0.06}
            min={0.01}
            max={0.2}
            step={0.001}
            onChange={(v) => handleParamChange('volume', v)}
          />
          <ParameterSlider
            label="Attack"
            value={params.attack || 0.001}
            min={0.0005}
            max={0.05}
            step={0.0001}
            unit="s"
            onChange={(v) => handleParamChange('attack', v)}
          />
          <ParameterSlider
            label="Decay"
            value={params.decay || 0.025}
            min={0.005}
            max={0.2}
            step={0.001}
            unit="s"
            onChange={(v) => handleParamChange('decay', v)}
          />

          <div className="flex items-center gap-3 py-1.5">
            <label className="w-24 text-xs text-[var(--holo-muted)] shrink-0">
              Waveform
            </label>
            <div className="flex gap-2">
              {(['sine', 'triangle', 'square', 'sawtooth'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => handleParamChange('type', type)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    params.type === type
                      ? 'bg-[var(--holo-accent)] text-black'
                      : 'bg-[var(--holo-border)]/50 hover:bg-[var(--holo-border)]'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <ParameterSlider
            label="Detune"
            value={params.detune || 0}
            min={-100}
            max={100}
            step={1}
            unit="cents"
            onChange={(v) => handleParamChange('detune', v)}
          />
          <ParameterSlider
            label="Freq End"
            value={params.freqEnd || params.frequency || 2400}
            min={200}
            max={8000}
            step={0.01}
            unit="Hz"
            logarithmic
            onChange={(v) => handleParamChange('freqEnd', v)}
          />
          <ParameterSlider
            label="Vibrato"
            value={params.vibrato || 0}
            min={0}
            max={50}
            step={1}
            unit="Hz"
            onChange={(v) => handleParamChange('vibrato', v)}
          />
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--holo-accent)]/20 hover:bg-[var(--holo-accent)]/40 text-[var(--holo-accent)] rounded transition-colors"
          >
            <Play size={14} />
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            <Save size={14} />
            {editingId ? 'Update' : 'Save'}
          </button>
          {editingId && (
            <button
              onClick={handleNew}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--holo-border)]/50 hover:bg-[var(--holo-border)] rounded transition-colors"
            >
              <Plus size={14} />
              New
            </button>
          )}
        </div>
      </div>

      {/* Custom sounds list */}
      <div className="w-48 p-3 overflow-auto">
        <h3 className="text-xs font-medium text-[var(--holo-muted)] mb-2">
          Custom Sounds
        </h3>
        {customSounds.length === 0 ? (
          <p className="text-xs text-[var(--holo-muted)] italic">
            No custom sounds yet
          </p>
        ) : (
          <div className="space-y-1">
            {customSounds.map((sound) => (
              <div
                key={sound.id}
                className={`flex items-center gap-1.5 p-1.5 rounded text-sm cursor-pointer ${
                  editingId === sound.id
                    ? 'bg-[var(--holo-accent)]/20 border border-[var(--holo-accent)]/50'
                    : 'hover:bg-[var(--holo-border)]/30'
                }`}
                onClick={() => handleEdit(sound)}
              >
                <span className="flex-1 truncate">{sound.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(sound.id);
                  }}
                  className="p-1 hover:bg-rose-500/20 text-rose-400 rounded"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

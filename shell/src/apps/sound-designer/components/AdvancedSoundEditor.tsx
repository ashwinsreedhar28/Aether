import { useState, useCallback } from 'react';
import { Play, Save, Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import {
  soundEngine,
  playCustomSound,
  type ToneParameters,
  type SoundDefinition,
  type FilterType,
} from '../../../audio';
import { ParameterSlider } from './ParameterSlider';
import { WaveformVisualizer } from './WaveformVisualizer';

interface AdvancedSoundEditorProps {
  onSave?: () => void;
}

const DEFAULT_PARAMS: ToneParameters = {
  frequency: 2400,
  duration: 0.1,
  type: 'sine',
  volume: 0.06,
  attack: 0.005,
  decay: 0.03,
  sustain: 0.7,
  release: 0.02,
};

const FILTER_TYPES: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'];

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, children, defaultOpen = false }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--holo-border)] rounded mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--holo-accent)] uppercase tracking-wider hover:bg-[var(--holo-border)]/20"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function AdvancedSoundEditor({ onSave }: AdvancedSoundEditorProps) {
  const [name, setName] = useState('');
  const [params, setParams] = useState<ToneParameters>(DEFAULT_PARAMS);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Effect toggles
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [harmonicsEnabled, setHarmonicsEnabled] = useState(false);
  const [distortionEnabled, setDistortionEnabled] = useState(false);
  const [delayEnabled, setDelayEnabled] = useState(false);
  const [panEnabled, setPanEnabled] = useState(false);
  const [pitchEnvEnabled, setPitchEnvEnabled] = useState(false);

  const customSounds = soundEngine.getCustomSounds();

  const handleParamChange = useCallback(
    (key: keyof ToneParameters, value: number | string | object | number[]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleFilterChange = useCallback(
    (key: string, value: number | string) => {
      setParams((prev) => ({
        ...prev,
        filter: {
          type: prev.filter?.type || 'lowpass',
          frequency: prev.filter?.frequency || 2000,
          Q: prev.filter?.Q || 1,
          gain: prev.filter?.gain || 0,
          [key]: value,
        },
      }));
    },
    []
  );

  const handleDelayChange = useCallback(
    (key: string, value: number) => {
      setParams((prev) => ({
        ...prev,
        delay: {
          time: prev.delay?.time || 0.1,
          feedback: prev.delay?.feedback || 0.3,
          mix: prev.delay?.mix || 0.3,
          [key]: value,
        },
      }));
    },
    []
  );

  const handlePitchEnvChange = useCallback(
    (key: string, value: number) => {
      setParams((prev) => ({
        ...prev,
        pitchEnvelope: {
          start: prev.pitchEnvelope?.start || 1,
          end: prev.pitchEnvelope?.end || 1,
          time: prev.pitchEnvelope?.time || 0.05,
          [key]: value,
        },
      }));
    },
    []
  );

  const handleHarmonicChange = useCallback(
    (index: number, value: number) => {
      setParams((prev) => {
        const harmonics = [...(prev.harmonics || [0, 0, 0, 0])];
        harmonics[index] = value;
        return { ...prev, harmonics };
      });
    },
    []
  );

  const handlePreview = useCallback(() => {
    const playParams: ToneParameters = { ...params };

    // Only include effects that are enabled
    if (!filterEnabled) delete playParams.filter;
    if (!harmonicsEnabled) delete playParams.harmonics;
    if (!distortionEnabled) playParams.distortion = undefined;
    if (!delayEnabled) delete playParams.delay;
    if (!panEnabled) playParams.pan = undefined;
    if (!pitchEnvEnabled) delete playParams.pitchEnvelope;

    playCustomSound([playParams]);
  }, [params, filterEnabled, harmonicsEnabled, distortionEnabled, delayEnabled, panEnabled, pitchEnvEnabled]);

  const resetEffects = useCallback(() => {
    setFilterEnabled(false);
    setHarmonicsEnabled(false);
    setDistortionEnabled(false);
    setDelayEnabled(false);
    setPanEnabled(false);
    setPitchEnvEnabled(false);
  }, []);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleSave = useCallback(() => {
    if (!name.trim()) return;

    const saveParams: ToneParameters = { ...params };

    // Only include effects that are enabled
    if (!filterEnabled) delete saveParams.filter;
    if (!harmonicsEnabled) delete saveParams.harmonics;
    if (!distortionEnabled) saveParams.distortion = undefined;
    if (!delayEnabled) delete saveParams.delay;
    if (!panEnabled) saveParams.pan = undefined;
    if (!pitchEnvEnabled) delete saveParams.pitchEnvelope;

    const id = editingId || `custom-${Date.now()}`;
    const sound: SoundDefinition = {
      id,
      name: name.trim(),
      category: 'tone',
      parameters: [saveParams],
    };

    soundEngine.addCustomSound(sound);
    setName('');
    setParams(DEFAULT_PARAMS);
    setEditingId(null);
    resetEffects();
    if (onSave) onSave();
  }, [name, params, editingId, onSave, resetEffects, filterEnabled, harmonicsEnabled, distortionEnabled, delayEnabled, panEnabled, pitchEnvEnabled]);

  const handleEdit = useCallback((sound: SoundDefinition) => {
    setEditingId(sound.id);
    setName(sound.name);
    if (sound.parameters && sound.parameters.length > 0) {
      const p = sound.parameters[0];
      setParams(p);
      setFilterEnabled(!!p.filter);
      setHarmonicsEnabled(!!p.harmonics && p.harmonics.length > 0);
      setDistortionEnabled(!!p.distortion && p.distortion > 0);
      setDelayEnabled(!!p.delay);
      setPanEnabled(p.pan !== undefined && p.pan !== 0);
      setPitchEnvEnabled(!!p.pitchEnvelope);
    }
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      soundEngine.removeCustomSound(id);
      if (editingId === id) {
        setEditingId(null);
        setName('');
        setParams(DEFAULT_PARAMS);
        resetEffects();
      }
      if (onSave) onSave();
    },
    [editingId, onSave, resetEffects]
  );

  const handleNew = useCallback(() => {
    setEditingId(null);
    setName('');
    setParams(DEFAULT_PARAMS);
    resetEffects();
  }, [resetEffects]);

  return (
    <div className="h-full flex">
      {/* Editor panel */}
      <div className="flex-1 p-4 border-r border-[var(--holo-border)] overflow-auto">
        {/* Visualizer */}
        <div className="mb-4">
          <WaveformVisualizer height={80} type="both" />
        </div>

        <div className="mb-4">
          <h3 className="text-xs font-medium text-[var(--holo-accent)] mb-2 uppercase tracking-wider">
            {editingId ? 'Edit Sound' : 'Create New Sound'}
          </h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sound name..."
            className="w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)]"
          />
        </div>

        {/* Basic Parameters */}
        <CollapsibleSection title="Oscillator" defaultOpen>
          <div className="space-y-1">
            <ParameterSlider
              label="Frequency"
              value={params.frequency || 2400}
              min={20}
              max={12000}
              step={0.01}
              unit="Hz"
              logarithmic
              onChange={(v) => handleParamChange('frequency', v)}
            />
            <ParameterSlider
              label="Duration"
              value={params.duration || 0.1}
              min={0.01}
              max={2}
              step={0.001}
              unit="s"
              onChange={(v) => handleParamChange('duration', v)}
            />
            <ParameterSlider
              label="Volume"
              value={params.volume || 0.06}
              min={0.01}
              max={0.3}
              step={0.001}
              onChange={(v) => handleParamChange('volume', v)}
            />

            <div className="flex items-center gap-3 py-1.5">
              <label className="w-24 text-xs text-[var(--holo-muted)] shrink-0">
                Waveform
              </label>
              <div className="flex gap-1 flex-wrap">
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
          </div>
        </CollapsibleSection>

        {/* Envelope (ADSR) */}
        <CollapsibleSection title="Envelope (ADSR)" defaultOpen>
          <div className="space-y-1">
            <ParameterSlider
              label="Attack"
              value={params.attack || 0.005}
              min={0.001}
              max={0.5}
              step={0.001}
              unit="s"
              onChange={(v) => handleParamChange('attack', v)}
            />
            <ParameterSlider
              label="Decay"
              value={params.decay || 0.03}
              min={0.001}
              max={0.5}
              step={0.001}
              unit="s"
              onChange={(v) => handleParamChange('decay', v)}
            />
            <ParameterSlider
              label="Sustain"
              value={params.sustain || 0.7}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => handleParamChange('sustain', v)}
            />
            <ParameterSlider
              label="Release"
              value={params.release || 0.02}
              min={0}
              max={1}
              step={0.001}
              unit="s"
              onChange={(v) => handleParamChange('release', v)}
            />
          </div>
        </CollapsibleSection>

        {/* Vibrato */}
        <CollapsibleSection title="Vibrato">
          <div className="space-y-1">
            <ParameterSlider
              label="Amount"
              value={params.vibrato || 0}
              min={0}
              max={100}
              step={1}
              unit="Hz"
              onChange={(v) => handleParamChange('vibrato', v)}
            />
            <ParameterSlider
              label="Rate"
              value={params.vibratoRate || 30}
              min={1}
              max={60}
              step={1}
              unit="Hz"
              onChange={(v) => handleParamChange('vibratoRate', v)}
            />
          </div>
        </CollapsibleSection>

        {/* Pitch Envelope */}
        <CollapsibleSection title="Pitch Envelope">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={pitchEnvEnabled}
                onChange={(e) => setPitchEnvEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Pitch Envelope
            </label>
          </div>
          {pitchEnvEnabled && (
            <div className="space-y-1">
              <ParameterSlider
                label="Start"
                value={params.pitchEnvelope?.start || 1}
                min={0.1}
                max={4}
                step={0.01}
                unit="x"
                onChange={(v) => handlePitchEnvChange('start', v)}
              />
              <ParameterSlider
                label="End"
                value={params.pitchEnvelope?.end || 1}
                min={0.1}
                max={4}
                step={0.01}
                unit="x"
                onChange={(v) => handlePitchEnvChange('end', v)}
              />
              <ParameterSlider
                label="Time"
                value={params.pitchEnvelope?.time || 0.05}
                min={0.001}
                max={1}
                step={0.001}
                unit="s"
                onChange={(v) => handlePitchEnvChange('time', v)}
              />
            </div>
          )}
        </CollapsibleSection>

        {/* Filter */}
        <CollapsibleSection title="Filter">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={filterEnabled}
                onChange={(e) => setFilterEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Filter
            </label>
          </div>
          {filterEnabled && (
            <div className="space-y-1">
              <div className="flex items-center gap-3 py-1.5">
                <label className="w-24 text-xs text-[var(--holo-muted)] shrink-0">
                  Type
                </label>
                <div className="flex gap-1 flex-wrap">
                  {FILTER_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => handleFilterChange('type', type)}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        params.filter?.type === type
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
                label="Cutoff"
                value={params.filter?.frequency || 2000}
                min={20}
                max={15000}
                step={1}
                unit="Hz"
                logarithmic
                onChange={(v) => handleFilterChange('frequency', v)}
              />
              <ParameterSlider
                label="Resonance"
                value={params.filter?.Q || 1}
                min={0.1}
                max={20}
                step={0.1}
                unit="Q"
                onChange={(v) => handleFilterChange('Q', v)}
              />
              {params.filter?.type === 'peaking' && (
                <ParameterSlider
                  label="Gain"
                  value={params.filter?.gain || 0}
                  min={-20}
                  max={20}
                  step={0.5}
                  unit="dB"
                  onChange={(v) => handleFilterChange('gain', v)}
                />
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* Harmonics */}
        <CollapsibleSection title="Harmonics">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={harmonicsEnabled}
                onChange={(e) => setHarmonicsEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Harmonics
            </label>
          </div>
          {harmonicsEnabled && (
            <div className="space-y-1">
              {[0, 1, 2, 3].map((i) => (
                <ParameterSlider
                  key={i}
                  label={`${i + 2}${['nd', 'rd', 'th', 'th'][i]}`}
                  value={params.harmonics?.[i] || 0}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => handleHarmonicChange(i, v)}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Distortion */}
        <CollapsibleSection title="Distortion">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={distortionEnabled}
                onChange={(e) => setDistortionEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Distortion
            </label>
          </div>
          {distortionEnabled && (
            <ParameterSlider
              label="Amount"
              value={params.distortion || 0}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => handleParamChange('distortion', v)}
            />
          )}
        </CollapsibleSection>

        {/* Delay */}
        <CollapsibleSection title="Delay">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={delayEnabled}
                onChange={(e) => setDelayEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Delay
            </label>
          </div>
          {delayEnabled && (
            <div className="space-y-1">
              <ParameterSlider
                label="Time"
                value={params.delay?.time || 0.1}
                min={0.01}
                max={0.5}
                step={0.001}
                unit="s"
                onChange={(v) => handleDelayChange('time', v)}
              />
              <ParameterSlider
                label="Feedback"
                value={params.delay?.feedback || 0.3}
                min={0}
                max={0.9}
                step={0.01}
                onChange={(v) => handleDelayChange('feedback', v)}
              />
              <ParameterSlider
                label="Mix"
                value={params.delay?.mix || 0.3}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => handleDelayChange('mix', v)}
              />
            </div>
          )}
        </CollapsibleSection>

        {/* Panning */}
        <CollapsibleSection title="Stereo">
          <div className="mb-2">
            <label className="flex items-center gap-2 text-xs text-[var(--holo-muted)]">
              <input
                type="checkbox"
                checked={panEnabled}
                onChange={(e) => setPanEnabled(e.target.checked)}
                className="rounded"
              />
              Enable Panning
            </label>
          </div>
          {panEnabled && (
            <ParameterSlider
              label="Pan"
              value={params.pan || 0}
              min={-1}
              max={1}
              step={0.01}
              unit="L/R"
              onChange={(v) => handleParamChange('pan', v)}
            />
          )}
        </CollapsibleSection>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-4 sticky bottom-0 bg-[rgba(10,10,20,0.95)] py-2">
          <button
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--holo-accent)]/20 hover:bg-[var(--holo-accent)]/40 text-[var(--holo-accent)] rounded transition-colors"
          >
            <Play size={14} />
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            <Save size={14} />
            {editingId ? 'Update' : 'Save'}
          </button>
          {editingId && (
            <button
              onClick={handleNew}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--holo-border)]/50 hover:bg-[var(--holo-border)] rounded transition-colors"
            >
              <Plus size={14} />
              New
            </button>
          )}
        </div>
      </div>

      {/* Custom sounds list */}
      <div className="w-52 p-3 overflow-auto">
        <h3 className="text-xs font-medium text-[var(--holo-muted)] mb-2 uppercase tracking-wider">
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
                className={`flex items-center gap-1.5 p-2 rounded text-sm cursor-pointer ${
                  editingId === sound.id
                    ? 'bg-[var(--holo-accent)]/20 border border-[var(--holo-accent)]/50'
                    : 'hover:bg-[var(--holo-border)]/30'
                }`}
                onClick={() => handleEdit(sound)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playCustomSound(sound.parameters || [DEFAULT_PARAMS]);
                  }}
                  className="p-1 hover:bg-[var(--holo-accent)]/20 rounded"
                >
                  <Play size={12} />
                </button>
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

import { useState } from 'react';
import { soundEngine, CATEGORY_LABELS, type SoundCategory } from '../../../audio';
import { SoundPreview } from './SoundPreview';

const CATEGORIES: SoundCategory[] = [
  'tap',
  'blip',
  'chime',
  'slide',
  'tone',
  'fizz',
  'rise',
  'fall',
  'sequence',
  'pulse',
  'shimmer',
  'whoosh',
];

export function SoundLibrary() {
  const [selectedCategory, setSelectedCategory] = useState<SoundCategory | 'all'>(
    'all'
  );

  const presets = soundEngine.getPresetSounds();
  const customSounds = soundEngine.getCustomSounds();

  const filteredPresets =
    selectedCategory === 'all'
      ? presets
      : presets.filter((s) => s.category === selectedCategory);

  return (
    <div className="h-full flex flex-col">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-1 p-3 border-b border-[var(--holo-border)]">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            selectedCategory === 'all'
              ? 'bg-[var(--holo-accent)] text-black'
              : 'hover:bg-[var(--holo-border)]'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              selectedCategory === cat
                ? 'bg-[var(--holo-accent)] text-black'
                : 'hover:bg-[var(--holo-border)]'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Sound list */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          {filteredPresets.map((sound) => (
            <div
              key={sound.id}
              className="flex items-center gap-2 p-2 rounded bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.3)] transition-colors"
            >
              <SoundPreview soundId={sound.id} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{sound.name}</div>
                <div className="text-xs text-[var(--holo-muted)]">
                  {CATEGORY_LABELS[sound.category]}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Custom sounds section */}
        {customSounds.length > 0 && (
          <>
            <h3 className="text-xs font-medium text-[var(--holo-accent)] mt-6 mb-2 uppercase tracking-wider">
              Custom Sounds
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {customSounds.map((sound) => (
                <div
                  key={sound.id}
                  className="flex items-center gap-2 p-2 rounded bg-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.3)] transition-colors border border-[var(--holo-accent)]/30"
                >
                  <SoundPreview soundId={sound.id} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{sound.name}</div>
                    <div className="text-xs text-[var(--holo-muted)]">Custom</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

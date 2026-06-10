/**
 * KeyValueEditor Component
 * Reusable component for editing key-value pairs (headers, params, form data)
 */

import { Plus, Trash2, GripVertical } from 'lucide-react';
import type { KeyValuePair } from '../../types';
import { createKeyValuePair } from '../../constants';

interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  showDescription = false,
}: KeyValueEditorProps) {
  const handleAdd = () => {
    onChange([...pairs, createKeyValuePair()]);
  };

  const handleRemove = (id: string) => {
    onChange(pairs.filter((p) => p.id !== id));
  };

  const handleUpdate = (id: string, field: keyof KeyValuePair, value: string | boolean) => {
    onChange(
      pairs.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--holo-muted)]">
        <div className="w-6" />
        <div className="w-5" />
        <div className="flex-1">{keyPlaceholder}</div>
        <div className="flex-1">{valuePlaceholder}</div>
        {showDescription && <div className="flex-1">Description</div>}
        <div className="w-8" />
      </div>

      {/* Rows */}
      {pairs.map((pair) => (
        <div
          key={pair.id}
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[rgba(20,20,30,0.5)] group"
        >
          {/* Drag handle */}
          <div className="w-6 flex justify-center">
            <GripVertical
              size={12}
              className="text-[var(--holo-muted)] opacity-0 group-hover:opacity-50 cursor-grab"
            />
          </div>

          {/* Enabled checkbox */}
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => handleUpdate(pair.id, 'enabled', e.target.checked)}
            className="w-4 h-4 rounded border-[var(--holo-border)] bg-transparent accent-[var(--holo-accent)]"
          />

          {/* Key input */}
          <input
            type="text"
            value={pair.key}
            onChange={(e) => handleUpdate(pair.id, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 px-2 py-1 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
          />

          {/* Value input */}
          <input
            type="text"
            value={pair.value}
            onChange={(e) => handleUpdate(pair.id, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1 px-2 py-1 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
          />

          {/* Description input */}
          {showDescription && (
            <input
              type="text"
              value={pair.description || ''}
              onChange={(e) => handleUpdate(pair.id, 'description', e.target.value)}
              placeholder="Description"
              className="flex-1 px-2 py-1 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
            />
          )}

          {/* Delete button */}
          <button
            onClick={() => handleRemove(pair.id)}
            className="w-8 flex justify-center p-1 rounded hover:bg-red-500/20 text-[var(--holo-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {/* Add button */}
      <button
        onClick={handleAdd}
        className="flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/10 rounded transition-colors"
      >
        <Plus size={14} />
        Add
      </button>
    </div>
  );
}

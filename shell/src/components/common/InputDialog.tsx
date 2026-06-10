import { useState, useEffect, useRef } from 'react';
import { soundEngine } from '../../audio';

interface InputDialogProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  title,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    soundEngine.playEvent('dialog:open');
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundEngine.playEvent('dialog:cancel');
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      soundEngine.playEvent('dialog:confirm');
      onConfirm(value.trim());
    }
  };

  const handleCancel = () => {
    soundEngine.playEvent('dialog:cancel');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="holo-panel p-4 min-w-[300px] shadow-xl">
        <h3 className="text-sm font-medium mb-3">{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3 py-1.5 text-sm bg-[var(--holo-accent)] rounded hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

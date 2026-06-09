import { useEffect, useRef } from 'react';
import { soundEngine } from '../../audio';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    soundEngine.playEvent('dialog:open');
    // Focus confirm button on mount for keyboard navigation
    confirmButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        soundEngine.playEvent('dialog:cancel');
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        soundEngine.playEvent('dialog:confirm');
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm]);

  const handleConfirm = () => {
    soundEngine.playEvent('dialog:confirm');
    onConfirm();
  };

  const handleCancel = () => {
    soundEngine.playEvent('dialog:cancel');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="holo-panel p-4 min-w-[300px] max-w-[400px] shadow-xl">
        <h3 className="text-sm font-medium mb-2">{title}</h3>
        <p className="text-sm text-[var(--holo-muted)] mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            className={`px-3 py-1.5 text-sm rounded transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[rgba(15,15,25,0.95)] ${
              danger
                ? 'bg-rose-500 text-white focus:ring-rose-500'
                : 'bg-[var(--holo-accent)] focus:ring-[var(--holo-accent)]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

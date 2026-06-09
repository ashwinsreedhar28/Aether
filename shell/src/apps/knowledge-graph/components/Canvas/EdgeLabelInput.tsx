import { useState, useRef, useEffect, useCallback } from 'react';

interface EdgeLabelInputProps {
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
  viewport: { x: number; y: number; zoom: number };
  onSave: (label: string) => void;
  onCancel: () => void;
}

export function EdgeLabelInput({
  sourcePos,
  targetPos,
  viewport,
  onSave,
  onCancel,
}: EdgeLabelInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');

  // Calculate position at center of edge in screen coordinates
  const centerX = (sourcePos.x + targetPos.x) / 2;
  const centerY = (sourcePos.y + targetPos.y) / 2;

  // Convert to screen coordinates
  const screenX = centerX * viewport.zoom + viewport.x;
  const screenY = centerY * viewport.zoom + viewport.y;

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave(label);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [label, onSave, onCancel]);

  const handleBlur = useCallback(() => {
    // Save on blur (clicking away)
    onSave(label);
  }, [label, onSave]);

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="bg-[var(--holo-bg)]/95 border border-[var(--holo-accent)]/40 rounded-lg shadow-xl backdrop-blur-sm p-2">
        <input
          ref={inputRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="Edge label (optional)"
          className="w-48 px-3 py-2 text-sm bg-[var(--holo-border)]/30 border border-[var(--holo-border)] rounded-md text-[var(--holo-text)] outline-none focus:border-[var(--holo-accent)]/50 placeholder:text-[var(--holo-muted)]"
        />
        <p className="mt-1.5 text-[10px] text-[var(--holo-muted)] text-center">
          Enter to save · Esc to skip
        </p>
      </div>
    </div>
  );
}

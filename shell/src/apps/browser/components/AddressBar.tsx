import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Lock, Unlock, Loader2 } from 'lucide-react';

interface AddressBarProps {
  url: string;
  displayUrl: string;
  isSecure: boolean;
  isLoading: boolean;
  isActive: boolean;
  onNavigate: (url: string) => void;
  onDisplayUrlChange: (url: string) => void;
}

export function AddressBar({
  url,
  displayUrl,
  isSecure,
  isLoading,
  isActive,
  onNavigate,
  onDisplayUrlChange,
}: AddressBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onNavigate(displayUrl);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      onDisplayUrlChange(url);
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // Select all text on focus
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Reset to actual URL if user didn't navigate
    if (displayUrl !== url) {
      onDisplayUrlChange(url);
    }
  };

  // Focus address bar on Cmd+L
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  return (
    <div
      className={`flex-1 flex items-center gap-2 px-3 py-1.5 bg-[rgba(0,0,0,0.3)]
                  border rounded-md transition-colors ${
                    isFocused
                      ? 'border-[var(--holo-accent)] shadow-[0_0_8px_rgba(0,255,255,0.2)]'
                      : 'border-[var(--holo-border)]'
                  }`}
    >
      {/* Security indicator */}
      {url.startsWith('http') && (
        isSecure ? (
          <Lock className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
        ) : (
          <Unlock className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
        )
      )}

      {/* URL input */}
      <input
        ref={inputRef}
        type="text"
        value={displayUrl}
        onChange={(e) => onDisplayUrlChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="flex-1 bg-transparent text-[var(--holo-text)] text-sm outline-none
                   placeholder:text-[var(--holo-muted)] min-w-0"
        placeholder="Enter URL or search..."
        spellCheck={false}
      />

      {/* Loading indicator */}
      {isLoading && (
        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />
      )}
    </div>
  );
}

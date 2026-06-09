/**
 * UrlBar Component
 * Method selector + URL input + Send button
 */

import { useMemo } from 'react';
import { Send, X } from 'lucide-react';
import type { HttpMethod, KeyValuePair } from '../../types';
import { HTTP_METHODS, HTTP_METHOD_COLORS } from '../../constants';

interface UrlBarProps {
  method: HttpMethod;
  url: string;
  queryParams: KeyValuePair[];
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  isLoading: boolean;
  onCancel: () => void;
}

export function UrlBar({
  method,
  url,
  queryParams,
  onMethodChange,
  onUrlChange,
  onSend,
  isLoading,
  onCancel,
}: UrlBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!isLoading) onSend();
    }
  };

  // Build full URL with query params for display
  const fullUrl = useMemo(() => {
    const enabledParams = queryParams.filter((p) => p.enabled && p.key.trim());
    if (enabledParams.length === 0) return url;

    const queryString = enabledParams
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${queryString}`;
  }, [url, queryParams]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {/* Method selector */}
        <select
          value={method}
          onChange={(e) => onMethodChange(e.target.value as HttpMethod)}
          className="px-3 py-2 text-sm font-bold rounded bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] focus:border-[var(--holo-accent)] focus:outline-none cursor-pointer"
          style={{ color: HTTP_METHOD_COLORS[method] }}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m} style={{ color: HTTP_METHOD_COLORS[m] }}>
              {m}
            </option>
          ))}
        </select>

        {/* URL input */}
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL or paste curl command"
          className="flex-1 px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none"
        />

        {/* Send/Cancel button */}
        {isLoading ? (
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            <X size={16} />
            Cancel
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!url.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
            Send
          </button>
        )}
      </div>

      {/* Full URL preview with query params */}
      {fullUrl !== url && (
        <div className="text-xs text-[var(--holo-muted)] font-mono truncate px-1">
          {fullUrl}
        </div>
      )}
    </div>
  );
}

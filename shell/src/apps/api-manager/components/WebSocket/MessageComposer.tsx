/**
 * MessageComposer Component
 * WebSocket message input
 */

import { useState } from 'react';
import { Send } from 'lucide-react';

interface MessageComposerProps {
  onSend: (message: string) => void;
}

export function MessageComposer({ onSend }: MessageComposerProps) {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim()) {
      onSend(message);
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-3">
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter message to send..."
          rows={3}
          className="flex-1 px-3 py-2 text-sm font-mono bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none resize-none"
        />
        <button
          onClick={handleSend}
          disabled={!message.trim()}
          className="self-end flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={14} />
          Send
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--holo-muted)]">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}

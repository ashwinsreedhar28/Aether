/**
 * MessageList Component
 * WebSocket message history display
 */

import { useRef, useEffect } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { WebSocketMessage } from '../../types';

interface MessageListProps {
  messages: WebSocketMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--holo-muted)] text-sm">
        No messages yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2 space-y-2">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex gap-2 p-2 rounded ${
            message.direction === 'sent'
              ? 'bg-[var(--holo-accent)]/10 ml-8'
              : 'bg-[rgba(20,20,30,0.5)] mr-8'
          }`}
        >
          {/* Direction indicator */}
          <div
            className={`flex-shrink-0 p-1 rounded ${
              message.direction === 'sent'
                ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
                : 'bg-green-500/20 text-green-400'
            }`}
          >
            {message.direction === 'sent' ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )}
          </div>

          {/* Message content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-medium ${
                  message.direction === 'sent'
                    ? 'text-[var(--holo-accent)]'
                    : 'text-green-400'
                }`}
              >
                {message.direction === 'sent' ? 'Sent' : 'Received'}
              </span>
              <span className="text-xs text-[var(--holo-muted)]">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
              {message.type === 'binary' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  Binary
                </span>
              )}
            </div>
            <pre className="text-sm font-mono whitespace-pre-wrap break-words">
              {formatMessageData(message.data)}
            </pre>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function formatMessageData(data: string): string {
  // Try to parse and format as JSON
  try {
    const parsed = JSON.parse(data);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return data;
  }
}

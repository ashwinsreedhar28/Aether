/**
 * MessageLog Component
 *
 * Displays real-time JSON-RPC message stream with filtering.
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { ArrowRight, ArrowLeft, Trash2, Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import type { McpMessage, MessageFilter } from '../types';
import { JsonViewer } from './JsonViewer';

interface MessageLogProps {
  messages: McpMessage[];
  filter: MessageFilter;
  onFilterChange: (filter: MessageFilter) => void;
  onClear: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

interface MessageRowProps {
  message: McpMessage;
  expanded: boolean;
  onToggle: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getMessageSummary(message: McpMessage['message']): string {
  if ('method' in message) {
    return message.method;
  }
  if ('error' in message && message.error) {
    return `error: ${message.error.message}`;
  }
  if ('result' in message) {
    const result = message.result;
    if (Array.isArray(result)) {
      return `[${result.length} items]`;
    }
    if (typeof result === 'object' && result !== null) {
      const keys = Object.keys(result);
      return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
    }
    return String(result).slice(0, 50);
  }
  return '';
}

const MessageRow = memo(function MessageRow({ message, expanded, onToggle }: MessageRowProps) {
  const isSent = message.direction === 'sent';
  const isError = 'error' in message.message && message.message.error;

  return (
    <div
      className={`border-b border-[var(--holo-accent)]/5 ${expanded ? 'bg-[rgba(0,0,0,0.2)]' : ''}`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(0,0,0,0.1)] transition-colors"
      >
        {isSent ? (
          <ArrowRight className="w-3 h-3 text-blue-400 flex-shrink-0" />
        ) : (
          <ArrowLeft
            className={`w-3 h-3 flex-shrink-0 ${isError ? 'text-red-400' : 'text-green-400'}`}
          />
        )}
        <span className="text-xs text-gray-500 w-16 flex-shrink-0">
          {formatTime(message.timestamp)}
        </span>
        <span className="text-xs text-gray-400 w-20 flex-shrink-0 truncate">
          {message.serverId}
        </span>
        <span
          className={`text-xs flex-1 truncate ${
            isError ? 'text-red-400' : 'text-[var(--holo-text)]'
          }`}
        >
          {getMessageSummary(message.message)}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <JsonViewer data={message.message} collapsed />
        </div>
      )}
    </div>
  );
});

export function MessageLog({
  messages,
  filter,
  onFilterChange,
  onClear,
  expanded,
  onToggleExpanded,
}: MessageLogProps) {
  const [expandedMessage, setExpandedMessage] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive (if not expanded)
  useEffect(() => {
    if (scrollRef.current && !expandedMessage) {
      // scrollRef.current.scrollTop = 0; // Newest at top
    }
  }, [messages.length, expandedMessage]);

  const handleToggleMessage = useCallback((index: number) => {
    setExpandedMessage(prev => (prev === index ? null : index));
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFilterChange({ ...filter, search: e.target.value });
    },
    [filter, onFilterChange]
  );

  const handleDirectionChange = useCallback(
    (direction: 'all' | 'sent' | 'received') => {
      onFilterChange({ ...filter, direction });
    },
    [filter, onFilterChange]
  );

  return (
    <div className={`flex flex-col border-t border-[var(--holo-accent)]/20 ${expanded ? 'flex-1' : 'h-48'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[rgba(0,0,0,0.2)] border-b border-[var(--holo-accent)]/10">
        <button
          onClick={onToggleExpanded}
          className="text-gray-400 hover:text-[var(--holo-text)]"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronUp className="w-4 h-4" />
          )}
        </button>
        <span className="text-sm font-medium text-[var(--holo-text)]">Message Log</span>
        <span className="text-xs text-gray-500">{messages.length} messages</span>

        <div className="flex-1" />

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1 rounded ${
            showFilters ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]' : 'text-gray-400 hover:text-[var(--holo-text)]'
          }`}
          title="Filter messages"
        >
          <Filter className="w-4 h-4" />
        </button>

        <button
          onClick={onClear}
          className="p-1 rounded text-gray-400 hover:text-red-400"
          title="Clear messages"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-3 px-3 py-2 bg-[rgba(0,0,0,0.15)] border-b border-[var(--holo-accent)]/10">
          <div className="flex items-center gap-1 bg-[rgba(0,0,0,0.2)] rounded px-2 py-1 flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={filter.search || ''}
              onChange={handleSearchChange}
              placeholder="Search..."
              className="bg-transparent text-xs text-[var(--holo-text)] focus:outline-none flex-1"
            />
          </div>

          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => handleDirectionChange('all')}
              className={`px-2 py-1 rounded ${
                filter.direction === 'all' || !filter.direction
                  ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
                  : 'text-gray-400 hover:text-[var(--holo-text)]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => handleDirectionChange('sent')}
              className={`px-2 py-1 rounded ${
                filter.direction === 'sent'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-gray-400 hover:text-[var(--holo-text)]'
              }`}
            >
              Sent
            </button>
            <button
              onClick={() => handleDirectionChange('received')}
              className={`px-2 py-1 rounded ${
                filter.direction === 'received'
                  ? 'bg-green-500/20 text-green-400'
                  : 'text-gray-400 hover:text-[var(--holo-text)]'
              }`}
            >
              Received
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            No messages yet
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageRow
              key={`${msg.timestamp}-${i}`}
              message={msg}
              expanded={expandedMessage === i}
              onToggle={() => handleToggleMessage(i)}
            />
          ))
        )}
      </div>
    </div>
  );
}

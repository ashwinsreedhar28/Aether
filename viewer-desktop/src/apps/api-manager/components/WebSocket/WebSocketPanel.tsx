/**
 * WebSocketPanel Component
 * WebSocket connection manager and message display
 */

import { useState } from 'react';
import { Wifi, WifiOff, Trash2, Loader2 } from 'lucide-react';
import type { WebSocketConfig, WebSocketState } from '../../types';
import { MessageList } from './MessageList';
import { MessageComposer } from './MessageComposer';

interface WebSocketPanelProps {
  config: WebSocketConfig;
  onUpdate: (updates: Partial<WebSocketConfig>) => void;
  onDelete: () => void;
  state: WebSocketState;
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: (message: string) => void;
  onClearMessages: () => void;
}

export function WebSocketPanel({
  config,
  onUpdate,
  onDelete,
  state,
  onConnect,
  onDisconnect,
  onSend,
  onClearMessages,
}: WebSocketPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(config.name);

  const handleNameSubmit = () => {
    if (editName.trim()) {
      onUpdate({ name: editName.trim() });
    } else {
      setEditName(config.name);
    }
    setIsEditing(false);
  };

  const isConnected = state.status === 'connected';
  const isConnecting = state.status === 'connecting';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--holo-border)]">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') {
                setEditName(config.name);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="flex-1 px-2 py-1 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-accent)] rounded focus:outline-none"
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium cursor-pointer hover:text-[var(--holo-accent)]"
            onClick={() => {
              setEditName(config.name);
              setIsEditing(true);
            }}
          >
            {config.name}
          </span>
        )}

        {/* Status indicator */}
        <div
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded ${
            isConnecting
              ? 'bg-yellow-500/20 text-yellow-400'
              : isConnected
              ? 'bg-green-500/20 text-green-400'
              : state.status === 'error'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-[var(--holo-muted)]/20 text-[var(--holo-muted)]'
          }`}
        >
          {isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : isConnected ? (
            <Wifi size={12} />
          ) : (
            <WifiOff size={12} />
          )}
          <span className="capitalize">{state.status}</span>
        </div>

        <button
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-red-500/20 text-[var(--holo-muted)] hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* URL and connect */}
      <div className="px-3 py-2 border-b border-[var(--holo-border)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase px-2 py-1 rounded bg-purple-500/20 text-purple-400">
            WS
          </span>
          <input
            type="text"
            value={config.url}
            onChange={(e) => onUpdate({ url: e.target.value })}
            placeholder="wss://example.com/socket"
            disabled={isConnected || isConnecting}
            className="flex-1 px-3 py-2 text-sm bg-[rgba(20,20,30,0.5)] border border-[var(--holo-border)] rounded focus:border-[var(--holo-accent)] focus:outline-none disabled:opacity-50"
          />
          {isConnected || isConnecting ? (
            <button
              onClick={onDisconnect}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              <WifiOff size={16} />
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={!config.url.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Wifi size={16} />
              Connect
            </button>
          )}
        </div>

        {/* Error message */}
        {state.error && (
          <div className="mt-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 rounded">
            {state.error}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Message header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)]">
          <span className="text-xs font-semibold text-[var(--holo-muted)] uppercase tracking-wider">
            Messages ({state.messages.length})
          </span>
          {state.messages.length > 0 && (
            <button
              onClick={onClearMessages}
              className="text-xs text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-hidden">
          <MessageList messages={state.messages} />
        </div>

        {/* Message composer */}
        {isConnected && (
          <div className="border-t border-[var(--holo-border)]">
            <MessageComposer onSend={onSend} />
          </div>
        )}
      </div>
    </div>
  );
}

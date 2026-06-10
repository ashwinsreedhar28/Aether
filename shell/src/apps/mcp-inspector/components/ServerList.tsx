/**
 * ServerList Component
 *
 * Displays list of MCP servers with status badges and control buttons.
 */

import { memo, useCallback } from 'react';
import { Play, Square, RefreshCw, Server } from 'lucide-react';
import type { McpServerInfo, McpServerStatus } from '../types';

interface ServerListProps {
  servers: McpServerInfo[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onStartServer: (serverId: string) => void;
  onStopServer: (serverId: string) => void;
  onRestartServer: (serverId: string) => void;
  onReload: () => void;
  loading?: boolean;
}

interface ServerCardProps {
  server: McpServerInfo;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}

const statusColors: Record<McpServerStatus, string> = {
  stopped: 'text-gray-500',
  starting: 'text-yellow-400',
  running: 'text-green-400',
  error: 'text-red-400',
};

const statusDots: Record<McpServerStatus, string> = {
  stopped: 'bg-gray-500',
  starting: 'bg-yellow-400 animate-pulse',
  running: 'bg-green-400',
  error: 'bg-red-400',
};

const ServerCard = memo(function ServerCard({
  server,
  selected,
  onSelect,
  onStart,
  onStop,
  onRestart,
}: ServerCardProps) {
  const isRunning = server.status === 'running';
  const isStarting = server.status === 'starting';
  const canStart = server.status === 'stopped' || server.status === 'error';

  const handleStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStart();
  }, [onStart]);

  const handleStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStop();
  }, [onStop]);

  const handleRestart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRestart();
  }, [onRestart]);

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded-lg cursor-pointer transition-colors ${
        selected
          ? 'bg-[var(--holo-accent)]/20 border border-[var(--holo-accent)]/40'
          : 'bg-[rgba(0,0,0,0.2)] border border-transparent hover:bg-[rgba(0,0,0,0.3)]'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Server className="w-4 h-4 text-[var(--holo-accent)]" />
        <span className="text-sm font-medium text-[var(--holo-text)] truncate flex-1">
          {server.id}
        </span>
        <span className={`w-2 h-2 rounded-full ${statusDots[server.status]}`} />
      </div>

      <div className="flex items-center gap-2 text-xs mb-2">
        <span className={statusColors[server.status]}>
          {server.status}
        </span>
        {server.serverInfo?.name && (
          <span className="text-gray-500 truncate">
            ({server.serverInfo.name})
          </span>
        )}
      </div>

      {server.error && (
        <div className="text-xs text-red-400 mb-2 truncate" title={server.error}>
          {server.error}
        </div>
      )}

      <div className="flex items-center gap-1">
        {canStart && (
          <button
            onClick={handleStart}
            className="p-1.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
            title="Start server"
          >
            <Play className="w-3 h-3" />
          </button>
        )}
        {(isRunning || isStarting) && (
          <button
            onClick={handleStop}
            className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title="Stop server"
          >
            <Square className="w-3 h-3" />
          </button>
        )}
        {isRunning && (
          <button
            onClick={handleRestart}
            className="p-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors"
            title="Restart server"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {server.capabilities && isRunning && (
        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
          {server.capabilities.tools && <span>Tools</span>}
          {server.capabilities.resources && <span>Resources</span>}
          {server.capabilities.prompts && <span>Prompts</span>}
        </div>
      )}
    </div>
  );
});

export function ServerList({
  servers,
  selectedServerId,
  onSelectServer,
  onStartServer,
  onStopServer,
  onRestartServer,
  onReload,
  loading,
}: ServerListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-[var(--holo-accent)]/10">
        <h2 className="text-sm font-medium text-[var(--holo-text)]">Servers</h2>
        <button
          onClick={onReload}
          disabled={loading}
          className="p-1 rounded text-gray-400 hover:text-[var(--holo-text)] hover:bg-[rgba(0,0,0,0.2)] transition-colors disabled:opacity-50"
          title="Reload settings"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {servers.length === 0 ? (
          <div className="text-center text-gray-500 text-sm p-4">
            <p>No MCP servers configured</p>
            <p className="text-xs mt-1">Add servers to ~/.claude/settings.json</p>
          </div>
        ) : (
          servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              selected={server.id === selectedServerId}
              onSelect={() => onSelectServer(server.id)}
              onStart={() => onStartServer(server.id)}
              onStop={() => onStopServer(server.id)}
              onRestart={() => onRestartServer(server.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

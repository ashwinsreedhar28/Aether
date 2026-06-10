/**
 * useMcpServers Hook
 *
 * Manages MCP server state - loads configurations and tracks server status.
 */

import { useState, useEffect, useCallback } from 'react';
import type { McpServerInfo } from '../types';

interface UseMcpServersResult {
  servers: McpServerInfo[];
  loading: boolean;
  error: string | null;
  selectedServerId: string | null;
  selectedServer: McpServerInfo | null;
  selectServer: (serverId: string | null) => void;
  startServer: (serverId: string) => Promise<void>;
  stopServer: (serverId: string) => Promise<void>;
  restartServer: (serverId: string) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

export function useMcpServers(): UseMcpServersResult {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // Load settings and server list
  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // First load settings to populate the configs
      await window.electron.mcp.loadSettings();

      // Then get server list with status
      const serverList = await window.electron.mcp.listServers();
      setServers(serverList);

      // Auto-select first server if none selected
      if (!selectedServerId && serverList.length > 0) {
        setSelectedServerId(serverList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }, [selectedServerId]);

  // Initial load
  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = window.electron.mcp.onStatusChange((info: McpServerInfo) => {
      setServers(prev => prev.map(s => (s.id === info.id ? info : s)));
    });

    return unsubscribe;
  }, []);

  // Select a server
  const selectServer = useCallback((serverId: string | null) => {
    setSelectedServerId(serverId);
  }, []);

  // Start a server
  const startServer = useCallback(async (serverId: string) => {
    try {
      await window.electron.mcp.startServer(serverId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start server');
    }
  }, []);

  // Stop a server
  const stopServer = useCallback(async (serverId: string) => {
    try {
      await window.electron.mcp.stopServer(serverId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop server');
    }
  }, []);

  // Restart a server
  const restartServer = useCallback(async (serverId: string) => {
    try {
      await window.electron.mcp.restartServer(serverId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart server');
    }
  }, []);

  // Get selected server
  const selectedServer = servers.find(s => s.id === selectedServerId) || null;

  return {
    servers,
    loading,
    error,
    selectedServerId,
    selectedServer,
    selectServer,
    startServer,
    stopServer,
    restartServer,
    reloadSettings: loadServers,
  };
}

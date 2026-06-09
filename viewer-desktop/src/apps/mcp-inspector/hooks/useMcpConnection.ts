/**
 * useMcpConnection Hook
 *
 * Fetches tools, resources, and prompts from a connected MCP server.
 */

import { useState, useEffect, useCallback } from 'react';
import type { McpTool, McpResource, McpPrompt, McpServerInfo } from '../types';

interface UseMcpConnectionResult {
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  loading: boolean;
  error: string | null;
  refreshTools: () => Promise<void>;
  refreshResources: () => Promise<void>;
  refreshPrompts: () => Promise<void>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
  getPrompt: (name: string, args?: Record<string, string>) => Promise<unknown>;
}

export function useMcpConnection(server: McpServerInfo | null): UseMcpConnectionResult {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverId = server?.id;
  const isRunning = server?.status === 'running';
  const hasTools = server?.capabilities?.tools;
  const hasResources = server?.capabilities?.resources;
  const hasPrompts = server?.capabilities?.prompts;

  // Refresh tools list
  const refreshTools = useCallback(async () => {
    if (!serverId || !isRunning) return;

    try {
      const toolList = await window.electron.mcp.listTools(serverId);
      setTools(toolList);
    } catch (err) {
      console.error('Failed to list tools:', err);
    }
  }, [serverId, isRunning]);

  // Refresh resources list
  const refreshResources = useCallback(async () => {
    if (!serverId || !isRunning) return;

    try {
      const resourceList = await window.electron.mcp.listResources(serverId);
      setResources(resourceList);
    } catch (err) {
      console.error('Failed to list resources:', err);
    }
  }, [serverId, isRunning]);

  // Refresh prompts list
  const refreshPrompts = useCallback(async () => {
    if (!serverId || !isRunning) return;

    try {
      const promptList = await window.electron.mcp.listPrompts(serverId);
      setPrompts(promptList);
    } catch (err) {
      console.error('Failed to list prompts:', err);
    }
  }, [serverId, isRunning]);

  // Load all data when server becomes available
  useEffect(() => {
    if (!serverId || !isRunning) {
      setTools([]);
      setResources([]);
      setPrompts([]);
      return;
    }

    const loadAll = async () => {
      setLoading(true);
      setError(null);

      try {
        const promises: Promise<void>[] = [];

        if (hasTools) promises.push(refreshTools());
        if (hasResources) promises.push(refreshResources());
        if (hasPrompts) promises.push(refreshPrompts());

        await Promise.all(promises);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load server data');
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [serverId, isRunning, hasTools, hasResources, hasPrompts, refreshTools, refreshResources, refreshPrompts]);

  // Call a tool
  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (!serverId) throw new Error('No server selected');
      return window.electron.mcp.callTool(serverId, name, args);
    },
    [serverId]
  );

  // Read a resource
  const readResource = useCallback(
    async (uri: string): Promise<unknown> => {
      if (!serverId) throw new Error('No server selected');
      return window.electron.mcp.readResource(serverId, uri);
    },
    [serverId]
  );

  // Get a prompt
  const getPrompt = useCallback(
    async (name: string, args?: Record<string, string>): Promise<unknown> => {
      if (!serverId) throw new Error('No server selected');
      return window.electron.mcp.getPrompt(serverId, name, args);
    },
    [serverId]
  );

  return {
    tools,
    resources,
    prompts,
    loading,
    error,
    refreshTools,
    refreshResources,
    refreshPrompts,
    callTool,
    readResource,
    getPrompt,
  };
}

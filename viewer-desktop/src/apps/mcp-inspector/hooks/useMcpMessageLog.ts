/**
 * useMcpMessageLog Hook
 *
 * Collects and filters JSON-RPC messages from MCP servers.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { McpMessage, MessageFilter } from '../types';

const MAX_MESSAGES = 1000;

interface UseMcpMessageLogResult {
  messages: McpMessage[];
  filteredMessages: McpMessage[];
  filter: MessageFilter;
  setFilter: (filter: MessageFilter) => void;
  clearMessages: () => void;
  serverFilter: string | null;
  setServerFilter: (serverId: string | null) => void;
}

export function useMcpMessageLog(): UseMcpMessageLogResult {
  const [messages, setMessages] = useState<McpMessage[]>([]);
  const [filter, setFilter] = useState<MessageFilter>({
    direction: 'all',
    method: '',
    search: '',
  });
  const [serverFilter, setServerFilter] = useState<string | null>(null);

  // Subscribe to messages
  useEffect(() => {
    const unsubscribe = window.electron.mcp.onMessage((message: McpMessage) => {
      setMessages(prev => {
        const newMessages = [message, ...prev];
        // Keep only the last MAX_MESSAGES
        if (newMessages.length > MAX_MESSAGES) {
          return newMessages.slice(0, MAX_MESSAGES);
        }
        return newMessages;
      });
    });

    return unsubscribe;
  }, []);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter(msg => {
      // Filter by server
      if (serverFilter && msg.serverId !== serverFilter) {
        return false;
      }

      // Filter by direction
      if (filter.direction && filter.direction !== 'all' && msg.direction !== filter.direction) {
        return false;
      }

      // Filter by method
      if (filter.method) {
        const method = 'method' in msg.message ? msg.message.method : '';
        if (!method.toLowerCase().includes(filter.method.toLowerCase())) {
          return false;
        }
      }

      // Filter by search text
      if (filter.search) {
        const json = JSON.stringify(msg.message).toLowerCase();
        if (!json.includes(filter.search.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }, [messages, filter, serverFilter]);

  return {
    messages,
    filteredMessages,
    filter,
    setFilter,
    clearMessages,
    serverFilter,
    setServerFilter,
  };
}

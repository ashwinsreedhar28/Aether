/**
 * useWebSocket Hook
 * Manages WebSocket connections
 */

import { useState, useCallback, useRef } from 'react';
import type { WebSocketConfig, WebSocketState, WebSocketMessage, Environment } from '../types';
import { resolveVariables } from './useEnvironments';
import { generateId } from '../constants';

interface UseWebSocketReturn {
  connect: (config: WebSocketConfig, environment: Environment | null) => void;
  disconnect: () => void;
  send: (message: string) => void;
  state: WebSocketState;
  clearMessages: () => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [state, setState] = useState<WebSocketState>({
    status: 'disconnected',
    messages: [],
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);

  const clearMessages = useCallback(() => {
    setState((s) => ({ ...s, messages: [] }));
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState((s) => ({ ...s, status: 'disconnected' }));
  }, []);

  const connect = useCallback(
    (config: WebSocketConfig, environment: Environment | null) => {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Resolve URL with environment variables
      const url = resolveVariables(config.url, environment);

      setState({
        status: 'connecting',
        messages: [],
        error: null,
      });

      try {
        // Build protocols array
        const protocols = config.protocols?.filter((p) => p.trim()) || [];

        // Create WebSocket
        const ws = new WebSocket(url, protocols.length > 0 ? protocols : undefined);

        ws.onopen = () => {
          setState((s) => ({ ...s, status: 'connected', error: null }));
        };

        ws.onmessage = (event) => {
          const message: WebSocketMessage = {
            id: generateId(),
            direction: 'received',
            data: typeof event.data === 'string' ? event.data : '[Binary data]',
            timestamp: new Date().toISOString(),
            type: typeof event.data === 'string' ? 'text' : 'binary',
          };
          setState((s) => ({
            ...s,
            messages: [...s.messages, message],
          }));
        };

        ws.onerror = () => {
          setState((s) => ({
            ...s,
            status: 'error',
            error: 'Connection error',
          }));
        };

        ws.onclose = (event) => {
          setState((s) => ({
            ...s,
            status: 'disconnected',
            error: event.code !== 1000 ? `Connection closed: ${event.reason || event.code}` : null,
          }));
          wsRef.current = null;
        };

        wsRef.current = ws;
      } catch (err) {
        setState({
          status: 'error',
          messages: [],
          error: err instanceof Error ? err.message : 'Failed to connect',
        });
      }
    },
    []
  );

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);

      const message: WebSocketMessage = {
        id: generateId(),
        direction: 'sent',
        data,
        timestamp: new Date().toISOString(),
        type: 'text',
      };

      setState((s) => ({
        ...s,
        messages: [...s.messages, message],
      }));
    }
  }, []);

  return {
    connect,
    disconnect,
    send,
    state,
    clearMessages,
  };
}

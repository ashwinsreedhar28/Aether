/**
 * MCP Inspector Types
 *
 * Re-exports types from preload and adds UI-specific types.
 */

// Re-export types from preload
export type {
  McpServerConfig,
  ClaudeSettings,
  McpServerStatus,
  McpServerInfo,
  McpTool,
  McpResource,
  McpPrompt,
  McpMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from '../../../electron/preload/index';

// UI-specific types
export type TabId = 'tools' | 'resources' | 'prompts' | 'messages';

export interface ToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

export interface ResourceReadResult {
  success: boolean;
  content?: unknown;
  error?: string;
}

export interface PromptGetResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface MessageFilter {
  direction?: 'sent' | 'received' | 'all';
  method?: string;
  search?: string;
}

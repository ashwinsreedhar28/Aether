/**
 * MCP Inspector Types
 *
 * App-local MCP protocol types and UI-specific types. These protocol shapes
 * are defined locally (structurally compatible with window.electron.mcp.*
 * return types) so the app has zero dependency on the electron preload layer.
 */

// MCP protocol types
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSettings {
  mcpServers?: Record<string, McpServerConfig>;
}

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface McpServerInfo {
  id: string;
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  serverInfo?: {
    name?: string;
    version?: string;
  };
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface McpMessage {
  timestamp: number;
  serverId: string;
  direction: 'sent' | 'received';
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
}

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

/**
 * MCP Server Manager
 *
 * Manages MCP (Model Context Protocol) server processes.
 * Reads configurations from ~/.claude/settings.json and spawns servers
 * using stdio transport with JSON-RPC 2.0 protocol.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';

// JSON-RPC 2.0 Types
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

// MCP Types
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeSettings {
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

export interface McpMessage {
  timestamp: number;
  serverId: string;
  direction: 'sent' | 'received';
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  startTime: number;
}

interface ServerProcess {
  process: ChildProcess;
  readline: Interface;
  pendingRequests: Map<number | string, PendingRequest>;
  nextId: number;
  info: McpServerInfo;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * McpServerManager handles spawning and communicating with MCP servers
 */
export class McpServerManager extends EventEmitter {
  private servers: Map<string, ServerProcess> = new Map();
  private settings: ClaudeSettings | null = null;

  /**
   * Load MCP server configurations from Claude Code settings
   */
  async loadSettings(): Promise<ClaudeSettings> {
    const settingsPath = join(homedir(), '.claude', 'settings.json');

    try {
      const content = await readFile(settingsPath, 'utf-8');
      this.settings = JSON.parse(content) as ClaudeSettings;
      return this.settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.settings = { mcpServers: {} };
        return this.settings;
      }
      throw error;
    }
  }

  /**
   * Get all configured server IDs and their configs
   */
  getServerConfigs(): Record<string, McpServerConfig> {
    return this.settings?.mcpServers || {};
  }

  /**
   * Get status info for all servers
   */
  listServers(): McpServerInfo[] {
    const configs = this.getServerConfigs();
    const result: McpServerInfo[] = [];

    for (const [id, config] of Object.entries(configs)) {
      const server = this.servers.get(id);
      if (server) {
        result.push(server.info);
      } else {
        result.push({
          id,
          config,
          status: 'stopped',
        });
      }
    }

    return result;
  }

  /**
   * Get status for a single server
   */
  getServerStatus(serverId: string): McpServerInfo | null {
    const server = this.servers.get(serverId);
    if (server) {
      return server.info;
    }

    const config = this.settings?.mcpServers?.[serverId];
    if (config) {
      return {
        id: serverId,
        config,
        status: 'stopped',
      };
    }

    return null;
  }

  /**
   * Start an MCP server
   */
  async startServer(serverId: string): Promise<McpServerInfo> {
    // Check if already running
    if (this.servers.has(serverId)) {
      return this.servers.get(serverId)!.info;
    }

    const config = this.settings?.mcpServers?.[serverId];
    if (!config) {
      throw new Error(`Server "${serverId}" not found in settings`);
    }

    const info: McpServerInfo = {
      id: serverId,
      config,
      status: 'starting',
    };

    this.emitStatusChange(info);

    try {
      // Spawn the process
      const proc = spawn(config.command, config.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...config.env,
        },
      });

      // Set up readline for stdout
      const rl = createInterface({ input: proc.stdout! });

      const serverProcess: ServerProcess = {
        process: proc,
        readline: rl,
        pendingRequests: new Map(),
        nextId: 1,
        info,
      };

      this.servers.set(serverId, serverProcess);

      // Handle incoming messages
      rl.on('line', (line) => {
        this.handleLine(serverId, line);
      });

      // Handle stderr
      proc.stderr?.on('data', (data) => {
        const message = data.toString();
        console.error(`[MCP ${serverId}] stderr:`, message);
      });

      // Handle process exit
      proc.on('exit', (code) => {
        this.handleProcessExit(serverId, code);
      });

      proc.on('error', (error) => {
        this.handleProcessError(serverId, error);
      });

      // Initialize the server
      await this.initializeServer(serverId);

      info.status = 'running';
      this.emitStatusChange(info);

      return info;
    } catch (error) {
      info.status = 'error';
      info.error = error instanceof Error ? error.message : String(error);
      this.emitStatusChange(info);
      this.servers.delete(serverId);
      throw error;
    }
  }

  /**
   * Stop a running server
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    // Reject all pending requests
    for (const [, pending] of server.pendingRequests) {
      pending.reject(new Error('Server stopped'));
    }

    // Close readline and kill process
    server.readline.close();
    server.process.kill();

    // Update status
    server.info.status = 'stopped';
    server.info.error = undefined;
    this.emitStatusChange(server.info);

    this.servers.delete(serverId);
  }

  /**
   * Restart a server
   */
  async restartServer(serverId: string): Promise<McpServerInfo> {
    await this.stopServer(serverId);
    return this.startServer(serverId);
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async sendRequest(serverId: string, method: string, params?: unknown): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server "${serverId}" is not running`);
    }

    const id = server.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      server.pendingRequests.set(id, {
        resolve,
        reject,
        method,
        startTime: Date.now(),
      });

      this.writeMessage(serverId, request);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  sendNotification(serverId: string, method: string, params?: unknown): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server "${serverId}" is not running`);
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.writeMessage(serverId, notification);
  }

  /**
   * Send a raw JSON-RPC message
   */
  sendRaw(serverId: string, message: JsonRpcRequest | JsonRpcNotification): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server "${serverId}" is not running`);
    }

    this.writeMessage(serverId, message);
  }

  /**
   * List tools available from a server
   */
  async listTools(serverId: string): Promise<McpTool[]> {
    const result = await this.sendRequest(serverId, 'tools/list') as { tools?: McpTool[] };
    return result?.tools || [];
  }

  /**
   * Call a tool on a server
   */
  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest(serverId, 'tools/call', {
      name,
      arguments: args,
    });
  }

  /**
   * List resources available from a server
   */
  async listResources(serverId: string): Promise<McpResource[]> {
    const result = await this.sendRequest(serverId, 'resources/list') as { resources?: McpResource[] };
    return result?.resources || [];
  }

  /**
   * Read a resource from a server
   */
  async readResource(serverId: string, uri: string): Promise<unknown> {
    return this.sendRequest(serverId, 'resources/read', { uri });
  }

  /**
   * List prompts available from a server
   */
  async listPrompts(serverId: string): Promise<McpPrompt[]> {
    const result = await this.sendRequest(serverId, 'prompts/list') as { prompts?: McpPrompt[] };
    return result?.prompts || [];
  }

  /**
   * Get a prompt from a server
   */
  async getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<unknown> {
    return this.sendRequest(serverId, 'prompts/get', {
      name,
      arguments: args,
    });
  }

  /**
   * Stop all servers
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map(id => this.stopServer(id));
    await Promise.all(stopPromises);
  }

  // Private methods

  private async initializeServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server "${serverId}" not found`);
    }

    // Send initialize request
    const result = await this.sendRequest(serverId, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: {
        name: 'VIEWER MCP Inspector',
        version: '1.0.0',
      },
    }) as {
      serverInfo?: { name?: string; version?: string };
      capabilities?: { tools?: object; resources?: object; prompts?: object };
    };

    // Update server info with capabilities
    server.info.serverInfo = result?.serverInfo;
    server.info.capabilities = {
      tools: !!result?.capabilities?.tools,
      resources: !!result?.capabilities?.resources,
      prompts: !!result?.capabilities?.prompts,
    };

    // Send initialized notification
    this.sendNotification(serverId, 'notifications/initialized');
  }

  private writeMessage(serverId: string, message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    const json = JSON.stringify(message);
    server.process.stdin?.write(json + '\n');

    // Emit message event
    const mcpMessage: McpMessage = {
      timestamp: Date.now(),
      serverId,
      direction: 'sent',
      message,
    };
    this.emit('message', mcpMessage);
  }

  private handleLine(serverId: string, line: string): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(line);
    } catch {
      console.error(`[MCP ${serverId}] Invalid JSON:`, line);
      return;
    }

    // Emit message event
    const mcpMessage: McpMessage = {
      timestamp: Date.now(),
      serverId,
      direction: 'received',
      message,
    };
    this.emit('message', mcpMessage);

    // Handle response
    if ('id' in message && message.id !== null && message.id !== undefined) {
      const response = message as JsonRpcResponse;
      // Guarded above: message.id is non-null here.
      const pending = server.pendingRequests.get(response.id!);

      if (pending) {
        server.pendingRequests.delete(response.id!);

        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    }
    // Handle notification from server
    else if ('method' in message) {
      this.emit('notification', serverId, message);
    }
  }

  private handleProcessExit(serverId: string, code: number | null): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    // Reject all pending requests
    for (const [, pending] of server.pendingRequests) {
      pending.reject(new Error(`Server exited with code ${code}`));
    }

    server.info.status = 'stopped';
    if (code !== 0) {
      server.info.error = `Process exited with code ${code}`;
    }
    this.emitStatusChange(server.info);

    this.servers.delete(serverId);
  }

  private handleProcessError(serverId: string, error: Error): void {
    const server = this.servers.get(serverId);
    if (!server) return;

    // Reject all pending requests
    for (const [, pending] of server.pendingRequests) {
      pending.reject(error);
    }

    server.info.status = 'error';
    server.info.error = error.message;
    this.emitStatusChange(server.info);

    this.servers.delete(serverId);
  }

  private emitStatusChange(info: McpServerInfo): void {
    this.emit('statusChange', info);
  }
}

// Singleton instance
let mcpServerManager: McpServerManager | null = null;

export function getMcpServerManager(): McpServerManager {
  if (!mcpServerManager) {
    mcpServerManager = new McpServerManager();
  }
  return mcpServerManager;
}

export function cleanupMcpServerManager(): void {
  if (mcpServerManager) {
    void mcpServerManager.stopAll();
    mcpServerManager = null;
  }
}

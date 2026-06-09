/**
 * MCP IPC Handlers
 *
 * Registers IPC handlers for MCP server management.
 * Bridges the Electron main process MCP manager to the renderer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  getMcpServerManager,
  cleanupMcpServerManager,
  type McpServerInfo,
  type McpTool,
  type McpResource,
  type McpPrompt,
  type McpMessage,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type ClaudeSettings,
} from '../services/mcpServerManager';

/**
 * Register all MCP-related IPC handlers
 */
export function registerMcpHandlers(_getMainWindow: () => BrowserWindow | null): void {
  const manager = getMcpServerManager();

  // Set up event forwarding to renderer
  manager.on('statusChange', (info: McpServerInfo) => {
    broadcastToWindows('mcp:statusChange', info);
  });

  manager.on('message', (message: McpMessage) => {
    broadcastToWindows('mcp:message', message);
  });

  manager.on('notification', (serverId: string, notification: JsonRpcNotification) => {
    broadcastToWindows('mcp:notification', { serverId, notification });
  });

  // Load settings
  ipcMain.handle('mcp:loadSettings', async (): Promise<ClaudeSettings> => {
    return manager.loadSettings();
  });

  // List all configured servers with status
  ipcMain.handle('mcp:listServers', (): McpServerInfo[] => {
    return manager.listServers();
  });

  // Get status of a single server
  ipcMain.handle('mcp:getServerStatus', (_, serverId: string): McpServerInfo | null => {
    return manager.getServerStatus(serverId);
  });

  // Start a server
  ipcMain.handle('mcp:startServer', async (_, serverId: string): Promise<McpServerInfo> => {
    return manager.startServer(serverId);
  });

  // Stop a server
  ipcMain.handle('mcp:stopServer', async (_, serverId: string): Promise<void> => {
    return manager.stopServer(serverId);
  });

  // Restart a server
  ipcMain.handle('mcp:restartServer', async (_, serverId: string): Promise<McpServerInfo> => {
    return manager.restartServer(serverId);
  });

  // List tools from a server
  ipcMain.handle('mcp:listTools', async (_, serverId: string): Promise<McpTool[]> => {
    return manager.listTools(serverId);
  });

  // Call a tool
  ipcMain.handle(
    'mcp:callTool',
    async (_, serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> => {
      return manager.callTool(serverId, toolName, args);
    }
  );

  // List resources from a server
  ipcMain.handle('mcp:listResources', async (_, serverId: string): Promise<McpResource[]> => {
    return manager.listResources(serverId);
  });

  // Read a resource
  ipcMain.handle('mcp:readResource', async (_, serverId: string, uri: string): Promise<unknown> => {
    return manager.readResource(serverId, uri);
  });

  // List prompts from a server
  ipcMain.handle('mcp:listPrompts', async (_, serverId: string): Promise<McpPrompt[]> => {
    return manager.listPrompts(serverId);
  });

  // Get a prompt
  ipcMain.handle(
    'mcp:getPrompt',
    async (_, serverId: string, promptName: string, args?: Record<string, string>): Promise<unknown> => {
      return manager.getPrompt(serverId, promptName, args);
    }
  );

  // Send raw JSON-RPC message
  ipcMain.handle(
    'mcp:sendRaw',
    (_, serverId: string, message: JsonRpcRequest | JsonRpcNotification): void => {
      manager.sendRaw(serverId, message);
    }
  );
}

/**
 * Broadcast a message to all windows
 */
function broadcastToWindows(channel: string, ...args: unknown[]): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      try {
        const webContents = win.webContents;
        if (!webContents.isDestroyed()) {
          const mainFrame = webContents.mainFrame;
          if (mainFrame) {
            webContents.send(channel, ...args);
          }
        }
      } catch {
        // Ignore errors during window destruction
      }
    }
  }
}

/**
 * Cleanup MCP handlers and stop all servers
 */
export function cleanupMcpHandlers(): void {
  cleanupMcpServerManager();
}

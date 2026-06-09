import { contextBridge, ipcRenderer } from 'electron';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modified: string;
  size: number;
  extension?: string;
  children?: FileNode[];
}

export interface FileReadResponse {
  path: string;
  content: string;
  modified: string;
  isImage?: boolean;
  /** True when the file no longer exists (e.g. deleted while a tab still references it). */
  notFound?: boolean;
  /** Human-readable error when the file could not be read. */
  error?: string;
}

export interface FileChangeEvent {
  type: 'file-changed' | 'file-created' | 'file-deleted';
  path: string;
}

// The persisted user config is a heterogeneous JSON blob — different renderer
// stores read/write their own subsets (windows, workspaces, settings, sound).
// Fields are optional; the consuming store refines the loosely-typed values.
export interface ViewerConfig {
  windows?: Array<Record<string, unknown>>;
  expandedDirs?: string[];
  recentFiles?: string[];
  favorites?: string[];
  recentFolders?: Array<{ path: string; name: string; lastOpened: number }>;
  workspaces?: Array<Record<string, unknown>>;
  soundConfig?: unknown;
  appSettings?: unknown;
}

export interface TerminalCreateResponse {
  sessionId: string;
  shell: string;
  cwd: string;
}

export interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface TerminalShellsResponse {
  shells: string[];
  defaultShell: string;
}

// Claude types
export interface ClaudeStreamMessage {
  type: 'assistant' | 'user' | 'result' | 'system' | 'stream_event';
  uuid?: string;
  session_id?: string;
  message?: {
    content?: Array<{
      type: 'text' | 'tool_use' | 'tool_result';
      text?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  event?: {
    delta?: {
      type: string;
      text?: string;
    };
  };
  is_error?: boolean;
  errors?: string[];
  result?: string;
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

const electronAPI = {
  // File system operations
  fs: {
    getTree: (options?: { showHidden?: boolean }): Promise<{ tree: FileNode }> =>
      ipcRenderer.invoke('fs:getTree', options),

    getChildren: (dirPath: string, options?: { showHidden?: boolean }): Promise<{ children: FileNode[] }> =>
      ipcRenderer.invoke('fs:getChildren', dirPath, options),

    watchDir: (dirPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('fs:watchDir', dirPath),

    unwatchDir: (dirPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('fs:unwatchDir', dirPath),

    readFile: (path: string): Promise<FileReadResponse> =>
      ipcRenderer.invoke('fs:readFile', path),

    writeFile: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', path, content),

    createFile: (path: string, type: 'file' | 'directory'): Promise<void> =>
      ipcRenderer.invoke('fs:createFile', path, type),

    deleteFile: (path: string): Promise<void> =>
      ipcRenderer.invoke('fs:deleteFile', path),

    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),

    onChange: (callback: (event: FileChangeEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: FileChangeEvent) =>
        callback(data);
      ipcRenderer.on('fs:onChange', handler);
      return () => {
        ipcRenderer.removeListener('fs:onChange', handler);
      };
    },
  },

  // App operations
  app: {
    getRootDir: (): Promise<string | null> => ipcRenderer.invoke('app:getRootDir'),

    hasWorkspace: (): Promise<boolean> => ipcRenderer.invoke('app:hasWorkspace'),

    setRootDir: (path: string): Promise<string> =>
      ipcRenderer.invoke('app:setRootDir', path),

    openFolderDialog: (addToExisting = false): Promise<{ path: string; addToExisting: boolean } | null> =>
      ipcRenderer.invoke('dialog:openFolder', addToExisting),

    onRootDirChanged: (callback: (path: string, addToExisting: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string, addToExisting: boolean) =>
        callback(path, addToExisting);
      ipcRenderer.on('app:rootDirChanged', handler);
      return () => {
        ipcRenderer.removeListener('app:rootDirChanged', handler);
      };
    },

    onInitialFolder: (callback: (path: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string) =>
        callback(path);
      ipcRenderer.on('app:initialFolder', handler);
      return () => {
        ipcRenderer.removeListener('app:initialFolder', handler);
      };
    },

    onMenuNewTerminal: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:new-terminal', handler);
      return () => {
        ipcRenderer.removeListener('menu:new-terminal', handler);
      };
    },

    onMenuCloseWorkspace: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:close-workspace', handler);
      return () => {
        ipcRenderer.removeListener('menu:close-workspace', handler);
      };
    },

    onMenuCloseTab: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:close-tab', handler);
      return () => {
        ipcRenderer.removeListener('menu:close-tab', handler);
      };
    },

    onMenuOpenSearch: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:open-search', handler);
      return () => {
        ipcRenderer.removeListener('menu:open-search', handler);
      };
    },

    onMenuToggleExplorer: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:toggle-explorer', handler);
      return () => {
        ipcRenderer.removeListener('menu:toggle-explorer', handler);
      };
    },

    onMenuTileWindows: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:tile-windows', handler);
      return () => {
        ipcRenderer.removeListener('menu:tile-windows', handler);
      };
    },

    onMenuMaximizeWindow: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:maximize-window', handler);
      return () => {
        ipcRenderer.removeListener('menu:maximize-window', handler);
      };
    },

    onMenuPrevTab: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:prev-tab', handler);
      return () => {
        ipcRenderer.removeListener('menu:prev-tab', handler);
      };
    },

    onMenuNextTab: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:next-tab', handler);
      return () => {
        ipcRenderer.removeListener('menu:next-tab', handler);
      };
    },

    onMenuFocusUp: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:focus-up', handler);
      return () => {
        ipcRenderer.removeListener('menu:focus-up', handler);
      };
    },

    onMenuFocusDown: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:focus-down', handler);
      return () => {
        ipcRenderer.removeListener('menu:focus-down', handler);
      };
    },

    onMenuFocusLeft: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:focus-left', handler);
      return () => {
        ipcRenderer.removeListener('menu:focus-left', handler);
      };
    },

    onMenuFocusRight: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:focus-right', handler);
      return () => {
        ipcRenderer.removeListener('menu:focus-right', handler);
      };
    },

    onMenuNewProject: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:new-project', handler);
      return () => {
        ipcRenderer.removeListener('menu:new-project', handler);
      };
    },

    onMenuLayoutPreset: (callback: (preset: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, preset: string) => callback(preset);
      ipcRenderer.on('menu:layout-preset', handler);
      return () => {
        ipcRenderer.removeListener('menu:layout-preset', handler);
      };
    },

    onMenuOpenClaudePalette: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:open-claude-palette', handler);
      return () => {
        ipcRenderer.removeListener('menu:open-claude-palette', handler);
      };
    },
  },

  // Config operations
  config: {
    load: (): Promise<ViewerConfig | null> => ipcRenderer.invoke('config:load'),

    save: (config: ViewerConfig): Promise<void> =>
      ipcRenderer.invoke('config:save', config),
  },

  // Terminal operations
  terminal: {
    create: (cwd?: string, shell?: string): Promise<TerminalCreateResponse> =>
      ipcRenderer.invoke('terminal:create', cwd, shell),

    write: (sessionId: string, data: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('terminal:write', sessionId, data),

    resize: (sessionId: string, cols: number, rows: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),

    kill: (sessionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('terminal:kill', sessionId),

    getShells: (): Promise<TerminalShellsResponse> =>
      ipcRenderer.invoke('terminal:getShells'),

    getSession: (sessionId: string): Promise<{ id: string; shell: string; cwd: string } | null> =>
      ipcRenderer.invoke('terminal:getSession', sessionId),

    onData: (callback: (event: TerminalDataEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: TerminalDataEvent) =>
        callback(data);
      ipcRenderer.on('terminal:data', handler);
      return () => {
        ipcRenderer.removeListener('terminal:data', handler);
      };
    },

    onExit: (callback: (event: TerminalExitEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: TerminalExitEvent) =>
        callback(data);
      ipcRenderer.on('terminal:exit', handler);
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler);
      };
    },
  },

  // Browser operations
  browser: {
    openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('browser:openExternal', url),
  },

  // Leap service operations
  leap: {
    status: (): Promise<{
      running: boolean;
      managed: boolean;
      pid: number | null;
      path: string;
    }> => ipcRenderer.invoke('leap:status'),

    ensureService: (enabled: boolean): Promise<{
      running: boolean;
      managed: boolean;
      pid: number | null;
      path: string;
    }> => ipcRenderer.invoke('leap:ensureService', enabled),
  },

  // MCP operations
  mcp: {
    // Load settings from ~/.claude/settings.json
    loadSettings: (): Promise<ClaudeSettings> =>
      ipcRenderer.invoke('mcp:loadSettings'),

    // List all configured servers with status
    listServers: (): Promise<McpServerInfo[]> =>
      ipcRenderer.invoke('mcp:listServers'),

    // Get status of a single server
    getServerStatus: (serverId: string): Promise<McpServerInfo | null> =>
      ipcRenderer.invoke('mcp:getServerStatus', serverId),

    // Start a server
    startServer: (serverId: string): Promise<McpServerInfo> =>
      ipcRenderer.invoke('mcp:startServer', serverId),

    // Stop a server
    stopServer: (serverId: string): Promise<void> =>
      ipcRenderer.invoke('mcp:stopServer', serverId),

    // Restart a server
    restartServer: (serverId: string): Promise<McpServerInfo> =>
      ipcRenderer.invoke('mcp:restartServer', serverId),

    // List tools from a server
    listTools: (serverId: string): Promise<McpTool[]> =>
      ipcRenderer.invoke('mcp:listTools', serverId),

    // Call a tool
    callTool: (serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('mcp:callTool', serverId, toolName, args),

    // List resources from a server
    listResources: (serverId: string): Promise<McpResource[]> =>
      ipcRenderer.invoke('mcp:listResources', serverId),

    // Read a resource
    readResource: (serverId: string, uri: string): Promise<unknown> =>
      ipcRenderer.invoke('mcp:readResource', serverId, uri),

    // List prompts from a server
    listPrompts: (serverId: string): Promise<McpPrompt[]> =>
      ipcRenderer.invoke('mcp:listPrompts', serverId),

    // Get a prompt
    getPrompt: (serverId: string, promptName: string, args?: Record<string, string>): Promise<unknown> =>
      ipcRenderer.invoke('mcp:getPrompt', serverId, promptName, args),

    // Send raw JSON-RPC message
    sendRaw: (serverId: string, message: JsonRpcRequest | JsonRpcNotification): Promise<void> =>
      ipcRenderer.invoke('mcp:sendRaw', serverId, message),

    // Event: Server status changed
    onStatusChange: (callback: (info: McpServerInfo) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, info: McpServerInfo) => callback(info);
      ipcRenderer.on('mcp:statusChange', handler);
      return () => ipcRenderer.removeListener('mcp:statusChange', handler);
    },

    // Event: JSON-RPC message sent/received
    onMessage: (callback: (message: McpMessage) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, message: McpMessage) => callback(message);
      ipcRenderer.on('mcp:message', handler);
      return () => ipcRenderer.removeListener('mcp:message', handler);
    },

    // Event: Notification from server
    onNotification: (callback: (data: { serverId: string; notification: JsonRpcNotification }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { serverId: string; notification: JsonRpcNotification }) => callback(data);
      ipcRenderer.on('mcp:notification', handler);
      return () => ipcRenderer.removeListener('mcp:notification', handler);
    },
  },

  // Claude Command Palette operations
  claude: {
    query: (prompt: string, context: { cwd: string; currentFile?: string; model?: string; resume?: string; openFiles?: string[] }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('claude:query', prompt, context),

    abort: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('claude:abort'),

    getAuthStatus: (): Promise<{ authenticated: boolean; email?: string }> =>
      ipcRenderer.invoke('claude:auth-status'),

    onStream: (callback: (message: ClaudeStreamMessage) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, message: ClaudeStreamMessage) => callback(message);
      ipcRenderer.on('claude:stream', handler);
      return () => ipcRenderer.removeListener('claude:stream', handler);
    },
  },

  // Control bridge operations
  control: {
    bridgeReady: (): Promise<void> =>
      ipcRenderer.invoke('control:bridge-ready'),

    // Human→agent feedback: the renderer reports an interaction on a hosted view
    // (it knows its own windowId, not the agent-assigned View.id) and the main
    // process emits it as a view_event back to the opening agent. Fire-and-forget.
    emitViewEvent: (
      windowId: string,
      action: string,
      data: Record<string, unknown>
    ): Promise<void> =>
      ipcRenderer.invoke('control:emit-view-event', windowId, action, data),
  },

  // Whisper dictation operations
  whisper: {
    setApiKey: (apiKey: string | null): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('whisper:setApiKey', apiKey),

    transcribe: (
      audioData: ArrayBuffer,
      language: string | null
    ): Promise<{ success: boolean; text?: string; error?: string }> =>
      ipcRenderer.invoke('whisper:transcribe', audioData, language),

    hasApiKey: (): Promise<{ hasKey: boolean }> =>
      ipcRenderer.invoke('whisper:hasApiKey'),
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);

// Export type for use in renderer
export type ElectronAPI = typeof electronAPI;

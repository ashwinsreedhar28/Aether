// Tab state
export interface TabState {
  id: string;              // Unique tab identifier
  title: string;           // Tab display name (filename)
  filePath: string;        // File being displayed
  appId: string;           // App type (markdown-viewer, json-viewer, etc.)
  isDirty: boolean;        // Has unsaved changes
  isActive: boolean;       // Currently visible tab
  isSuspended?: boolean;   // App suspended/unmounted to save resources
}

// Window state
export interface WindowState {
  id: string;
  title: string;
  tabs?: TabState[];        // Array of tabs in this window (optional for backwards compat)
  activeTabId?: string;     // Currently visible tab (optional for backwards compat)
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  // Legacy properties (for backwards compatibility during migration)
  appId?: string;
  filePath?: string;
}

// App registry entry
export interface AppEntry {
  id: string;
  name: string;
  icon: string;
  component: React.ComponentType<AppProps>;
  fileTypes?: string[];
  defaultSize?: { width: number; height: number };
}

// Props passed to app components
export interface AppProps {
  windowId: string;
  filePath?: string;
}

// File system types
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  modified?: string;
  size?: number;
}

// File content
export interface FileContent {
  path: string;
  content: string;
  modified: string;
}

// Viewer config (persisted to .viewer/config.json)
export interface ViewerConfig {
  windows: WindowState[];
  expandedDirs: string[];
  recentFiles: string[];
  favorites: string[];
}

// File server API responses
export interface FileTreeResponse {
  tree: FileNode;
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

export interface FileWriteResponse {
  success: boolean;
  path: string;
}

// WebSocket events
export type WSEvent =
  | { type: 'file-changed'; path: string }
  | { type: 'file-created'; path: string }
  | { type: 'file-deleted'; path: string }
  | { type: 'connected' };

// Terminal types
export interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
}

export interface TerminalSettings {
  defaultShell: string;
  fontSize: number;
  fontFamily: string;
}

import type { ComponentType } from 'react';

/**
 * Props passed to all app components
 */
export interface AppProps {
  windowId: string;
  tabId: string;
  filePath?: string;
  isActive: boolean;
  /** Optional: lets an app report its display title back to the host tab (e.g. the browser). */
  onTitleChange?: (title: string) => void;
}

/**
 * Definition for a registered app
 */
export interface AppDefinition {
  /** Unique identifier (e.g., 'markdown-editor') */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Lucide icon name */
  icon: string;
  /** The React component to render */
  component: ComponentType<AppProps>;
  /** File extensions this app handles (e.g., ['md', 'markdown']) */
  fileTypes?: string[];
  /** Default window size when opening */
  defaultSize?: { width: number; height: number };
}

/**
 * Context value available to apps via useAppContext()
 */
export interface AppContextValue {
  /** Current window ID */
  windowId: string;
  /** Current tab ID */
  tabId: string;
  /** Open a file (in current window as new tab) */
  openFile: (path: string) => void;
  /** Open a new window with an app */
  openWindow: (appId: string, filePath?: string) => void;
  /** Close the current tab */
  closeTab: () => void;
  /** Mark the current tab as dirty (unsaved changes) */
  setDirty: (isDirty: boolean) => void;
  /** Update current tab metadata (e.g., title/url for standalone apps) */
  updateTab: (updates: { title?: string; filePath?: string }) => void;
  /** Suspend/unmount the current tab to save resources */
  setSuspended: (isSuspended: boolean) => void;
  /** File API for reading/writing files */
  fileApi: {
    readFile: (path: string) => Promise<{ content: string; isImage?: boolean }>;
    writeFile: (path: string, content: string) => Promise<void>;
  };
}

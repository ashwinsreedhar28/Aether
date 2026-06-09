import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { fileApi } from '../stores/fileSystemStore';
import { isKanbanFile } from './fileMatchers';
import type { AppContextValue } from './types';

const AppContext = createContext<AppContextValue | null>(null);

interface AppProviderProps {
  children: ReactNode;
  windowId: string;
  tabId: string;
}

/**
 * Provider that gives apps access to viewer APIs
 */
export function AppProvider({ children, windowId, tabId }: AppProviderProps) {
  const addTab = useWorkspaceStore(s => s.addTab);
  const removeTab = useWorkspaceStore(s => s.removeTab);
  const updateTabDirty = useWorkspaceStore(s => s.updateTabDirty);
  const updateTab = useWorkspaceStore(s => s.updateTab);
  const setTabSuspended = useWorkspaceStore(s => s.setTabSuspended);
  const openWindow = useWorkspaceStore(s => s.openWindow);

  const value = useMemo<AppContextValue>(() => ({
    windowId,
    tabId,

    openFile: (path: string) => {
      // Determine appId from file extension
      const ext = path.split('.').pop()?.toLowerCase() || '';
      let appId = 'text-editor';

      if (isKanbanFile(path)) {
        appId = 'kanban-board';
      } else if (['md', 'markdown'].includes(ext)) {
        appId = 'markdown-editor';
      } else if (ext === 'json') {
        appId = 'json-viewer';
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
        appId = 'image-viewer';
      }

      const fileName = path.split('/').pop() || 'Untitled';
      addTab(windowId, path, appId, fileName);
    },

    openWindow: (appId: string, filePath?: string) => {
      openWindow({
        title: filePath?.split('/').pop() || appId,
        tabs: filePath ? [{
          id: crypto.randomUUID(),
          title: filePath.split('/').pop() || 'Untitled',
          filePath,
          appId,
          isDirty: false,
          isActive: true,
        }] : undefined,
        position: { x: 100, y: 100 },
        size: { width: 800, height: 600 },
        isMinimized: false,
        isMaximized: false,
      });
    },

    closeTab: () => {
      removeTab(windowId, tabId);
    },

    setDirty: (isDirty: boolean) => {
      updateTabDirty(windowId, tabId, isDirty);
    },

    updateTab: (updates: { title?: string; filePath?: string }) => {
      updateTab(windowId, tabId, updates);
    },

    setSuspended: (isSuspended: boolean) => {
      setTabSuspended(windowId, tabId, isSuspended);
    },

    fileApi: {
      readFile: fileApi.readFile,
      writeFile: fileApi.writeFile,
    },
  }), [windowId, tabId, addTab, removeTab, updateTabDirty, updateTab, setTabSuspended, openWindow]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to access viewer APIs from within an app
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider by design
export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

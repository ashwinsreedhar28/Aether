/**
 * Control Bridge
 * Exposes Zustand store actions to the Electron main process via window.__viewerControl.
 * The control server calls these actions via mainWindow.webContents.executeJavaScript().
 */

import { useWorkspaceStore } from '../stores/workspaceStore';
import { getAppForFile, getApps } from '../apps';

type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, ActionHandler> = {
  'get-state': () => {
    const store = useWorkspaceStore.getState();
    return {
      workspaces: store.workspaces.map(w => ({
        id: w.id,
        rootDir: w.rootDir,
        name: w.name,
        isActive: w.id === store.activeWorkspaceId,
        windows: w.windows.map(win => ({
          id: win.id,
          title: win.title,
          isMinimized: win.isMinimized,
          isMaximized: win.isMaximized,
          position: win.position,
          size: win.size,
          zIndex: win.zIndex,
          tabs: (win.tabs || []).map(t => ({
            id: t.id,
            title: t.title,
            filePath: t.filePath,
            appId: t.appId,
            isActive: t.isActive,
            isDirty: t.isDirty,
          })),
          activeTabId: win.activeTabId,
        })),
      })),
      activeWorkspaceId: store.activeWorkspaceId,
    };
  },

  'get-apps': () => {
    const apps = getApps();
    return apps.map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      fileTypes: a.fileTypes || [],
      defaultSize: a.defaultSize || { width: 600, height: 500 },
    }));
  },

  'open-file': (params: Record<string, unknown>) => {
    const filePath = params.path as string;
    const forceAppId = params.appId as string | undefined;
    const targetWindowId = params.windowId as string | undefined;

    const store = useWorkspaceStore.getState();
    const workspace = store.getActiveWorkspace();
    if (!workspace) return { error: 'No active workspace' };

    // Check if file is already open in a tab
    for (const win of workspace.windows) {
      const existing = (win.tabs || []).find(t => t.filePath === filePath);
      if (existing) {
        store.switchTab(win.id, existing.id);
        store.focusWindow(win.id);
        return { windowId: win.id, tabId: existing.id, alreadyOpen: true };
      }
    }

    // Determine which app to use
    const appDef = forceAppId ? undefined : getAppForFile(filePath);
    const appId = forceAppId || appDef?.id || 'text-editor';
    const fileName = filePath.split('/').pop() || 'Untitled';
    const defaultSize = appDef?.defaultSize || { width: 600, height: 500 };

    if (targetWindowId) {
      // Add as tab to specified window (--tab mode)
      const tabId = store.addTab(targetWindowId, filePath, appId, fileName);
      store.focusWindow(targetWindowId);
      return { windowId: targetWindowId, tabId, appId };
    }

    // Default: open in a new window (each file gets its own display)
    const offset = workspace.windows.length * 30;
    const windowId = store.openWindow({
      title: fileName,
      appId,
      filePath,
      position: { x: 150 + offset, y: 80 + offset },
      size: defaultSize,
      isMinimized: false,
      isMaximized: false,
    });
    return { windowId, appId };
  },

  'open-files': (params: Record<string, unknown>) => {
    const paths = params.paths as string[];
    const windowId = params.windowId as string | undefined;
    const results: unknown[] = [];
    const errors: string[] = [];

    for (const p of paths) {
      try {
        const result = handlers['open-file']({ path: p, windowId });
        results.push(result);
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { opened: results, errors };
  },

  'open-app': (params: Record<string, unknown>) => {
    const appId = params.appId as string;
    const title = (params.title as string) || appId;
    const store = useWorkspaceStore.getState();

    const apps = getApps();
    const appDef = apps.find(a => a.id === appId);
    const defaultSize = appDef?.defaultSize || { width: 600, height: 500 };

    const windowId = store.openWindow({
      title,
      appId,
      filePath: '',
      position: { x: 150 + Math.random() * 100, y: 80 + Math.random() * 100 },
      size: defaultSize,
      isMinimized: false,
      isMaximized: false,
    });
    return { windowId, appId };
  },

  'close-window': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    useWorkspaceStore.getState().closeWindow(windowId);
    return { success: true };
  },

  'close-tab': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    const tabId = params.tabId as string;
    useWorkspaceStore.getState().removeTab(windowId, tabId);
    return { success: true };
  },

  'focus-window': (params: Record<string, unknown>) => {
    const windowId = params.windowId as string;
    useWorkspaceStore.getState().focusWindow(windowId);
    return { success: true };
  },

  'open-workspace': async (params: Record<string, unknown>) => {
    const rootDir = params.path as string;
    const id = await useWorkspaceStore.getState().openWorkspace(rootDir);
    return { workspaceId: id };
  },

  'switch-workspace': (params: Record<string, unknown>) => {
    const id = params.id as string;
    useWorkspaceStore.getState().switchWorkspace(id);
    return { success: true };
  },

  'list-workspaces': () => {
    const store = useWorkspaceStore.getState();
    return store.workspaces.map(w => ({
      id: w.id,
      rootDir: w.rootDir,
      name: w.name,
      isActive: w.id === store.activeWorkspaceId,
      windowCount: w.windows.length,
    }));
  },

  'open-terminal': async (params: Record<string, unknown>) => {
    const windowId = params.windowId as string | undefined;
    const cwd = params.cwd as string | undefined;
    await useWorkspaceStore.getState().openTerminal(windowId, cwd);
    return { success: true };
  },

  'terminal-write': async (params: Record<string, unknown>) => {
    const sessionId = params.sessionId as string;
    const data = params.data as string;
    return await window.electron.terminal.write(sessionId, data);
  },

  'apply-layout': (params: Record<string, unknown>) => {
    const preset = params.preset as string;
    const store = useWorkspaceStore.getState();

    if (preset === 'tile') {
      store.tileWindows();
    } else {
      store.applyLayoutPreset(preset as 'focus' | 'split' | 'thirds' | 'quarters');
    }
    return { success: true };
  },
};

/**
 * Initialize the control bridge by registering the __viewerControl object on window.
 * Call this once during app startup after stores are ready.
 */
export function initControlBridge(): void {
  (window as unknown as Record<string, unknown>).__viewerControl = {
    execute: async (action: string, params: Record<string, unknown> = {}) => {
      const handler = handlers[action];
      if (!handler) {
        throw new Error(`Unknown control action: ${action}`);
      }
      return await handler(params);
    },
  };

  // Notify main process that the bridge is ready
  window.electron.control.bridgeReady();
}

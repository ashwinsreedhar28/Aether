import { create } from 'zustand';
import type { WindowState, TabState } from '../types';
import { calculateTileLayout } from '../utils/tileLayoutCalculator';

interface PreTileState {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface WindowStore {
  windows: WindowState[];
  nextZIndex: number;
  configLoaded: boolean;
  terminalCounter: number;
  isTiled: boolean;
  isAnimatingTile: boolean;
  preTileState: Map<string, PreTileState>;

  // Window actions
  openWindow: (window: Omit<WindowState, 'id' | 'zIndex'>) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<WindowState>) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  moveWindow: (id: string, position: { x: number; y: number }) => void;
  resizeWindow: (id: string, size: { width: number; height: number }) => void;
  tileWindows: () => void;

  // Tab actions
  addTab: (windowId: string, filePath: string, appId: string, title?: string) => string;
  removeTab: (windowId: string, tabId: string, skipTerminalKill?: boolean) => void;
  switchTab: (windowId: string, tabId: string) => void;
  moveTab: (fromWindowId: string, toWindowId: string, tabId: string, index?: number) => void;
  reorderTab: (windowId: string, oldIndex: number, newIndex: number) => void;
  tearOffTab: (windowId: string, tabId: string, position: { x: number; y: number }) => void;
  mergeWindows: (sourceWindowId: string, targetWindowId: string) => void;
  updateTabDirty: (windowId: string, tabId: string, isDirty: boolean) => void;

  // Terminal actions
  openTerminal: (windowId?: string, cwd?: string) => Promise<void>;

  // Config actions
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
}

let windowIdCounter = 0;
let tabIdCounter = 0;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// Debounced save
function debouncedSave(store: WindowStore) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    store.saveConfig();
  }, 1000);
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  nextZIndex: 1,
  configLoaded: false,
  terminalCounter: 0,
  isTiled: false,
  isAnimatingTile: false,
  preTileState: new Map(),

  openWindow: (windowData) => {
    const id = `window-${++windowIdCounter}`;
    const { nextZIndex } = get();

    // Handle backwards compatibility: convert old single-file format to tab format
    let tabs: TabState[] = [];
    let activeTabId = '';

    if (windowData.tabs && windowData.tabs.length > 0) {
      // Already has tabs
      tabs = windowData.tabs;
      activeTabId = windowData.activeTabId || tabs[0]?.id || '';
    } else if (windowData.filePath && windowData.appId) {
      // Old format: create a single tab
      const tabId = `tab-${++tabIdCounter}`;
      const filename = windowData.filePath.split('/').pop() || windowData.filePath;
      tabs = [{
        id: tabId,
        title: filename,
        filePath: windowData.filePath,
        appId: windowData.appId,
        isDirty: false,
        isActive: true,
      }];
      activeTabId = tabId;
    } else {
      // No tabs and no file (e.g., file-explorer) - use empty array
      tabs = [];
      activeTabId = '';
    }

    const newWindow: WindowState = {
      ...windowData,
      id,
      zIndex: nextZIndex,
      tabs,
      activeTabId,
    };

    set((state) => ({
      windows: [...state.windows, newWindow],
      nextZIndex: state.nextZIndex + 1,
    }));

    debouncedSave(get());
    return id;
  },

  closeWindow: (id) => {
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    }));
    debouncedSave(get());
  },

  focusWindow: (id) => {
    const { nextZIndex } = get();
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, zIndex: nextZIndex, isMinimized: false } : w
      ),
      nextZIndex: state.nextZIndex + 1,
    }));
  },

  updateWindow: (id, updates) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, ...updates } : w
      ),
    }));
    debouncedSave(get());
  },

  minimizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMinimized: true } : w
      ),
    }));
    debouncedSave(get());
  },

  maximizeWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMaximized: true } : w
      ),
    }));
    debouncedSave(get());
  },

  restoreWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isMaximized: false, isMinimized: false } : w
      ),
    }));
    debouncedSave(get());
  },

  moveWindow: (id, position) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, position } : w
      ),
      // Clear tiled state when windows are manually moved
      isTiled: false,
      preTileState: new Map(),
    }));
    debouncedSave(get());
  },

  resizeWindow: (id, size) => {
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, size } : w
      ),
      // Clear tiled state when windows are manually resized
      isTiled: false,
      preTileState: new Map(),
    }));
    debouncedSave(get());
  },

  tileWindows: () => {
    const { windows, isTiled, preTileState } = get();

    // Enable animation
    set({ isAnimatingTile: true });

    // If already tiled, restore original positions
    if (isTiled && preTileState.size > 0) {
      set((state) => ({
        windows: state.windows.map((w) => {
          const savedState = preTileState.get(w.id);
          if (savedState) {
            return {
              ...w,
              position: savedState.position,
              size: savedState.size,
            };
          }
          return w;
        }),
        isTiled: false,
        preTileState: new Map(),
      }));
      // Clear animation flag after transition completes
      setTimeout(() => set({ isAnimatingTile: false }), 300);
      debouncedSave(get());
      return;
    }

    // Save current positions before tiling
    const newPreTileState = new Map<string, PreTileState>();
    windows.forEach((w) => {
      if (!w.isMinimized) {
        newPreTileState.set(w.id, {
          position: { ...w.position },
          size: { ...w.size },
        });
      }
    });

    // Calculate container size
    const containerSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Calculate layouts for all windows
    const layouts = calculateTileLayout(windows, containerSize, 8);

    // Apply layouts to windows and restore any maximized windows
    set((state) => ({
      windows: state.windows.map((w) => {
        const layout = layouts.find(l => l.windowId === w.id);
        if (layout) {
          return {
            ...w,
            position: layout.position,
            size: layout.size,
            isMaximized: false,
          };
        }
        return w;
      }),
      isTiled: true,
      preTileState: newPreTileState,
    }));

    // Clear animation flag after transition completes
    setTimeout(() => set({ isAnimatingTile: false }), 300);
    debouncedSave(get());
  },

  // Tab actions
  addTab: (windowId, filePath, appId, title) => {
    const tabId = `tab-${++tabIdCounter}`;
    const filename = title || filePath.split('/').pop() || filePath;

    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === windowId) {
          // Deactivate all existing tabs
          const updatedTabs = (w.tabs || []).map(t => ({ ...t, isActive: false }));
          // Add new tab as active
          const newTab: TabState = {
            id: tabId,
            title: filename,
            filePath,
            appId,
            isDirty: false,
            isActive: true,
          };
          return {
            ...w,
            tabs: [...updatedTabs, newTab],
            activeTabId: tabId,
          };
        }
        return w;
      }),
    }));

    debouncedSave(get());
    return tabId;
  },

  removeTab: (windowId, tabId, skipTerminalKill = false) => {
    // Find the tab before removing it to check if it's a terminal
    const windowState = get().windows.find(w => w.id === windowId);
    const tab = windowState?.tabs?.find(t => t.id === tabId);

    // If it's a terminal tab, kill the terminal session (unless we're moving it)
    if (tab?.appId === 'terminal' && !skipTerminalKill) {
      window.electron.terminal.kill(tab.filePath).catch(console.error);
    }

    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === windowId && w.tabs) {
          const newTabs = w.tabs.filter(t => t.id !== tabId);

          // If no tabs left, we'll let closeWindow handle it
          if (newTabs.length === 0) {
            return w;  // Keep window for now, caller should check
          }

          // If we removed the active tab, activate the last tab
          let newActiveTabId = w.activeTabId;
          if (tabId === w.activeTabId) {
            newActiveTabId = newTabs[newTabs.length - 1].id;
            newTabs[newTabs.length - 1].isActive = true;
          }

          return {
            ...w,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        }
        return w;
      }),
    }));

    // Check if window should be closed
    const win = get().windows.find(w => w.id === windowId);
    if (win && win.tabs && win.tabs.length === 0) {
      get().closeWindow(windowId);
    }

    debouncedSave(get());
  },

  switchTab: (windowId, tabId) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === windowId && w.tabs) {
          return {
            ...w,
            tabs: w.tabs.map(t => ({
              ...t,
              isActive: t.id === tabId,
            })),
            activeTabId: tabId,
          };
        }
        return w;
      }),
    }));
  },

  moveTab: (fromWindowId, toWindowId, tabId, index) => {
    const { windows } = get();
    const sourceWindow = windows.find(w => w.id === fromWindowId);
    const targetWindow = windows.find(w => w.id === toWindowId);

    if (!sourceWindow || !targetWindow || !sourceWindow.tabs) return;

    const tab = sourceWindow.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Single atomic state update - remove from source and add to target
    set((state) => {
      const updatedWindows = state.windows.map((w) => {
        // Remove from source window
        if (w.id === fromWindowId && w.tabs) {
          const newTabs = w.tabs.filter(t => t.id !== tabId);

          // If no tabs left, mark for removal (will be handled by filter below)
          if (newTabs.length === 0) {
            return null;
          }

          // If we removed the active tab, activate the last tab
          let newActiveTabId = w.activeTabId;
          if (tabId === w.activeTabId) {
            newActiveTabId = newTabs[newTabs.length - 1].id;
            newTabs[newTabs.length - 1].isActive = true;
          }

          return {
            ...w,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        }

        // Add to target window
        if (w.id === toWindowId && w.tabs) {
          const newTabs = w.tabs.map(t => ({ ...t, isActive: false }));
          const insertIndex = index !== undefined ? index : newTabs.length;
          newTabs.splice(insertIndex, 0, { ...tab, isActive: true });

          return {
            ...w,
            tabs: newTabs,
            activeTabId: tabId,
          };
        }

        return w;
      }).filter((w): w is WindowState => w !== null); // Remove windows with no tabs

      return { windows: updatedWindows };
    });

    // Check if source window should be closed
    const sourceWin = get().windows.find(w => w.id === fromWindowId);
    if (sourceWin && sourceWin.tabs && sourceWin.tabs.length === 0) {
      get().closeWindow(fromWindowId);
    }

    debouncedSave(get());
  },

  reorderTab: (windowId, oldIndex, newIndex) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === windowId && w.tabs) {
          const tabs = [...w.tabs];
          const [tab] = tabs.splice(oldIndex, 1);
          tabs.splice(newIndex, 0, tab);

          return { ...w, tabs };
        }
        return w;
      }),
    }));

    debouncedSave(get());
  },

  tearOffTab: (windowId, tabId, position) => {
    const { windows } = get();
    const sourceWindow = windows.find(w => w.id === windowId);
    if (!sourceWindow || !sourceWindow.tabs) return;

    const tab = sourceWindow.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Single atomic state update - remove from source and create new window
    set((state) => {
      const newWindowId = `window-${++windowIdCounter}`;
      const updatedWindows = state.windows.map((w) => {
        if (w.id === windowId && w.tabs) {
          const newTabs = w.tabs.filter(t => t.id !== tabId);

          // Update source window
          if (newTabs.length === 0) {
            return null; // Mark for removal
          }

          let newActiveTabId = w.activeTabId;
          if (tabId === w.activeTabId && newTabs.length > 0) {
            newActiveTabId = newTabs[newTabs.length - 1].id;
            newTabs[newTabs.length - 1].isActive = true;
          }

          return {
            ...w,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        }
        return w;
      }).filter((w): w is WindowState => w !== null); // Remove windows with no tabs

      // Add new window
      const newWindow: WindowState = {
        id: newWindowId,
        title: tab.title,
        tabs: [{ ...tab, isActive: true }],
        activeTabId: tab.id,
        position,
        size: sourceWindow.size,
        isMinimized: false,
        isMaximized: false,
        zIndex: state.nextZIndex,
      };

      return {
        windows: [...updatedWindows, newWindow],
        nextZIndex: state.nextZIndex + 1,
      };
    });

    debouncedSave(get());
  },

  mergeWindows: (sourceWindowId, targetWindowId) => {
    const { windows } = get();
    const sourceWindow = windows.find(w => w.id === sourceWindowId);
    const targetWindow = windows.find(w => w.id === targetWindowId);

    if (!sourceWindow || !targetWindow || sourceWindow.id === targetWindow.id) {
      return;
    }

    if (!sourceWindow.tabs || !targetWindow.tabs) {
      return;
    }

    // Add all tabs from source to target
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === targetWindowId && w.tabs && sourceWindow.tabs) {
          const allTabs = [
            ...w.tabs.map(t => ({ ...t, isActive: false })),
            ...sourceWindow.tabs.map(t => ({ ...t, isActive: false })),
          ];
          return {
            ...w,
            tabs: allTabs,
          };
        }
        return w;
      }),
    }));

    // Close source window
    get().closeWindow(sourceWindowId);
  },

  updateTabDirty: (windowId, tabId, isDirty) => {
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id === windowId && w.tabs) {
          return {
            ...w,
            tabs: w.tabs.map(t =>
              t.id === tabId ? { ...t, isDirty } : t
            ),
          };
        }
        return w;
      }),
    }));
  },

  // Terminal actions
  openTerminal: async (windowId, cwd) => {
    try {
      // Create terminal session in main process
      const result = await window.electron.terminal.create(cwd);
      const terminalNumber = get().terminalCounter + 1;
      set({ terminalCounter: terminalNumber });

      const terminalTitle = `Terminal ${terminalNumber}`;

      if (windowId) {
        // Add terminal tab to existing window
        get().addTab(windowId, result.sessionId, 'terminal', terminalTitle);
        get().focusWindow(windowId);
      } else {
        // Create new window with terminal tab
        get().openWindow({
          title: terminalTitle,
          tabs: [{
            id: `tab-${++tabIdCounter}`,
            title: terminalTitle,
            filePath: result.sessionId,
            appId: 'terminal',
            isDirty: false,
            isActive: true,
          }],
          activeTabId: `tab-${tabIdCounter}`,
          position: { x: 100, y: 100 },
          size: { width: 800, height: 500 },
          isMinimized: false,
          isMaximized: false,
        });
      }
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  },

  loadConfig: async () => {
    try {
      const config = await window.electron.config.load();

      if (config && config.windows && config.windows.length > 0) {
        // Restore windows with new z-indices (persisted windows are loosely typed JSON)
        const persistedWindows = config.windows as unknown as Omit<WindowState, 'id' | 'zIndex'>[];
        const restoredWindows: WindowState[] = persistedWindows.map((w, i) => ({
          ...w,
          id: `window-${++windowIdCounter}`,
          zIndex: i + 1,
        }));

        set({
          windows: restoredWindows,
          nextZIndex: restoredWindows.length + 1,
          configLoaded: true,
        });
        return;
      }
    } catch {
      // Config doesn't exist yet, that's fine
    }
    set({ configLoaded: true });
  },

  saveConfig: async () => {
    const { windows } = get();

    // Load existing config first so we don't overwrite other stores' data
    const existingConfig = await window.electron.config.load() || {};

    // Strip z-index from saved state (will be recalculated on load)
    const config = {
      ...existingConfig,
      windows: windows.map(({ zIndex: _zIndex, ...rest }) => rest),
    };

    try {
      await window.electron.config.save(config as Parameters<typeof window.electron.config.save>[0]);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  },
}));

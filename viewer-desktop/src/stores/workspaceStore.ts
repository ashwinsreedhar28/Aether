import { create } from 'zustand';
import type { WindowState, TabState } from '../types';
import { soundEngine } from '../audio';
import { calculatePresetLayout, type LayoutPreset } from '../utils/layoutPresets';

// Workspace represents a single folder/root opened in the app
export interface Workspace {
  id: string;
  rootDir: string;
  name: string; // Display name (folder basename)
  windows: WindowState[];
  expandedDirs: Set<string>;
  selectedPath: string | null;
  nextZIndex: number;
  terminalCounter: number;
  isTiled: boolean;
  isAnimatingTile: boolean;
  focusedWindowId: string | null;
  preTileState: Map<string, { position: { x: number; y: number }; size: { width: number; height: number } }>;
}

// Serializable version for persistence
export interface SerializedWorkspace {
  id: string;
  rootDir: string;
  name: string;
  windows: Omit<WindowState, 'zIndex'>[];
  expandedDirs: string[];
  selectedPath: string | null;
}

export interface WorkspaceStore {
  // State
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  recentFolders: { path: string; name: string; lastOpened: number }[];
  configLoaded: boolean;

  // Computed getters
  getActiveWorkspace: () => Workspace | null;

  // Workspace actions
  openWorkspace: (rootDir: string) => Promise<string>;
  closeWorkspace: (id: string) => void;
  switchWorkspace: (id: string) => void;
  reorderWorkspaces: (oldIndex: number, newIndex: number) => void;

  // Window actions (operate on active workspace)
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
  applyLayoutPreset: (preset: LayoutPreset) => void;

  // Tab actions
  addTab: (windowId: string, filePath: string, appId: string, title?: string) => string;
  removeTab: (windowId: string, tabId: string, skipTerminalKill?: boolean) => void;
  switchTab: (windowId: string, tabId: string) => void;
  moveTab: (fromWindowId: string, toWindowId: string, tabId: string, index?: number) => void;
  reorderTab: (windowId: string, oldIndex: number, newIndex: number) => void;
  tearOffTab: (windowId: string, tabId: string, position: { x: number; y: number }) => void;
  mergeWindows: (sourceWindowId: string, targetWindowId: string) => void;
  updateTabDirty: (windowId: string, tabId: string, isDirty: boolean) => void;
  updateTab: (windowId: string, tabId: string, updates: Partial<Pick<TabState, 'title' | 'filePath'>>) => void;
  setTabSuspended: (windowId: string, tabId: string, isSuspended: boolean) => void;

  // Terminal actions
  openTerminal: (windowId?: string, cwd?: string) => Promise<void>;

  // File system actions for active workspace
  setExpandedDirs: (dirs: Set<string>) => void;
  toggleDir: (path: string) => void;
  expandDir: (path: string) => void;
  collapseDir: (path: string) => void;
  setSelectedPath: (path: string | null) => void;

  // Config actions
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
  addRecentFolder: (path: string, name: string) => void;
}

let workspaceIdCounter = 0;
let windowIdCounter = 0;
let tabIdCounter = 0;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// Debounced save
function debouncedSave(store: WorkspaceStore) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    store.saveConfig();
  }, 1000);
}

// Constants for layout calculations
const WORKSPACE_TABS_HEIGHT = 40;

// Helper to get consistent container dimensions for tiling
function getDesktopContainerSize(workspaceCount: number) {
  // WorkspaceTabs only shown when more than one workspace
  const tabsHeight = workspaceCount > 1 ? WORKSPACE_TABS_HEIGHT : 0;
  return {
    width: window.innerWidth,
    height: window.innerHeight - tabsHeight,
  };
}

// Helper to create a new workspace
function createWorkspace(rootDir: string): Workspace {
  const id = `workspace-${++workspaceIdCounter}`;
  const name = rootDir.split('/').pop() || rootDir;

  return {
    id,
    rootDir,
    name,
    windows: [],
    expandedDirs: new Set([rootDir]),
    selectedPath: null,
    nextZIndex: 1,
    terminalCounter: 0,
    isTiled: false,
    isAnimatingTile: false,
    focusedWindowId: null,
    preTileState: new Map(),
  };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  recentFolders: [],
  configLoaded: false,

  getActiveWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get();
    return workspaces.find(w => w.id === activeWorkspaceId) || null;
  },

  // Workspace actions
  openWorkspace: async (rootDir: string) => {
    const { workspaces, addRecentFolder } = get();

    // Check if workspace is already open
    const existing = workspaces.find(w => w.rootDir === rootDir);
    if (existing) {
      set({ activeWorkspaceId: existing.id });
      return existing.id;
    }

    // Create new workspace
    const workspace = createWorkspace(rootDir);

    // Set root dir in Electron
    await window.electron.app.setRootDir(rootDir);

    set(state => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    }));

    // Add to recent folders
    addRecentFolder(rootDir, workspace.name);

    debouncedSave(get());
    return workspace.id;
  },

  closeWorkspace: (id: string) => {
    const { workspaces, activeWorkspaceId } = get();

    // Find workspace being closed
    const closingIndex = workspaces.findIndex(w => w.id === id);
    if (closingIndex === -1) return;

    const newWorkspaces = workspaces.filter(w => w.id !== id);

    // Determine new active workspace
    let newActiveId: string | null = null;
    if (newWorkspaces.length > 0) {
      if (activeWorkspaceId === id) {
        // Switch to adjacent workspace
        const newIndex = Math.min(closingIndex, newWorkspaces.length - 1);
        newActiveId = newWorkspaces[newIndex].id;
      } else {
        newActiveId = activeWorkspaceId;
      }
    }

    set({
      workspaces: newWorkspaces,
      activeWorkspaceId: newActiveId,
    });

    // Update Electron root dir if we have an active workspace
    if (newActiveId) {
      const newWorkspace = newWorkspaces.find(w => w.id === newActiveId);
      if (newWorkspace) {
        window.electron.app.setRootDir(newWorkspace.rootDir);
      }
    }

    debouncedSave(get());
  },

  switchWorkspace: (id: string) => {
    const { workspaces, activeWorkspaceId } = get();
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace) return;

    if (activeWorkspaceId !== id) {
      soundEngine.playEvent('workspace:switch');
    }
    set({ activeWorkspaceId: id });

    // Update Electron root dir
    window.electron.app.setRootDir(workspace.rootDir);
  },

  reorderWorkspaces: (oldIndex: number, newIndex: number) => {
    soundEngine.playEvent('workspace:reorder');
    set(state => {
      const workspaces = [...state.workspaces];
      const [workspace] = workspaces.splice(oldIndex, 1);
      workspaces.splice(newIndex, 0, workspace);
      return { workspaces };
    });
    debouncedSave(get());
  },

  // Window actions - operate on active workspace
  openWindow: (windowData) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return '';

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return '';

    soundEngine.playEvent('window:open');
    const id = `window-${++windowIdCounter}`;

    // Handle backwards compatibility: convert old single-file format to tab format
    let tabs: TabState[] = [];
    let activeTabId = '';

    if (windowData.tabs && windowData.tabs.length > 0) {
      tabs = windowData.tabs;
      activeTabId = windowData.activeTabId || tabs[0]?.id || '';
    } else if (windowData.filePath && windowData.appId) {
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
    }

    const newWindow: WindowState = {
      ...windowData,
      id,
      zIndex: workspace.nextZIndex,
      tabs,
      activeTabId,
    };

    // If workspace is tiled, recalculate layout to include new window
    if (workspace.isTiled) {
      import('../utils/tileLayoutCalculator').then(({ calculateTileLayout }) => {
        const containerSize = getDesktopContainerSize(workspaces.length);

        const allWindows = [...workspace.windows, newWindow];
        const layouts = calculateTileLayout(allWindows, containerSize, 8, id);

        // Update preTileState to include new window's initial position
        const newPreTileState = new Map(workspace.preTileState);
        newPreTileState.set(id, {
          position: { ...windowData.position },
          size: { ...windowData.size },
        });

        set(state => ({
          workspaces: state.workspaces.map(w => {
            if (w.id === activeWorkspaceId) {
              return {
                ...w,
                windows: allWindows.map(win => {
                  const layout = layouts.find(l => l.windowId === win.id);
                  if (layout) {
                    return { ...win, position: layout.position, size: layout.size, isMaximized: false };
                  }
                  return win;
                }),
                nextZIndex: w.nextZIndex + 1,
                isAnimatingTile: true,
                focusedWindowId: id,
                preTileState: newPreTileState,
              };
            }
            return w;
          }),
        }));

        // Clear animation flag after transition
        setTimeout(() => {
          set(state => ({
            workspaces: state.workspaces.map(w => {
              if (w.id === activeWorkspaceId) {
                return { ...w, isAnimatingTile: false };
              }
              return w;
            }),
          }));
        }, 300);

        debouncedSave(get());
      });
    } else {
      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return {
              ...w,
              windows: [...w.windows, newWindow],
              nextZIndex: w.nextZIndex + 1,
            };
          }
          return w;
        }),
      }));

      debouncedSave(get());
    }

    return id;
  },

  closeWindow: (id: string) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    soundEngine.playEvent('window:close');

    // If tiled, recalculate layout after removing window
    if (workspace.isTiled) {
      import('../utils/tileLayoutCalculator').then(({ calculateTileLayout }) => {
        const remainingWindows = workspace.windows.filter(win => win.id !== id);
        const containerSize = getDesktopContainerSize(workspaces.length);

        // Find the new focused window (highest z-index among remaining non-minimized)
        const visibleWindows = remainingWindows.filter(w => !w.isMinimized);
        const newFocusedWindow = visibleWindows.length > 0
          ? visibleWindows.reduce((prev, current) => current.zIndex > prev.zIndex ? current : prev)
          : null;
        const newFocusedWindowId = newFocusedWindow?.id || null;

        const layouts = calculateTileLayout(remainingWindows, containerSize, 8, newFocusedWindowId || undefined);

        // Remove the closed window from preTileState
        const newPreTileState = new Map(workspace.preTileState);
        newPreTileState.delete(id);

        set(state => ({
          workspaces: state.workspaces.map(w => {
            if (w.id === activeWorkspaceId) {
              return {
                ...w,
                windows: remainingWindows.map(win => {
                  const layout = layouts.find(l => l.windowId === win.id);
                  if (layout) {
                    return { ...win, position: layout.position, size: layout.size };
                  }
                  return win;
                }),
                isAnimatingTile: true,
                focusedWindowId: newFocusedWindowId,
                preTileState: newPreTileState,
              };
            }
            return w;
          }),
        }));

        // Clear animation flag after transition
        setTimeout(() => {
          set(state => ({
            workspaces: state.workspaces.map(w => {
              if (w.id === activeWorkspaceId) {
                return { ...w, isAnimatingTile: false };
              }
              return w;
            }),
          }));
        }, 300);

        debouncedSave(get());
      });
    } else {
      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return {
              ...w,
              windows: w.windows.filter(win => win.id !== id),
            };
          }
          return w;
        }),
      }));
      debouncedSave(get());
    }
  },

  focusWindow: (id: string) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    // Only play sound if actually changing focus
    if (workspace.focusedWindowId !== id) {
      soundEngine.playEvent('window:focus');
    }

    // Just update z-index and focus - don't recalculate layout
    // This preserves preset layouts when switching focus with Cmd+Arrow
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, zIndex: w.nextZIndex, isMinimized: false } : win
            ),
            nextZIndex: w.nextZIndex + 1,
            focusedWindowId: id,
          };
        }
        return w;
      }),
    }));
  },

  updateWindow: (id: string, updates: Partial<WindowState>) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, ...updates } : win
            ),
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  minimizeWindow: (id: string) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    soundEngine.playEvent('window:minimize');
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, isMinimized: true } : win
            ),
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  maximizeWindow: (id: string) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    soundEngine.playEvent('window:maximize');
    // Enable animation
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            isAnimatingTile: true,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, isMaximized: true } : win
            ),
          };
        }
        return w;
      }),
    }));
    // Disable animation after transition completes
    setTimeout(() => {
      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return { ...w, isAnimatingTile: false };
          }
          return w;
        }),
      }));
    }, 300);
    debouncedSave(get());
  },

  restoreWindow: (id: string) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    // Enable animation
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            isAnimatingTile: true,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, isMaximized: false, isMinimized: false } : win
            ),
          };
        }
        return w;
      }),
    }));
    // Disable animation after transition completes
    setTimeout(() => {
      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return { ...w, isAnimatingTile: false };
          }
          return w;
        }),
      }));
    }, 300);
    debouncedSave(get());
  },

  moveWindow: (id: string, position: { x: number; y: number }) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, position } : win
            ),
            isTiled: false,
            preTileState: new Map(),
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  resizeWindow: (id: string, size: { width: number; height: number }) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === id ? { ...win, size } : win
            ),
            isTiled: false,
            preTileState: new Map(),
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  tileWindows: () => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    soundEngine.playEvent('workspace:tile');

    // Import dynamically to avoid circular deps
    import('../utils/tileLayoutCalculator').then(({ calculateTileLayout }) => {
      // If already tiled, restore original positions with animation
      if (workspace.isTiled && workspace.preTileState.size > 0) {
        set(state => ({
          workspaces: state.workspaces.map(w => {
            if (w.id === activeWorkspaceId) {
              return {
                ...w,
                windows: w.windows.map(win => {
                  const savedState = workspace.preTileState.get(win.id);
                  if (savedState) {
                    return { ...win, position: savedState.position, size: savedState.size };
                  }
                  return win;
                }),
                isTiled: false,
                isAnimatingTile: true,
                preTileState: new Map(),
              };
            }
            return w;
          }),
        }));

        // Clear animation flag after transition
        setTimeout(() => {
          set(state => ({
            workspaces: state.workspaces.map(w => {
              if (w.id === activeWorkspaceId) {
                return { ...w, isAnimatingTile: false };
              }
              return w;
            }),
          }));
        }, 300);

        debouncedSave(get());
        return;
      }

      // Save current positions before tiling
      const newPreTileState = new Map<string, { position: { x: number; y: number }; size: { width: number; height: number } }>();
      workspace.windows.forEach(w => {
        if (!w.isMinimized) {
          newPreTileState.set(w.id, {
            position: { ...w.position },
            size: { ...w.size },
          });
        }
      });

      // Calculate container size
      const containerSize = getDesktopContainerSize(workspaces.length);

      // Find the currently focused window (highest z-index non-minimized)
      const visibleWindows = workspace.windows.filter(w => !w.isMinimized);
      const focusedWindow = visibleWindows.length > 0
        ? visibleWindows.reduce((prev, current) => current.zIndex > prev.zIndex ? current : prev)
        : null;
      const focusedWindowId = focusedWindow?.id || null;

      const layouts = calculateTileLayout(workspace.windows, containerSize, 8, focusedWindowId || undefined);

      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return {
              ...w,
              windows: w.windows.map(win => {
                const layout = layouts.find(l => l.windowId === win.id);
                if (layout) {
                  return { ...win, position: layout.position, size: layout.size, isMaximized: false };
                }
                return win;
              }),
              isTiled: true,
              isAnimatingTile: true,
              focusedWindowId,
              preTileState: newPreTileState,
            };
          }
          return w;
        }),
      }));

      // Clear animation flag after transition
      setTimeout(() => {
        set(state => ({
          workspaces: state.workspaces.map(w => {
            if (w.id === activeWorkspaceId) {
              return { ...w, isAnimatingTile: false };
            }
            return w;
          }),
        }));
      }, 300);

      debouncedSave(get());
    });
  },

  applyLayoutPreset: (preset: LayoutPreset) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    soundEngine.playEvent('workspace:tile');

    // Save current positions before applying preset
    const newPreTileState = new Map<string, { position: { x: number; y: number }; size: { width: number; height: number } }>();
    workspace.windows.forEach(w => {
      if (!w.isMinimized) {
        newPreTileState.set(w.id, {
          position: { ...w.position },
          size: { ...w.size },
        });
      }
    });

    // Calculate container size (accounting for workspace tabs if multiple workspaces)
    const WORKSPACE_TABS_HEIGHT = 40;
    const tabsHeight = workspaces.length > 1 ? WORKSPACE_TABS_HEIGHT : 0;
    const containerSize = {
      width: window.innerWidth,
      height: window.innerHeight - tabsHeight,
    };

    // Find focused window
    const visibleWindows = workspace.windows.filter(w => !w.isMinimized);
    const focusedWindow = visibleWindows.length > 0
      ? visibleWindows.reduce((prev, current) => current.zIndex > prev.zIndex ? current : prev)
      : null;

    const layouts = calculatePresetLayout(preset, workspace.windows, containerSize, focusedWindow?.id);

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              const layout = layouts.find(l => l.windowId === win.id);
              if (layout) {
                return { ...win, position: layout.position, size: layout.size, isMaximized: false };
              }
              return win;
            }),
            isTiled: true,
            isAnimatingTile: true,
            preTileState: newPreTileState,
          };
        }
        return w;
      }),
    }));

    // Clear animation flag after transition
    setTimeout(() => {
      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return { ...w, isAnimatingTile: false };
          }
          return w;
        }),
      }));
    }, 400); // Slightly longer for the new holographic effect

    debouncedSave(get());
  },

  // Tab actions
  addTab: (windowId: string, filePath: string, appId: string, title?: string) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return '';

    soundEngine.playEvent('tab:add');
    const tabId = `tab-${++tabIdCounter}`;
    const filename = title || filePath.split('/').pop() || filePath;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                const updatedTabs = (win.tabs || []).map(t => ({ ...t, isActive: false }));
                const newTab: TabState = {
                  id: tabId,
                  title: filename,
                  filePath,
                  appId,
                  isDirty: false,
                  isActive: true,
                  isSuspended: false,
                };
                return {
                  ...win,
                  tabs: [...updatedTabs, newTab],
                  activeTabId: tabId,
                };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));

    debouncedSave(get());
    return tabId;
  },

  removeTab: (windowId: string, tabId: string, skipTerminalKill = false) => {
    const { activeWorkspaceId, workspaces, closeWindow } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const windowState = workspace?.windows.find(w => w.id === windowId);
    const tab = windowState?.tabs?.find(t => t.id === tabId);

    soundEngine.playEvent('tab:remove');

    // If it's a terminal tab, kill the terminal session
    if (tab?.appId === 'terminal' && !skipTerminalKill) {
      window.electron.terminal.kill(tab.filePath).catch(console.error);
    }

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId && win.tabs) {
                const newTabs = win.tabs.filter(t => t.id !== tabId);
                if (newTabs.length === 0) {
                  return win; // Keep for now, will be closed below
                }
                let newActiveTabId = win.activeTabId;
                if (tabId === win.activeTabId) {
                  newActiveTabId = newTabs[newTabs.length - 1].id;
                  newTabs[newTabs.length - 1].isActive = true;
                }
                return { ...win, tabs: newTabs, activeTabId: newActiveTabId };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));

    // Check if window should be closed
    const updatedWorkspace = get().workspaces.find(w => w.id === activeWorkspaceId);
    const win = updatedWorkspace?.windows.find(w => w.id === windowId);
    if (win && win.tabs && win.tabs.length === 0) {
      closeWindow(windowId);
    }

    debouncedSave(get());
  },

  switchTab: (windowId: string, tabId: string) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    soundEngine.playEvent('tab:switch');
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId && win.tabs) {
                return {
                  ...win,
                  tabs: win.tabs.map(t => ({
                    ...t,
                    isActive: t.id === tabId,
                    isSuspended: t.id === tabId ? false : t.isSuspended,
                  })),
                  activeTabId: tabId,
                };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));
  },

  updateTab: (windowId: string, tabId: string, updates: Partial<Pick<TabState, 'title' | 'filePath'>>) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id !== activeWorkspaceId) return w;
        return {
          ...w,
          windows: w.windows.map(win => {
            if (win.id !== windowId || !win.tabs) return win;
            return {
              ...win,
              tabs: win.tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)),
            };
          }),
        };
      }),
    }));

    debouncedSave(get());
  },

  setTabSuspended: (windowId: string, tabId: string, isSuspended: boolean) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id !== activeWorkspaceId) return w;
        return {
          ...w,
          windows: w.windows.map(win => {
            if (win.id !== windowId || !win.tabs) return win;
            return {
              ...win,
              tabs: win.tabs.map(t => (t.id === tabId ? { ...t, isSuspended } : t)),
            };
          }),
        };
      }),
    }));

    debouncedSave(get());
  },

  moveTab: (fromWindowId: string, toWindowId: string, tabId: string, index?: number) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const sourceWindow = workspace?.windows.find(w => w.id === fromWindowId);
    const targetWindow = workspace?.windows.find(w => w.id === toWindowId);

    if (!sourceWindow || !targetWindow || !sourceWindow.tabs) return;

    const tab = sourceWindow.tabs.find(t => t.id === tabId);
    if (!tab) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          let shouldCloseSource = false;
          const updatedWindows = w.windows.map(win => {
            if (win.id === fromWindowId && win.tabs) {
              const newTabs = win.tabs.filter(t => t.id !== tabId);
              if (newTabs.length === 0) {
                shouldCloseSource = true;
                return win;
              }
              let newActiveTabId = win.activeTabId;
              if (tabId === win.activeTabId) {
                newActiveTabId = newTabs[newTabs.length - 1].id;
                newTabs[newTabs.length - 1].isActive = true;
              }
              return { ...win, tabs: newTabs, activeTabId: newActiveTabId };
            }
            if (win.id === toWindowId && win.tabs) {
              const newTabs = win.tabs.map(t => ({ ...t, isActive: false }));
              const insertIndex = index !== undefined ? index : newTabs.length;
              newTabs.splice(insertIndex, 0, { ...tab, isActive: true });
              return { ...win, tabs: newTabs, activeTabId: tabId };
            }
            return win;
          });

          return {
            ...w,
            windows: shouldCloseSource
              ? updatedWindows.filter(win => win.id !== fromWindowId)
              : updatedWindows,
          };
        }
        return w;
      }),
    }));

    debouncedSave(get());
  },

  reorderTab: (windowId: string, oldIndex: number, newIndex: number) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    soundEngine.playEvent('tab:reorder');
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId && win.tabs) {
                const tabs = [...win.tabs];
                const [tab] = tabs.splice(oldIndex, 1);
                tabs.splice(newIndex, 0, tab);
                return { ...win, tabs };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  tearOffTab: (windowId: string, tabId: string, position: { x: number; y: number }) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const sourceWindow = workspace?.windows.find(w => w.id === windowId);
    if (!sourceWindow || !sourceWindow.tabs) return;

    const tab = sourceWindow.tabs.find(t => t.id === tabId);
    if (!tab) return;

    soundEngine.playEvent('tab:tearOff');
    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          const newWindowId = `window-${++windowIdCounter}`;
          let shouldCloseSource = false;

          const updatedWindows = w.windows.map(win => {
            if (win.id === windowId && win.tabs) {
              const newTabs = win.tabs.filter(t => t.id !== tabId);
              if (newTabs.length === 0) {
                shouldCloseSource = true;
                return win;
              }
              let newActiveTabId = win.activeTabId;
              if (tabId === win.activeTabId && newTabs.length > 0) {
                newActiveTabId = newTabs[newTabs.length - 1].id;
                newTabs[newTabs.length - 1].isActive = true;
              }
              return { ...win, tabs: newTabs, activeTabId: newActiveTabId };
            }
            return win;
          });

          const newWindow: WindowState = {
            id: newWindowId,
            title: tab.title,
            tabs: [{ ...tab, isActive: true }],
            activeTabId: tab.id,
            position,
            size: sourceWindow.size,
            isMinimized: false,
            isMaximized: false,
            zIndex: w.nextZIndex,
          };

          return {
            ...w,
            windows: [
              ...(shouldCloseSource ? updatedWindows.filter(win => win.id !== windowId) : updatedWindows),
              newWindow,
            ],
            nextZIndex: w.nextZIndex + 1,
          };
        }
        return w;
      }),
    }));
    debouncedSave(get());
  },

  mergeWindows: (sourceWindowId: string, targetWindowId: string) => {
    const { activeWorkspaceId, workspaces, closeWindow } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const sourceWindow = workspace?.windows.find(w => w.id === sourceWindowId);
    const targetWindow = workspace?.windows.find(w => w.id === targetWindowId);

    if (!sourceWindow || !targetWindow || sourceWindow.id === targetWindow.id) return;
    if (!sourceWindow.tabs || !targetWindow.tabs) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === targetWindowId && win.tabs && sourceWindow.tabs) {
                const allTabs = [
                  ...win.tabs.map(t => ({ ...t, isActive: false })),
                  ...sourceWindow.tabs.map(t => ({ ...t, isActive: false })),
                ];
                return { ...win, tabs: allTabs };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));

    closeWindow(sourceWindowId);
  },

  updateTabDirty: (windowId: string, tabId: string, isDirty: boolean) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId && win.tabs) {
                return {
                  ...win,
                  tabs: win.tabs.map(t => t.id === tabId ? { ...t, isDirty } : t),
                };
              }
              return win;
            }),
          };
        }
        return w;
      }),
    }));
  },

  // Terminal actions
  openTerminal: async (windowId?: string, cwd?: string) => {
    const { activeWorkspaceId, workspaces, addTab, focusWindow, openWindow } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    try {
      const result = await window.electron.terminal.create(cwd);
      const terminalNumber = workspace.terminalCounter + 1;

      set(state => ({
        workspaces: state.workspaces.map(w => {
          if (w.id === activeWorkspaceId) {
            return { ...w, terminalCounter: terminalNumber };
          }
          return w;
        }),
      }));

      const terminalTitle = `Terminal ${terminalNumber}`;

      if (windowId) {
        addTab(windowId, result.sessionId, 'terminal', terminalTitle);
        focusWindow(windowId);
      } else {
        openWindow({
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

  // File system actions
  setExpandedDirs: (dirs: Set<string>) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return { ...w, expandedDirs: dirs };
        }
        return w;
      }),
    }));
  },

  toggleDir: (path: string) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    const newExpanded = new Set(workspace.expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
      soundEngine.playEvent('folder:collapse');
    } else {
      newExpanded.add(path);
      soundEngine.playEvent('folder:expand');
    }

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return { ...w, expandedDirs: newExpanded };
        }
        return w;
      }),
    }));
  },

  expandDir: (path: string) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    const newExpanded = new Set(workspace.expandedDirs);
    newExpanded.add(path);

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return { ...w, expandedDirs: newExpanded };
        }
        return w;
      }),
    }));
  },

  collapseDir: (path: string) => {
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    if (!workspace) return;

    const newExpanded = new Set(workspace.expandedDirs);
    newExpanded.delete(path);

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return { ...w, expandedDirs: newExpanded };
        }
        return w;
      }),
    }));
  },

  setSelectedPath: (path: string | null) => {
    const { activeWorkspaceId } = get();
    if (!activeWorkspaceId) return;

    set(state => ({
      workspaces: state.workspaces.map(w => {
        if (w.id === activeWorkspaceId) {
          return { ...w, selectedPath: path };
        }
        return w;
      }),
    }));
  },

  // Config actions
  addRecentFolder: (path: string, name: string) => {
    set(state => {
      const filtered = state.recentFolders.filter(f => f.path !== path);
      const newRecent = [
        { path, name, lastOpened: Date.now() },
        ...filtered,
      ].slice(0, 10); // Keep last 10
      return { recentFolders: newRecent };
    });
    debouncedSave(get());
  },

  loadConfig: async () => {
    try {
      const config = await window.electron.config.load();

      if (config) {
        // Load recent folders
        if (config.recentFolders) {
          set({ recentFolders: config.recentFolders });
        }

        // Load sound config if available
        if (config.soundConfig) {
          soundEngine.loadConfig(config.soundConfig as Parameters<typeof soundEngine.loadConfig>[0]);
        }

        // Load workspaces if any were saved
        if (config.workspaces && config.workspaces.length > 0) {
          const serializedWorkspaces = config.workspaces as unknown as SerializedWorkspace[];
          const loadedWorkspaces: Workspace[] = serializedWorkspaces.map((ws) => ({
            id: `workspace-${++workspaceIdCounter}`,
            rootDir: ws.rootDir,
            name: ws.name,
            windows: ws.windows.map((w, j) => {
              const newWindowId = `window-${++windowIdCounter}`;
              const tabs = (w.tabs || []).map(tab => ({
                ...tab,
                id: `tab-${++tabIdCounter}`,
              }));
              const activeTabId = tabs.find(t => t.isActive)?.id || tabs[0]?.id || undefined;
              return {
                ...w,
                id: newWindowId,
                tabs,
                activeTabId,
                zIndex: j + 1,
              };
            }),
            expandedDirs: new Set(ws.expandedDirs || [ws.rootDir]),
            selectedPath: ws.selectedPath,
            nextZIndex: ws.windows.length + 1,
            terminalCounter: 0,
            isTiled: false,
            isAnimatingTile: false,
            focusedWindowId: null,
            preTileState: new Map(),
          }));

          set({
            workspaces: loadedWorkspaces,
            activeWorkspaceId: loadedWorkspaces[0]?.id || null,
            configLoaded: true,
          });

          // Set root dir to first workspace
          if (loadedWorkspaces[0]) {
            await window.electron.app.setRootDir(loadedWorkspaces[0].rootDir);
          }
          return;
        }
      }
    } catch {
      // Config doesn't exist yet, that's fine
    }
    set({ configLoaded: true });
  },

  saveConfig: async () => {
    const { workspaces, recentFolders } = get();

    // Serialize workspaces
    const serializedWorkspaces: SerializedWorkspace[] = workspaces.map(w => ({
      id: w.id,
      rootDir: w.rootDir,
      name: w.name,
      windows: w.windows.map(({ zIndex: _zIndex, ...rest }) => rest),
      expandedDirs: Array.from(w.expandedDirs),
      selectedPath: w.selectedPath,
    }));

    const existingConfig = await window.electron.config.load() || {};
    const config = {
      ...existingConfig,
      workspaces: serializedWorkspaces,
      recentFolders,
      soundConfig: soundEngine.exportConfig(),
    };

    try {
      await window.electron.config.save(config as unknown as Parameters<typeof window.electron.config.save>[0]);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  },
}));

// Compatibility layer - export windows getter for components that need it
export const getActiveWindows = () => {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
  const workspace = workspaces.find(w => w.id === activeWorkspaceId);
  return workspace?.windows || [];
};

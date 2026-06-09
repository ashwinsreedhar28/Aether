import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFileSystemStore } from '../../stores/fileSystemStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Window } from '../Window';
import { FileExplorer } from '../FileExplorer';
import { SearchModal } from '../Search';
import { Dock } from '../Dock';
import { InputDialog } from '../common/InputDialog';
import { getAppForFile } from '../../apps';
import { soundEngine } from '../../audio';
import type { LayoutPreset } from '../../utils/layoutPresets';

interface DesktopProps {
  workspaceId: string;
}

export const Desktop = memo(function Desktop({ workspaceId }: DesktopProps) {
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId);
  const openWindow = useWorkspaceStore(s => s.openWindow);
  const addTab = useWorkspaceStore(s => s.addTab);
  const switchTab = useWorkspaceStore(s => s.switchTab);
  const focusWindow = useWorkspaceStore(s => s.focusWindow);
  const closeWindow = useWorkspaceStore(s => s.closeWindow);
  const removeTab = useWorkspaceStore(s => s.removeTab);
  const tileWindows = useWorkspaceStore(s => s.tileWindows);
  const applyLayoutPreset = useWorkspaceStore(s => s.applyLayoutPreset);
  const openTerminal = useWorkspaceStore(s => s.openTerminal);
  const closeWorkspace = useWorkspaceStore(s => s.closeWorkspace);
  const maximizeWindow = useWorkspaceStore(s => s.maximizeWindow);
  const restoreWindow = useWorkspaceStore(s => s.restoreWindow);

  const tree = useFileSystemStore(s => s.tree);
  const refreshTree = useFileSystemStore(s => s.refreshTree);
  const setRootDir = useFileSystemStore(s => s.setRootDir);
  const [showSearch, setShowSearch] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);

  const loadSettings = useSettingsStore(s => s.loadSettings);
  const openWorkspace = useWorkspaceStore(s => s.openWorkspace);

  // Check if this desktop's workspace is active
  const isActive = workspaceId === activeWorkspaceId;

  // Get windows from THIS workspace (not active workspace)
  const workspace = workspaces.find(w => w.id === workspaceId);
  const windows = useMemo(() => workspace?.windows || [], [workspace?.windows]);

  const windowsRef = useRef(windows);
  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const workspacesRef = useRef(workspaces);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  // Get the currently focused window (highest z-index, not minimized)
  const getFocusedWindow = useCallback(() => {
    const visibleWindows = windowsRef.current.filter(w => !w.isMinimized);
    if (visibleWindows.length === 0) return null;
    return visibleWindows.reduce((prev, current) =>
      current.zIndex > prev.zIndex ? current : prev
    );
  }, []);

  // Find adjacent window in a direction
  const findAdjacentWindow = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const focused = getFocusedWindow();
    if (!focused) return null;

    const visibleWindows = windowsRef.current.filter(w => !w.isMinimized && w.id !== focused.id);
    if (visibleWindows.length === 0) return null;

    // Get center of focused window
    const focusedCenterX = focused.position.x + focused.size.width / 2;
    const focusedCenterY = focused.position.y + focused.size.height / 2;

    // Filter windows in the correct direction and find closest
    const candidates = visibleWindows.filter(w => {
      const centerX = w.position.x + w.size.width / 2;
      const centerY = w.position.y + w.size.height / 2;

      switch (direction) {
        case 'left': return centerX < focusedCenterX;
        case 'right': return centerX > focusedCenterX;
        case 'up': return centerY < focusedCenterY;
        case 'down': return centerY > focusedCenterY;
      }
    });

    if (candidates.length === 0) return null;

    // Find closest window by distance
    return candidates.reduce((closest, w) => {
      const centerX = w.position.x + w.size.width / 2;
      const centerY = w.position.y + w.size.height / 2;
      const closestCenterX = closest.position.x + closest.size.width / 2;
      const closestCenterY = closest.position.y + closest.size.height / 2;

      const distW = Math.hypot(centerX - focusedCenterX, centerY - focusedCenterY);
      const distClosest = Math.hypot(closestCenterX - focusedCenterX, closestCenterY - focusedCenterY);

      return distW < distClosest ? w : closest;
    });
  }, [getFocusedWindow]);

  const focusAdjacentWindow = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const adjacent = findAdjacentWindow(direction);
    if (adjacent) focusWindow(adjacent.id);
  }, [findAdjacentWindow, focusWindow]);

  // Close focused window or active tab
  const closeFocusedWindowOrTab = useCallback(() => {
    const focused = getFocusedWindow();
    if (!focused) return;

    // If window has multiple tabs, close just the active tab
    if (focused.tabs && focused.tabs.length > 1 && focused.activeTabId) {
      removeTab(focused.id, focused.activeTabId);
    } else {
      // Close the whole window
      closeWindow(focused.id);
    }
  }, [getFocusedWindow, removeTab, closeWindow]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Initialize on workspace change - only sync when THIS workspace becomes active
  const workspaceRootDir = workspace?.rootDir;
  useEffect(() => {
    if (isActive && workspaceRootDir !== undefined) {
      // Sync file system store with this workspace
      setRootDir(workspaceRootDir);
      refreshTree();
    }
  }, [isActive, workspaceRootDir, setRootDir, refreshTree]);

  // Navigate to previous or next tab in focused window
  const navigateTab = useCallback((direction: 'prev' | 'next') => {
    const focused = getFocusedWindow();
    if (!focused) return;

    const tabs = focused.tabs || [];
    if (tabs.length <= 1 || !focused.activeTabId) return;

    const currentIndex = tabs.findIndex(t => t.id === focused.activeTabId);
    if (direction === 'prev' && currentIndex > 0) {
      switchTab(focused.id, tabs[currentIndex - 1].id);
    } else if (direction === 'next' && currentIndex < tabs.length - 1) {
      switchTab(focused.id, tabs[currentIndex + 1].id);
    }
  }, [getFocusedWindow, switchTab]);

  // Toggle file explorer window
  const toggleFileExplorer = useCallback(() => {
    const fileExplorerWindow = windowsRef.current.find(w => w.appId === 'file-explorer');

    if (fileExplorerWindow) {
      focusWindow(fileExplorerWindow.id);
    } else {
      openWindow({
        title: 'Files',
        appId: 'file-explorer',
        position: { x: 20, y: 20 },
        size: { width: 280, height: 500 },
        isMinimized: false,
        isMaximized: false,
      });
    }
  }, [focusWindow, openWindow]);

  // Toggle maximize for focused window
  const toggleMaximize = useCallback(() => {
    const focused = getFocusedWindow();
    if (focused) {
      if (focused.isMaximized) {
        restoreWindow(focused.id);
      } else {
        maximizeWindow(focused.id);
      }
    }
  }, [getFocusedWindow, maximizeWindow, restoreWindow]);

  // Create new project
  const handleCreateProject = useCallback(async (projectName: string) => {
    const defaultFolder = useSettingsStore.getState().settings.defaultProjectsFolder;

    let parentFolder = defaultFolder;

    // If no default folder is set, ask user to choose a location
    if (!parentFolder) {
      const result = await window.electron.app.openFolderDialog();
      if (!result?.path) {
        return; // User cancelled
      }
      parentFolder = result.path;
    }

    // Create the project folder
    const projectPath = `${parentFolder}/${projectName}`;

    try {
      await window.electron.fs.createFile(projectPath, 'directory');
      // Open the new project as a workspace
      await openWorkspace(projectPath);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  }, [openWorkspace]);

  // Listen for menu actions (these work even when iframe has focus)
  // Only register these listeners for the active workspace
  useEffect(() => {
    if (!isActive) return;

    const unsubscribeTerminal = window.electron.app.onMenuNewTerminal(() => {
      openTerminal();
    });

    const unsubscribeCloseWorkspace = window.electron.app.onMenuCloseWorkspace(() => {
      const currentWorkspaceId = activeWorkspaceIdRef.current;
      if (currentWorkspaceId) {
        closeWorkspace(currentWorkspaceId);
      }
    });

    const unsubscribeCloseTab = window.electron.app.onMenuCloseTab(() => {
      closeFocusedWindowOrTab();
    });

    const unsubscribeOpenSearch = window.electron.app.onMenuOpenSearch(() => {
      soundEngine.playEvent('shortcut:activate');
      setShowSearch(true);
    });

    const unsubscribeToggleExplorer = window.electron.app.onMenuToggleExplorer(() => {
      soundEngine.playEvent('shortcut:activate');
      toggleFileExplorer();
    });

    const unsubscribeTileWindows = window.electron.app.onMenuTileWindows(() => {
      tileWindows();
    });

    const unsubscribeMaximizeWindow = window.electron.app.onMenuMaximizeWindow(() => {
      toggleMaximize();
    });

    const unsubscribePrevTab = window.electron.app.onMenuPrevTab(() => {
      navigateTab('prev');
    });

    const unsubscribeNextTab = window.electron.app.onMenuNextTab(() => {
      navigateTab('next');
    });

    const unsubscribeFocusUp = window.electron.app.onMenuFocusUp(() => {
      focusAdjacentWindow('up');
    });

    const unsubscribeFocusDown = window.electron.app.onMenuFocusDown(() => {
      focusAdjacentWindow('down');
    });

    const unsubscribeFocusLeft = window.electron.app.onMenuFocusLeft(() => {
      focusAdjacentWindow('left');
    });

    const unsubscribeFocusRight = window.electron.app.onMenuFocusRight(() => {
      focusAdjacentWindow('right');
    });

    const unsubscribeNewProject = window.electron.app.onMenuNewProject(() => {
      soundEngine.playEvent('shortcut:activate');
      setShowNewProjectDialog(true);
    });

    const unsubscribeLayoutPreset = window.electron.app.onMenuLayoutPreset((preset: string) => {
      soundEngine.playEvent('shortcut:activate');
      applyLayoutPreset(preset as LayoutPreset);
    });

    return () => {
      unsubscribeTerminal();
      unsubscribeCloseWorkspace();
      unsubscribeCloseTab();
      unsubscribeOpenSearch();
      unsubscribeToggleExplorer();
      unsubscribeTileWindows();
      unsubscribeMaximizeWindow();
      unsubscribePrevTab();
      unsubscribeNextTab();
      unsubscribeFocusUp();
      unsubscribeFocusDown();
      unsubscribeFocusLeft();
      unsubscribeFocusRight();
      unsubscribeNewProject();
      unsubscribeLayoutPreset();
    };
  }, [isActive, openTerminal, closeWorkspace, closeFocusedWindowOrTab, toggleFileExplorer, tileWindows, toggleMaximize, navigateTab, focusAdjacentWindow, applyLayoutPreset]);

  // Open file explorer if no windows in workspace (only for active workspace)
  useEffect(() => {
    if (isActive && workspace && windows.length === 0) {
      openWindow({
        title: 'Files',
        appId: 'file-explorer',
        position: { x: 20, y: 20 },
        size: { width: 280, height: 500 },
        isMinimized: false,
        isMaximized: false,
      });
    }
  }, [isActive, workspace, windows.length, openWindow]);

  // Keyboard shortcuts that don't need to work in iframes (workspace switching)
  // Most shortcuts are handled via Electron menu accelerators (work in iframes)
  // Only register for active workspace to avoid duplicate handlers
  useEffect(() => {
    if (!isActive) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
      }
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        isEditableTarget(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowUp') focusAdjacentWindow('up');
        if (e.key === 'ArrowDown') focusAdjacentWindow('down');
        if (e.key === 'ArrowLeft') focusAdjacentWindow('left');
        if (e.key === 'ArrowRight') focusAdjacentWindow('right');
        return;
      }

      // Cmd+1-9 - Switch to workspace by number (Mac only, Ctrl+1-4 is for layouts)
      if (e.metaKey && !e.ctrlKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        const workspaces = workspacesRef.current;
        if (index < workspaces.length) {
          e.preventDefault();
          const { switchWorkspace } = useWorkspaceStore.getState();
          switchWorkspace(workspaces[index].id);
        }
      }

      // Cmd/Ctrl+Shift+] - Next workspace (key is '}' when shift is held)
      // Also check for ']' in case browser reports the base key
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '}' || e.key === ']')) {
        e.preventDefault();
        const workspaces = workspacesRef.current;
        const activeWorkspaceId = activeWorkspaceIdRef.current;
        const currentIndex = workspaces.findIndex(w => w.id === activeWorkspaceId);
        if (currentIndex < workspaces.length - 1) {
          const { switchWorkspace } = useWorkspaceStore.getState();
          switchWorkspace(workspaces[currentIndex + 1].id);
        }
      }

      // Cmd/Ctrl+Shift+[ - Previous workspace (key is '{' when shift is held)
      // Also check for '[' in case browser reports the base key
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '{' || e.key === '[')) {
        e.preventDefault();
        const workspaces = workspacesRef.current;
        const activeWorkspaceId = activeWorkspaceIdRef.current;
        const currentIndex = workspaces.findIndex(w => w.id === activeWorkspaceId);
        if (currentIndex > 0) {
          const { switchWorkspace } = useWorkspaceStore.getState();
          switchWorkspace(workspaces[currentIndex - 1].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isActive, focusAdjacentWindow]);

  const handleOpenFile = (filePath: string) => {
    const windows = windowsRef.current;
    // Check if file is already open in any tab
    for (const window of windows) {
      if (window.tabs) {
        const existingTab = window.tabs.find(t => t.filePath === filePath);
        if (existingTab) {
          // File already open - switch to that tab and focus window
          switchTab(window.id, existingTab.id);
          focusWindow(window.id);
          return;
        }
      }
    }

    // Get app for this file type from registry
    const fileName = filePath.split('/').pop() || 'Untitled';
    const appDef = getAppForFile(filePath);
    const appId = appDef?.id || 'text-viewer';

    // Find the focused window (highest z-index) that's not file-explorer
    const viewerWindows = windows.filter(w => !w.isMinimized && w.appId !== 'file-explorer');

    if (viewerWindows.length > 0) {
      // Find the most recently focused viewer window
      const focusedWindow = viewerWindows.reduce((prev, current) =>
        current.zIndex > prev.zIndex ? current : prev
      );

      // Add as new tab to focused window
      addTab(focusedWindow.id, filePath, appId);
    } else {
      // No suitable window found - create new window with single tab
      const defaultSize = appDef?.defaultSize || { width: 600, height: 500 };
      openWindow({
        title: fileName,
        appId,
        filePath,
        position: { x: 300 + Math.random() * 100, y: 100 + Math.random() * 100 },
        size: defaultSize,
        isMinimized: false,
        isMaximized: false,
      });
    }
  };

  const renderWindowContent = (window: typeof windows[0], isFocused: boolean) => {
    // File Explorer is special - it doesn't use tabs
    if (window.appId === 'file-explorer') {
      return <FileExplorer isFocused={isFocused} isSearchOpen={showSearch} />;
    }

    // Window component handles rendering tab content via FileViewer
    return null;
  };

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-[var(--holo-bg)] flex-1"
      style={{
        display: isActive ? 'block' : 'none',
      }}
    >
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(rgba(100, 150, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(100, 150, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Windows */}
      {(() => {
        const maxZIndex = Math.max(...windows.filter(w => !w.isMinimized).map(w => w.zIndex), 0);
        return windows.map((window) => {
          const isFocused = isActive && !window.isMinimized && window.zIndex === maxZIndex;
          return (
            <Window key={window.id} window={window} isFocused={isFocused}>
              {renderWindowContent(window, isFocused)}
            </Window>
          );
        });
      })()}

      {/* Dock for minimized windows */}
      <Dock workspaceId={workspaceId} />

      {/* Search Modal */}
      {showSearch && (
        <SearchModal
          tree={tree}
          onClose={() => setShowSearch(false)}
          onSelectFile={handleOpenFile}
        />
      )}

      {/* New Project Dialog */}
      {showNewProjectDialog && (
        <InputDialog
          title="New Project"
          placeholder="Enter project name..."
          confirmLabel="Create"
          onConfirm={(name) => {
            setShowNewProjectDialog(false);
            handleCreateProject(name);
          }}
          onCancel={() => setShowNewProjectDialog(false)}
        />
      )}
    </div>
  );
});

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { File, Copy, FilePlus, FolderPlus, Edit3, Trash2, Eye, EyeOff } from 'lucide-react';
import { useFileSystemStore, fileApi } from '../../stores/fileSystemStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { FileTreeItem } from './FileTreeItem';
import { Breadcrumb } from './Breadcrumb';
import { QuickCreateMenu } from './QuickCreateMenu';
import { ContextMenu, type MenuItem } from '../common/ContextMenu';
import { InputDialog } from '../common/InputDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ICON_SIZES, ICON_STROKE_WIDTH } from './iconConfig';
import { getAppForFile } from '../../apps';
import { getTemplateByExtension } from '../../templates/fileTemplates';
import { soundEngine } from '../../audio';
import type { FileNode } from '../../types';

type DialogType = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'quickCreate' | null;

interface FileExplorerProps {
  isFocused?: boolean;
  isSearchOpen?: boolean;
}

// Helper to flatten visible tree nodes (respecting expanded state)
function getVisibleNodes(node: FileNode, expandedDirs: Set<string>): FileNode[] {
  const result: FileNode[] = [node];
  if (node.type === 'directory' && expandedDirs.has(node.path) && node.children) {
    // Sort children: directories first, then files, alphabetically within each group
    const sortedChildren = [...node.children].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const child of sortedChildren) {
      result.push(...getVisibleNodes(child, expandedDirs));
    }
  }
  return result;
}

// Helper to find parent path
function getParentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return path.substring(0, lastSlash);
}

export function FileExplorer({ isFocused, isSearchOpen }: FileExplorerProps) {
  const { tree, loading, error, refreshTree, selectedPaths, lastSelectedPath, expandedDirs, selectPath, selectPaths, clearSelection, expandDir, collapseDir, toggleDir, showHidden, toggleShowHidden } = useFileSystemStore();
  const { openWindow, addTab, switchTab, focusWindow, getActiveWorkspace } = useWorkspaceStore();
  const activeWorkspace = getActiveWorkspace();
  const windows = useMemo(() => activeWorkspace?.windows || [], [activeWorkspace?.windows]);
  const { subscribeToFileSystem, connected } = useFileWatcher();

  // Container ref for focus management
  const containerRef = useRef<HTMLDivElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);

  // Dialog state
  const [dialog, setDialog] = useState<DialogType>(null);
  const [dialogNode, setDialogNode] = useState<FileNode | null>(null);
  const [quickCreateExtension, setQuickCreateExtension] = useState<string | null>(null);
  const [quickCreateMenuOpen, setQuickCreateMenuOpen] = useState(false);

  // Root drop zone state
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  // Debounce timer for tree refresh
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memoize visible nodes for keyboard nav and shift-select
  const visibleNodes = useMemo(() => {
    return tree ? getVisibleNodes(tree, expandedDirs) : [];
  }, [tree, expandedDirs]);

  // Reset root drag state when drag ends anywhere
  useEffect(() => {
    const handleDragEnd = () => setIsRootDragOver(false);
    document.addEventListener('dragend', handleDragEnd);
    return () => document.removeEventListener('dragend', handleDragEnd);
  }, []);

  // Focus container when window becomes focused
  useEffect(() => {
    if (isFocused && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isFocused]);

  // Restore focus when search modal closes
  useEffect(() => {
    if (isFocused && !isSearchOpen && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isSearchOpen, isFocused]);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  // Track files modified externally (to show indicator)
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());

  // Subscribe to file system events (file created/deleted) for auto-refresh
  // and track file changes for notification indicators
  useEffect(() => {
    const unsubscribe = subscribeToFileSystem((event) => {
      if (event.type === 'file-created' || event.type === 'file-deleted') {
        // Debounce tree refresh to avoid excessive refreshes
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = setTimeout(() => {
          refreshTree();
        }, 300);
      }

      // Track modified files for indicator (only for file changes, not creates/deletes)
      if (event.type === 'file-changed' && 'path' in event) {
        // Only add if not currently open in any window tab (check all windows and all their tabs)
        const isOpenInAnyTab = windows.some(w => {
          // Check legacy filePath property for backwards compatibility
          if (w.filePath === event.path) return true;
          // Check all tabs in the window
          if (w.tabs) {
            return w.tabs.some(tab => tab.filePath === event.path);
          }
          return false;
        });
        if (!isOpenInAnyTab) {
          setModifiedFiles(prev => new Set(prev).add(event.path));
        }
      }
    });

    return () => {
      unsubscribe();
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [subscribeToFileSystem, refreshTree, windows]);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      soundEngine.playEvent('file:open');

      // Clear modified indicator when opening a file
      setModifiedFiles(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });

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
    },
    [windows, openWindow, addTab, switchTab, focusWindow]
  );

  // Keyboard navigation when focused
  useEffect(() => {
    if (!isFocused || !tree || isSearchOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if a dialog or menu is open
      if (dialog || quickCreateMenuOpen) return;

      // Handle Cmd+N to open quick create menu
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setQuickCreateMenuOpen(true);
        return;
      }

      // Handle Cmd+A to select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectPaths(visibleNodes.map(n => n.path));
        return;
      }

      // Handle Cmd+C to copy selected paths to clipboard
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedPaths.size > 0) {
        e.preventDefault();
        const paths = Array.from(selectedPaths).join('\n');
        navigator.clipboard.writeText(paths);
        return;
      }

      // Handle Escape to clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
        return;
      }

      // Get current position based on last selected path
      const currentIndex = lastSelectedPath
        ? visibleNodes.findIndex(n => n.path === lastSelectedPath)
        : -1;

      const selectedNode = currentIndex >= 0 ? visibleNodes[currentIndex] : null;

      // Don't handle arrow keys with meta/ctrl (except shift for multi-select)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < visibleNodes.length - 1) {
            const nextPath = visibleNodes[currentIndex + 1].path;
            selectPath(nextPath, { shift: e.shiftKey, visibleNodes });
          } else if (currentIndex === -1 && visibleNodes.length > 0) {
            selectPath(visibleNodes[0].path);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            const prevPath = visibleNodes[currentIndex - 1].path;
            selectPath(prevPath, { shift: e.shiftKey, visibleNodes });
          } else if (currentIndex === -1 && visibleNodes.length > 0) {
            selectPath(visibleNodes[0].path);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (selectedNode && selectedNode.type === 'directory') {
            if (!expandedDirs.has(selectedNode.path)) {
              expandDir(selectedNode.path);
            } else if (selectedNode.children && selectedNode.children.length > 0) {
              const sortedChildren = [...selectedNode.children].sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });
              selectPath(sortedChildren[0].path);
            }
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (selectedNode) {
            if (selectedNode.type === 'directory' && expandedDirs.has(selectedNode.path)) {
              collapseDir(selectedNode.path);
            } else {
              const parentPath = getParentPath(selectedNode.path);
              if (parentPath) {
                selectPath(parentPath);
              }
            }
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedNode) {
            if (selectedNode.type === 'file') {
              handleOpenFile(selectedNode.path);
            } else {
              toggleDir(selectedNode.path);
            }
          }
          break;

        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          if (selectedNode) {
            setDialogNode(selectedNode);
            setDialog('delete');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocused, tree, expandedDirs, selectedPaths, lastSelectedPath, selectPath, selectPaths, clearSelection, expandDir, collapseDir, toggleDir, dialog, quickCreateMenuOpen, handleOpenFile, isSearchOpen, visibleNodes]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // File operations
  const handleNewFile = useCallback(async (name: string) => {
    if (!dialogNode) return;
    const basePath = dialogNode.type === 'directory' ? dialogNode.path : dialogNode.path.replace(/\/[^/]+$/, '');
    const newPath = `${basePath}/${name}`;

    try {
      await fileApi.createFile(newPath);
      refreshTree();
      handleOpenFile(newPath);
    } catch (err) {
      console.error('Failed to create file:', err);
    }
    setDialog(null);
    setDialogNode(null);
  }, [dialogNode, refreshTree, handleOpenFile]);

  const handleNewFolder = useCallback(async (name: string) => {
    if (!dialogNode) return;
    const basePath = dialogNode.type === 'directory' ? dialogNode.path : dialogNode.path.replace(/\/[^/]+$/, '');
    const newPath = `${basePath}/${name}`;

    try {
      await fileApi.createDir(newPath);
      refreshTree();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
    setDialog(null);
    setDialogNode(null);
  }, [dialogNode, refreshTree]);

  // Quick create handler for templated files
  const handleQuickCreate = useCallback(async (name: string) => {
    if (!quickCreateExtension) return;

    // Determine base path (selected directory, parent of selected file, or tree root)
    const { rootDir } = useFileSystemStore.getState();
    const basePath = tree?.path || rootDir;
    let targetDir = basePath;

    // Use last selected path for determining target directory
    if (lastSelectedPath && tree) {
      // Find the selected node to determine if it's a file or directory
      const findNode = (node: FileNode, path: string): FileNode | null => {
        if (node.path === path) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findNode(child, path);
            if (found) return found;
          }
        }
        return null;
      };
      const selectedNode = findNode(tree, lastSelectedPath);
      if (selectedNode) {
        targetDir = selectedNode.type === 'directory'
          ? selectedNode.path
          : selectedNode.path.replace(/\/[^/]+$/, '');
      }
    }

    // Ensure the name has correct extension
    const fileName = name.endsWith(`.${quickCreateExtension}`)
      ? name
      : `${name}.${quickCreateExtension}`;
    const newPath = `${targetDir}/${fileName}`;

    try {
      // Get template and create file with content
      const template = getTemplateByExtension(quickCreateExtension);
      await fileApi.createFile(newPath);
      if (template) {
        await fileApi.writeFile(newPath, template.getDefaultContent());
      }
      refreshTree();
      handleOpenFile(newPath);
    } catch (err) {
      console.error('Failed to create file:', err);
    }

    setDialog(null);
    setQuickCreateExtension(null);
  }, [quickCreateExtension, tree, lastSelectedPath, refreshTree, handleOpenFile]);

  // Handler for plus button - create file (generic or templated)
  const handlePlusCreateFile = useCallback((extension?: string) => {
    if (extension) {
      setQuickCreateExtension(extension);
      setDialog('quickCreate');
    } else {
      // For generic file, use tree root or selected directory
      setDialogNode(tree || null);
      setDialog('newFile');
    }
  }, [tree]);

  // Handler for plus button - create folder
  const handlePlusCreateFolder = useCallback(() => {
    setDialogNode(tree || null);
    setDialog('newFolder');
  }, [tree]);

  const handleRename = useCallback(async (newName: string) => {
    if (!dialogNode) return;
    const parentPath = dialogNode.path.replace(/\/[^/]+$/, '');
    const newPath = `${parentPath}/${newName}`;

    try {
      await fileApi.rename(dialogNode.path, newPath);
      refreshTree();
    } catch (err) {
      console.error('Failed to rename:', err);
    }
    setDialog(null);
    setDialogNode(null);
  }, [dialogNode, refreshTree]);

  const handleDelete = useCallback(async () => {
    if (!dialogNode) return;

    try {
      await fileApi.deleteFile(dialogNode.path);
      refreshTree();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
    setDialog(null);
    setDialogNode(null);
  }, [dialogNode, refreshTree]);

  const copyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  // Build context menu items
  const getContextMenuItems = (node: FileNode): MenuItem[] => {
    const items: MenuItem[] = [];

    if (node.type === 'file') {
      items.push({
        label: 'Open',
        icon: <File size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
        onClick: () => handleOpenFile(node.path),
      });
    }

    items.push({
      label: 'Copy Path',
      icon: <Copy size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
      onClick: () => copyPath(node.path),
    });

    items.push({ label: '', onClick: () => {}, divider: true });

    if (node.type === 'directory') {
      items.push({
        label: 'New File',
        icon: <FilePlus size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
        onClick: () => {
          setDialogNode(node);
          setDialog('newFile');
        },
      });
      items.push({
        label: 'New Folder',
        icon: <FolderPlus size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
        onClick: () => {
          setDialogNode(node);
          setDialog('newFolder');
        },
      });
      items.push({ label: '', onClick: () => {}, divider: true });
    }

    items.push({
      label: 'Rename',
      icon: <Edit3 size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
      onClick: () => {
        setDialogNode(node);
        setDialog('rename');
      },
    });

    items.push({
      label: 'Delete',
      icon: <Trash2 size={ICON_SIZES.contextMenu} strokeWidth={ICON_STROKE_WIDTH} />,
      onClick: () => {
        setDialogNode(node);
        setDialog('delete');
      },
      danger: true,
    });

    return items;
  };

  if (loading && !tree) {
    return (
      <div className="p-4 text-[var(--holo-muted)]">
        Loading file tree...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-400 mb-2">Error: {error}</div>
        <button
          onClick={() => refreshTree()}
          className="px-3 py-1 text-sm bg-[var(--holo-accent)] rounded hover:opacity-80"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 text-[var(--holo-muted)]">
        No files found
      </div>
    );
  }

  return (
    <div ref={containerRef} tabIndex={-1} className="h-full flex flex-col outline-none">
      {/* Breadcrumb Navigation with quick create button */}
      <div className="flex items-center gap-1 pr-2 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.3)]">
        <div className="flex-1 min-w-0">
          <Breadcrumb />
        </div>
        <QuickCreateMenu
          onCreateFile={handlePlusCreateFile}
          onCreateFolder={handlePlusCreateFolder}
          isOpen={quickCreateMenuOpen}
          onOpenChange={setQuickCreateMenuOpen}
        />
      </div>

      {/* Tree with root drop zone */}
      <div
        className={`flex-1 overflow-auto py-1 relative ${isRootDragOver ? 'root-drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          // Only show root indicator if directly over the container (not a file-tree-item)
          const target = e.target as HTMLElement;
          const isOverFileItem = target.closest('.file-tree-item');
          if (!isOverFileItem) {
            setIsRootDragOver(true);
          } else {
            setIsRootDragOver(false);
          }
        }}
        onDragLeave={(e) => {
          // Reset when leaving the container entirely
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsRootDragOver(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsRootDragOver(false);

          if (!tree) return;

          // Only handle drop if directly on container (not on a file-tree-item)
          const target = e.target as HTMLElement;
          if (target.closest('.file-tree-item')) {
            return; // Let the FileTreeItem handle it
          }

          try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            const itemsToMove: { path: string; name: string }[] = data.multiple
              ? data.items
              : [{ path: data.path, name: data.name }];

            for (const item of itemsToMove) {
              const sourcePath = item.path;
              const fileName = item.name;

              // Don't move if already at root
              if (getParentPath(sourcePath) === tree.path) {
                continue;
              }

              const newPath = `${tree.path}/${fileName}`;
              if (newPath === sourcePath) continue;

              await fileApi.rename(sourcePath, newPath);
            }

            clearSelection();
            refreshTree();
          } catch (err) {
            console.error('Failed to move file to root:', err);
          }
        }}
      >
        {isRootDragOver && (
          <div className="root-drop-indicator" />
        )}
        <FileTreeItem
          node={tree}
          depth={0}
          onOpenFile={handleOpenFile}
          onContextMenu={handleContextMenu}
          modifiedFiles={modifiedFiles}
          visibleNodes={visibleNodes}
        />
      </div>

      {/* Footer - selected path + refresh + connection status */}
      <div className="px-2 py-1 border-t border-[var(--holo-border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            title={connected ? 'Live sync connected' : 'Live sync disconnected'}
          />
          <span className="text-xs text-[var(--holo-muted)] truncate">
            {selectedPaths.size > 1
              ? `${selectedPaths.size} items selected`
              : lastSelectedPath
                ? lastSelectedPath.replace(useFileSystemStore.getState().rootDir, '~')
                : ''
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleShowHidden()}
            className={`text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors ${showHidden ? 'text-[var(--holo-accent)]' : ''}`}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => refreshTree()}
            className="text-xs text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={closeContextMenu}
        />
      )}

      {/* Dialogs */}
      {dialog === 'newFile' && dialogNode && (
        <InputDialog
          title="New File"
          placeholder="filename.md"
          confirmLabel="Create"
          onConfirm={handleNewFile}
          onCancel={() => { setDialog(null); setDialogNode(null); }}
        />
      )}

      {dialog === 'newFolder' && dialogNode && (
        <InputDialog
          title="New Folder"
          placeholder="folder-name"
          confirmLabel="Create"
          onConfirm={handleNewFolder}
          onCancel={() => { setDialog(null); setDialogNode(null); }}
        />
      )}

      {dialog === 'rename' && dialogNode && (
        <InputDialog
          title="Rename"
          defaultValue={dialogNode.name}
          confirmLabel="Rename"
          onConfirm={handleRename}
          onCancel={() => { setDialog(null); setDialogNode(null); }}
        />
      )}

      {dialog === 'delete' && dialogNode && (
        <ConfirmDialog
          title="Delete"
          message={`Are you sure you want to delete "${dialogNode.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => { setDialog(null); setDialogNode(null); }}
        />
      )}

      {dialog === 'quickCreate' && quickCreateExtension && (
        <InputDialog
          title={`New ${getTemplateByExtension(quickCreateExtension)?.displayName || 'File'}`}
          placeholder={`filename.${quickCreateExtension}`}
          confirmLabel="Create"
          onConfirm={handleQuickCreate}
          onCancel={() => {
            setDialog(null);
            setQuickCreateExtension(null);
          }}
        />
      )}
    </div>
  );
}

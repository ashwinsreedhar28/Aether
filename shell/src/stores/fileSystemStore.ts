import { create } from 'zustand';
import type { FileNode } from '../types';
import { soundEngine } from '../audio';

// Helper to immutably update a node in the tree.
//
// Recurses down the branch whose path prefixes the target. The recursion guard
// uses the path prefix ALONE (not `tree.children` truthiness): a directory whose
// children have not been materialized yet still has `children: undefined`, and
// the old `tree.children && ...` guard caused inserts into deeper descendants to
// be silently dropped — the root cause of the "folders only go to certain depths"
// bug. We now only short-circuit when there are genuinely no children to walk.
function updateTreeNode(
  tree: FileNode,
  targetPath: string,
  updater: (node: FileNode) => FileNode
): { tree: FileNode; found: boolean } {
  if (tree.path === targetPath) {
    return { tree: updater(tree), found: true };
  }

  // Only descend when the target lives somewhere under this node.
  if (targetPath.startsWith(tree.path + '/')) {
    // No children loaded here yet — nothing to recurse into. Returning the node
    // unchanged is correct; callers must materialize a parent before its child
    // (refreshTree restores shallow-to-deep to guarantee this ordering).
    if (!tree.children) {
      return { tree, found: false };
    }
    let found = false;
    const children = tree.children.map((child) => {
      const result = updateTreeNode(child, targetPath, updater);
      found = found || result.found;
      return result.tree;
    });

    return {
      tree: { ...tree, children },
      found,
    };
  }

  return { tree, found: false };
}

function mergeHydratedTree(
  freshNode: FileNode,
  previousNode: FileNode | null,
  expandedDirs: Set<string>,
  loadedDirs: Set<string>
): FileNode {
  if (!previousNode || freshNode.path !== previousNode.path) {
    return freshNode;
  }

  const shouldPreserveChildren =
    freshNode.type === 'directory' &&
    previousNode.children &&
    (expandedDirs.has(freshNode.path) || loadedDirs.has(freshNode.path));

  if (!freshNode.children) {
    return shouldPreserveChildren
      ? { ...freshNode, children: previousNode.children }
      : freshNode;
  }

  const previousChildrenByPath = new Map(
    (previousNode.children || []).map((child) => [child.path, child])
  );

  const children = freshNode.children.map((child) =>
    mergeHydratedTree(
      child,
      previousChildrenByPath.get(child.path) || null,
      expandedDirs,
      loadedDirs
    )
  );

  return { ...freshNode, children };
}

// Sort directory paths shallow-to-deep so a parent is always restored before any
// of its descendants. Depth is measured by path-separator count.
function byDepthAscending(a: string, b: string): number {
  const depthA = a.split('/').length;
  const depthB = b.split('/').length;
  if (depthA !== depthB) return depthA - depthB;
  return a.localeCompare(b);
}

// Persisted expand-state lives in the top-level `expandedDirs` slot of the
// viewer config (separate from per-workspace state). Debounced so rapid
// expand/collapse bursts coalesce into a single write.
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
function persistExpandedDirs(expandedDirs: Set<string>): void {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(async () => {
    try {
      const existing = (await window.electron.config.load()) || {};
      await window.electron.config.save({
        ...existing,
        expandedDirs: Array.from(expandedDirs),
      });
    } catch (err) {
      console.error('Failed to persist expanded dirs:', err);
    }
  }, 500);
}

interface SelectOptions {
  shift?: boolean;
  meta?: boolean;
  visibleNodes?: FileNode[];  // Required for shift-select range
}

interface FileSystemStore {
  tree: FileNode | null;
  selectedPaths: Set<string>;
  lastSelectedPath: string | null;  // For shift-click range selection
  expandedDirs: Set<string>;
  loadedDirs: Set<string>;    // Directories whose children have been fetched
  loadingDirs: Set<string>;   // Directories currently being fetched
  rootDir: string;
  loading: boolean;
  error: string | null;
  showHidden: boolean;        // Whether to show hidden files/folders
  restoredFromConfig: boolean; // True once persisted expand-state has been restored (first load only)

  // Actions
  setTree: (tree: FileNode) => void;
  selectPath: (path: string | null, options?: SelectOptions) => void;
  selectPaths: (paths: string[]) => void;
  toggleSelection: (path: string) => void;
  clearSelection: () => void;
  toggleDir: (path: string) => void;
  expandDir: (path: string) => void;
  collapseDir: (path: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRootDir: (rootDir: string) => void;
  setShowHidden: (show: boolean) => void;
  toggleShowHidden: () => void;
  refreshTree: () => Promise<void>;
  initRootDir: () => Promise<void>;

  // Lazy loading actions
  loadChildren: (path: string, options?: { skipPrefetch?: boolean }) => Promise<void>;
  insertChildren: (parentPath: string, children: FileNode[]) => boolean;
  prefetchGrandchildren: (parentPath: string) => void;
}

export const useFileSystemStore = create<FileSystemStore>((set, get) => ({
  tree: null,
  selectedPaths: new Set<string>(),
  lastSelectedPath: null,
  expandedDirs: new Set<string>(),
  loadedDirs: new Set<string>(),
  loadingDirs: new Set<string>(),
  rootDir: '',
  loading: false,
  error: null,
  showHidden: false,
  restoredFromConfig: false,

  setTree: (tree) => {
    // When setting a new tree, mark the root as loaded (since depth 1 is included)
    set(() => ({
      tree,
      loadedDirs: new Set([tree.path]),
      loadingDirs: new Set(),
    }));
  },

  selectPath: (path, options) => {
    soundEngine.playEvent('file:select');

    if (path === null) {
      set({ selectedPaths: new Set(), lastSelectedPath: null });
      return;
    }

    const { shift, meta, visibleNodes } = options || {};

    if (meta) {
      // Cmd/Ctrl+click: Toggle selection
      set((state) => {
        const newSelected = new Set(state.selectedPaths);
        if (newSelected.has(path)) {
          newSelected.delete(path);
        } else {
          newSelected.add(path);
        }
        return { selectedPaths: newSelected, lastSelectedPath: path };
      });
    } else if (shift && visibleNodes) {
      // Shift+click: Range select
      const { lastSelectedPath } = get();
      if (lastSelectedPath && visibleNodes.length > 0) {
        const startIdx = visibleNodes.findIndex(n => n.path === lastSelectedPath);
        const endIdx = visibleNodes.findIndex(n => n.path === path);

        if (startIdx !== -1 && endIdx !== -1) {
          const [min, max] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const rangePaths = visibleNodes.slice(min, max + 1).map(n => n.path);
          set((state) => ({
            selectedPaths: new Set([...state.selectedPaths, ...rangePaths]),
          }));
          return;
        }
      }
      // Fallback to single select if no valid range
      set({ selectedPaths: new Set([path]), lastSelectedPath: path });
    } else {
      // Plain click: Single select
      set({ selectedPaths: new Set([path]), lastSelectedPath: path });
    }
  },

  selectPaths: (paths) => {
    soundEngine.playEvent('file:select');
    set({
      selectedPaths: new Set(paths),
      lastSelectedPath: paths.length > 0 ? paths[paths.length - 1] : null
    });
  },

  toggleSelection: (path) => {
    set((state) => {
      const newSelected = new Set(state.selectedPaths);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      return { selectedPaths: newSelected, lastSelectedPath: path };
    });
  },

  clearSelection: () => {
    set({ selectedPaths: new Set(), lastSelectedPath: null });
  },

  toggleDir: (path) => {
    const { loadedDirs, loadChildren } = get();
    const isExpanding = !get().expandedDirs.has(path);

    set((state) => {
      const newExpanded = new Set(state.expandedDirs);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
        soundEngine.playEvent('folder:collapse');
      } else {
        newExpanded.add(path);
        soundEngine.playEvent('folder:expand');
      }
      persistExpandedDirs(newExpanded);
      return { expandedDirs: newExpanded };
    });

    // Lazy load children if expanding and not yet loaded
    if (isExpanding && !loadedDirs.has(path)) {
      loadChildren(path);
    }
  },

  expandDir: (path) => {
    const { loadedDirs, loadChildren } = get();

    soundEngine.playEvent('folder:expand');
    set((state) => {
      const newExpanded = new Set(state.expandedDirs);
      newExpanded.add(path);
      persistExpandedDirs(newExpanded);
      return { expandedDirs: newExpanded };
    });

    // Lazy load children if not yet loaded
    if (!loadedDirs.has(path)) {
      loadChildren(path);
    }
  },

  collapseDir: (path) => {
    soundEngine.playEvent('folder:collapse');
    set((state) => {
      const newExpanded = new Set(state.expandedDirs);
      newExpanded.delete(path);
      persistExpandedDirs(newExpanded);
      return { expandedDirs: newExpanded };
    });
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setRootDir: (rootDir) => {
    set({
      rootDir,
      expandedDirs: new Set([rootDir]),
      loadedDirs: new Set(),
      loadingDirs: new Set(),
    });
  },

  setShowHidden: (show) => {
    set({
      showHidden: show,
      loadedDirs: new Set(),  // Clear cache to force reload
    });
    get().refreshTree();
  },

  toggleShowHidden: () => {
    const { showHidden, refreshTree } = get();
    set({
      showHidden: !showHidden,
      loadedDirs: new Set(),  // Clear cache to force reload
    });
    refreshTree();
  },

  initRootDir: async () => {
    const rootDir = (await window.electron.app.getRootDir()) ?? '';
    set({
      rootDir,
      expandedDirs: new Set([rootDir]),
      loadedDirs: new Set(),
      loadingDirs: new Set(),
    });
  },

  refreshTree: async () => {
    const { setLoading, setError, setTree, loadChildren, showHidden, restoredFromConfig } = get();
    setLoading(true);
    setError(null);

    try {
      const previousTree = get().tree;
      const previousLoadedDirs = get().loadedDirs;
      const data = await window.electron.fs.getTree({ showHidden });

      // On the very first load after an app reload, the in-memory expand-state
      // is empty. Restore the persisted set so folders the user had open before
      // reload come back. Subsequent refreshes (file-watcher triggered) keep the
      // live in-memory state instead.
      let expandedDirs = get().expandedDirs;
      if (!restoredFromConfig) {
        try {
          const cfg = await window.electron.config.load();
          const persisted = cfg?.expandedDirs;
          if (persisted && persisted.length > 0) {
            // Always include the root, and only keep paths under the current root
            // (config may carry stale paths from a previously-open folder).
            const rootPath = data.tree.path;
            const restored = new Set<string>([rootPath]);
            for (const p of persisted) {
              if (p === rootPath || p.startsWith(rootPath + '/')) {
                restored.add(p);
              }
            }
            expandedDirs = restored;
            set({ expandedDirs: restored });
          }
        } catch {
          // No persisted config — fall through with the live set.
        }
        set({ restoredFromConfig: true });
      }

      const hydratedTree = mergeHydratedTree(
        data.tree,
        previousTree,
        expandedDirs,
        previousLoadedDirs
      );
      setTree(hydratedTree);

      // Re-load children for all expanded directories to restore state.
      // setTree resets loadedDirs, so every expanded folder must re-fetch.
      // CRITICAL: restore shallow-to-deep and AWAIT each level, so a parent's
      // children array is materialized before we try to insert a grandchild into
      // it. Firing these un-awaited / unordered was the root cause of deep
      // folders failing to restore after reload.
      const expandedPaths = Array.from(expandedDirs)
        .filter((p) => p !== data.tree.path)
        .sort(byDepthAscending);

      for (const path of expandedPaths) {
        await loadChildren(path, { skipPrefetch: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
    } finally {
      setLoading(false);
    }
  },

  // Load children of a directory (with optional prefetch control)
  loadChildren: async (path, options?: { skipPrefetch?: boolean }) => {
    const { loadedDirs, loadingDirs, insertChildren, prefetchGrandchildren, showHidden, rootDir } = get();

    // Skip if already loaded or currently loading
    if (loadedDirs.has(path) || loadingDirs.has(path)) {
      return;
    }

    // Mark as loading
    set((state) => ({
      loadingDirs: new Set(state.loadingDirs).add(path),
    }));

    try {
      const { children } = await window.electron.fs.getChildren(path, { showHidden });

      const latest = get();
      if (latest.rootDir !== rootDir || latest.showHidden !== showHidden) {
        set((state) => {
          const newLoading = new Set(state.loadingDirs);
          newLoading.delete(path);
          return { loadingDirs: newLoading };
        });
        return;
      }

      // Insert children into tree
      const inserted = insertChildren(path, children);

      // Mark as loaded
      set((state) => {
        const newLoaded = new Set(state.loadedDirs);
        if (inserted) {
          newLoaded.add(path);
        }
        const newLoading = new Set(state.loadingDirs);
        newLoading.delete(path);
        return { loadedDirs: newLoaded, loadingDirs: newLoading };
      });

      if (!inserted) {
        return;
      }

      // Directory watching is best-effort; loading children should not fail if
      // the watcher cannot attach to this path.
      window.electron.fs.watchDir(path).catch((err) => {
        console.error('Failed to watch directory:', err);
      });

      // Prefetch grandchildren in background for smooth navigation
      // Skip if this is already a prefetch call to prevent cascading
      if (!options?.skipPrefetch) {
        prefetchGrandchildren(path);
      }
    } catch (err) {
      console.error('Failed to load children:', err);
      set((state) => {
        const newLoading = new Set(state.loadingDirs);
        newLoading.delete(path);
        return { loadingDirs: newLoading };
      });
    }
  },

  // Insert children into the tree at a specific path
  insertChildren: (parentPath, children) => {
    let inserted = false;
    set((state) => {
      if (!state.tree) return state;

      const result = updateTreeNode(state.tree, parentPath, (node) => ({
        ...node,
        children,
      }));
      inserted = result.found;

      return result.found ? { tree: result.tree } : state;
    });
    return inserted;
  },

  // Prefetch grandchildren for smoother navigation (only 1 level deep)
  prefetchGrandchildren: (parentPath) => {
    const { tree, loadedDirs, loadChildren } = get();
    if (!tree) return;

    // Find the parent node
    const findNode = (node: FileNode, targetPath: string): FileNode | null => {
      if (node.path === targetPath) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child, targetPath);
          if (found) return found;
        }
      }
      return null;
    };

    const parentNode = findNode(tree, parentPath);
    if (!parentNode?.children) return;

    // Use requestIdleCallback or setTimeout to avoid blocking UI
    const prefetchFn = () => {
      for (const child of parentNode.children || []) {
        if (child.type === 'directory' && !loadedDirs.has(child.path)) {
          // Load in background with skipPrefetch to prevent cascading
          loadChildren(child.path, { skipPrefetch: true });
        }
      }
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(prefetchFn, { timeout: 2000 });
    } else {
      setTimeout(prefetchFn, 100);
    }
  },
}));

// File operations helper using Electron IPC
export const fileApi = {
  async readFile(path: string): Promise<{ content: string; modified: string; isImage?: boolean }> {
    return window.electron.fs.readFile(path);
  },

  async writeFile(path: string, content: string): Promise<void> {
    await window.electron.fs.writeFile(path, content);
  },

  async createFile(path: string): Promise<void> {
    await window.electron.fs.createFile(path, 'file');
  },

  async createDir(path: string): Promise<void> {
    await window.electron.fs.createFile(path, 'directory');
  },

  async deleteFile(path: string): Promise<void> {
    await window.electron.fs.deleteFile(path);
  },

  async rename(oldPath: string, newPath: string): Promise<void> {
    await window.electron.fs.rename(oldPath, newPath);
  },
};

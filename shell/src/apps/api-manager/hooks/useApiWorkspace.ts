/**
 * useApiWorkspace Hook
 * Manages loading, saving, and state tracking for API workspace files
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  ApiWorkspace,
  ApiRequest,
  ApiFolder,
  Environment,
  WebSocketConfig,
  FolderItem,
} from '../types';
import { createEmptyWorkspace, generateId } from '../constants';
import { useFileWatcher } from '../../../hooks/useFileWatcher';

function isValidApiFilePath(path: string | undefined): path is string {
  if (!path) return false;
  return path.startsWith('/') && path.toLowerCase().endsWith('.api');
}

function validateWorkspace(data: unknown): ApiWorkspace {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid workspace data');
  }

  const ws = data as Partial<ApiWorkspace>;

  return {
    name: ws.name || 'Untitled',
    description: ws.description,
    version: '1.0',
    folders: Array.isArray(ws.folders) ? ws.folders : [],
    requests: Array.isArray(ws.requests) ? ws.requests : [],
    websockets: Array.isArray(ws.websockets) ? ws.websockets : [],
    environments: Array.isArray(ws.environments) ? ws.environments : [],
    activeEnvironmentId: ws.activeEnvironmentId,
    createdAt: ws.createdAt || new Date().toISOString(),
    updatedAt: ws.updatedAt || new Date().toISOString(),
  };
}

interface UseApiWorkspaceOptions {
  filePath?: string;
  fileApi: {
    readFile: (path: string) => Promise<{ content: string }>;
    writeFile: (path: string, content: string) => Promise<void>;
  };
  setDirty: (isDirty: boolean) => void;
}

interface UseApiWorkspaceReturn {
  workspace: ApiWorkspace | null;
  loading: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;
  externalChangeDetected: boolean;

  // File operations
  loadWorkspace: (silent?: boolean) => Promise<void>;
  saveWorkspace: () => Promise<void>;
  dismissExternalChange: () => void;

  // Request operations
  addRequest: (request: ApiRequest, folderId?: string) => void;
  updateRequest: (requestId: string, updates: Partial<ApiRequest>) => void;
  deleteRequest: (requestId: string) => void;
  duplicateRequest: (requestId: string) => void;

  // Folder operations
  addFolder: (folder: ApiFolder, parentId?: string) => void;
  updateFolder: (folderId: string, updates: Partial<ApiFolder>) => void;
  deleteFolder: (folderId: string) => void;

  // WebSocket operations
  addWebSocket: (ws: WebSocketConfig, folderId?: string) => void;
  updateWebSocket: (wsId: string, updates: Partial<WebSocketConfig>) => void;
  deleteWebSocket: (wsId: string) => void;

  // Environment operations
  addEnvironment: (env: Environment) => void;
  updateEnvironment: (envId: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (envId: string) => void;
  setActiveEnvironment: (envId: string | undefined) => void;

  // Direct workspace update
  updateWorkspace: (updater: (ws: ApiWorkspace) => ApiWorkspace) => void;

  // Get item by ID (searches recursively)
  getRequestById: (id: string) => ApiRequest | undefined;
  getWebSocketById: (id: string) => WebSocketConfig | undefined;
  getFolderById: (id: string) => ApiFolder | undefined;
  getActiveEnvironment: () => Environment | undefined;
}

// Helper to find and update items in nested folder structure
function findInFolders<T extends FolderItem>(
  folders: ApiFolder[],
  predicate: (item: FolderItem) => item is T
): T | undefined {
  for (const folder of folders) {
    for (const item of folder.items) {
      if (predicate(item)) return item;
      if ('items' in item) {
        const found = findInFolders([item as ApiFolder], predicate);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function updateInFolders<T extends FolderItem>(
  folders: ApiFolder[],
  id: string,
  updater: (item: T) => T
): ApiFolder[] {
  return folders.map((folder) => ({
    ...folder,
    items: folder.items.map((item) => {
      if ('id' in item && item.id === id) {
        return updater(item as T);
      }
      if ('items' in item) {
        return {
          ...item,
          items: updateInFolders([item as ApiFolder], id, updater)[0]?.items || [],
        };
      }
      return item;
    }),
  }));
}

function deleteFromFolders(folders: ApiFolder[], id: string): ApiFolder[] {
  return folders.map((folder) => ({
    ...folder,
    items: folder.items
      .filter((item) => !('id' in item && item.id === id))
      .map((item) => {
        if ('items' in item) {
          return {
            ...item,
            items: deleteFromFolders([item as ApiFolder], id)[0]?.items || [],
          };
        }
        return item;
      }),
  }));
}

function addToFolder(
  folders: ApiFolder[],
  folderId: string,
  item: FolderItem
): ApiFolder[] {
  return folders.map((folder) => {
    if (folder.id === folderId) {
      return { ...folder, items: [...folder.items, item] };
    }
    if (folder.items.some((i) => 'items' in i)) {
      return {
        ...folder,
        items: folder.items.map((i) => {
          if ('items' in i) {
            const updated = addToFolder([i as ApiFolder], folderId, item);
            return updated[0] || i;
          }
          return i;
        }),
      };
    }
    return folder;
  });
}

export function useApiWorkspace({
  filePath,
  fileApi,
  setDirty,
}: UseApiWorkspaceOptions): UseApiWorkspaceReturn {
  const [workspace, setWorkspace] = useState<ApiWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [externalChangeDetected, setExternalChangeDetected] = useState(false);

  const { subscribeToFile } = useFileWatcher();

  // Load workspace from file
  const loadWorkspace = useCallback(
    async (silent = false) => {
      if (!isValidApiFilePath(filePath)) {
        setWorkspace(createEmptyWorkspace('New Workspace'));
        setLoading(false);
        return;
      }

      if (!silent) {
        setLoading(true);
        setError(null);
      }

      try {
        const data = await fileApi.readFile(filePath);
        const parsed = JSON.parse(data.content);
        const validated = validateWorkspace(parsed);
        setWorkspace(validated);
        setHasUnsavedChanges(false);
        setDirty(false);
        setExternalChangeDetected(false);
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Failed to load workspace');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [filePath, fileApi, setDirty]
  );

  // Save workspace to file
  const saveWorkspace = useCallback(async () => {
    if (!filePath || !workspace) return;

    try {
      const payload = {
        ...workspace,
        updatedAt: new Date().toISOString(),
      };
      await fileApi.writeFile(filePath, JSON.stringify(payload, null, 2));
      setHasUnsavedChanges(false);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace');
    }
  }, [filePath, workspace, fileApi, setDirty]);

  // Mark as dirty
  const markDirty = useCallback(
    (next: ApiWorkspace) => {
      setWorkspace(next);
      setHasUnsavedChanges(true);
      setDirty(true);
    },
    [setDirty]
  );

  // Update workspace with a function
  const updateWorkspace = useCallback(
    (updater: (ws: ApiWorkspace) => ApiWorkspace) => {
      if (!workspace) return;
      const next = updater(workspace);
      if (next === workspace) return;
      markDirty(next);
    },
    [workspace, markDirty]
  );

  // Request operations
  const addRequest = useCallback(
    (request: ApiRequest, folderId?: string) => {
      updateWorkspace((ws) => {
        if (folderId) {
          return { ...ws, folders: addToFolder(ws.folders, folderId, request) };
        }
        return { ...ws, requests: [...ws.requests, request] };
      });
    },
    [updateWorkspace]
  );

  const updateRequest = useCallback(
    (requestId: string, updates: Partial<ApiRequest>) => {
      updateWorkspace((ws) => {
        // Check root requests first
        const rootIndex = ws.requests.findIndex((r) => r.id === requestId);
        if (rootIndex !== -1) {
          return {
            ...ws,
            requests: ws.requests.map((r) =>
              r.id === requestId
                ? { ...r, ...updates, updatedAt: new Date().toISOString() }
                : r
            ),
          };
        }
        // Search in folders
        return {
          ...ws,
          folders: updateInFolders<ApiRequest>(ws.folders, requestId, (r) => ({
            ...r,
            ...updates,
            updatedAt: new Date().toISOString(),
          })),
        };
      });
    },
    [updateWorkspace]
  );

  const deleteRequest = useCallback(
    (requestId: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        requests: ws.requests.filter((r) => r.id !== requestId),
        folders: deleteFromFolders(ws.folders, requestId),
      }));
    },
    [updateWorkspace]
  );

  const duplicateRequest = useCallback(
    (requestId: string) => {
      if (!workspace) return;

      // Find request in root or folders
      let request = workspace.requests.find((r) => r.id === requestId);
      if (!request) {
        request = findInFolders(
          workspace.folders,
          (item): item is ApiRequest => 'method' in item && item.id === requestId
        );
      }
      if (!request) return;

      const now = new Date().toISOString();
      const duplicate: ApiRequest = {
        ...request,
        id: generateId(),
        name: `${request.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      };

      addRequest(duplicate);
    },
    [workspace, addRequest]
  );

  // Folder operations
  const addFolder = useCallback(
    (folder: ApiFolder, parentId?: string) => {
      updateWorkspace((ws) => {
        if (parentId) {
          return { ...ws, folders: addToFolder(ws.folders, parentId, folder) };
        }
        return { ...ws, folders: [...ws.folders, folder] };
      });
    },
    [updateWorkspace]
  );

  const updateFolder = useCallback(
    (folderId: string, updates: Partial<ApiFolder>) => {
      updateWorkspace((ws) => ({
        ...ws,
        folders: ws.folders.map((f) =>
          f.id === folderId
            ? { ...f, ...updates, updatedAt: new Date().toISOString() }
            : f
        ),
      }));
    },
    [updateWorkspace]
  );

  const deleteFolder = useCallback(
    (folderId: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        folders: ws.folders.filter((f) => f.id !== folderId),
      }));
    },
    [updateWorkspace]
  );

  // WebSocket operations
  const addWebSocket = useCallback(
    (wsConfig: WebSocketConfig, folderId?: string) => {
      updateWorkspace((ws) => {
        if (folderId) {
          return { ...ws, folders: addToFolder(ws.folders, folderId, wsConfig) };
        }
        return { ...ws, websockets: [...ws.websockets, wsConfig] };
      });
    },
    [updateWorkspace]
  );

  const updateWebSocket = useCallback(
    (wsId: string, updates: Partial<WebSocketConfig>) => {
      updateWorkspace((ws) => {
        const rootIndex = ws.websockets.findIndex((w) => w.id === wsId);
        if (rootIndex !== -1) {
          return {
            ...ws,
            websockets: ws.websockets.map((w) =>
              w.id === wsId
                ? { ...w, ...updates, updatedAt: new Date().toISOString() }
                : w
            ),
          };
        }
        return {
          ...ws,
          folders: updateInFolders<WebSocketConfig>(ws.folders, wsId, (w) => ({
            ...w,
            ...updates,
            updatedAt: new Date().toISOString(),
          })),
        };
      });
    },
    [updateWorkspace]
  );

  const deleteWebSocket = useCallback(
    (wsId: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        websockets: ws.websockets.filter((w) => w.id !== wsId),
        folders: deleteFromFolders(ws.folders, wsId),
      }));
    },
    [updateWorkspace]
  );

  // Environment operations
  const addEnvironment = useCallback(
    (env: Environment) => {
      updateWorkspace((ws) => ({
        ...ws,
        environments: [...ws.environments, env],
      }));
    },
    [updateWorkspace]
  );

  const updateEnvironment = useCallback(
    (envId: string, updates: Partial<Environment>) => {
      updateWorkspace((ws) => ({
        ...ws,
        environments: ws.environments.map((e) =>
          e.id === envId
            ? { ...e, ...updates, updatedAt: new Date().toISOString() }
            : e
        ),
      }));
    },
    [updateWorkspace]
  );

  const deleteEnvironment = useCallback(
    (envId: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        environments: ws.environments.filter((e) => e.id !== envId),
        activeEnvironmentId:
          ws.activeEnvironmentId === envId ? undefined : ws.activeEnvironmentId,
      }));
    },
    [updateWorkspace]
  );

  const setActiveEnvironment = useCallback(
    (envId: string | undefined) => {
      updateWorkspace((ws) => ({
        ...ws,
        activeEnvironmentId: envId,
      }));
    },
    [updateWorkspace]
  );

  // Getters
  const getRequestById = useCallback(
    (id: string): ApiRequest | undefined => {
      if (!workspace) return undefined;
      const root = workspace.requests.find((r) => r.id === id);
      if (root) return root;
      return findInFolders(
        workspace.folders,
        (item): item is ApiRequest => 'method' in item && item.id === id
      );
    },
    [workspace]
  );

  const getWebSocketById = useCallback(
    (id: string): WebSocketConfig | undefined => {
      if (!workspace) return undefined;
      const root = workspace.websockets.find((w) => w.id === id);
      if (root) return root;
      return findInFolders(
        workspace.folders,
        (item): item is WebSocketConfig =>
          'url' in item && !('method' in item) && !('items' in item) && item.id === id
      );
    },
    [workspace]
  );

  const getFolderById = useCallback(
    (id: string): ApiFolder | undefined => {
      if (!workspace) return undefined;
      const root = workspace.folders.find((f) => f.id === id);
      if (root) return root;
      return findInFolders(
        workspace.folders,
        (item): item is ApiFolder => 'items' in item && item.id === id
      );
    },
    [workspace]
  );

  const getActiveEnvironment = useCallback((): Environment | undefined => {
    if (!workspace || !workspace.activeEnvironmentId) return undefined;
    return workspace.environments.find(
      (e) => e.id === workspace.activeEnvironmentId
    );
  }, [workspace]);

  const dismissExternalChange = useCallback(() => {
    setExternalChangeDetected(false);
  }, []);

  // Initial load
  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // Watch for external changes
  useEffect(() => {
    if (!isValidApiFilePath(filePath)) return;

    const unsubscribe = subscribeToFile(filePath, () => {
      if (hasUnsavedChanges) {
        setExternalChangeDetected(true);
      } else {
        loadWorkspace(true);
      }
    });

    return unsubscribe;
  }, [filePath, subscribeToFile, hasUnsavedChanges, loadWorkspace]);

  return {
    workspace,
    loading,
    error,
    hasUnsavedChanges,
    externalChangeDetected,
    loadWorkspace,
    saveWorkspace,
    dismissExternalChange,
    addRequest,
    updateRequest,
    deleteRequest,
    duplicateRequest,
    addFolder,
    updateFolder,
    deleteFolder,
    addWebSocket,
    updateWebSocket,
    deleteWebSocket,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
    setActiveEnvironment,
    updateWorkspace,
    getRequestById,
    getWebSocketById,
    getFolderById,
    getActiveEnvironment,
  };
}

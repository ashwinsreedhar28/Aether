/**
 * API Manager App
 * Postman-like API testing tool
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Send,
  Plus,
  Save,
  FolderOpen,
  AlertCircle,
  Loader2,
  FolderPlus,
  Wifi,
} from 'lucide-react';
import type { AppProps } from '../types';
import { useAppContext } from '../AppContext';
import { useApiWorkspace } from './hooks/useApiWorkspace';
import type { SelectedItem, ApiRequest, WebSocketConfig } from './types';
import { createEmptyRequest, createEmptyFolder, createEmptyWebSocket } from './constants';
import { Sidebar } from './components/Sidebar/Sidebar';
import { RequestBuilder } from './components/RequestBuilder/RequestBuilder';
import { ResponseViewer } from './components/ResponseViewer/ResponseViewer';
import { WebSocketPanel } from './components/WebSocket/WebSocketPanel';
import { useHttpClient } from './hooks/useHttpClient';
import { useWebSocket } from './hooks/useWebSocket';

export function ApiManager({ filePath, isActive }: AppProps) {
  const { fileApi, setDirty } = useAppContext();

  // Main workspace state
  const {
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
    setActiveEnvironment,
    getRequestById,
    getWebSocketById,
    getActiveEnvironment,
  } = useApiWorkspace({ filePath, fileApi, setDirty });

  // UI state
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);

  // HTTP client state
  const {
    execute: executeRequest,
    cancel: cancelRequest,
    state: requestState,
    clearResponse,
  } = useHttpClient();

  // WebSocket state
  const {
    connect: connectWebSocket,
    disconnect: disconnectWebSocket,
    send: sendWebSocketMessage,
    state: webSocketState,
    clearMessages,
  } = useWebSocket();

  // Get selected request or websocket
  const selectedRequest = selectedItem?.type === 'request'
    ? getRequestById(selectedItem.id)
    : undefined;

  const selectedWebSocket = selectedItem?.type === 'websocket'
    ? getWebSocketById(selectedItem.id)
    : undefined;

  // Handle selecting an item
  const handleSelectItem = useCallback((item: SelectedItem) => {
    setSelectedItem(item);
    clearResponse();
    if (webSocketState.status === 'connected') {
      disconnectWebSocket();
    }
  }, [clearResponse, disconnectWebSocket, webSocketState.status]);

  // Handle adding a new request
  const handleAddRequest = useCallback((folderId?: string) => {
    const newRequest = createEmptyRequest();
    addRequest(newRequest, folderId);
    setSelectedItem({ type: 'request', id: newRequest.id });
  }, [addRequest]);

  // Handle adding a new folder
  const handleAddFolder = useCallback((parentId?: string) => {
    const newFolder = createEmptyFolder();
    addFolder(newFolder, parentId);
  }, [addFolder]);

  // Handle adding a new websocket
  const handleAddWebSocket = useCallback((folderId?: string) => {
    const newWs = createEmptyWebSocket();
    addWebSocket(newWs, folderId);
    setSelectedItem({ type: 'websocket', id: newWs.id });
  }, [addWebSocket]);

  // Handle sending a request
  const handleSendRequest = useCallback(() => {
    if (!selectedRequest) return;
    const activeEnv = getActiveEnvironment();
    executeRequest(selectedRequest, activeEnv || null);
  }, [selectedRequest, getActiveEnvironment, executeRequest]);

  // Handle updating the current request
  const handleUpdateRequest = useCallback((updates: Partial<ApiRequest>) => {
    if (!selectedRequest) return;
    updateRequest(selectedRequest.id, updates);
  }, [selectedRequest, updateRequest]);

  // Handle deleting the current request
  const handleDeleteRequest = useCallback(() => {
    if (!selectedRequest) return;
    deleteRequest(selectedRequest.id);
    setSelectedItem(null);
  }, [selectedRequest, deleteRequest]);

  // Handle updating the current websocket
  const handleUpdateWebSocket = useCallback((updates: Partial<WebSocketConfig>) => {
    if (!selectedWebSocket) return;
    updateWebSocket(selectedWebSocket.id, updates);
  }, [selectedWebSocket, updateWebSocket]);

  // Handle deleting the current websocket
  const handleDeleteWebSocket = useCallback(() => {
    if (!selectedWebSocket) return;
    deleteWebSocket(selectedWebSocket.id);
    setSelectedItem(null);
    if (webSocketState.status === 'connected') {
      disconnectWebSocket();
    }
  }, [selectedWebSocket, deleteWebSocket, disconnectWebSocket, webSocketState.status]);

  // Handle websocket connect
  const handleConnectWebSocket = useCallback(() => {
    if (!selectedWebSocket) return;
    const activeEnv = getActiveEnvironment();
    connectWebSocket(selectedWebSocket, activeEnv || null);
  }, [selectedWebSocket, getActiveEnvironment, connectWebSocket]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges) {
          saveWorkspace();
        }
      }

      // Cmd/Ctrl + Enter to send request
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (selectedRequest) {
          handleSendRequest();
        } else if (selectedWebSocket && webSocketState.status === 'disconnected') {
          handleConnectWebSocket();
        }
      }

      // Cmd/Ctrl + N to add new request
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleAddRequest();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isActive,
    hasUnsavedChanges,
    saveWorkspace,
    selectedRequest,
    selectedWebSocket,
    handleSendRequest,
    handleConnectWebSocket,
    handleAddRequest,
    webSocketState.status,
  ]);

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--holo-bg)] text-[var(--holo-muted)]">
        <Loader2 size={24} className="animate-spin mr-2" />
        Loading workspace...
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-[var(--holo-bg)]">
        <AlertCircle size={48} className="text-red-400" />
        <div className="text-center">
          <h3 className="text-lg font-medium text-red-400 mb-1">Error loading workspace</h3>
          <p className="text-sm text-[var(--holo-muted)]">{error}</p>
        </div>
        <button
          onClick={() => loadWorkspace()}
          className="px-4 py-2 rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No workspace state
  if (!workspace) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-6 bg-[var(--holo-bg)]">
        <Send size={64} className="text-[var(--holo-accent)]" />
        <div className="text-center">
          <h2 className="text-xl font-medium text-[var(--holo-text)] mb-2">API Manager</h2>
          <p className="text-sm text-[var(--holo-muted)]">Open or create a .api workspace file</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {}}
            className="flex items-center gap-2 px-4 py-2 rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            <FolderOpen size={16} />
            Open Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      {/* External change warning */}
      {externalChangeDetected && (
        <div className="flex items-center justify-between px-3 py-2 bg-amber-500/20 border-b border-amber-500/50">
          <span className="text-xs text-amber-300">Workspace was modified externally</span>
          <div className="flex gap-2">
            <button
              onClick={() => loadWorkspace()}
              className="px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
            >
              Reload
            </button>
            <button
              onClick={dismissExternalChange}
              className="px-2 py-0.5 text-xs text-amber-300/70 hover:text-amber-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleAddRequest()}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            <Plus size={14} />
            Request
          </button>
          <button
            onClick={() => handleAddFolder()}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            <FolderPlus size={14} />
            Folder
          </button>
          <button
            onClick={() => handleAddWebSocket()}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 transition-colors"
          >
            <Wifi size={14} />
            WebSocket
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--holo-muted)]">{workspace.name}</span>
          {hasUnsavedChanges && <span className="text-xs text-amber-400">Unsaved</span>}
          <button
            onClick={saveWorkspace}
            disabled={!hasUnsavedChanges}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={14} />
            Save
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          workspace={workspace}
          selectedItem={selectedItem}
          onSelectItem={handleSelectItem}
          onAddRequest={handleAddRequest}
          onAddFolder={handleAddFolder}
          onAddWebSocket={handleAddWebSocket}
          onDeleteFolder={deleteFolder}
          onUpdateFolder={updateFolder}
          activeEnvironmentId={workspace.activeEnvironmentId}
          onSetActiveEnvironment={setActiveEnvironment}
          onUpdateEnvironment={updateEnvironment}
          onAddEnvironment={addEnvironment}
        />

        {/* Main panel - Request Builder or WebSocket */}
        <div className="flex-1 flex overflow-hidden">
          {selectedRequest ? (
            <>
              <div className="flex-1 overflow-hidden border-r border-[var(--holo-border)]">
                <RequestBuilder
                  request={selectedRequest}
                  onUpdate={handleUpdateRequest}
                  onDelete={handleDeleteRequest}
                  onDuplicate={() => duplicateRequest(selectedRequest.id)}
                  onSend={handleSendRequest}
                  isLoading={requestState.isLoading}
                  onCancel={cancelRequest}
                />
              </div>
              <div className="w-[400px] overflow-hidden">
                <ResponseViewer
                  response={requestState.response}
                  error={requestState.error}
                  isLoading={requestState.isLoading}
                />
              </div>
            </>
          ) : selectedWebSocket ? (
            <WebSocketPanel
              config={selectedWebSocket}
              onUpdate={handleUpdateWebSocket}
              onDelete={handleDeleteWebSocket}
              state={webSocketState}
              onConnect={handleConnectWebSocket}
              onDisconnect={disconnectWebSocket}
              onSend={sendWebSocketMessage}
              onClearMessages={clearMessages}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--holo-muted)]">
              <Send size={48} />
              <p className="text-sm">Select a request or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

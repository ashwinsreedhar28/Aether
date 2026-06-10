/**
 * Sidebar Component
 * Collection browser with folder tree and environment selector
 */

import type { ApiWorkspace, SelectedItem, ApiFolder, Environment } from '../../types';
import { FolderTree } from './FolderTree';
import { EnvironmentSelector } from './EnvironmentSelector';

interface SidebarProps {
  workspace: ApiWorkspace;
  selectedItem: SelectedItem;
  onSelectItem: (item: SelectedItem) => void;
  onAddRequest: (folderId?: string) => void;
  onAddFolder: (parentId?: string) => void;
  onAddWebSocket: (folderId?: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onUpdateFolder: (folderId: string, updates: Partial<ApiFolder>) => void;
  activeEnvironmentId?: string;
  onSetActiveEnvironment: (envId: string | undefined) => void;
  onUpdateEnvironment: (envId: string, updates: Partial<Environment>) => void;
  onAddEnvironment: (env: Environment) => void;
}

export function Sidebar({
  workspace,
  selectedItem,
  onSelectItem,
  onAddRequest,
  onAddFolder,
  onAddWebSocket,
  onDeleteFolder,
  onUpdateFolder,
  activeEnvironmentId,
  onSetActiveEnvironment,
  onUpdateEnvironment,
  onAddEnvironment,
}: SidebarProps) {
  return (
    <div className="w-64 border-r border-[var(--holo-border)] flex flex-col overflow-hidden">
      {/* Environment selector */}
      <div className="p-2 border-b border-[var(--holo-border)]">
        <EnvironmentSelector
          environments={workspace.environments}
          activeEnvironmentId={activeEnvironmentId}
          onSelect={onSetActiveEnvironment}
          onUpdateEnvironment={onUpdateEnvironment}
          onAddEnvironment={onAddEnvironment}
        />
      </div>

      {/* Collection tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs font-semibold text-[var(--holo-muted)] uppercase tracking-wider mb-2 px-2">
          Collection
        </div>

        {/* Folders */}
        {workspace.folders.map((folder) => (
          <FolderTree
            key={folder.id}
            folder={folder}
            selectedItem={selectedItem}
            onSelectItem={onSelectItem}
            onAddRequest={onAddRequest}
            onAddFolder={onAddFolder}
            onAddWebSocket={onAddWebSocket}
            onDeleteFolder={onDeleteFolder}
            onUpdateFolder={onUpdateFolder}
            depth={0}
          />
        ))}

        {/* Root-level requests */}
        {workspace.requests.map((request) => (
          <div
            key={request.id}
            onClick={() => onSelectItem({ type: 'request', id: request.id })}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
              selectedItem?.type === 'request' && selectedItem.id === request.id
                ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]'
                : 'hover:bg-[var(--holo-accent)]/10'
            }`}
          >
            <span
              className="text-[10px] font-bold uppercase px-1 rounded"
              style={{
                color: getMethodColor(request.method),
                backgroundColor: `${getMethodColor(request.method)}20`,
              }}
            >
              {request.method.slice(0, 3)}
            </span>
            <span className="text-sm flex-1 truncate">{request.name}</span>
          </div>
        ))}

        {/* Root-level websockets */}
        {workspace.websockets.map((ws) => (
          <div
            key={ws.id}
            onClick={() => onSelectItem({ type: 'websocket', id: ws.id })}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
              selectedItem?.type === 'websocket' && selectedItem.id === ws.id
                ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]'
                : 'hover:bg-[var(--holo-accent)]/10'
            }`}
          >
            <span className="text-[10px] font-bold uppercase px-1 rounded bg-purple-500/20 text-purple-400">
              WS
            </span>
            <span className="text-sm flex-1 truncate">{ws.name}</span>
          </div>
        ))}

        {/* Empty state */}
        {workspace.folders.length === 0 &&
          workspace.requests.length === 0 &&
          workspace.websockets.length === 0 && (
            <div className="text-center py-8 text-[var(--holo-muted)] text-sm">
              <p>No requests yet</p>
              <p className="text-xs mt-1">Add a request or folder to get started</p>
            </div>
          )}
      </div>
    </div>
  );
}

function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    PATCH: '#50e3c2',
    HEAD: '#9012fe',
    OPTIONS: '#0d5aa7',
  };
  return colors[method] || '#61affe';
}

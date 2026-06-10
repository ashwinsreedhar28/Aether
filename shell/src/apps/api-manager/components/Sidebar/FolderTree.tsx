/**
 * FolderTree Component
 * Recursive folder/request tree rendering
 */

import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import type { ApiFolder, SelectedItem } from '../../types';
import { isApiRequest, isWebSocketConfig, isApiFolder } from '../../types';

interface FolderTreeProps {
  folder: ApiFolder;
  selectedItem: SelectedItem;
  onSelectItem: (item: SelectedItem) => void;
  onAddRequest: (folderId?: string) => void;
  onAddFolder: (parentId?: string) => void;
  onAddWebSocket: (folderId?: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onUpdateFolder: (folderId: string, updates: Partial<ApiFolder>) => void;
  depth: number;
}

export function FolderTree({
  folder,
  selectedItem,
  onSelectItem,
  onAddRequest,
  onAddFolder,
  onAddWebSocket,
  onDeleteFolder,
  onUpdateFolder,
  depth,
}: FolderTreeProps) {
  const [isExpanded, setIsExpanded] = useState(folder.isExpanded ?? true);
  const [showMenu, setShowMenu] = useState(false);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    onUpdateFolder(folder.id, { isExpanded: !isExpanded });
  };

  const isSelected = selectedItem?.type === 'folder' && selectedItem.id === folder.id;

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      {/* Folder header */}
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
          isSelected
            ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]'
            : 'hover:bg-[var(--holo-accent)]/10'
        }`}
      >
        <button onClick={handleToggle} className="p-0.5 hover:bg-[var(--holo-accent)]/20 rounded">
          {isExpanded ? (
            <ChevronDown size={12} className="text-[var(--holo-muted)]" />
          ) : (
            <ChevronRight size={12} className="text-[var(--holo-muted)]" />
          )}
        </button>
        {isExpanded ? (
          <FolderOpen size={14} className="text-[var(--holo-accent)]" />
        ) : (
          <Folder size={14} className="text-[var(--holo-muted)]" />
        )}
        <span
          className="text-sm flex-1 truncate"
          onClick={() => onSelectItem({ type: 'folder', id: folder.id })}
        >
          {folder.name}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddRequest(folder.id);
            }}
            className="p-1 rounded hover:bg-[var(--holo-accent)]/20 text-[var(--holo-muted)] hover:text-[var(--holo-accent)]"
            title="Add request"
          >
            <Plus size={12} />
          </button>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1 rounded hover:bg-[var(--holo-accent)]/20 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            >
              <MoreHorizontal size={12} />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-50 bg-[rgba(20,20,30,0.95)] border border-[var(--holo-border)] rounded shadow-lg py-1 min-w-[120px]"
                onMouseLeave={() => setShowMenu(false)}
              >
                <button
                  onClick={() => {
                    onAddFolder(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--holo-accent)]/20 transition-colors"
                >
                  Add Folder
                </button>
                <button
                  onClick={() => {
                    onAddWebSocket(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--holo-accent)]/20 transition-colors"
                >
                  Add WebSocket
                </button>
                <div className="border-t border-[var(--holo-border)] my-1" />
                <button
                  onClick={() => {
                    onDeleteFolder(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Folder contents */}
      {isExpanded && (
        <div className="mt-0.5">
          {folder.items.map((item) => {
            if (isApiFolder(item)) {
              return (
                <FolderTree
                  key={item.id}
                  folder={item}
                  selectedItem={selectedItem}
                  onSelectItem={onSelectItem}
                  onAddRequest={onAddRequest}
                  onAddFolder={onAddFolder}
                  onAddWebSocket={onAddWebSocket}
                  onDeleteFolder={onDeleteFolder}
                  onUpdateFolder={onUpdateFolder}
                  depth={depth + 1}
                />
              );
            }

            if (isApiRequest(item)) {
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectItem({ type: 'request', id: item.id })}
                  style={{ marginLeft: 12 }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    selectedItem?.type === 'request' && selectedItem.id === item.id
                      ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]'
                      : 'hover:bg-[var(--holo-accent)]/10'
                  }`}
                >
                  <span
                    className="text-[10px] font-bold uppercase px-1 rounded"
                    style={{
                      color: getMethodColor(item.method),
                      backgroundColor: `${getMethodColor(item.method)}20`,
                    }}
                  >
                    {item.method.slice(0, 3)}
                  </span>
                  <span className="text-sm flex-1 truncate">{item.name}</span>
                </div>
              );
            }

            if (isWebSocketConfig(item)) {
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectItem({ type: 'websocket', id: item.id })}
                  style={{ marginLeft: 12 }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    selectedItem?.type === 'websocket' && selectedItem.id === item.id
                      ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]'
                      : 'hover:bg-[var(--holo-accent)]/10'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase px-1 rounded bg-purple-500/20 text-purple-400">
                    WS
                  </span>
                  <span className="text-sm flex-1 truncate">{item.name}</span>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
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

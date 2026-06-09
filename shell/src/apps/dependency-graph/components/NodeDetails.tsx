/**
 * Node details sidebar/panel
 */

import { X, FileCode, ArrowUpRight, ArrowDownLeft, ExternalLink, FolderOpen } from 'lucide-react';
import type { DependencyNode } from '../types';

interface NodeDetailsProps {
  node: DependencyNode;
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  onOpenFile: (path: string) => void;
}

export function NodeDetails({ node, onClose, onNavigate, onOpenFile }: NodeDetailsProps) {
  return (
    <div className="w-72 border-l border-[var(--holo-border)] bg-[var(--holo-bg)] flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode size={14} className="text-[var(--holo-accent)] shrink-0" />
          <span className="text-sm font-medium text-[var(--holo-text)] truncate">
            {node.name}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--holo-border)]/50 text-[var(--holo-muted)] shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Path */}
        <div>
          <span className="text-xs text-[var(--holo-muted)] uppercase tracking-wider">Path</span>
          <div
            className="mt-1 text-xs text-[var(--holo-text)] font-mono break-all cursor-pointer hover:text-[var(--holo-accent)]"
            onClick={() => onOpenFile(node.absolutePath)}
            title="Click to open file"
          >
            {node.id}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded bg-[var(--holo-border)]/30">
            <div className="text-lg font-semibold text-[var(--holo-text)]">
              {node.imports.length}
            </div>
            <div className="text-xs text-[var(--holo-muted)]">imports</div>
          </div>
          <div className="p-2 rounded bg-[var(--holo-border)]/30">
            <div className="text-lg font-semibold text-[var(--holo-text)]">
              {node.importedBy.length}
            </div>
            <div className="text-xs text-[var(--holo-muted)]">imported by</div>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {node.isEntryPoint && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
              Entry Point
            </span>
          )}
          {node.isExternal && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">
              External
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            .{node.extension}
          </span>
        </div>

        {/* Imports list */}
        {node.imports.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowDownLeft size={12} className="text-cyan-400" />
              <span className="text-xs text-[var(--holo-muted)] uppercase tracking-wider">
                Imports ({node.imports.length})
              </span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {node.imports.map((importId) => (
                <button
                  key={importId}
                  onClick={() => onNavigate(importId)}
                  className="w-full text-left px-2 py-1.5 rounded bg-[var(--holo-border)]/20 hover:bg-[var(--holo-border)]/50 group flex items-center justify-between"
                >
                  <span className="text-xs text-[var(--holo-text)] truncate font-mono">
                    {importId.split('/').pop()}
                  </span>
                  <ExternalLink
                    size={10}
                    className="text-[var(--holo-muted)] opacity-0 group-hover:opacity-100 shrink-0"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Imported by list */}
        {node.importedBy.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowUpRight size={12} className="text-orange-400" />
              <span className="text-xs text-[var(--holo-muted)] uppercase tracking-wider">
                Imported by ({node.importedBy.length})
              </span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {node.importedBy.map((importerId) => (
                <button
                  key={importerId}
                  onClick={() => onNavigate(importerId)}
                  className="w-full text-left px-2 py-1.5 rounded bg-[var(--holo-border)]/20 hover:bg-[var(--holo-border)]/50 group flex items-center justify-between"
                >
                  <span className="text-xs text-[var(--holo-text)] truncate font-mono">
                    {importerId.split('/').pop()}
                  </span>
                  <ExternalLink
                    size={10}
                    className="text-[var(--holo-muted)] opacity-0 group-hover:opacity-100 shrink-0"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer action */}
      {!node.isExternal && (
        <div className="p-3 border-t border-[var(--holo-border)]">
          <button
            onClick={() => onOpenFile(node.absolutePath)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-[var(--holo-accent)]/20 hover:bg-[var(--holo-accent)]/30 text-[var(--holo-accent)] text-sm transition-colors"
          >
            <FolderOpen size={14} />
            Open in Editor
          </button>
        </div>
      )}
    </div>
  );
}

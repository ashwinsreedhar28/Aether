import { useState, useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  X,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { useGraphStore, selectEditingNode, selectNodeEdges, selectConnectedNodes } from '../../store/graphStore';
import { NODE_TYPES, EDGE_TYPES } from '../../constants';
import { RichTextEditor } from '../../../kanban/components/RichTextEditor';
import type { NodeType } from '../../types';

interface DetailsSidebarProps {
  onClose: () => void;
}

export function DetailsSidebar({ onClose }: DetailsSidebarProps) {
  const node = useGraphStore(selectEditingNode);
  const nodeId = node?.id;
  // Use useShallow to prevent infinite re-renders from array reference changes
  const edges = useGraphStore(useShallow((s) => nodeId ? selectNodeEdges(nodeId)(s) : []));
  const connectedNodes = useGraphStore(useShallow((s) => nodeId ? selectConnectedNodes(nodeId)(s) : []));
  const categories = useGraphStore((s) => s.categories);

  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);
  const setSelectedNodes = useGraphStore((s) => s.setSelectedNodes);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);

  const [title, setTitle] = useState(node?.title || '');
  const [body, setBody] = useState(node?.body || '');
  const [bodyPlainText, setBodyPlainText] = useState(node?.bodyPlainText || '');
  const [newTag, setNewTag] = useState('');
  const [showConnections, setShowConnections] = useState(true);
  const bodyRef = useRef({ body, bodyPlainText });

  // Keep ref updated for debounced save
  useEffect(() => {
    bodyRef.current = { body, bodyPlainText };
  }, [body, bodyPlainText]);

  // Sync local edit state when the selected node changes (render-phase adjustment)
  const [syncedNodeId, setSyncedNodeId] = useState(node?.id);
  if (node && node.id !== syncedNodeId) {
    setSyncedNodeId(node.id);
    setTitle(node.title);
    setBody(node.body);
    setBodyPlainText(node.bodyPlainText || '');
  }

  // Save title changes with debounce
  useEffect(() => {
    if (!node) return;

    const timer = setTimeout(() => {
      if (title !== node.title) {
        updateNode(node.id, { title });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [title, node, updateNode]);

  // Handle body change from RichTextEditor
  const handleBodyChange = useCallback((json: string, plainText: string) => {
    setBody(json);
    setBodyPlainText(plainText);

    // Debounced save
    if (node) {
      updateNode(node.id, { body: json, bodyPlainText: plainText });
    }
  }, [node, updateNode]);

  const handleDelete = useCallback(() => {
    if (node) {
      deleteNode(node.id);
      onClose();
    }
  }, [node, deleteNode, onClose]);

  const handleDuplicate = useCallback(() => {
    if (node) {
      const newId = duplicateNode(node.id);
      if (newId) {
        setSelectedNodes([newId]);
        setEditingNode(newId);
      }
    }
  }, [node, duplicateNode, setSelectedNodes, setEditingNode]);

  const handleAddTag = useCallback(() => {
    if (!node || !newTag.trim()) return;
    const tags = [...(node.tags || []), newTag.trim()];
    updateNode(node.id, { tags });
    setNewTag('');
  }, [node, newTag, updateNode]);

  const handleRemoveTag = useCallback((tag: string) => {
    if (!node) return;
    const tags = (node.tags || []).filter((t) => t !== tag);
    updateNode(node.id, { tags });
  }, [node, updateNode]);

  const handleTypeChange = useCallback((type: NodeType) => {
    if (node) {
      updateNode(node.id, { type });
    }
  }, [node, updateNode]);

  const handleCategoryChange = useCallback((categoryId: string | undefined) => {
    if (node) {
      updateNode(node.id, { categoryId });
    }
  }, [node, updateNode]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodes([nodeId]);
    setEditingNode(nodeId);
  }, [setSelectedNodes, setEditingNode]);

  if (!node) {
    return (
      <div className="w-[360px] h-full bg-[var(--holo-bg)]/95 border-l border-[var(--holo-border)] flex items-center justify-center">
        <p className="text-[var(--holo-muted)] text-sm">Select a node to edit</p>
      </div>
    );
  }

  return (
    <div className="w-[360px] h-full bg-[var(--holo-bg)]/95 border-l border-[var(--holo-border)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--holo-border)]">
        <span className="text-sm font-medium text-[var(--holo-text)]">Edit Node</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDuplicate}
            className="p-1.5 rounded-md text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-[var(--holo-accent)]/10"
            title="Duplicate"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md text-[var(--holo-muted)] hover:text-red-400 hover:bg-red-500/10"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-[var(--holo-accent)]/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="px-4 py-3 border-b border-[var(--holo-border)]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Node title..."
            className="w-full bg-transparent text-lg font-semibold text-[var(--holo-text)] outline-none placeholder:text-[var(--holo-muted)]"
          />
        </div>

        {/* Type & Category */}
        <div className="px-4 py-3 border-b border-[var(--holo-border)] space-y-3">
          <div>
            <label className="text-xs text-[var(--holo-muted)] uppercase tracking-wide mb-1.5 block">
              Type
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(NODE_TYPES) as [NodeType, typeof NODE_TYPES.note][]).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={`
                    px-2.5 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors
                    ${node.type === type
                      ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/40'
                      : 'bg-[var(--holo-border)]/30 text-[var(--holo-muted)] border border-transparent hover:border-[var(--holo-border)]'
                    }
                  `}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--holo-muted)] uppercase tracking-wide mb-1.5 block">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleCategoryChange(undefined)}
                className={`
                  px-2.5 py-1 text-xs rounded-md transition-colors
                  ${!node.categoryId
                    ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/40'
                    : 'bg-[var(--holo-border)]/30 text-[var(--holo-muted)] border border-transparent hover:border-[var(--holo-border)]'
                  }
                `}
              >
                None
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`
                    px-2.5 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors
                    ${node.categoryId === cat.id
                      ? 'bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] border border-[var(--holo-accent)]/40'
                      : 'bg-[var(--holo-border)]/30 text-[var(--holo-muted)] border border-transparent hover:border-[var(--holo-border)]'
                    }
                  `}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3 border-b border-[var(--holo-border)]">
          <label className="text-xs text-[var(--holo-muted)] uppercase tracking-wide mb-1.5 block">
            Content
          </label>
          <RichTextEditor
            content={body}
            onChange={handleBodyChange}
            placeholder="Write your notes here..."
          />
        </div>

        {/* Tags */}
        <div className="px-4 py-3 border-b border-[var(--holo-border)]">
          <label className="text-xs text-[var(--holo-muted)] uppercase tracking-wide mb-1.5 block">
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {node.tags?.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs rounded-full bg-[var(--holo-accent)]/10 text-[var(--holo-accent)] border border-[var(--holo-accent)]/20 flex items-center gap-1"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="Add tag..."
              className="flex-1 bg-[var(--holo-border)]/20 rounded-md px-2.5 py-1.5 text-xs text-[var(--holo-text)] outline-none border border-[var(--holo-border)] focus:border-[var(--holo-accent)]/50"
            />
            <button
              onClick={handleAddTag}
              className="px-2.5 py-1.5 text-xs rounded-md bg-[var(--holo-accent)]/20 text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/30"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Connections */}
        <div className="px-4 py-3">
          <button
            onClick={() => setShowConnections(!showConnections)}
            className="flex items-center gap-2 text-xs text-[var(--holo-muted)] uppercase tracking-wide mb-2 hover:text-[var(--holo-text)]"
          >
            {showConnections ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Connections ({edges.length})
          </button>

          {showConnections && (
            <div className="space-y-1.5">
              {connectedNodes.length === 0 ? (
                <p className="text-xs text-[var(--holo-muted)] py-2">
                  No connections. Press E to create edges.
                </p>
              ) : (
                connectedNodes.map((connNode) => {
                  const edge = edges.find(
                    (e) => e.source === connNode.id || e.target === connNode.id
                  );
                  const edgeType = edge ? EDGE_TYPES[edge.type] : EDGE_TYPES.relates;
                  const isOutgoing = edge?.source === node.id;

                  return (
                    <button
                      key={connNode.id}
                      onClick={() => handleNodeClick(connNode.id)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg bg-[var(--holo-border)]/20 hover:bg-[var(--holo-border)]/40 transition-colors text-left"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: connNode.color || NODE_TYPES[connNode.type].color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--holo-text)] truncate">
                          {connNode.title}
                        </p>
                        <p className="text-xs text-[var(--holo-muted)]">
                          {isOutgoing ? '→' : '←'} {edgeType.label}
                        </p>
                      </div>
                      <ExternalLink className="w-3 h-3 text-[var(--holo-muted)]" />
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[var(--holo-border)] text-xs text-[var(--holo-muted)]">
        Created: {new Date(node.createdAt).toLocaleDateString()}
        {node.updatedAt !== node.createdAt && (
          <> · Updated: {new Date(node.updatedAt).toLocaleDateString()}</>
        )}
      </div>
    </div>
  );
}

import { useCallback, useState, useRef, useEffect } from 'react';
import type { FileNode } from '../../types';
import { useFileSystemStore, fileApi } from '../../stores/fileSystemStore';
import { FileIcon } from './FileIcon';

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  modifiedFiles: Set<string>;
  visibleNodes: FileNode[];  // For shift-select range calculation
}

export function FileTreeItem({ node, depth, onOpenFile, onContextMenu, modifiedFiles, visibleNodes }: FileTreeItemProps) {
  const { selectedPaths, expandedDirs, loadingDirs, selectPath, toggleDir, refreshTree, clearSelection } = useFileSystemStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPaths.has(node.path);
  const isLoading = loadingDirs.has(node.path);

  // Scroll into view when selected
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);
  const isModified = node.type === 'file' && modifiedFiles.has(node.path);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Handle modifier keys for multi-select
    selectPath(node.path, {
      shift: e.shiftKey,
      meta: e.metaKey || e.ctrlKey,
      visibleNodes,
    });

    // Only toggle directory on plain click (no modifiers)
    if (node.type === 'directory' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      toggleDir(node.path);
    }
  }, [node.path, node.type, selectPath, toggleDir, visibleNodes]);

  const handleDoubleClick = useCallback(() => {
    if (node.type === 'file') {
      onOpenFile(node.path);
    }
  }, [node.type, node.path, onOpenFile]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectPath(node.path);
      onContextMenu(e, node);
    },
    [node, selectPath, onContextMenu]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';

    // If dragging a selected item, include all selected items
    // Otherwise, just drag the single item
    if (isSelected && selectedPaths.size > 1) {
      const items = Array.from(selectedPaths).map(path => {
        const name = path.split('/').pop() || '';
        return { path, name };
      });
      e.dataTransfer.setData('application/json', JSON.stringify({ items, multiple: true }));
    } else {
      e.dataTransfer.setData('application/json', JSON.stringify({
        path: node.path,
        name: node.name,
        type: node.type,
        multiple: false,
      }));
    }
  }, [node, isSelected, selectedPaths]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Only allow drop on directories
    if (node.type === 'directory') {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    }
  }, [node.type]);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (node.type !== 'directory') return;

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));

      // Handle multiple files
      const itemsToMove: { path: string; name: string }[] = data.multiple
        ? data.items
        : [{ path: data.path, name: data.name }];

      for (const item of itemsToMove) {
        const sourcePath = item.path;
        const fileName = item.name;

        // Don't move to same directory
        if (sourcePath.startsWith(node.path + '/')) {
          continue;
        }

        // Don't move a directory into itself
        if (node.path.startsWith(sourcePath + '/')) {
          console.error('Cannot move a directory into itself');
          continue;
        }

        // Calculate new path
        const newPath = `${node.path}/${fileName}`;

        // Check if target already exists (simple check)
        if (newPath === sourcePath) continue;

        // Perform move
        await fileApi.rename(sourcePath, newPath);
      }

      // Clear selection and refresh tree to show changes
      clearSelection();
      refreshTree();
    } catch (err) {
      console.error('Failed to move file:', err);
    }
  }, [node, refreshTree, clearSelection]);

  return (
    <div>
      <div
        ref={itemRef}
        draggable
        className={`file-tree-item flex items-center gap-2 ${isSelected ? 'selected' : ''} ${
          isDragging ? 'opacity-50' : ''
        } ${
          isDragOver ? 'bg-[var(--holo-accent)]/20 border-l-2 border-[var(--holo-accent)]' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {node.type === 'directory' && (
          <span className="text-xs text-[var(--holo-muted)] w-3">
            {isLoading ? (
              <span className="inline-block animate-spin">◌</span>
            ) : isExpanded ? (
              '▾'
            ) : (
              '▸'
            )}
          </span>
        )}
        {node.type === 'file' && <span className="w-3" />}
        <FileIcon type={node.type} extension={node.extension} isExpanded={isExpanded} />
        <span className="text-sm truncate flex-1">{node.name}</span>
        {isModified && (
          <span
            className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mr-2"
            title="Modified externally"
          />
        )}
      </div>

      {node.type === 'directory' && isExpanded && (
        <div>
          {isLoading && !node.children?.length && (
            <div
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              className="text-xs text-[var(--holo-muted)] py-1"
            >
              Loading...
            </div>
          )}
          {node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
              modifiedFiles={modifiedFiles}
              visibleNodes={visibleNodes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Search,
  Filter,
  Download,
  Upload,
  LayoutGrid,
  Settings,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import { NODE_TYPES } from '../../constants';
import type { NodeType } from '../../types';

interface MainToolbarProps {
  onSearch: () => void;
  onFilter: () => void;
  onExport: () => void;
  onImport: () => void;
  onAutoLayout: () => void;
  onSettings: () => void;
}

export function MainToolbar({
  onSearch,
  onFilter,
  onExport,
  onImport,
  onAutoLayout,
  onSettings,
}: MainToolbarProps) {
  const addNode = useGraphStore((s) => s.addNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const viewport = useGraphStore((s) => s.viewport);
  const setViewport = useGraphStore((s) => s.setViewport);
  const setSelectedNodes = useGraphStore((s) => s.setSelectedNodes);
  const setEditingNode = useGraphStore((s) => s.setEditingNode);

  const hasSelection = selectedNodeIds.size > 0;

  const handleAddNode = useCallback((type: NodeType = 'note') => {
    // Add node near center of viewport
    const x = (-viewport.x + 400) / viewport.zoom;
    const y = (-viewport.y + 300) / viewport.zoom;

    const id = addNode({
      type,
      position: { x, y },
      title: `New ${NODE_TYPES[type].label}`,
      body: '',
    });

    setSelectedNodes([id]);
    setEditingNode(id);
  }, [addNode, viewport, setSelectedNodes, setEditingNode]);

  const handleDelete = useCallback(() => {
    selectedNodeIds.forEach((id) => deleteNode(id));
  }, [selectedNodeIds, deleteNode]);

  const handleDuplicate = useCallback(() => {
    const firstSelected = [...selectedNodeIds][0];
    if (firstSelected) {
      const newId = duplicateNode(firstSelected);
      if (newId) {
        setSelectedNodes([newId]);
      }
    }
  }, [selectedNodeIds, duplicateNode, setSelectedNodes]);

  const handleZoom = useCallback((delta: number) => {
    setViewport({
      ...viewport,
      zoom: Math.max(0.1, Math.min(2, viewport.zoom + delta)),
    });
  }, [viewport, setViewport]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--holo-bg)]/80 border-b border-[var(--holo-border)] backdrop-blur-sm">
      {/* Add node dropdown */}
      <div className="relative group">
        <ToolbarButton icon={Plus} label="Add Node" onClick={() => handleAddNode('note')} />
        <div className="absolute top-full left-0 mt-1 hidden group-hover:block z-50">
          <div className="py-1 bg-[var(--holo-bg)] border border-[var(--holo-border)] rounded-lg shadow-xl min-w-[140px]">
            {(Object.entries(NODE_TYPES) as [NodeType, typeof NODE_TYPES.note][]).map(([type, config]) => (
              <button
                key={type}
                onClick={() => handleAddNode(type)}
                className="w-full px-3 py-1.5 text-left text-sm text-[var(--holo-text)] hover:bg-[var(--holo-accent)]/10 flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                {config.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Divider />

      {/* Selection actions */}
      <ToolbarButton
        icon={Copy}
        label="Duplicate"
        onClick={handleDuplicate}
        disabled={!hasSelection}
      />
      <ToolbarButton
        icon={Trash2}
        label="Delete"
        onClick={handleDelete}
        disabled={!hasSelection}
        danger
      />

      <Divider />

      {/* Search & Filter */}
      <ToolbarButton icon={Search} label="Search (Cmd+F)" onClick={onSearch} />
      <ToolbarButton icon={Filter} label="Filter" onClick={onFilter} />

      <Divider />

      {/* View controls */}
      <ToolbarButton icon={ZoomOut} label="Zoom Out" onClick={() => handleZoom(-0.1)} />
      <span className="text-xs text-[var(--holo-muted)] w-12 text-center">
        {Math.round(viewport.zoom * 100)}%
      </span>
      <ToolbarButton icon={ZoomIn} label="Zoom In" onClick={() => handleZoom(0.1)} />
      <ToolbarButton icon={LayoutGrid} label="Auto Layout" onClick={onAutoLayout} />

      <div className="flex-1" />

      {/* Right side actions */}
      <ToolbarButton icon={Upload} label="Import" onClick={onImport} />
      <ToolbarButton icon={Download} label="Export" onClick={onExport} />
      <ToolbarButton icon={Settings} label="Settings" onClick={onSettings} />
    </div>
  );
}

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function ToolbarButton({ icon: Icon, label, onClick, disabled, danger }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        p-1.5 rounded-md transition-colors
        ${disabled
          ? 'text-[var(--holo-muted)]/40 cursor-not-allowed'
          : danger
            ? 'text-[var(--holo-muted)] hover:text-red-400 hover:bg-red-500/10'
            : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-[var(--holo-accent)]/10'
        }
      `}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-[var(--holo-border)] mx-1" />;
}

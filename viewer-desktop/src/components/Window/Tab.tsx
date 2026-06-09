import { X, FileText, FileJson, FileCode, Image, Terminal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState } from '../../types';

interface TabProps {
  tab: TabState;
  isActive: boolean;
  onSwitch: () => void;
  onClose: (e: React.MouseEvent) => void;
}

export function Tab({ tab, isActive, onSwitch, onClose }: TabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });
  // Get icon based on app type
  const getIcon = () => {
    switch (tab.appId) {
      case 'markdown-viewer':
        return <FileText className="w-3.5 h-3.5" />;
      case 'json-viewer':
        return <FileJson className="w-3.5 h-3.5" />;
      case 'image-viewer':
        return <Image className="w-3.5 h-3.5" />;
      case 'terminal':
        return <Terminal className="w-3.5 h-3.5" />;
      case 'text-viewer':
      default:
        return <FileCode className="w-3.5 h-3.5" />;
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-tab-id={tab.id}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 min-w-[120px] max-w-[200px]
        border-r border-[var(--holo-border)] cursor-grab active:cursor-grabbing
        transition-all duration-150 group
        ${isActive
          ? 'bg-[var(--holo-bg-elevated)] text-[var(--holo-text)]'
          : 'bg-[rgba(15,15,25,0.4)] text-[var(--holo-muted)] hover:bg-[rgba(15,15,25,0.6)] hover:text-[var(--holo-text)]'
        }
        ${isDragging ? 'z-50' : ''}
      `}
      onClick={onSwitch}
      title={tab.filePath}
    >
      {/* File icon */}
      <div className="flex-shrink-0">
        {getIcon()}
      </div>

      {/* Title */}
      <span className="flex-1 text-xs truncate">
        {tab.title}
      </span>

      {/* Unsaved indicator */}
      {tab.isDirty && (
        <div
          className="w-1.5 h-1.5 rounded-full bg-[var(--holo-accent)] flex-shrink-0"
          title="Unsaved changes"
        />
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="flex-shrink-0 w-3.5 h-3.5 rounded-sm opacity-0 group-hover:opacity-100
                   hover:bg-[var(--holo-border)] transition-all duration-150
                   flex items-center justify-center"
        title="Close tab"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

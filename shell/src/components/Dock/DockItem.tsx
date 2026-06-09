import { useCallback } from 'react';
import { FileText, Folder, Image } from 'lucide-react';
import type { WindowState } from '../../types';

interface DockItemProps {
  window: WindowState;
  onRestore: (id: string) => void;
}

export function DockItem({ window, onRestore }: DockItemProps) {
  const handleClick = useCallback(() => {
    onRestore(window.id);
  }, [window.id, onRestore]);

  // Select icon based on app type
  const Icon = window.appId === 'file-explorer'
    ? Folder
    : window.appId === 'image-viewer'
    ? Image
    : FileText;

  return (
    <button
      onClick={handleClick}
      className="dock-item relative w-12 h-12 flex items-center justify-center rounded-lg bg-[var(--holo-panel)] border border-[var(--holo-border)] hover:border-[var(--holo-accent)] hover:bg-[var(--holo-panel-hover)] transition-all duration-200 group"
      title={window.title}
    >
      <Icon
        size={20}
        className="text-[var(--holo-muted)] group-hover:text-[var(--holo-accent)] transition-colors"
      />

      {/* Tooltip */}
      <div className="absolute left-full ml-2 px-2 py-1 rounded bg-[var(--holo-panel)] border border-[var(--holo-border)] text-xs text-[var(--holo-text)] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        {window.title}
      </div>
    </button>
  );
}

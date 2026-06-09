import { Home, ChevronRight } from 'lucide-react';
import { useFileSystemStore } from '../../stores/fileSystemStore';

export function Breadcrumb() {
  const { lastSelectedPath: selectedPath, selectPath, expandDir, rootDir } = useFileSystemStore();

  if (!selectedPath) return null;

  // Parse path into segments
  const ROOT_DIR = rootDir;
  const relativePath = selectedPath.replace(ROOT_DIR, '');
  const segments = relativePath.split('/').filter(Boolean);

  const handleSegmentClick = (index: number) => {
    // Build path up to this segment
    const newPath = index === -1
      ? ROOT_DIR
      : ROOT_DIR + '/' + segments.slice(0, index + 1).join('/');

    selectPath(newPath);
    expandDir(newPath);
  };

  return (
    <div className="px-2 py-2 flex items-center gap-1 overflow-x-auto">
      {/* Home/Root */}
      <button
        onClick={() => handleSegmentClick(-1)}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--holo-accent)]/10 transition-colors flex-shrink-0"
        title={ROOT_DIR}
      >
        <Home size={14} className="text-[var(--holo-accent)]" />
        <span className="text-[var(--holo-muted)]">root</span>
      </button>

      {/* Path segments */}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <div key={index} className="flex items-center gap-1 flex-shrink-0">
            <ChevronRight size={12} className="text-[var(--holo-muted)]" />
            <button
              onClick={() => !isLast && handleSegmentClick(index)}
              className={`px-2 py-1 text-xs rounded transition-colors ${isLast
                  ? 'text-[var(--holo-text)] cursor-default'
                  : 'text-[var(--holo-muted)] hover:bg-[var(--holo-accent)]/10 hover:text-[var(--holo-text)]'
                }`}
              disabled={isLast}
              title={segment}
            >
              {segment.length > 20 ? segment.slice(0, 18) + '...' : segment}
            </button>
          </div>
        );
      })}
    </div>
  );
}

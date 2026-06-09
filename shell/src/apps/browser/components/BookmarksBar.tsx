import { Star, X } from 'lucide-react';
import type { Bookmark } from '../types';

interface BookmarksBarProps {
  bookmarks: Bookmark[];
  currentUrl: string;
  isBookmarked: boolean;
  onBookmarkClick: (url: string) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (id: string) => void;
}

export function BookmarksBar({
  bookmarks,
  isBookmarked,
  onBookmarkClick,
  onAddBookmark,
  onRemoveBookmark,
}: BookmarksBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--holo-border)] bg-[rgba(10,10,15,0.5)] overflow-x-auto">
      {/* Add/Remove bookmark button */}
      <button
        onClick={onAddBookmark}
        className={`p-1 rounded transition-colors flex-shrink-0 ${
          isBookmarked
            ? 'text-yellow-400 hover:text-yellow-300'
            : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
        }`}
        title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
      >
        <Star className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} />
      </button>

      <div className="w-px h-4 bg-[var(--holo-border)] mx-1 flex-shrink-0" />

      {/* Bookmark items */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {bookmarks.map((bookmark) => (
          <div
            key={bookmark.id}
            className="group flex items-center gap-1 px-2 py-0.5 rounded text-xs
                       bg-[rgba(0,255,255,0.05)] hover:bg-[rgba(0,255,255,0.1)]
                       border border-transparent hover:border-[var(--holo-border)]
                       transition-colors cursor-pointer flex-shrink-0 max-w-[150px]"
          >
            <span
              onClick={() => onBookmarkClick(bookmark.url)}
              className="truncate text-[var(--holo-text)]"
              title={bookmark.url}
            >
              {bookmark.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveBookmark(bookmark.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[rgba(255,0,0,0.2)] rounded transition-opacity"
              title="Remove bookmark"
            >
              <X className="w-3 h-3 text-[var(--holo-muted)]" />
            </button>
          </div>
        ))}

        {bookmarks.length === 0 && (
          <span className="text-xs text-[var(--holo-muted)] px-2">
            No bookmarks yet. Click the star to add one.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Kanban renderer — a read-only board view of a kanban JSON document.
 *
 * Pure: parses `data.content` (the kb_*.json board format) and renders columns
 * and cards. This is the *content* layer only — drag/drop editing, card modals,
 * and autosave remain desktop-shell concerns and are not part of the shared
 * renderer. The spatial shell gets a faithful read-only board for free.
 */
import { useMemo } from 'react';
import type { ViewRendererProps } from './registry';

interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: 'P1' | 'P2' | 'P3' | null;
  dueDate?: string;
}

interface KanbanColumn {
  id: string;
  title: string;
  color?: string;
  cards?: KanbanCard[];
}

interface KanbanBoard {
  name?: string;
  description?: string;
  columns?: KanbanColumn[];
}

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#3b82f6',
};

export function KanbanRenderer({ data }: ViewRendererProps) {
  const board = useMemo<KanbanBoard | null>(() => {
    try {
      return JSON.parse(data.content) as KanbanBoard;
    } catch {
      return null;
    }
  }, [data.content]);

  if (!board || !Array.isArray(board.columns)) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Invalid kanban board
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {(board.name || board.description) && (
        <div className="px-4 py-2 border-b border-[var(--holo-border)] bg-[rgba(15,15,25,0.5)]">
          {board.name && <div className="text-sm font-semibold text-[var(--holo-text)]">{board.name}</div>}
          {board.description && (
            <div className="text-xs text-[var(--holo-muted)]">{board.description}</div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto flex gap-3 p-4 items-start">
        {board.columns.map((col) => (
          <div
            key={col.id}
            className="flex-shrink-0 w-72 rounded-lg bg-[rgba(0,0,0,0.25)] border border-[var(--holo-border)]"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--holo-border)]">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: col.color ?? 'var(--holo-accent)' }}
                />
                <span className="text-sm font-medium text-[var(--holo-text)]">{col.title}</span>
              </div>
              <span className="text-xs text-[var(--holo-muted)]">{col.cards?.length ?? 0}</span>
            </div>
            <div className="p-2 space-y-2">
              {(col.cards ?? []).map((card) => (
                <div
                  key={card.id}
                  className="rounded-md bg-[rgba(15,15,25,0.7)] border border-[var(--holo-border)] p-2.5"
                >
                  <div className="text-sm text-[var(--holo-text)]">{card.title}</div>
                  {card.description && (
                    <div className="mt-1 text-xs text-[var(--holo-muted)] line-clamp-3">
                      {card.description}
                    </div>
                  )}
                  {(card.tags?.length || card.priority || card.dueDate) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {card.priority && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] rounded text-white"
                          style={{ background: PRIORITY_COLORS[card.priority] ?? '#666' }}
                        >
                          {card.priority}
                        </span>
                      )}
                      {card.dueDate && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-[var(--holo-muted)]">
                          {card.dueDate}
                        </span>
                      )}
                      {card.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

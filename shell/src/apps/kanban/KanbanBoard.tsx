import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Calendar,
  CheckSquare,
  Filter,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import type { AppProps } from '../types';
import { debouncedAutoSave, flushPendingSave } from './utils/autosave';
import { getTagColor } from './utils/tagColors';
import { RichTextEditor, getChecklistProgress } from './components/RichTextEditor';
import { useKanbanKeyboard } from './hooks/useKanbanKeyboard';

type Priority = 'P1' | 'P2' | 'P3' | null;

const PRIORITY_COLORS: Record<NonNullable<Priority>, string> = {
  P1: '#ef4444',
  P2: '#f59e0b',
  P3: '#3b82f6',
};

function isOverdue(dateStr: string): boolean {
  const dueDate = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
}

function isDueToday(dateStr: string): boolean {
  const dueDate = new Date(dateStr);
  const today = new Date();
  return dueDate.toDateString() === today.toDateString();
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sortCardsByPriority(cards: KanbanCard[]): KanbanCard[] {
  const priorityOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
  return [...cards].sort((a, b) => {
    const aOrder = a.priority ? priorityOrder[a.priority] : 3;
    const bOrder = b.priority ? priorityOrder[b.priority] : 3;
    return aOrder - bOrder;
  });
}

type KanbanCard = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  priority?: Priority;
  dueDate?: string;
  descriptionPlainText?: string;
  isArchived?: boolean;
  archivedAt?: string;
  archivedFromColumn?: string;
};

type CardTemplate = {
  id: string;
  name: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: Priority;
};

type KanbanColumn = {
  id: string;
  title: string;
  color?: string;
  wipLimit?: number;
  cards: KanbanCard[];
};

type KanbanBoardData = {
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  columns: KanbanColumn[];
  archivedCards?: KanbanCard[];
  cardTemplates?: CardTemplate[];
};

const defaultColumns = (): KanbanColumn[] => [
  { id: 'todo', title: 'Backlog', color: '#6b7cff', cards: [] },
  { id: 'doing', title: 'In Progress', color: '#4ec5ff', cards: [] },
  { id: 'done', title: 'Done', color: '#6de3b6', cards: [] },
];

const palette = ['#6b7cff', '#4ec5ff', '#6de3b6', '#f5c76b', '#f38ba0', '#9c88ff'];

type BoardTemplate = {
  id: string;
  name: string;
  description: string;
  columns: Array<{ title: string; color: string }>;
};

const BUILT_IN_BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'simple-kanban',
    name: 'Simple Kanban',
    description: 'Basic To Do, In Progress, Done workflow',
    columns: [
      { title: 'To Do', color: '#6b7cff' },
      { title: 'In Progress', color: '#4ec5ff' },
      { title: 'Done', color: '#6de3b6' },
    ],
  },
  {
    id: 'scrum-board',
    name: 'Scrum Board',
    description: 'Sprint planning with Backlog, Sprint, Review stages',
    columns: [
      { title: 'Backlog', color: '#6b7cff' },
      { title: 'Sprint', color: '#9c88ff' },
      { title: 'In Progress', color: '#4ec5ff' },
      { title: 'Review', color: '#f5c76b' },
      { title: 'Done', color: '#6de3b6' },
    ],
  },
  {
    id: 'bug-tracker',
    name: 'Bug Tracker',
    description: 'Track bugs from report to resolution',
    columns: [
      { title: 'New', color: '#f38ba0' },
      { title: 'Triaged', color: '#f5c76b' },
      { title: 'In Progress', color: '#4ec5ff' },
      { title: 'Testing', color: '#9c88ff' },
      { title: 'Resolved', color: '#6de3b6' },
    ],
  },
  {
    id: 'personal-tasks',
    name: 'Personal Tasks',
    description: 'Organize personal tasks by priority and status',
    columns: [
      { title: 'Ideas', color: '#9c88ff' },
      { title: 'This Week', color: '#f5c76b' },
      { title: 'Today', color: '#f38ba0' },
      { title: 'Completed', color: '#6de3b6' },
    ],
  },
];

function slugify(input: string) {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'board';
}

function ensureBoardShape(raw: unknown, fallbackName: string): KanbanBoardData {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== 'object') {
    return { name: fallbackName, createdAt: now, updatedAt: now, columns: defaultColumns() };
  }

  const data = raw as Partial<KanbanBoardData>;
  const columns = Array.isArray(data.columns) ? data.columns : defaultColumns();

  const normalizedColumns = columns.map((col, idx) => ({
    id: col.id || `col-${idx}-${crypto.randomUUID()}`,
    title: col.title || `Column ${idx + 1}`,
    color: col.color || palette[idx % palette.length],
    wipLimit: col.wipLimit,
    cards: Array.isArray(col.cards)
      ? col.cards.map((card, cIdx) => ({
          id: card.id || `card-${idx}-${cIdx}-${crypto.randomUUID()}`,
          title: card.title || 'Untitled',
          description: card.description || '',
          tags: Array.isArray(card.tags) ? card.tags.filter(Boolean) : [],
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        }))
      : [],
  }));

  return {
    name: data.name || fallbackName,
    description: data.description || '',
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    columns: normalizedColumns,
  };
}

function summarizePath(path: string, rootDir: string) {
  if (!path) return '';
  if (rootDir && path.startsWith(rootDir)) {
    return path.replace(rootDir, '~');
  }
  return path;
}

function sanitizedFolder(input: string) {
  return input
    .replace(/\\/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\.\./g, '');
}

function buildFileName(name: string) {
  const safe = slugify(name);
  return safe.startsWith('kb_') ? `${safe}.json` : `kb_${safe}.json`;
}

const basePanel =
  'bg-[rgba(15,15,25,0.65)] border border-[var(--holo-border)] rounded-lg shadow-lg';

// Card Edit Modal Component
interface CardEditModalProps {
  card: KanbanCard;
  onSave: (updates: Partial<KanbanCard>) => void;
  onDelete: () => void;
  onArchive: () => void;
  onClose: () => void;
}

function CardEditModal({ card, onSave, onDelete, onArchive, onClose }: CardEditModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [descriptionPlainText, setDescriptionPlainText] = useState(card.descriptionPlainText || '');
  const [tags, setTags] = useState(card.tags?.join(', ') || '');
  const [priority, setPriority] = useState<Priority>(card.priority ?? null);
  const [dueDate, setDueDate] = useState(card.dueDate || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSave = () => {
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({
      title: title.trim() || 'Untitled',
      description,
      descriptionPlainText,
      tags: parsedTags,
      priority,
      dueDate: dueDate || undefined,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
      onClose();
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div
      className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`${basePanel} inset-4 absolute flex flex-col`}>
        {/* Header with close button */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-[var(--holo-border)]">
          <h2 className="text-sm font-semibold text-[var(--holo-text)]">Edit Card</h2>
          <button
            onClick={onClose}
            className="text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Top metadata row: Title, Tags, Priority, Due Date */}
        <div className="flex-shrink-0 p-4 border-b border-[var(--holo-border)] bg-[rgba(0,0,0,0.2)]">
          <div className="flex items-start gap-4 flex-wrap">
            {/* Title - takes more space */}
            <div className="flex-1 min-w-[200px]">
              <span className="text-xs text-[var(--holo-muted)] block mb-1">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
              />
            </div>

            {/* Tags */}
            <div className="flex-1 min-w-[180px]">
              <span className="text-xs text-[var(--holo-muted)] block mb-1">Tags (comma separated)</span>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
                placeholder="bug, priority, feature"
              />
            </div>

            {/* Priority */}
            <div className="flex-shrink-0">
              <span className="text-xs text-[var(--holo-muted)] block mb-1">Priority</span>
              <div className="flex gap-1">
                {(['P1', 'P2', 'P3', null] as const).map((p) => (
                  <button
                    key={p ?? 'none'}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`px-2.5 py-2 text-sm rounded border transition-colors ${
                      priority === p
                        ? 'border-[var(--holo-accent)] bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
                        : 'border-[var(--holo-border)] text-[var(--holo-muted)] hover:border-[var(--holo-accent)]/50'
                    }`}
                    style={p ? { borderLeftColor: PRIORITY_COLORS[p], borderLeftWidth: '3px' } : undefined}
                  >
                    {p ?? 'None'}
                  </button>
                ))}
              </div>
            </div>

            {/* Due Date */}
            <div className="flex-shrink-0">
              <span className="text-xs text-[var(--holo-muted)] block mb-1">Due Date</span>
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={dueDate ? dueDate.split('T')[0] : ''}
                  onChange={(e) => setDueDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="px-3 py-2 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
                />
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => setDueDate('')}
                    className="p-2 text-[var(--holo-muted)] hover:text-rose-400 transition-colors"
                    title="Clear due date"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description - fills remaining space */}
        <div className="flex-1 min-h-0 p-4 flex flex-col">
          <span className="text-xs text-[var(--holo-muted)] block mb-2">Description</span>
          <div className="flex-1 min-h-0 overflow-auto">
            <RichTextEditor
              content={description}
              onChange={(json, plainText) => {
                setDescription(json);
                setDescriptionPlainText(plainText);
              }}
              placeholder="Add details, notes, or checklists..."
              fullHeight
            />
          </div>
        </div>

        {/* Footer with timestamps and actions */}
        <div className="flex-shrink-0 p-4 border-t border-[var(--holo-border)] bg-[rgba(0,0,0,0.2)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onArchive}
                className="px-3 py-1.5 text-sm rounded flex items-center gap-1.5 text-[var(--holo-muted)] hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                <Archive size={14} />
                Archive
              </button>
              <button
                onClick={handleDelete}
                className={`px-3 py-1.5 text-sm rounded flex items-center gap-1.5 transition-colors ${
                  confirmDelete
                    ? 'bg-rose-500 text-white'
                    : 'text-[var(--holo-muted)] hover:text-rose-400 hover:bg-rose-500/10'
                }`}
              >
                <Trash2 size={14} />
                {confirmDelete ? 'Confirm' : 'Delete'}
              </button>
              <div className="text-xs text-[var(--holo-muted)] ml-4">
                {card.createdAt && (
                  <span>Created: {new Date(card.createdAt).toLocaleDateString()}</span>
                )}
                {card.updatedAt && (
                  <span className="ml-3">Updated: {new Date(card.updatedAt).toLocaleDateString()}</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-1.5 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Draggable Card Component
interface DraggableCardProps {
  card: KanbanCard;
  columnId: string;
  columnIndex: number;
  cardIndex: number;
  onDoubleClick: () => void;
  onTagClick?: (tag: string) => void;
  isSelected?: boolean;
  onSelect?: (cardId: string, columnId: string, columnIndex: number, cardIndex: number) => void;
}

function DraggableCard({ card, columnId, columnIndex, cardIndex, onDoubleClick, onTagClick, isSelected, onSelect }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card, columnId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderColor: card.priority ? PRIORITY_COLORS[card.priority] : 'var(--holo-border)',
    borderLeftWidth: card.priority ? '3px' : '1px',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      className={`group relative p-3 rounded-lg border bg-[rgba(255,255,255,0.02)]
        hover:border-[var(--holo-accent)]/60 transition-colors cursor-grab active:cursor-grabbing
        ${isDragging ? 'opacity-50 z-50' : ''}
        ${card.priority ? 'pl-4' : ''}
        ${card.dueDate && isOverdue(card.dueDate) ? 'ring-1 ring-rose-500/50' : ''}
        ${isSelected ? 'ring-2 ring-[var(--holo-accent)]' : ''}`}
      onDoubleClick={onDoubleClick}
      onClick={() => onSelect?.(card.id, columnId, columnIndex, cardIndex)}
    >
      {card.priority && (
        <div
          className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
          style={{ backgroundColor: PRIORITY_COLORS[card.priority] }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--holo-text)] truncate">{card.title}</div>
        {card.descriptionPlainText && (
          <div className="text-xs text-[var(--holo-muted)] mt-1 line-clamp-2">
            {card.descriptionPlainText}
          </div>
        )}
        {card.tags && card.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {card.tags.map((tag) => {
              const colors = getTagColor(tag);
              return (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded-full cursor-pointer hover:scale-105 transition-transform"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: colors.border,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick?.(tag);
                  }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
        )}
        {card.dueDate && (
          <div className={`flex items-center gap-1 mt-2 text-[10px] ${
            isOverdue(card.dueDate)
              ? 'text-rose-400'
              : isDueToday(card.dueDate)
                ? 'text-amber-400'
                : 'text-[var(--holo-muted)]'
          }`}>
            <Calendar size={10} />
            <span>{formatDueDate(card.dueDate)}</span>
            {isOverdue(card.dueDate) && (
              <AlertCircle size={10} className="text-rose-400" />
            )}
          </div>
        )}
        {/* Checklist Progress */}
        {(() => {
          const progress = getChecklistProgress(card.description || '');
          if (!progress) return null;

          const percentage = (progress.completed / progress.total) * 100;
          const isComplete = progress.completed === progress.total;

          return (
            <div className="flex items-center gap-2 mt-2">
              <CheckSquare
                size={12}
                className={isComplete ? 'text-emerald-400' : 'text-[var(--holo-muted)]'}
              />
              <span className={`text-[10px] ${isComplete ? 'text-emerald-400' : 'text-[var(--holo-muted)]'}`}>
                {progress.completed}/{progress.total}
              </span>
              <div className="flex-1 h-1 bg-[var(--holo-border)] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isComplete ? 'bg-emerald-400' : 'bg-[var(--holo-accent)]'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Card preview for drag overlay
function CardPreview({ card }: { card: KanbanCard }) {
  return (
    <div className="p-3 rounded-lg border-2 border-[var(--holo-accent)] bg-[rgba(15,15,25,0.95)] shadow-xl backdrop-blur-sm w-[280px]">
      <div className="text-sm font-medium text-[var(--holo-text)] truncate">{card.title}</div>
      {card.descriptionPlainText && (
        <div className="text-xs text-[var(--holo-muted)] mt-1 line-clamp-2">{card.descriptionPlainText}</div>
      )}
      {card.tags && card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {card.tags.slice(0, 3).map((tag) => {
            const colors = getTagColor(tag);
            return (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: colors.bg,
                  color: colors.text,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: colors.border,
                }}
              >
                {tag}
              </span>
            );
          })}
          {card.tags.length > 3 && (
            <span className="text-[10px] text-[var(--holo-muted)]">+{card.tags.length - 3}</span>
          )}
        </div>
      )}
      {/* Checklist Progress in Drag Preview */}
      {(() => {
        const progress = getChecklistProgress(card.description || '');
        if (!progress) return null;

        return (
          <div className="flex items-center gap-1 mt-2 text-[10px] text-[var(--holo-muted)]">
            <CheckSquare size={10} />
            <span>{progress.completed}/{progress.total}</span>
          </div>
        );
      })()}
    </div>
  );
}

// Column Component
interface ColumnProps {
  column: KanbanColumn;
  columnIndex: number;
  onAddCard: (columnId: string, title: string, description: string, tags: string) => void;
  onDeleteColumn: (columnId: string) => void;
  onEditCard: (card: KanbanCard, columnId: string) => void;
  onUpdateColumnTitle: (columnId: string, newTitle: string) => void;
  onTagClick?: (tag: string) => void;
  selectedCardId?: string | null;
  onSelectCard?: (cardId: string, columnId: string, columnIndex: number, cardIndex: number) => void;
}

function Column({ column, columnIndex, onAddCard, onDeleteColumn, onEditCard, onUpdateColumnTitle, onTagClick, selectedCardId, onSelectCard }: ColumnProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(column.title);

  // Make column droppable for empty column drops
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAddCard(column.id, title, '', '');
    setTitle('');
    setShowAddForm(false);
  };

  const handleDeleteColumn = () => {
    if (showDeleteConfirm) {
      onDeleteColumn(column.id);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const sortedCards = sortCardsByPriority(column.cards);
  const cardIds = sortedCards.map((c) => c.id);

  return (
    <div
      ref={setNodeRef}
      className={`${basePanel} p-3 flex flex-col max-h-[calc(100vh-220px)] transition-colors ${
        isOver ? 'border-[var(--holo-accent)]/60 bg-[var(--holo-accent)]/5' : ''
      }`}
    >
      {/* Header - flex-shrink-0 to stay fixed */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-6 rounded-full"
            style={{ background: column.color || 'var(--holo-accent)' }}
          />
          <div>
            {isEditingTitle ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => {
                  if (editTitle.trim()) {
                    onUpdateColumnTitle(column.id, editTitle.trim());
                  }
                  setIsEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (editTitle.trim()) {
                      onUpdateColumnTitle(column.id, editTitle.trim());
                    }
                    setIsEditingTitle(false);
                  }
                  if (e.key === 'Escape') {
                    setEditTitle(column.title);
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
                className="bg-transparent text-sm font-semibold focus:outline-none border-b border-[var(--holo-accent)] w-full"
              />
            ) : (
              <div
                className="text-sm font-semibold cursor-pointer hover:text-[var(--holo-accent)] transition-colors"
                onDoubleClick={() => setIsEditingTitle(true)}
              >
                {column.title}
              </div>
            )}
            <div className="text-xs text-[var(--holo-muted)]">
              {column.cards.length} card{column.cards.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddForm(true)}
            className="p-1.5 rounded text-[var(--holo-muted)] hover:text-[var(--holo-accent)] hover:bg-[var(--holo-accent)]/10 transition-colors"
            title="Add card"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={handleDeleteColumn}
            onMouseLeave={() => setShowDeleteConfirm(false)}
            className={`p-1.5 rounded transition-colors ${
              showDeleteConfirm
                ? 'bg-rose-500/20 text-rose-400'
                : 'text-[var(--holo-muted)] hover:text-[var(--holo-text)] hover:bg-white/5'
            }`}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete column'}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Add Card Form - flex-shrink-0 */}
      {showAddForm && (
        <div className="flex-shrink-0 space-y-2 p-2 bg-[rgba(0,0,0,0.2)] rounded-lg border border-[var(--holo-border)] mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') setShowAddForm(false);
            }}
            className="w-full px-2 py-1.5 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="flex-1 py-1.5 text-sm text-[var(--holo-muted)] hover:text-[var(--holo-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="flex-1 py-1.5 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Cards container - scrollable */}
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 scrollbar-thin scrollbar-thumb-[var(--holo-border)] scrollbar-track-transparent hover:scrollbar-thumb-[var(--holo-accent)]/60">
          {sortedCards.length === 0 && !showAddForm && (
            <div className="text-xs text-[var(--holo-muted)] text-center py-4 opacity-50">
              Drop cards here
            </div>
          )}
          {sortedCards.map((card, cardIndex) => (
            <DraggableCard
              key={card.id}
              card={card}
              columnId={column.id}
              columnIndex={columnIndex}
              cardIndex={cardIndex}
              onDoubleClick={() => onEditCard(card, column.id)}
              onTagClick={onTagClick}
              isSelected={selectedCardId === card.id}
              onSelect={onSelectCard}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

// Draggable Column wrapper component
interface DraggableColumnProps {
  column: KanbanColumn;
  columnIndex: number;
  onAddCard: (columnId: string, title: string, description: string, tags: string) => void;
  onDeleteColumn: (columnId: string) => void;
  onEditCard: (card: KanbanCard, columnId: string) => void;
  onUpdateColumnTitle: (columnId: string, newTitle: string) => void;
  onTagClick?: (tag: string) => void;
  selectedCardId?: string | null;
  onSelectCard?: (cardId: string, columnId: string, columnIndex: number, cardIndex: number) => void;
}

function DraggableColumn(props: DraggableColumnProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.column.id,
    data: { type: 'column', column: props.column },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Drag handle on entire column */}
      <div {...listeners} className="cursor-grab active:cursor-grabbing">
        <Column {...props} />
      </div>
    </div>
  );
}

export function KanbanBoard({ windowId, filePath, isActive }: AppProps) {
  const { fileApi, setDirty, openFile, closeTab } = useAppContext();
  const { subscribeToFile } = useFileWatcher();

  const [board, setBoard] = useState<KanbanBoardData | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [rootDir, setRootDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [externalChangeDetected, setExternalChangeDetected] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBoardName, setNewBoardName] = useState('New Kanban Board');
  const [newBoardFolder, setNewBoardFolder] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<BoardTemplate | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Archive panel state
  const [showArchivePanel, setShowArchivePanel] = useState(false);

  // Card edit modal state
  const [editingCard, setEditingCard] = useState<{
    card: KanbanCard;
    columnId: string;
  } | null>(null);

  // Drag state - TabBar pattern for correct positioning
  const dragInfoRef = useRef<{
    card?: KanbanCard;
    column?: KanbanColumn;
    initialX: number;
    initialY: number;
  } | null>(null);

  const [dragState, setDragState] = useState<{
    card?: KanbanCard;
    column?: KanbanColumn;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Keyboard shortcuts
  const { selectedCard, setSelectedCard, showHelp, setShowHelp } = useKanbanKeyboard({
    isActive,
    columns: board?.columns || [],
    onNewCard: (columnId) => {
      // Find the column and trigger its add form
      // For now, just add a blank card
      if (board) {
        handleAddCard(columnId, 'New Card', '', '');
      }
    },
    onEditCard: (cardId, columnId) => {
      const column = board?.columns.find(c => c.id === columnId);
      const card = column?.cards.find(c => c.id === cardId);
      if (card) {
        setEditingCard({ card, columnId });
      }
    },
    onCloseModal: () => {
      setEditingCard(null);
    },
    hasOpenModal: !!editingCard,
  });

  useEffect(() => {
    window.electron.app.getRootDir().then((dir) => setRootDir(dir ?? ''));
  }, []);

  // Filter columns based on search query and active tag filters
  const filteredColumns = useMemo(() => {
    if (!board) return [];
    if (!searchQuery && activeTagFilters.length === 0) return board.columns;

    const query = searchQuery.toLowerCase();

    return board.columns.map(col => ({
      ...col,
      cards: col.cards.filter(card => {
        // Skip archived cards
        if (card.isArchived) return false;

        // Search filter
        const matchesSearch = !searchQuery ||
          card.title.toLowerCase().includes(query) ||
          (card.descriptionPlainText || '').toLowerCase().includes(query);

        // Tag filter (OR logic - card matches if it has any of the active tags)
        const matchesTags = activeTagFilters.length === 0 ||
          activeTagFilters.some(tag => card.tags?.includes(tag));

        return matchesSearch && matchesTags;
      }),
    }));
  }, [board, searchQuery, activeTagFilters]);

  const loadBoard = useCallback(
    async (path: string, isReload = false) => {
      if (!path) return;
      if (!isReload) {
        setLoading(true);
      }
      setError(null);
      setExternalChangeDetected(false);

      try {
        const data = await fileApi.readFile(path);
        const parsed = ensureBoardShape(JSON.parse(data.content), 'Kanban Board');
        setBoard(parsed);
        setCurrentFilePath(path);
        setHasUnsavedChanges(false);
        setDirty(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load board. Is the JSON valid?';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [fileApi, setDirty]
  );

  useEffect(() => {
    if (filePath && filePath.includes('/')) {
      setCurrentFilePath(filePath);
      loadBoard(filePath);
    } else {
      setLoading(false);
    }
  }, [filePath, loadBoard]);

  useEffect(() => {
    if (!currentFilePath) return;

    const unsubscribe = subscribeToFile(currentFilePath, () => {
      if (hasUnsavedChanges) {
        setExternalChangeDetected(true);
      } else {
        loadBoard(currentFilePath, true);
      }
    });

    return unsubscribe;
  }, [currentFilePath, subscribeToFile, hasUnsavedChanges, loadBoard]);

  const handleSave = useCallback(async () => {
    if (!board || !currentFilePath) return;
    setSaving(true);
    setError(null);

    try {
      const payload = {
        ...board,
        updatedAt: new Date().toISOString(),
      };
      await fileApi.writeFile(currentFilePath, JSON.stringify(payload, null, 2));
      setBoard(payload);
      setHasUnsavedChanges(false);
      setDirty(false);
      setExternalChangeDetected(false);
    } catch (err) {
      console.error('Failed to save board:', err);
      setError('Unable to save board. Check file permissions.');
    } finally {
      setSaving(false);
    }
  }, [board, currentFilePath, fileApi, setDirty]);

  // Autosave effect - triggers 1 second after any change
  useEffect(() => {
    if (!hasUnsavedChanges || !board || !currentFilePath) return;

    debouncedAutoSave(async () => {
      const payload = {
        ...board,
        updatedAt: new Date().toISOString(),
      };
      try {
        await fileApi.writeFile(currentFilePath, JSON.stringify(payload, null, 2));
        setBoard(payload);
        setHasUnsavedChanges(false);
        setDirty(false);
        setExternalChangeDetected(false);
      } catch (err) {
        console.error('Autosave failed:', err);
      }
    }, 1500);
  }, [hasUnsavedChanges, board, currentFilePath, fileApi, setDirty]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, hasUnsavedChanges, handleSave]);

  const markDirty = useCallback(
    (next: KanbanBoardData) => {
      setBoard(next);
      setHasUnsavedChanges(true);
      setDirty(true);
    },
    [setDirty]
  );

  const handleAddColumn = (title: string) => {
    if (!board) return;
    const color = palette[(board.columns.length + 1) % palette.length];
    const next: KanbanBoardData = {
      ...board,
      columns: [
        ...board.columns,
        {
          id: `col-${crypto.randomUUID()}`,
          title: title || `Column ${board.columns.length + 1}`,
          color,
          cards: [],
        },
      ],
    };
    markDirty(next);
  };

  const handleAddCard = (columnId: string, title: string, description: string, tags: string) => {
    if (!board) return;
    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const next: KanbanBoardData = {
      ...board,
      columns: board.columns.map((col) =>
        col.id === columnId
          ? {
              ...col,
              cards: [
                {
                  id: `card-${crypto.randomUUID()}`,
                  title: title || 'Untitled',
                  description,
                  tags: parsedTags,
                  createdAt: new Date().toISOString(),
                },
                ...col.cards,
              ],
            }
          : col
      ),
    };

    markDirty(next);
  };

  const handleUpdateCard = (cardId: string, columnId: string, updates: Partial<KanbanCard>) => {
    if (!board) return;
    const next: KanbanBoardData = {
      ...board,
      columns: board.columns.map((col) =>
        col.id === columnId
          ? {
              ...col,
              cards: col.cards.map((card) =>
                card.id === cardId ? { ...card, ...updates } : card
              ),
            }
          : col
      ),
    };
    markDirty(next);
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    if (!board) return;
    const next = {
      ...board,
      columns: board.columns.map((col) =>
        col.id === columnId ? { ...col, cards: col.cards.filter((c) => c.id !== cardId) } : col
      ),
    };
    markDirty(next);
  };

  const handleArchiveCard = useCallback((columnId: string, cardId: string) => {
    if (!board) return;

    const column = board.columns.find(c => c.id === columnId);
    const card = column?.cards.find(c => c.id === cardId);
    if (!card) return;

    const archivedCard = {
      ...card,
      isArchived: true,
      archivedAt: new Date().toISOString(),
      archivedFromColumn: columnId,
    };

    const next: KanbanBoardData = {
      ...board,
      columns: board.columns.map(col =>
        col.id === columnId
          ? { ...col, cards: col.cards.filter(c => c.id !== cardId) }
          : col
      ),
      archivedCards: [...(board.archivedCards || []), archivedCard],
    };

    markDirty(next);
    setEditingCard(null);
  }, [board, markDirty]);

  const handleRestoreCard = useCallback((cardId: string, targetColumnId: string) => {
    if (!board) return;

    const card = board.archivedCards?.find(c => c.id === cardId);
    if (!card) return;

    // Remove archived metadata (intentional destructure-to-omit)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isArchived, archivedAt, archivedFromColumn, ...restoredCard } = card;

    const next: KanbanBoardData = {
      ...board,
      columns: board.columns.map(col =>
        col.id === targetColumnId
          ? { ...col, cards: [restoredCard, ...col.cards] }
          : col
      ),
      archivedCards: board.archivedCards?.filter(c => c.id !== cardId) || [],
    };

    markDirty(next);
  }, [board, markDirty]);

  const handleDeleteColumn = (columnId: string) => {
    if (!board) return;
    const next = { ...board, columns: board.columns.filter((c) => c.id !== columnId) };
    markDirty(next);
  };

  const handleUpdateColumnTitle = (columnId: string, newTitle: string) => {
    if (!board) return;
    const next: KanbanBoardData = {
      ...board,
      columns: board.columns.map((col) =>
        col.id === columnId ? { ...col, title: newTitle } : col
      ),
    };
    markDirty(next);
  };

  // Drag and Drop handlers
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current;

    if (data?.type === 'column') {
      // Column drag - no special preview needed, uses CSS transform
      return;
    }

    if (data?.type === 'card') {
      const activatorEvent = event.activatorEvent as MouseEvent;
      const target = activatorEvent.target as HTMLElement;
      const cardNode = target.closest('[data-card-id]');

      if (cardNode) {
        const rect = cardNode.getBoundingClientRect();
        dragInfoRef.current = {
          card: data.card,
          initialX: rect.left,
          initialY: rect.top,
        };
        setDragState({
          card: data.card,
          currentX: rect.left,
          currentY: rect.top,
        });
      }
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (dragInfoRef.current) {
      setDragState({
        card: dragInfoRef.current.card,
        currentX: dragInfoRef.current.initialX + event.delta.x,
        currentY: dragInfoRef.current.initialY + event.delta.y,
      });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    dragInfoRef.current = null;
    setDragState(null);

    if (!over || !board) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // Handle column reordering
    if (activeData?.type === 'column') {
      const oldIndex = board.columns.findIndex((c) => c.id === active.id);
      const newIndex = board.columns.findIndex((c) => c.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newColumns = [...board.columns];
        const [movedColumn] = newColumns.splice(oldIndex, 1);
        newColumns.splice(newIndex, 0, movedColumn);
        markDirty({ ...board, columns: newColumns });
      }
      return;
    }

    if (!activeData || activeData.type !== 'card') return;

    const activeCardId = active.id as string;
    const sourceColumnId = activeData.columnId;

    // Determine target column and index
    let targetColumnId: string;
    let targetIndex: number;

    if (overData?.type === 'card') {
      // Dropped on another card
      targetColumnId = overData.columnId;
      const targetColumn = board.columns.find((c) => c.id === targetColumnId);
      targetIndex = targetColumn?.cards.findIndex((c) => c.id === over.id) ?? 0;
    } else {
      // Dropped on column (empty area)
      targetColumnId = over.id as string;
      const targetColumn = board.columns.find((c) => c.id === targetColumnId);
      targetIndex = targetColumn?.cards.length ?? 0;
    }

    // Same column reordering
    if (sourceColumnId === targetColumnId) {
      const column = board.columns.find((c) => c.id === sourceColumnId);
      if (!column) return;

      const oldIndex = column.cards.findIndex((c) => c.id === activeCardId);
      if (oldIndex === targetIndex || oldIndex === -1) return;

      const newCards = [...column.cards];
      const [movedCard] = newCards.splice(oldIndex, 1);
      newCards.splice(targetIndex, 0, movedCard);

      const newColumns = board.columns.map((col) =>
        col.id === sourceColumnId ? { ...col, cards: newCards } : col
      );

      markDirty({ ...board, columns: newColumns });
    } else {
      // Cross-column move
      const sourceColumn = board.columns.find((c) => c.id === sourceColumnId);
      const targetColumn = board.columns.find((c) => c.id === targetColumnId);

      if (!sourceColumn || !targetColumn) return;

      const cardToMove = sourceColumn.cards.find((c) => c.id === activeCardId);
      if (!cardToMove) return;

      const newColumns = board.columns.map((col) => {
        if (col.id === sourceColumnId) {
          return { ...col, cards: col.cards.filter((c) => c.id !== activeCardId) };
        }
        if (col.id === targetColumnId) {
          const newCards = [...col.cards];
          newCards.splice(targetIndex, 0, { ...cardToMove, updatedAt: new Date().toISOString() });
          return { ...col, cards: newCards };
        }
        return col;
      });

      markDirty({ ...board, columns: newColumns });

      // Human→agent feedback: report the cross-column drag back to the agent that
      // opened this view (resolved in main from windowId). Fire-and-forget — a
      // failed emit must never disrupt the local board update.
      void window.electron?.control
        ?.emitViewEvent(windowId, 'card_moved', {
          cardId: activeCardId,
          fromColumn: sourceColumnId,
          toColumn: targetColumnId,
          position: targetIndex,
        })
        .catch(() => {});
    }
  };

  const handleCreateBoard = async () => {
    if (!rootDir) return;
    const folder = sanitizedFolder(newBoardFolder);
    const fileName = buildFileName(newBoardName);
    const targetPath = `${rootDir.replace(/\\$/g, '').replace(/\/$/, '')}${
      folder ? `/${folder}` : ''
    }/${fileName}`;

    setCreating(true);
    setError(null);
    try {
      // Use template columns if selected, otherwise use default
      const templateColumns = selectedTemplate
        ? selectedTemplate.columns.map((col) => ({
            id: `col-${crypto.randomUUID()}`,
            title: col.title,
            color: col.color,
            cards: [],
          }))
        : defaultColumns();

      const initialBoard: KanbanBoardData = {
        name: newBoardName || 'Kanban Board',
        description: selectedTemplate
          ? `Created from "${selectedTemplate.name}" template.`
          : 'Fresh board created from the viewer.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        columns: templateColumns,
      };

      await window.electron.fs.createFile(targetPath, 'file');
      await fileApi.writeFile(targetPath, JSON.stringify(initialBoard, null, 2));

      openFile(targetPath);
      closeTab();
    } catch (err) {
      console.error('Failed to create board:', err);
      setError('Could not create the kb_ file. Is the folder inside the working directory?');
    } finally {
      setCreating(false);
    }
  };

  const creationFileName = useMemo(() => buildFileName(newBoardName), [newBoardName]);
  const creationFolder = useMemo(() => sanitizedFolder(newBoardFolder), [newBoardFolder]);

  // Handle tag click for filtering
  const handleTagClick = useCallback((tag: string) => {
    setActiveTagFilters(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  }, []);

  if (!currentFilePath) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className={`${basePanel} max-w-xl w-full p-6 space-y-4`}>
          <div className="flex items-center gap-2 text-[var(--holo-accent)]">
            <LayoutDashboard size={18} />
            <span className="text-sm font-semibold">Create a Kanban board</span>
          </div>
          <p className="text-sm text-[var(--holo-muted)]">
            This app works with JSON files named{' '}
            <code className="px-1 py-0.5 bg-black/30 rounded">kb_*.json</code>. Choose a name and
            optional folder inside the working directory to generate one.
          </p>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-[var(--holo-muted)]">Board name</span>
              <input
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)]"
                placeholder="Design sync"
              />
            </label>

            <label className="block">
              <span className="text-xs text-[var(--holo-muted)]">
                Folder (optional, relative to root)
              </span>
              <input
                value={newBoardFolder}
                onChange={(e) => setNewBoardFolder(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)]"
                placeholder="projects/active"
              />
            </label>

            {/* Template Selection */}
            <div className="space-y-3">
              <span className="text-xs text-[var(--holo-muted)]">Start from template</span>
              <div className="grid grid-cols-2 gap-2">
                {BUILT_IN_BOARD_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={`p-3 text-left border rounded-lg transition-all ${
                      selectedTemplate?.id === template.id
                        ? 'border-[var(--holo-accent)] bg-[var(--holo-accent)]/10'
                        : 'border-[var(--holo-border)] hover:border-[var(--holo-accent)]/50'
                    }`}
                  >
                    <div className="text-sm font-medium">{template.name}</div>
                    <div className="text-xs text-[var(--holo-muted)] mt-1">{template.description}</div>
                    <div className="flex gap-1 mt-2">
                      {template.columns.slice(0, 4).map((col, i) => (
                        <div
                          key={i}
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: col.color }}
                          title={col.title}
                        />
                      ))}
                      {template.columns.length > 4 && (
                        <span className="text-[10px] text-[var(--holo-muted)]">
                          +{template.columns.length - 4}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Blank board option */}
              <button
                onClick={() => setSelectedTemplate(null)}
                className={`w-full p-3 text-left border rounded-lg transition-all ${
                  selectedTemplate === null
                    ? 'border-[var(--holo-accent)] bg-[var(--holo-accent)]/10'
                    : 'border-[var(--holo-border)] hover:border-[var(--holo-accent)]/50'
                }`}
              >
                <div className="text-sm font-medium">Blank Board</div>
                <div className="text-xs text-[var(--holo-muted)] mt-1">Start with default columns</div>
              </button>
            </div>

            {/* Template Preview */}
            {selectedTemplate && (
              <div className="p-3 bg-[rgba(0,0,0,0.2)] rounded-lg border border-[var(--holo-border)]">
                <div className="text-xs text-[var(--holo-muted)] mb-2">Preview: {selectedTemplate.name}</div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {selectedTemplate.columns.map((col, i) => (
                    <div
                      key={i}
                      className="flex-shrink-0 w-24 p-2 bg-[rgba(0,0,0,0.3)] rounded border border-[var(--holo-border)]"
                    >
                      <div className="flex items-center gap-1">
                        <div
                          className="w-2 h-4 rounded-full"
                          style={{ backgroundColor: col.color }}
                        />
                        <span className="text-xs truncate">{col.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs text-[var(--holo-muted)]">
              File will be created at{' '}
              <span className="text-[var(--holo-text)]">
                {rootDir
                  ? `${summarizePath(rootDir, rootDir)}/${
                      creationFolder ? `${creationFolder}/` : ''
                    }${creationFileName}`
                  : creationFileName}
              </span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-amber-300 text-sm">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[var(--holo-muted)]">
              Hint: Use the Files window to open an existing kb_*.json.
            </div>
            <button
              onClick={handleCreateBoard}
              disabled={creating}
              className="px-3 py-2 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-90 transition disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create & open'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--holo-muted)]">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading board…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className={`${basePanel} p-5 max-w-lg w-full`}>
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle size={18} />
            <span className="text-sm font-semibold">Unable to open board</span>
          </div>
          <p className="mt-2 text-sm text-[var(--holo-muted)]">{error}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => currentFilePath && loadBoard(currentFilePath, true)}
              className="px-3 py-1.5 text-sm bg-[var(--holo-accent)] rounded hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!board) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div className="relative h-full flex flex-col overflow-hidden bg-gradient-to-br from-[rgba(20,25,40,0.9)] via-[rgba(10,10,15,0.95)] to-[rgba(15,20,35,0.9)]">
        {externalChangeDetected && (
          <div className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/40 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle size={14} />
              <span>This kb file changed elsewhere.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => currentFilePath && loadBoard(currentFilePath, true)}
                className="px-2 py-1 text-xs bg-amber-400 text-black rounded hover:bg-amber-300 transition"
              >
                Reload
              </button>
              <button
                onClick={() => setExternalChangeDetected(false)}
                className="px-2 py-1 text-xs text-amber-200 hover:text-amber-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="p-4 border-b border-[var(--holo-border)] bg-[rgba(10,10,18,0.7)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--holo-accent)]/15 border border-[var(--holo-border)] flex items-center justify-center">
                <LayoutDashboard className="text-[var(--holo-accent)]" size={20} />
              </div>
              <div>
                <input
                  value={board.name}
                  onChange={(e) => markDirty({ ...board, name: e.target.value })}
                  className="bg-transparent text-lg font-semibold text-[var(--holo-text)] focus:outline-none"
                />
                <div className="text-xs text-[var(--holo-muted)]">
                  {summarizePath(currentFilePath, rootDir)}
                </div>
              </div>
            </div>

            {/* Search and Filter Bar */}
            <div className="flex items-center gap-3 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--holo-muted)]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search cards..."
                  className="w-full pl-9 pr-8 py-1.5 text-sm bg-[rgba(0,0,0,0.35)] border border-[var(--holo-border)] rounded focus:outline-none focus:border-[var(--holo-accent)] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasUnsavedChanges ? (
                <span className="text-xs text-amber-300 px-2 py-1 rounded border border-amber-500/40 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  Autosaving...
                </span>
              ) : (
                <span className="text-xs text-emerald-400 px-2 py-1 rounded border border-emerald-500/40">
                  Saved
                </span>
              )}
              <button
                onClick={() => currentFilePath && loadBoard(currentFilePath, true)}
                className="px-3 py-1.5 text-sm border border-[var(--holo-border)] rounded hover:bg-[var(--holo-accent)]/10 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={14} />
                Reload
              </button>
              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saving}
                className="px-3 py-1.5 text-sm bg-[var(--holo-accent)] text-black rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition-opacity"
              >
                <Save size={14} />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowArchivePanel(prev => !prev)}
                className={`px-3 py-1.5 text-sm border rounded flex items-center gap-2 transition-colors ${
                  showArchivePanel
                    ? 'border-[var(--holo-accent)] bg-[var(--holo-accent)]/10 text-[var(--holo-accent)]'
                    : 'border-[var(--holo-border)] hover:bg-[var(--holo-accent)]/10'
                }`}
              >
                <Archive size={14} />
                Archive
                {board.archivedCards?.length ? (
                  <span className="text-xs bg-[var(--holo-accent)]/20 px-1.5 py-0.5 rounded">
                    {board.archivedCards.length}
                  </span>
                ) : null}
              </button>
              <button
                onClick={() => handleAddColumn('')}
                className="px-3 py-1.5 text-sm border border-[var(--holo-border)] rounded hover:bg-[var(--holo-accent)]/10 flex items-center gap-2 transition-colors"
              >
                <Plus size={14} />
                Column
              </button>
            </div>
          </div>
        </div>

        {/* Active Filters & Available Tags */}
        {(activeTagFilters.length > 0 || board.columns.some(c => c.cards.some(card => card.tags?.length))) && (
          <div className="px-4 py-2 border-b border-[var(--holo-border)] bg-[rgba(10,10,18,0.5)] flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-[var(--holo-muted)]" />

            {/* Active filter tags */}
            {activeTagFilters.map(tag => {
              const colors = getTagColor(tag);
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTagFilters(prev => prev.filter(t => t !== tag))}
                  className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-transform hover:scale-105"
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: colors.border,
                  }}
                >
                  {tag}
                  <X size={10} />
                </button>
              );
            })}

            {activeTagFilters.length > 0 && (
              <button
                onClick={() => setActiveTagFilters([])}
                className="text-xs text-[var(--holo-muted)] hover:text-[var(--holo-text)] px-2"
              >
                Clear all
              </button>
            )}

            {/* Available tags (not yet filtered) */}
            {activeTagFilters.length === 0 && (
              <span className="text-xs text-[var(--holo-muted)]">Click a tag on any card to filter</span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
          {/* Show "no results" message when filtering returns no cards */}
          {filteredColumns.every(col => col.cards.length === 0) && (searchQuery || activeTagFilters.length > 0) ? (
            <div className="flex items-center justify-center h-40 text-[var(--holo-muted)]">
              <div className="text-center">
                <Search size={24} className="mx-auto mb-2 opacity-50" />
                <p>No cards match your search</p>
                <button
                  onClick={() => { setSearchQuery(''); setActiveTagFilters([]); }}
                  className="text-[var(--holo-accent)] text-sm mt-2 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <SortableContext
              items={board.columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex gap-4 items-start min-w-max">
                {filteredColumns.map((column, columnIndex) => (
                  <div key={column.id} className="w-[280px] flex-shrink-0">
                    <DraggableColumn
                      column={column}
                      columnIndex={columnIndex}
                      onAddCard={handleAddCard}
                      onDeleteColumn={handleDeleteColumn}
                      onEditCard={(card, colId) => setEditingCard({ card, columnId: colId })}
                      onUpdateColumnTitle={handleUpdateColumnTitle}
                      selectedCardId={selectedCard?.cardId}
                      onSelectCard={(cardId, columnId, colIdx, cardIdx) => {
                        setSelectedCard({
                          cardId,
                          columnId,
                          columnIndex: colIdx,
                          cardIndex: cardIdx,
                        });
                      }}
                      onTagClick={handleTagClick}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>
          )}
        </div>
      </div>

      {/* Drag Overlay - custom portal for correct positioning */}
      {dragState && dragState.card &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: dragState.currentX,
              top: dragState.currentY,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          >
            <CardPreview card={dragState.card} />
          </div>,
          document.body
        )}

      {/* Archive Panel */}
      {showArchivePanel && (
        <div className="fixed inset-y-0 right-0 w-80 bg-[rgba(15,15,25,0.98)] border-l border-[var(--holo-border)] shadow-xl z-40 flex flex-col">
          <div className="p-4 border-b border-[var(--holo-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-[var(--holo-accent)]" />
              <span className="font-semibold">Archived Cards</span>
              <span className="text-xs text-[var(--holo-muted)]">
                ({board?.archivedCards?.length || 0})
              </span>
            </div>
            <button
              onClick={() => setShowArchivePanel(false)}
              className="p-1 text-[var(--holo-muted)] hover:text-[var(--holo-text)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(!board?.archivedCards || board.archivedCards.length === 0) ? (
              <div className="text-center text-[var(--holo-muted)] py-8">
                <Archive size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No archived cards</p>
              </div>
            ) : (
              board.archivedCards.map(card => (
                <div
                  key={card.id}
                  className="p-3 bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded-lg"
                >
                  <div className="text-sm font-medium truncate">{card.title}</div>
                  {card.archivedAt && (
                    <div className="text-xs text-[var(--holo-muted)] mt-1">
                      Archived {new Date(card.archivedAt).toLocaleDateString()}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      className="flex-1 text-xs bg-[rgba(0,0,0,0.3)] border border-[var(--holo-border)] rounded px-2 py-1"
                      defaultValue={card.archivedFromColumn || board.columns[0]?.id}
                    >
                      {board.columns.map(col => (
                        <option key={col.id} value={col.id}>{col.title}</option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => {
                        const select = e.currentTarget.parentElement?.querySelector('select') as HTMLSelectElement;
                        const targetColumn = select?.value || board.columns[0]?.id;
                        if (targetColumn) {
                          handleRestoreCard(card.id, targetColumn);
                        }
                      }}
                      className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"
                      title="Restore card"
                    >
                      <ArchiveRestore size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingCard && (
        <CardEditModal
          card={editingCard.card}
          onSave={(updates) =>
            handleUpdateCard(editingCard.card.id, editingCard.columnId, updates)
          }
          onDelete={() => handleDeleteCard(editingCard.columnId, editingCard.card.id)}
          onArchive={() => handleArchiveCard(editingCard.columnId, editingCard.card.id)}
          onClose={() => setEditingCard(null)}
        />
      )}

      {/* Keyboard Shortcuts Help */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div className="bg-[rgba(15,15,25,0.95)] border border-[var(--holo-border)] rounded-lg p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-[var(--holo-text)]">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--holo-muted)]">New card</span>
                <kbd className="px-2 py-0.5 bg-black/30 rounded border border-[var(--holo-border)] text-[var(--holo-text)]">n</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--holo-muted)]">Edit selected card</span>
                <kbd className="px-2 py-0.5 bg-black/30 rounded border border-[var(--holo-border)] text-[var(--holo-text)]">e</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--holo-muted)]">Navigate cards</span>
                <kbd className="px-2 py-0.5 bg-black/30 rounded border border-[var(--holo-border)] text-[var(--holo-text)]">↑↓←→</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--holo-muted)]">Close / Deselect</span>
                <kbd className="px-2 py-0.5 bg-black/30 rounded border border-[var(--holo-border)] text-[var(--holo-text)]">Esc</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--holo-muted)]">Show shortcuts</span>
                <kbd className="px-2 py-0.5 bg-black/30 rounded border border-[var(--holo-border)] text-[var(--holo-text)]">?</kbd>
              </div>
            </div>
            <p className="text-xs text-[var(--holo-muted)] mt-4">Press Escape or click outside to close</p>
          </div>
        </div>
      )}
    </DndContext>
  );
}

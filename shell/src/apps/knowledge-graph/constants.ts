import type { NodeType, EdgeType, EdgeStyle, MindmapSettings, Category } from './types';

// Node type configurations
export const NODE_TYPES: Record<NodeType, { label: string; icon: string; color: string }> = {
  note: { label: 'Note', icon: 'StickyNote', color: '#60a5fa' },
  resource: { label: 'Resource', icon: 'Link', color: '#34d399' },
  concept: { label: 'Concept', icon: 'Lightbulb', color: '#a78bfa' },
  question: { label: 'Question', icon: 'HelpCircle', color: '#fbbf24' },
  custom: { label: 'Custom', icon: 'Star', color: '#f472b6' },
};

// Edge type configurations
export const EDGE_TYPES: Record<EdgeType, { label: string; color: string; defaultStyle: EdgeStyle }> = {
  relates: { label: 'Relates to', color: 'rgba(148, 163, 184, 0.6)', defaultStyle: 'solid' },
  causes: { label: 'Causes', color: 'rgba(251, 191, 36, 0.7)', defaultStyle: 'solid' },
  supports: { label: 'Supports', color: 'rgba(52, 211, 153, 0.7)', defaultStyle: 'solid' },
  contradicts: { label: 'Contradicts', color: 'rgba(248, 113, 113, 0.7)', defaultStyle: 'dashed' },
  depends: { label: 'Depends on', color: 'rgba(96, 165, 250, 0.7)', defaultStyle: 'dotted' },
  contains: { label: 'Contains', color: 'rgba(167, 139, 250, 0.7)', defaultStyle: 'solid' },
  custom: { label: 'Custom', color: 'rgba(244, 114, 182, 0.7)', defaultStyle: 'solid' },
};

// Default categories
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'ideas', name: 'Ideas', color: '#a78bfa', icon: 'Lightbulb' },
  { id: 'projects', name: 'Projects', color: '#60a5fa', icon: 'Folder' },
  { id: 'resources', name: 'Resources', color: '#34d399', icon: 'BookOpen' },
  { id: 'questions', name: 'Questions', color: '#fbbf24', icon: 'HelpCircle' },
  { id: 'archive', name: 'Archive', color: '#6b7280', icon: 'Archive' },
];

// Default settings
export const DEFAULT_SETTINGS: MindmapSettings = {
  showGrid: true,
  gridSize: 20,
  snapToGrid: true,
  showMinimap: true,
  defaultNodeType: 'note',
  defaultEdgeType: 'relates',
  aiEnabled: true,
};

// Node dimensions
export const NODE_WIDTH = 280;
export const NODE_MIN_HEIGHT = 80;
export const NODE_MAX_HEIGHT = 200;

// Canvas settings
export const CANVAS_PADDING = 50;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;

// Sidebar width
export const SIDEBAR_WIDTH = 360;

// Colors for category picker
export const CATEGORY_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#fbbf24', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#6b7280', // gray
];

// Generate unique ID
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Create new node with defaults
export function createNode(
  partial: Partial<import('./types').GraphNode> & { position: { x: number; y: number } }
): import('./types').GraphNode {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    type: 'note',
    title: 'New Node',
    body: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// Create new edge with defaults
export function createEdge(
  partial: Partial<import('./types').GraphEdge> & { source: string; target: string }
): import('./types').GraphEdge {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    type: 'relates',
    style: 'solid',
    createdAt: now,
    ...partial,
  };
}

// Create empty mindmap file
export function createEmptyMindmap(name: string = 'Untitled'): import('./types').MindmapFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    categories: [...DEFAULT_CATEGORIES],
    settings: { ...DEFAULT_SETTINGS },
  };
}

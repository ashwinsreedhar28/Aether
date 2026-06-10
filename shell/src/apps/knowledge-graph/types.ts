// Knowledge Graph Types

export type NodeType = 'note' | 'resource' | 'concept' | 'question' | 'custom';
export type EdgeType = 'relates' | 'causes' | 'supports' | 'contradicts' | 'depends' | 'contains' | 'custom';
export type EdgeStyle = 'solid' | 'dashed' | 'dotted';

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'link' | 'embed';
  name: string;
  url: string;
  mimeType?: string;
  thumbnail?: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  title: string;
  body: string;
  bodyPlainText?: string;
  attachments?: Attachment[];
  categoryId?: string;
  tags?: string[];
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  style?: EdgeStyle;
  color?: string;
  animated?: boolean;
  bidirectional?: boolean;
  strength?: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export interface MindmapSettings {
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  showMinimap: boolean;
  defaultNodeType: NodeType;
  defaultEdgeType: EdgeType;
  aiEnabled: boolean;
}

export interface MindmapFile {
  version: 1;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport?: { x: number; y: number; zoom: number };
  categories: Category[];
  settings: MindmapSettings;
}

// AI Export types
export interface AINodeExport {
  id: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
  connectedTo: Array<{
    nodeId: string;
    nodeTitle: string;
    relationship: string;
    direction: 'incoming' | 'outgoing';
  }>;
}

export interface AIContextExport {
  nodes: AINodeExport[];
  summary: {
    totalNodes: number;
    totalEdges: number;
    categories: string[];
    keyTopics: string[];
  };
}

// Auto-link suggestion
export interface AutoLinkSuggestion {
  sourceId: string;
  targetId: string;
  confidence: number;
  reason: string;
  suggestedType: EdgeType;
}

// Store types
export interface GraphState {
  // Data
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: Category[];
  settings: MindmapSettings;
  name: string;
  description: string;

  // Selection
  selectedNodeIds: Set<string>;
  selectedEdgeId: string | null;

  // View
  viewport: { x: number; y: number; zoom: number };

  // UI state
  searchQuery: string;
  activeFilters: {
    categories: Set<string>;
    tags: Set<string>;
    nodeTypes: Set<NodeType>;
  };

  // Edit state
  editingNodeId: string | null;
  sidebarOpen: boolean;

  // Edge creation mode
  edgeCreationMode: boolean;
  edgeCreationSource: string | null;  // First node selected for edge creation
}

export interface GraphActions {
  // Node actions
  addNode: (node: Partial<GraphNode> & { position: { x: number; y: number } }) => string;
  updateNode: (id: string, updates: Partial<GraphNode>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => string | null;

  // Edge actions
  addEdge: (edge: Partial<GraphEdge> & { source: string; target: string }) => string;
  updateEdge: (id: string, updates: Partial<GraphEdge>) => void;
  deleteEdge: (id: string) => void;

  // Category actions
  addCategory: (category: Omit<Category, 'id'>) => string;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  // Selection
  setSelectedNodes: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  selectEdge: (id: string | null) => void;

  // View
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;

  // UI
  setSearchQuery: (query: string) => void;
  setEditingNode: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleFilter: (type: 'categories' | 'tags' | 'nodeTypes', value: string) => void;

  // Edge creation mode
  setEdgeCreationMode: (enabled: boolean) => void;
  setEdgeCreationSource: (nodeId: string | null) => void;

  // Settings
  updateSettings: (updates: Partial<MindmapSettings>) => void;

  // Bulk
  importData: (data: MindmapFile) => void;
  exportData: () => MindmapFile;
  reset: () => void;
}

export type GraphStore = GraphState & GraphActions;

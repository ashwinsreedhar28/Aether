import { create } from 'zustand';
import type { GraphStore, GraphNode, GraphEdge, NodeType } from '../types';
import { generateId, createNode, createEdge, DEFAULT_SETTINGS, DEFAULT_CATEGORIES } from '../constants';

const initialState = {
  nodes: [] as GraphNode[],
  edges: [] as GraphEdge[],
  categories: [...DEFAULT_CATEGORIES],
  settings: { ...DEFAULT_SETTINGS },
  name: 'Untitled',
  description: '',
  selectedNodeIds: new Set<string>(),
  selectedEdgeId: null as string | null,
  viewport: { x: 0, y: 0, zoom: 1 },
  searchQuery: '',
  activeFilters: {
    categories: new Set<string>(),
    tags: new Set<string>(),
    nodeTypes: new Set<NodeType>(),
  },
  editingNodeId: null as string | null,
  sidebarOpen: false,
  edgeCreationMode: false,
  edgeCreationSource: null as string | null,
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  ...initialState,

  // Node actions
  addNode: (partial) => {
    const node = createNode(partial);
    set((state) => ({
      nodes: [...state.nodes, node],
    }));
    return node.id;
  },

  updateNode: (id, updates) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
      ),
    }));
  },

  deleteNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeIds: new Set([...state.selectedNodeIds].filter((nid) => nid !== id)),
      editingNodeId: state.editingNodeId === id ? null : state.editingNodeId,
    }));
  },

  duplicateNode: (id) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === id);
    if (!node) return null;

    const newNode = createNode({
      ...node,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      title: `${node.title} (copy)`,
    });

    set((s) => ({
      nodes: [...s.nodes, newNode],
    }));

    return newNode.id;
  },

  // Edge actions
  addEdge: (partial) => {
    const edge = createEdge(partial);
    set((state) => ({
      edges: [...state.edges, edge],
    }));
    return edge.id;
  },

  updateEdge: (id, updates) => {
    set((state) => ({
      edges: state.edges.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }));
  },

  deleteEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
    }));
  },

  // Category actions
  addCategory: (category) => {
    const id = generateId();
    set((state) => ({
      categories: [...state.categories, { ...category, id }],
    }));
    return id;
  },

  updateCategory: (id, updates) => {
    set((state) => ({
      categories: state.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  },

  deleteCategory: (id) => {
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      nodes: state.nodes.map((n) =>
        n.categoryId === id ? { ...n, categoryId: undefined } : n
      ),
    }));
  },

  // Selection
  setSelectedNodes: (ids) => {
    set({ selectedNodeIds: new Set(ids), selectedEdgeId: null });
  },

  addToSelection: (id) => {
    set((state) => ({
      selectedNodeIds: new Set([...state.selectedNodeIds, id]),
      selectedEdgeId: null,
    }));
  },

  removeFromSelection: (id) => {
    set((state) => ({
      selectedNodeIds: new Set([...state.selectedNodeIds].filter((nid) => nid !== id)),
    }));
  },

  clearSelection: () => {
    set({ selectedNodeIds: new Set(), selectedEdgeId: null, editingNodeId: null });
  },

  selectEdge: (id) => {
    set({ selectedEdgeId: id, selectedNodeIds: new Set() });
  },

  // View
  setViewport: (viewport) => {
    set({ viewport });
  },

  // UI
  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setEditingNode: (id) => {
    set({ editingNodeId: id, sidebarOpen: id !== null });
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open, editingNodeId: open ? get().editingNodeId : null });
  },

  setEdgeCreationMode: (enabled) => {
    set({ edgeCreationMode: enabled, edgeCreationSource: enabled ? get().edgeCreationSource : null });
  },

  setEdgeCreationSource: (nodeId) => {
    set({ edgeCreationSource: nodeId });
  },

  toggleFilter: (type, value) => {
    set((state) => {
      const filters = { ...state.activeFilters };
      const filterSet = new Set(filters[type]);
      if (filterSet.has(value as never)) {
        filterSet.delete(value as never);
      } else {
        filterSet.add(value as never);
      }
      filters[type] = filterSet as never;
      return { activeFilters: filters };
    });
  },

  // Settings
  updateSettings: (updates) => {
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  // Bulk operations
  importData: (data) => {
    set({
      nodes: data.nodes,
      edges: data.edges,
      categories: data.categories.length > 0 ? data.categories : [...DEFAULT_CATEGORIES],
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
      name: data.name,
      description: data.description || '',
      viewport: data.viewport || { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: new Set(),
      selectedEdgeId: null,
      editingNodeId: null,
      sidebarOpen: false,
      edgeCreationMode: false,
      edgeCreationSource: null,
    });
  },

  exportData: () => {
    const state = get();
    const now = new Date().toISOString();
    return {
      version: 1 as const,
      name: state.name,
      description: state.description || undefined,
      createdAt: now,
      updatedAt: now,
      nodes: state.nodes,
      edges: state.edges,
      viewport: state.viewport,
      categories: state.categories,
      settings: state.settings,
    };
  },

  reset: () => {
    set({
      ...initialState,
      categories: [...DEFAULT_CATEGORIES],
      settings: { ...DEFAULT_SETTINGS },
      selectedNodeIds: new Set(),
      activeFilters: {
        categories: new Set(),
        tags: new Set(),
        nodeTypes: new Set(),
      },
      edgeCreationMode: false,
      edgeCreationSource: null,
    });
  },
}));

// Selectors
export const selectNodes = (state: GraphStore) => state.nodes;
export const selectEdges = (state: GraphStore) => state.edges;
export const selectCategories = (state: GraphStore) => state.categories;
export const selectSettings = (state: GraphStore) => state.settings;
export const selectSelectedNodes = (state: GraphStore) =>
  state.nodes.filter((n) => state.selectedNodeIds.has(n.id));
export const selectEditingNode = (state: GraphStore) =>
  state.nodes.find((n) => n.id === state.editingNodeId) || null;

// Get node by ID
export const selectNodeById = (id: string) => (state: GraphStore) =>
  state.nodes.find((n) => n.id === id);

// Get edges connected to a node
export const selectNodeEdges = (nodeId: string) => (state: GraphStore) =>
  state.edges.filter((e) => e.source === nodeId || e.target === nodeId);

// Get connected nodes
export const selectConnectedNodes = (nodeId: string) => (state: GraphStore) => {
  const connectedEdges = state.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  const connectedIds = new Set(
    connectedEdges.flatMap((e) => [e.source, e.target]).filter((id) => id !== nodeId)
  );
  return state.nodes.filter((n) => connectedIds.has(n.id));
};

// Search nodes
export const selectSearchResults = (state: GraphStore) => {
  const query = state.searchQuery.toLowerCase().trim();
  if (!query) return state.nodes;

  return state.nodes.filter(
    (n) =>
      n.title.toLowerCase().includes(query) ||
      n.body.toLowerCase().includes(query) ||
      n.tags?.some((t) => t.toLowerCase().includes(query))
  );
};

// Get all unique tags
export const selectAllTags = (state: GraphStore) => {
  const tags = new Set<string>();
  state.nodes.forEach((n) => n.tags?.forEach((t) => tags.add(t)));
  return Array.from(tags).sort();
};

// Filter nodes based on active filters
export const selectFilteredNodes = (state: GraphStore) => {
  const { categories, tags, nodeTypes } = state.activeFilters;

  return state.nodes.filter((node) => {
    // If no filters active, show all
    if (categories.size === 0 && tags.size === 0 && nodeTypes.size === 0) {
      return true;
    }

    // Check category filter
    if (categories.size > 0 && node.categoryId && !categories.has(node.categoryId)) {
      return false;
    }

    // Check tag filter (node must have at least one matching tag)
    if (tags.size > 0 && (!node.tags || !node.tags.some((t) => tags.has(t)))) {
      return false;
    }

    // Check node type filter
    if (nodeTypes.size > 0 && !nodeTypes.has(node.type)) {
      return false;
    }

    return true;
  });
};

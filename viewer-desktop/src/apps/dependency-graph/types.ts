/**
 * Dependency Graph Types
 */

export interface DependencyNode {
  id: string;           // File path (relative to workspace root)
  absolutePath: string; // Full path for file operations
  name: string;         // Display name (filename)
  extension: string;    // File extension
  imports: string[];    // IDs of files this imports
  importedBy: string[]; // IDs of files that import this
  isExternal: boolean;  // True if node_modules dependency
  isEntryPoint: boolean;// True if not imported by anything internal
  depth: number;        // Distance from selected/entry file
}

export interface DependencyEdge {
  id: string;
  source: string;       // Importing file ID
  target: string;       // Imported file ID
  importType: 'static' | 'dynamic'; // import vs import()
  importPath: string;   // Original import string
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
  rootDir: string;
  scannedAt: number;
}

export interface ImportInfo {
  source: string;       // The import path as written
  resolved: string | null; // Resolved absolute path, null if external
  isDynamic: boolean;
  isExternal: boolean;
}

export interface ScanOptions {
  maxDepth?: number;     // Max traversal depth (default 10)
  includeExternal?: boolean; // Show node_modules deps
  fileTypes?: string[];  // Extensions to scan (default: ts, tsx, js, jsx)
  excludePatterns?: RegExp[]; // Patterns to skip
}

export interface GraphViewState {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  focusedNodeId: string | null;
  showExternal: boolean;
  layoutDirection: 'TB' | 'LR' | 'BT' | 'RL';
  zoom: number;
}

// React Flow node data
// Defined as a type alias (not interface) so it carries an implicit index
// signature and satisfies @xyflow/react's `Node<T extends Record<string, unknown>>`.
export type DependencyNodeData = {
  label: string;
  extension: string;
  isExternal: boolean;
  isEntryPoint: boolean;
  importCount: number;
  importedByCount: number;
  depth: number;
};

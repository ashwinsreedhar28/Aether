/**
 * Graph Builder - Constructs dependency graph from file system
 */

import type {
  DependencyNode,
  DependencyEdge,
  DependencyGraph,
  ScanOptions,
} from '../types';
import {
  extractImports,
  resolveImportPath,
  shouldScanFile,
} from './importParser';

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  maxDepth: 10,
  includeExternal: false,
  fileTypes: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
  excludePatterns: [
    /node_modules/,
    /\.d\.ts$/,
    /\.test\./,
    /\.spec\./,
    /__tests__/,
    /\.stories\./,
  ],
};

/**
 * Build dependency graph starting from a root file or scanning entire workspace
 */
export async function buildDependencyGraph(
  rootDir: string,
  startFile: string | null,
  allFiles: string[],
  readFile: (path: string) => Promise<string>,
  options: ScanOptions = {}
): Promise<DependencyGraph> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Filter to scannable files
  const scannableFiles = new Set(
    allFiles.filter((f) => {
      if (!shouldScanFile(f)) return false;
      for (const pattern of opts.excludePatterns) {
        if (pattern.test(f)) return false;
      }
      return true;
    })
  );

  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const externalDeps = new Set<string>();

  // Process each file
  for (const filePath of scannableFiles) {
    const relativePath = filePath.startsWith(rootDir)
      ? filePath.slice(rootDir.length)
      : filePath;

    const fileName = filePath.split('/').pop() || filePath;
    const extension = fileName.split('.').pop() || '';

    // Create node
    const node: DependencyNode = {
      id: relativePath,
      absolutePath: filePath,
      name: fileName,
      extension,
      imports: [],
      importedBy: [],
      isExternal: false,
      isEntryPoint: false,
      depth: 0,
    };

    nodes.set(relativePath, node);

    // Read and parse file
    try {
      const content = await readFile(filePath);
      const imports = extractImports(content);

      for (const imp of imports) {
        if (imp.isExternal) {
          if (opts.includeExternal) {
            externalDeps.add(imp.source);
          }
          continue;
        }

        // Resolve relative import
        const resolved = resolveImportPath(imp.source, filePath, scannableFiles);
        if (resolved) {
          const resolvedRelative = resolved.startsWith(rootDir)
            ? resolved.slice(rootDir.length)
            : resolved;

          node.imports.push(resolvedRelative);

          edges.push({
            id: `${relativePath}->${resolvedRelative}`,
            source: relativePath,
            target: resolvedRelative,
            importType: imp.isDynamic ? 'dynamic' : 'static',
            importPath: imp.source,
          });
        }
      }
    } catch (err) {
      console.warn(`Failed to parse ${filePath}:`, err);
    }
  }

  // Add external dependency nodes if enabled
  if (opts.includeExternal) {
    for (const ext of externalDeps) {
      const node: DependencyNode = {
        id: `external:${ext}`,
        absolutePath: '',
        name: ext,
        extension: '',
        imports: [],
        importedBy: [],
        isExternal: true,
        isEntryPoint: false,
        depth: 999,
      };
      nodes.set(node.id, node);
    }
  }

  // Build importedBy relationships
  for (const edge of edges) {
    const targetNode = nodes.get(edge.target);
    if (targetNode) {
      targetNode.importedBy.push(edge.source);
    }
  }

  // Calculate entry points (files not imported by anything)
  for (const node of nodes.values()) {
    if (!node.isExternal && node.importedBy.length === 0) {
      node.isEntryPoint = true;
    }
  }

  // Calculate depths from start file or all entry points
  if (startFile) {
    const startRelative = startFile.startsWith(rootDir)
      ? startFile.slice(rootDir.length)
      : startFile;
    calculateDepths(nodes, startRelative);
  } else {
    // Calculate from all entry points
    for (const node of nodes.values()) {
      if (node.isEntryPoint) {
        calculateDepths(nodes, node.id);
      }
    }
  }

  return {
    nodes,
    edges,
    rootDir,
    scannedAt: Date.now(),
  };
}

/**
 * Calculate depths via BFS from a starting node
 */
function calculateDepths(nodes: Map<string, DependencyNode>, startId: string): void {
  const startNode = nodes.get(startId);
  if (!startNode) return;

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;

    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodes.get(id);
    if (!node) continue;

    // Only update if this path is shorter
    if (node.depth === 0 || depth < node.depth) {
      node.depth = depth;
    }

    // Queue imports
    for (const importId of node.imports) {
      if (!visited.has(importId)) {
        queue.push({ id: importId, depth: depth + 1 });
      }
    }
  }
}

/**
 * Filter graph to show only nodes within N degrees of a selected node
 */
export function filterGraphByProximity(
  graph: DependencyGraph,
  selectedId: string,
  maxDegrees: number
): DependencyGraph {
  const includedNodes = new Set<string>();
  const queue: Array<{ id: string; degree: number }> = [{ id: selectedId, degree: 0 }];

  // BFS to find nodes within maxDegrees
  while (queue.length > 0) {
    const { id, degree } = queue.shift()!;

    if (includedNodes.has(id) || degree > maxDegrees) continue;
    includedNodes.add(id);

    const node = graph.nodes.get(id);
    if (!node) continue;

    // Add imports and importedBy
    for (const importId of node.imports) {
      if (!includedNodes.has(importId)) {
        queue.push({ id: importId, degree: degree + 1 });
      }
    }
    for (const importerId of node.importedBy) {
      if (!includedNodes.has(importerId)) {
        queue.push({ id: importerId, degree: degree + 1 });
      }
    }
  }

  // Filter nodes and edges
  const filteredNodes = new Map<string, DependencyNode>();
  for (const [id, node] of graph.nodes) {
    if (includedNodes.has(id)) {
      filteredNodes.set(id, node);
    }
  }

  const filteredEdges = graph.edges.filter(
    (edge) => includedNodes.has(edge.source) && includedNodes.has(edge.target)
  );

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    rootDir: graph.rootDir,
    scannedAt: graph.scannedAt,
  };
}

/**
 * Get statistics about the graph
 */
export function getGraphStats(graph: DependencyGraph): {
  totalFiles: number;
  totalEdges: number;
  entryPoints: number;
  avgImports: number;
  maxImports: number;
  orphans: number; // Files with no imports and not imported
} {
  let entryPoints = 0;
  let totalImports = 0;
  let maxImports = 0;
  let orphans = 0;

  for (const node of graph.nodes.values()) {
    if (node.isExternal) continue;

    if (node.isEntryPoint) entryPoints++;
    totalImports += node.imports.length;
    maxImports = Math.max(maxImports, node.imports.length);

    if (node.imports.length === 0 && node.importedBy.length === 0) {
      orphans++;
    }
  }

  const internalNodes = Array.from(graph.nodes.values()).filter((n) => !n.isExternal);

  return {
    totalFiles: internalNodes.length,
    totalEdges: graph.edges.length,
    entryPoints,
    avgImports: internalNodes.length > 0 ? totalImports / internalNodes.length : 0,
    maxImports,
    orphans,
  };
}

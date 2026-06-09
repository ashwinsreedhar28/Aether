/**
 * Import Parser - Extracts imports from JS/TS files
 *
 * Uses regex-based parsing for speed (no AST required for basic import detection)
 */

import type { ImportInfo } from '../types';

// Match various import patterns
const IMPORT_PATTERNS = [
  // ES6 static imports: import X from 'Y', import { X } from 'Y', import 'Y'
  /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([@\w./-]+)['"]/g,
  // Dynamic imports: import('Y'), import("Y")
  /import\s*\(\s*['"]([@\w./-]+)['"]\s*\)/g,
  // require(): require('Y'), require("Y")
  /require\s*\(\s*['"]([@\w./-]+)['"]\s*\)/g,
  // export from: export { X } from 'Y', export * from 'Y'
  /export\s+(?:[\w*{}\s,]+\s+)?from\s+['"]([@\w./-]+)['"]/g,
];

const DYNAMIC_PATTERN = /import\s*\(/;

/**
 * Check if an import path is external (node_modules)
 */
export function isExternalImport(importPath: string): boolean {
  // Relative imports start with . or /
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return false;
  }
  // Absolute imports to node_modules
  return true;
}

/**
 * Extract all imports from file content
 */
export function extractImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const source = match[1];

      // Skip duplicates
      if (seen.has(source)) continue;
      seen.add(source);

      // Check if this specific match is dynamic
      const isDynamic = DYNAMIC_PATTERN.test(match[0]);
      const isExternal = isExternalImport(source);

      imports.push({
        source,
        resolved: null, // Will be resolved later
        isDynamic,
        isExternal,
      });
    }
  }

  return imports;
}

/**
 * Resolve a relative import path to an absolute path
 * Handles various JS/TS resolution patterns
 */
export function resolveImportPath(
  importSource: string,
  fromFile: string,
  existingFiles: Set<string>
): string | null {
  // External imports aren't resolved to files
  if (isExternalImport(importSource)) {
    return null;
  }

  // Get the directory of the importing file
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));

  // Resolve the relative path
  const resolved = resolvePath(fromDir, importSource);

  // Try various extensions and index files
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', ''];
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

  // Try direct match with extensions
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (existingFiles.has(withExt)) {
      return withExt;
    }
  }

  // Try as directory with index file
  for (const indexFile of indexFiles) {
    const withIndex = `${resolved}/${indexFile}`;
    if (existingFiles.has(withIndex)) {
      return withIndex;
    }
  }

  return null;
}

/**
 * Simple path resolution (handles . and ..)
 */
function resolvePath(base: string, relative: string): string {
  const baseParts = base.split('/').filter(Boolean);
  const relativeParts = relative.split('/').filter(Boolean);

  for (const part of relativeParts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }

  return '/' + baseParts.join('/');
}

/**
 * Get supported file extensions for scanning
 */
export function getSupportedExtensions(): string[] {
  return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
}

/**
 * Check if a file should be scanned for imports
 */
export function shouldScanFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return getSupportedExtensions().includes(ext);
}

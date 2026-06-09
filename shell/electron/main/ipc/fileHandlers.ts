import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modified: string;
  size: number;
  extension?: string;
  children?: FileNode[];
}

// Build file tree recursively
async function buildTree(
  dirPath: string,
  depth = 0,
  maxDepth = 5,
  showHidden = false
): Promise<FileNode | null> {
  if (depth > maxDepth) return null;

  const stats = await fs.stat(dirPath);
  const name = path.basename(dirPath);

  // Skip hidden files/dirs unless showHidden is true (always show .viewer)
  if (name.startsWith('.') && name !== '.viewer' && !showHidden) {
    return null;
  }

  const node: FileNode = {
    name,
    path: dirPath,
    type: stats.isDirectory() ? 'directory' : 'file',
    modified: stats.mtime.toISOString(),
    size: stats.size,
  };

  if (stats.isDirectory()) {
    try {
      const entries = await fs.readdir(dirPath);
      const children: FileNode[] = [];

      for (const entry of entries.sort()) {
        // Skip node_modules and other large directories
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
          continue;
        }

        const childPath = path.join(dirPath, entry);
        const child = await buildTree(childPath, depth + 1, maxDepth, showHidden);
        if (child) {
          children.push(child);
        }
      }

      // Sort: directories first, then files, alphabetically
      node.children = children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      console.error(`Error reading directory ${dirPath}:`, err);
      node.children = [];
    }
  } else {
    node.extension = path.extname(name).slice(1).toLowerCase();
  }

  return node;
}

// Validate that a path is within the root directory
function validatePath(filePath: string, rootDir: string): string {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootDir);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Access denied: Path is outside root directory');
  }
  return resolvedPath;
}

// Get immediate children of a directory (for lazy loading)
async function getDirectoryChildren(dirPath: string, showHidden = false): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath);
  const children: FileNode[] = [];

  for (const entry of entries.sort()) {
    // Skip node_modules and other large directories
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
      continue;
    }

    // Skip hidden files/dirs unless showHidden is true (always show .viewer)
    if (entry.startsWith('.') && entry !== '.viewer' && !showHidden) {
      continue;
    }

    const childPath = path.join(dirPath, entry);
    try {
      const stats = await fs.stat(childPath);

      const node: FileNode = {
        name: entry,
        path: childPath,
        type: stats.isDirectory() ? 'directory' : 'file',
        modified: stats.mtime.toISOString(),
        size: stats.size,
      };

      if (!stats.isDirectory()) {
        node.extension = path.extname(entry).slice(1).toLowerCase();
      }
      // Directories get children: undefined (not loaded yet)

      children.push(node);
    } catch (err) {
      // Skip files we can't access
      console.error(`Error accessing ${childPath}:`, err);
    }
  }

  // Sort: directories first, then files, alphabetically
  return children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function registerFileHandlers(getRootDir: () => string) {
  // Get file tree (initial load - only depth 1)
  ipcMain.handle('fs:getTree', async (_, options?: { showHidden?: boolean }) => {
    const rootDir = getRootDir();
    const tree = await buildTree(rootDir, 0, 1, options?.showHidden ?? false); // Only load 1 level deep
    return { tree };
  });

  // Get children of a directory (lazy loading)
  ipcMain.handle('fs:getChildren', async (_, dirPath: string, options?: { showHidden?: boolean }) => {
    const rootDir = getRootDir();
    const resolvedPath = validatePath(dirPath, rootDir);
    const children = await getDirectoryChildren(resolvedPath, options?.showHidden ?? false);
    return { children };
  });

  // Read file contents
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    const rootDir = getRootDir();
    // Keep the security check OUTSIDE the try/catch so access-denied errors are
    // never swallowed/treated as a missing file.
    const resolvedPath = validatePath(filePath, rootDir);

    try {
      const stats = await fs.stat(resolvedPath);

      // Check if it's a binary file (image, PDF, or audio)
      const ext = path.extname(resolvedPath).toLowerCase();
      const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.pdf', '.mp3', '.wav', '.ogg', '.m4a', '.flac'];

      if (binaryExts.includes(ext)) {
        // Return base64 encoded content
        const content = await fs.readFile(resolvedPath);
        const base64 = content.toString('base64');
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
          '.pdf': 'application/pdf',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.m4a': 'audio/mp4',
          '.flac': 'audio/flac',
        };
        const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
        const isImage = !audioExts.includes(ext) && ext !== '.pdf';
        return {
          path: resolvedPath,
          content: `data:${mimeTypes[ext] || 'application/octet-stream'};base64,${base64}`,
          modified: stats.mtime.toISOString(),
          isImage,
          isPdf: ext === '.pdf',
        };
      }

      const content = await fs.readFile(resolvedPath, 'utf-8');
      return {
        path: resolvedPath,
        content,
        modified: stats.mtime.toISOString(),
      };
    } catch (err) {
      // File was deleted/moved (e.g. a persisted tab still references it).
      // Degrade gracefully instead of rejecting the IPC call.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          path: resolvedPath,
          content: '',
          modified: new Date().toISOString(),
          notFound: true,
        };
      }
      throw err;
    }
  });

  // Write file contents
  ipcMain.handle(
    'fs:writeFile',
    async (_, filePath: string, content: string) => {
      const rootDir = getRootDir();
      const resolvedPath = validatePath(filePath, rootDir);
      await fs.writeFile(resolvedPath, content, 'utf-8');
      return { success: true, path: resolvedPath };
    }
  );

  // Create file or directory
  ipcMain.handle(
    'fs:createFile',
    async (_, filePath: string, type: 'file' | 'directory') => {
      const rootDir = getRootDir();
      const resolvedPath = validatePath(filePath, rootDir);

      if (type === 'directory') {
        await fs.mkdir(resolvedPath, { recursive: true });
      } else {
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, '', 'utf-8');
      }

      return { success: true, path: resolvedPath };
    }
  );

  // Delete file or directory
  ipcMain.handle('fs:deleteFile', async (_, filePath: string) => {
    const rootDir = getRootDir();
    const resolvedPath = validatePath(filePath, rootDir);

    // Prevent deleting root
    if (resolvedPath === rootDir) {
      throw new Error('Cannot delete root directory');
    }

    await fs.rm(resolvedPath, { recursive: true });
    return { success: true };
  });

  // Rename/move file or directory
  ipcMain.handle(
    'fs:rename',
    async (_, oldPath: string, newPath: string) => {
      const rootDir = getRootDir();
      const resolvedOld = validatePath(oldPath, rootDir);
      const resolvedNew = validatePath(newPath, rootDir);

      await fs.rename(resolvedOld, resolvedNew);
      return { success: true };
    }
  );
}

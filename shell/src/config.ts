// Application configuration
// Root directory is fetched from Electron main process and stored in fileSystemStore

import { useFileSystemStore } from './stores/fileSystemStore';

/**
 * Get the configured root directory from the file system store.
 * This is initialized from environment/Electron config.
 */
export function getRootDir(): string {
  return useFileSystemStore.getState().rootDir;
}

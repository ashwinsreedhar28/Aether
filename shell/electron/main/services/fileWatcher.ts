import { BrowserWindow } from 'electron';
import { subscribe, type AsyncSubscription } from '@parcel/watcher';
import * as path from 'path';

export interface FileChangeEvent {
  type: 'file-changed' | 'file-created' | 'file-deleted';
  path: string;
}

// Directories/files to ignore (filtered in event callback)
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.cache', '.npm', '.nvm',
  'Library', 'Applications', '.Trash'
]);

export class FileWatcherService {
  private subscription: AsyncSubscription | null = null;
  private mainWindow: BrowserWindow | null = null;

  async start(rootDir: string, mainWindow: BrowserWindow): Promise<void> {
    this.mainWindow = mainWindow;

    try {
      // Single recursive subscription for entire root directory
      this.subscription = await subscribe(
        rootDir,
        (err, events) => {
          if (err) {
            console.error('Watcher error:', err);
            return;
          }

          for (const event of events) {
            if (this.shouldIgnore(event.path)) continue;

            const eventType = this.mapEventType(event.type);
            this.emit(eventType, event.path);
          }
        },
        {
          ignore: [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/.cache/**',
          ]
        }
      );

      console.log(`File watcher started for: ${rootDir}`);
    } catch (err) {
      console.error('Failed to start file watcher:', err);
    }
  }

  // No-op: root subscription already covers all subdirectories
  async watchDirectory(_dirPath: string): Promise<void> {
    // @parcel/watcher is recursive by default - nothing to do
  }

  // No-op: we don't unwatch individual directories
  async unwatchDirectory(_dirPath: string): Promise<void> {
    // @parcel/watcher is recursive by default - nothing to do
  }

  private shouldIgnore(filePath: string): boolean {
    const parts = filePath.split(path.sep);
    return parts.some(part =>
      IGNORE_DIRS.has(part) ||
      (part.startsWith('.') && part !== '.viewer')
    );
  }

  private mapEventType(type: 'create' | 'update' | 'delete'): FileChangeEvent['type'] {
    switch (type) {
      case 'create': return 'file-created';
      case 'update': return 'file-changed';
      case 'delete': return 'file-deleted';
    }
  }

  private emit(type: FileChangeEvent['type'], filePath: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed() &&
        !this.mainWindow.webContents.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('fs:onChange', { type, path: filePath });
      } catch {
        // Window was destroyed during send
      }
    }
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
      console.log('File watcher stopped');
    }
  }

  async changeRoot(newRootDir: string, mainWindow: BrowserWindow): Promise<void> {
    await this.stop();
    await this.start(newRootDir, mainWindow);
  }
}

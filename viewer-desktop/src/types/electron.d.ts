// The renderer's view of `window.electron` is derived directly from the preload
// script's exposed API, so the two can never drift out of sync. The preload
// module (electron/preload/index.ts) is the single source of truth — it exports
// `export type ElectronAPI = typeof electronAPI`.
import type { ElectronAPI } from '../../electron/preload';

export interface FileChangeEvent {
  type: 'file-changed' | 'file-created' | 'file-deleted';
  path: string;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

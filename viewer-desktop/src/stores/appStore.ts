import { create } from 'zustand';
import { isKanbanFile } from '../apps/fileMatchers';
import type { AppEntry } from '../types';

// Import built-in apps (will be added later)
// For now, we'll have a simple file viewer

interface AppStore {
  apps: Map<string, AppEntry>;

  // Actions
  registerApp: (app: AppEntry) => void;
  unregisterApp: (id: string) => void;
  getAppForFile: (filePath: string) => AppEntry | null;
  getApp: (id: string) => AppEntry | undefined;
}

// Get file extension from path
function getExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export const useAppStore = create<AppStore>((set, get) => ({
  apps: new Map(),

  registerApp: (app) => {
    set((state) => {
      const newApps = new Map(state.apps);
      newApps.set(app.id, app);
      return { apps: newApps };
    });
  },

  unregisterApp: (id) => {
    set((state) => {
      const newApps = new Map(state.apps);
      newApps.delete(id);
      return { apps: newApps };
    });
  },

  getAppForFile: (filePath) => {
    const { apps } = get();
    const ext = getExtension(filePath);

    if (isKanbanFile(filePath)) {
      return apps.get('kanban-board') || null;
    }

    for (const app of apps.values()) {
      if (app.fileTypes?.includes(ext)) {
        return app;
      }
    }

    // Default to text editor for unknown types
    return apps.get('text-editor') || null;
  },

  getApp: (id) => {
    return get().apps.get(id);
  },
}));

// Initialize with built-in apps
export function initializeBuiltInApps(apps: AppEntry[]) {
  const { registerApp } = useAppStore.getState();
  apps.forEach(registerApp);
}

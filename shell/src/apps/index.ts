import type { AppDefinition } from './types';
import { isKanbanFile } from './fileMatchers';

// Auto-discover all apps using Vite's import.meta.glob
// Each app folder must have an index.ts that exports `app: AppDefinition`
const appModules = import.meta.glob<{ app: AppDefinition }>(
  './*/index.ts',
  { eager: true }
);

// Registry of all discovered apps
const appRegistry = new Map<string, AppDefinition>();

// Initialize registry from discovered modules
for (const path in appModules) {
  const module = appModules[path];
  if (module.app) {
    appRegistry.set(module.app.id, module.app);
  }
}

/**
 * Get all registered apps
 */
export function getApps(): AppDefinition[] {
  return Array.from(appRegistry.values());
}

/**
 * Get an app by ID
 */
export function getApp(id: string): AppDefinition | undefined {
  return appRegistry.get(id);
}

/**
 * Get the app that handles a given file type
 */
export function getAppForFile(filePath: string): AppDefinition | undefined {
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  // kb_*.json always opens in kanban
  if (isKanbanFile(filePath)) {
    const kanbanApp = appRegistry.get('kanban-board');
    if (kanbanApp) return kanbanApp;
  }

  // Find app that handles this extension
  for (const app of appRegistry.values()) {
    if (app.fileTypes?.includes(ext)) {
      return app;
    }
  }

  // Default to text-editor for unknown types
  return appRegistry.get('text-editor');
}

/**
 * Get file extension to app ID mapping
 */
export function getFileTypeMapping(): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const app of appRegistry.values()) {
    if (app.fileTypes) {
      for (const ext of app.fileTypes) {
        mapping[ext] = app.id;
      }
    }
  }

  return mapping;
}

// Registry change listeners — let the Dock / launcher re-render when an app is
// registered or removed at runtime (e.g. an app Aether just built, or a dev-HMR
// re-glob). Build-time glob registration runs before any listener exists, so it
// doesn't fire — only genuine runtime mutations notify.
type RegistryListener = () => void;
const registryListeners = new Set<RegistryListener>();

function notifyRegistryChange(): void {
  registryListeners.forEach((l) => l());
}

/**
 * Subscribe to runtime registry changes. Returns an unsubscribe function.
 */
export function onRegistryChange(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

/**
 * Register an app dynamically (for external / Aether-built apps)
 */
export function registerApp(app: AppDefinition): void {
  appRegistry.set(app.id, app);
  notifyRegistryChange();
}

/**
 * Unregister an app
 */
export function unregisterApp(id: string): void {
  appRegistry.delete(id);
  notifyRegistryChange();
}

// Re-export types
export type { AppDefinition, AppProps, AppContextValue } from './types';
export { AppWrapper } from './AppWrapper';
export { AppProvider, useAppContext } from './AppContext';

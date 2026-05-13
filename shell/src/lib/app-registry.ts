import type { AppDefinition } from './app-definition'

// Auto-discover apps via Vite's import.meta.glob. Each folder under
// src/apps/<name>/ must have an index.ts exporting `app: AppDefinition`.
// Pattern adopted from _ingest/VIEWER/apps/viewer/src/apps/index.ts; we
// cut VIEWER's file-routing / dynamic-register / context-provider layers
// because none of that is earned yet.
const modules = import.meta.glob<{ app: AppDefinition }>(
  '../apps/*/index.ts',
  { eager: true }
)

const registry: Record<string, AppDefinition> = {}
for (const path in modules) {
  const mod = modules[path]
  if (!mod?.app) {
    console.warn(`[app-registry] ${path} did not export an "app" — skipping`)
    continue
  }
  if (registry[mod.app.id]) {
    console.warn(
      `[app-registry] duplicate id "${mod.app.id}" at ${path} — keeping first`
    )
    continue
  }
  registry[mod.app.id] = mod.app
}

// Sorted by id for deterministic nav ordering. If an app ever needs to
// pin itself to a specific slot, an `order?: number` field on AppDefinition
// is the cheapest extension.
export function getApps(): AppDefinition[] {
  return Object.values(registry).sort((a, b) => a.id.localeCompare(b.id))
}

export function getApp(id: string): AppDefinition | undefined {
  return registry[id]
}

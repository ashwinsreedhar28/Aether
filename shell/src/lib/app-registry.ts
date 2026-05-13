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

// Nav order: by AppDefinition.order ascending (default 100 if missing),
// then by id.localeCompare as a deterministic tiebreaker. Both keys ensure
// the result is stable across rebuilds regardless of glob-resolution order.
const DEFAULT_ORDER = 100
export function getApps(): AppDefinition[] {
  return Object.values(registry).sort((a, b) => {
    const oa = a.order ?? DEFAULT_ORDER
    const ob = b.order ?? DEFAULT_ORDER
    if (oa !== ob) return oa - ob
    return a.id.localeCompare(b.id)
  })
}

export function getApp(id: string): AppDefinition | undefined {
  return registry[id]
}

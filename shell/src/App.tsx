import { useEffect } from 'react'
import { Newspaper, Sparkles, type LucideIcon } from 'lucide-react'
import { getApps, getApp } from './lib/app-registry'
import { useActiveApp } from './stores/active-app'

// Explicit icon map. Week 1 has 2 apps; an explicit map preserves
// tree-shaking versus `import * as Icons from 'lucide-react'`, which
// would pull the whole package. When we hit ~10 apps we revisit and
// likely switch to dynamic resolution.
const ICON_MAP: Record<string, LucideIcon> = {
  Newspaper,
  Sparkles
}

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Sparkles
}

export function App() {
  const apps = getApps()
  const activeAppId = useActiveApp((s) => s.activeAppId)
  const setActiveAppId = useActiveApp((s) => s.setActiveAppId)

  // Signal renderer-ready after first commit (not synchronously after
  // render()). The main process's splash → reveal sequence waits on this.
  useEffect(() => {
    window.homeOS.signalReady()
  }, [])

  // Fallback chain: explicit active id → first app in sorted registry → none.
  const active = getApp(activeAppId) ?? apps[0]
  const ActiveComponent = active?.component

  return (
    <div
      className="h-screen w-screen flex flex-col select-none"
      style={{ background: 'var(--holo-bg)' }}
    >
      <nav
        className="flex items-center gap-1 px-3 h-12 border-b shrink-0"
        style={{
          background: 'rgba(10,10,15,0.6)',
          borderColor: 'var(--holo-border)'
        }}
      >
        {apps.map((appDef) => {
          const Icon = resolveIcon(appDef.icon)
          const isActive = active?.id === appDef.id
          return (
            <button
              key={appDef.id}
              type="button"
              onClick={() => setActiveAppId(appDef.id)}
              className="holo-nav-btn flex items-center gap-2 px-3 h-8 rounded-md text-xs transition-colors"
              data-active={isActive}
              style={{
                color: isActive ? 'var(--holo-accent)' : 'var(--holo-muted)',
                background: isActive ? 'rgba(74,158,255,0.10)' : 'transparent'
              }}
            >
              <Icon size={14} />
              <span className="tracking-wide">{appDef.name}</span>
            </button>
          )
        })}
      </nav>
      <main className="flex-1 overflow-hidden">
        {ActiveComponent ? <ActiveComponent /> : null}
      </main>
    </div>
  )
}

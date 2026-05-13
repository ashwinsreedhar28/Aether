import { useEffect, useState } from 'react'
import { Cable, Newspaper, Sparkles, type LucideIcon } from 'lucide-react'
import { getApps, getApp } from './lib/app-registry'
import { useActiveApp } from './stores/active-app'

// Width of the macOS traffic-light cluster on a standard hiddenInset window.
// Padding the nav left by this much keeps buttons clear of the red/yellow/
// green system controls. Non-mac platforms don't draw the cluster, so the
// inset collapses to the prior 12px symmetric padding.
const MAC_TRAFFIC_LIGHT_INSET = 80
const NAV_HORIZONTAL_PAD = 12

// Explicit icon map. Week 1 has 3 apps; an explicit map preserves
// tree-shaking versus `import * as Icons from 'lucide-react'`, which
// would pull the whole package. When we hit ~10 apps we revisit and
// likely switch to dynamic resolution.
const ICON_MAP: Record<string, LucideIcon> = {
  Cable,
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

  // Default optimistically to 'darwin' since macOS is the primary target
  // (CLAUDE.md §11). On non-mac, this flips to the actual platform after
  // the metadata IPC resolves — brief padding flash is preferable to
  // mis-rendering the traffic-light inset on the primary target's cold
  // start.
  const [platform, setPlatform] = useState<string>('darwin')

  // Signal renderer-ready after first commit (not synchronously after
  // render()). The main process's splash → reveal sequence waits on this.
  useEffect(() => {
    window.homeOS.signalReady()
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.homeOS.getMetadata().then((m) => {
      if (!cancelled) setPlatform(m.platform)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const isMac = platform === 'darwin'
  const navPaddingLeft = isMac ? MAC_TRAFFIC_LIGHT_INSET : NAV_HORIZONTAL_PAD

  // Fallback chain: explicit active id → first app in sorted registry → none.
  const active = getApp(activeAppId) ?? apps[0]
  const ActiveComponent = active?.component

  return (
    <div
      className="h-screen w-screen flex flex-col select-none"
      style={{ background: 'var(--holo-bg)' }}
    >
      <nav
        className="flex items-center gap-1 h-12 border-b shrink-0"
        style={{
          background: 'rgba(10,10,15,0.6)',
          borderColor: 'var(--holo-border)',
          paddingLeft: navPaddingLeft,
          paddingRight: NAV_HORIZONTAL_PAD,
          // titleBarStyle: 'hiddenInset' removes the OS's draggable title bar.
          // Marking the nav strip as drag restores window dragging from the
          // top of the renderer; per-button no-drag overrides keep clicks
          // working. The 80px inset on macOS is itself a drag region so the
          // user can grab the empty strip next to the traffic lights.
          WebkitAppRegion: 'drag'
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
                background: isActive ? 'rgba(74,158,255,0.10)' : 'transparent',
                WebkitAppRegion: 'no-drag'
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

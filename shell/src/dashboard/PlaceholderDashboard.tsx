import { useEffect } from 'react'

export function PlaceholderDashboard() {
  // Signal renderer-ready after first commit (not synchronously after
  // render()). The Electron main process's splash → reveal sequence
  // waits on this. Pattern lifted from the old launcher App.tsx,
  // deleted with the content-app paradigm in Sprint 6.1.
  useEffect(() => {
    window.aether.signalReady()
  }, [])

  return (
    <div
      className="h-screen w-screen flex items-center justify-center select-none"
      style={{ background: 'var(--holo-bg)', color: 'var(--holo-muted)' }}
    >
      <div className="text-center space-y-2">
        <h1 className="text-2xl tracking-wide" style={{ color: 'var(--holo-accent)' }}>
          AETHER
        </h1>
        <p className="text-xs tracking-widest opacity-60">
          DIAGNOSTIC DASHBOARD — SPRINT 6.1 PLACEHOLDER
        </p>
        <p className="text-xs opacity-40 max-w-sm mt-4">
          Scene subscriber, CLI input, and summoned visualizations
          land across Sprint 6.2 → 6.5. This placeholder confirms
          the shell launches cleanly after the content-app archive.
        </p>
      </div>
    </div>
  )
}

import { useEffect } from 'react'

// Sprint 6.3a transport probe (DEV ONLY — removed in 6.3b). The hardcoded test
// panel exercises the renderer→main→scene-server POST path; the onSceneEvent
// subscription proves snapshots + deltas arrive over the IPC push channel.
// panel.style values are strings only — the scene server's AVP client decodes
// style as [String: String] (governance-log 2026-05-26). 6.3b's CLI inherits
// this constraint.
const testPanel = {
  id: `test-${Date.now()}`,
  kind: 'text',
  text: 'Hello from Aether shell — Sprint 6.3a transport probe',
  transform: { position: [0, 1.5, -1.3], rotation: [0, 0, 0], scale: [1, 1, 1] },
  size: { width: 0.5, height: 0.3 },
  style: { title: 'Probe' }, // string values only
}

export function PlaceholderDashboard() {
  // Signal renderer-ready after first commit (not synchronously after
  // render()). The Electron main process's splash → reveal sequence
  // waits on this. Pattern lifted from the old launcher App.tsx,
  // deleted with the content-app paradigm in Sprint 6.1.
  useEffect(() => {
    window.aether.signalReady()
  }, [])

  // Sprint 6.3a transport probe (DEV ONLY — removed in 6.3b). Logs every scene
  // event the main-process subscriber forwards. Confirms the WS → IPC push
  // path works before the real Dashboard + PanelRenderer land.
  useEffect(() => {
    const unsubscribe = window.aether.scene.onSceneEvent((ev) => {
      if (ev.type === 'snapshot') {
        console.log(`[scene-probe] snapshot: ${ev.scene.panels.length} panels`)
      } else {
        console.log(`[scene-probe] delta: seq ${ev.seq} (${ev.changes.length} changes)`)
      }
    })
    return unsubscribe
  }, [])

  // Sprint 6.3a transport probe (DEV ONLY — removed in 6.3b). POSTs a hardcoded
  // text panel through main; success shows up as a delta in the log above and
  // in `curl :5180/scene`.
  const postTestPanel = async (): Promise<void> => {
    const result = await window.aether.scene.postPanel(testPanel)
    console.log('[scene-probe] postPanel result:', result)
  }

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

      {/* Sprint 6.3a transport probe (DEV ONLY — removed in 6.3b). */}
      <button
        type="button"
        onClick={() => void postTestPanel()}
        className="fixed bottom-4 right-4 text-xs px-3 py-1.5 rounded border opacity-70 hover:opacity-100"
        style={{ borderColor: 'var(--holo-accent)', color: 'var(--holo-accent)' }}
      >
        POST test panel
      </button>
    </div>
  )
}

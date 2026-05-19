import { contextBridge, ipcRenderer } from 'electron'

// Splash-only bridge surface. Distinct from the main preload (index.ts) so the
// splash window doesn't get the full `window.aether` API for a static screen
// it has no business calling. Single channel: `splash:phase` from main,
// surfaced as `window.aetherSplash.onPhase(cb)`.

contextBridge.exposeInMainWorld('aetherSplash', {
  onPhase: (cb: (phase: { label: string; index: number; total: number }) => void) => {
    const handler = (_e: unknown, phase: { label: string; index: number; total: number }) =>
      cb(phase)
    ipcRenderer.on('splash:phase', handler)
    return () => ipcRenderer.removeListener('splash:phase', handler)
  }
})

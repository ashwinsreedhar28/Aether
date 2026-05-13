import { contextBridge, ipcRenderer } from 'electron'

// The single bridge surface for week 1. Keep it tiny — every channel here is
// part of the renderer/main contract and should be considered API.
// Pattern lifted from Pulse: typed `window.homeOS` via contextBridge, no
// direct `ipcRenderer` access in renderer components.
const api = {
  signalReady: (): void => {
    ipcRenderer.send('shell:renderer-ready')
  },
  getMetadata: (): Promise<{
    name: string
    version: string
    isDev: boolean
    bootedAt: string
  }> => ipcRenderer.invoke('shell:metadata')
}

contextBridge.exposeInMainWorld('homeOS', api)

export type HomeOSApi = typeof api

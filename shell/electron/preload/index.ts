import { contextBridge, ipcRenderer } from 'electron'

// The single bridge surface for week 1. Keep it tiny — every channel here is
// part of the renderer/main contract and should be considered API.
// Pattern lifted from Pulse: typed `window.homeOS` via contextBridge, no
// direct `ipcRenderer` access in renderer components.

export interface MeshEnvelope {
  id: string
  correlation_id: string
  from: string
  to: string
  kind: 'invocation' | 'response' | 'error'
  payload: Record<string, unknown>
  wrapped?: MeshEnvelope
  timestamp: string
  signature: string
}

export interface MeshInvokeError {
  status: number | null
  message: string
  data?: unknown
}

export interface MeshInvokeResult {
  ok: boolean
  envelope?: MeshEnvelope
  accepted?: { id: string; status: 'accepted' }
  error?: MeshInvokeError
  durationMs: number
}

export interface MeshStatus {
  coreUrl: string | null
  coreHealthy: boolean
}

interface FileFilter {
  name: string
  extensions: string[]
}

interface OpenDialogOptions {
  filters?: FileFilter[]
}

const files = {
  /**
   * Native open-file dialog. Returns the absolute path of the chosen file,
   * or null if the user cancelled. `filters` is the standard Electron
   * dialog filter shape (extensions without leading dot).
   */
  openDialog: (opts: OpenDialogOptions = {}): Promise<string | null> =>
    ipcRenderer.invoke('files:openDialog', opts),
  /**
   * UTF-8 read of an absolute path. Rejects if the path is outside the
   * allowed roots (home / userData / downloads / temp), is not a regular
   * file, or exceeds the 1 MiB cap. Errors carry descriptive messages —
   * callers should surface them.
   */
  readText: (path: string): Promise<string> =>
    ipcRenderer.invoke('files:readText', path)
}

const api = {
  signalReady: (): void => {
    ipcRenderer.send('shell:renderer-ready')
  },
  getMetadata: (): Promise<{
    name: string
    version: string
    isDev: boolean
    bootedAt: string
    /** node's process.platform — 'darwin' | 'linux' | 'win32' | ... */
    platform: string
  }> => ipcRenderer.invoke('shell:metadata'),
  mesh: {
    invoke: (
      target: string,
      payload: Record<string, unknown>,
    ): Promise<MeshInvokeResult> => ipcRenderer.invoke('mesh:invoke', target, payload),
    status: (): Promise<MeshStatus> => ipcRenderer.invoke('mesh:status'),
  },
  files
}

contextBridge.exposeInMainWorld('homeOS', api)

export type HomeOSApi = typeof api

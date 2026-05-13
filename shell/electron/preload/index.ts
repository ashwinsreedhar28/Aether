import { contextBridge, ipcRenderer } from 'electron'

// The single bridge surface for the renderer. Every channel here is part of
// the renderer/main contract and should be considered API. Pattern lifted
// from Pulse: typed `window.homeOS` via contextBridge, no direct
// `ipcRenderer` access in renderer components.

// ---- Mesh types (kept in sync with core/node_sdk_ts) ------------------------

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

export type MeshState = 'idle' | 'starting' | 'ready' | 'failed'

export interface MeshStatus {
  coreUrl: string | null
  coreHealthy: boolean
  state: MeshState
  error: string | null
}

// ---- Voice types (kept in sync with daemons/raven-daemon/src/types.ts) ------
// Duplicated rather than imported so the preload (a sandbox-loaded script)
// stays free of cross-package imports.

export type RavenStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface RavenState {
  status: RavenStatus
  pid?: number
  startedAt?: string
  error?: string
}

export interface TranscriptEntry {
  id: string
  timestamp: string
  speaker: 'user' | 'raven' | 'system'
  text: string
}

export interface ToolCallEntry {
  id: string
  timestamp: string
  toolName: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  durationMs?: number
  callId?: string
}

export type VoiceAvailability =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }

export interface VoiceStatus extends RavenState {
  lastTranscript?: TranscriptEntry
  lastToolCall?: ToolCallEntry
}

// ---- Files types ----------------------------------------------------------

interface FileFilter {
  name: string
  extensions: string[]
}

interface OpenDialogOptions {
  filters?: FileFilter[]
}

// ---- Subscribe helper -----------------------------------------------------

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// ---- Namespaces -----------------------------------------------------------

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
    ipcRenderer.invoke('files:readText', path),
}

const mesh = {
  invoke: (
    target: string,
    payload: Record<string, unknown>,
  ): Promise<MeshInvokeResult> => ipcRenderer.invoke('mesh:invoke', target, payload),
  status: (): Promise<MeshStatus> => ipcRenderer.invoke('mesh:status'),
}

// Voice namespace — proxies to daemons/raven-daemon over loopback HTTP via
// the main process. None of this is direct: the renderer never opens sockets
// itself, and the daemon never accepts non-loopback traffic.
const voice = {
  availability: (): Promise<VoiceAvailability> => ipcRenderer.invoke('voice:availability'),
  status: (): Promise<VoiceStatus> => ipcRenderer.invoke('voice:status'),
  start: (): Promise<RavenState> => ipcRenderer.invoke('voice:start'),
  stop: (): Promise<RavenState> => ipcRenderer.invoke('voice:stop'),
  recentTranscripts: (limit = 5): Promise<{ transcripts: TranscriptEntry[] }> =>
    ipcRenderer.invoke('voice:recent-transcripts', limit),
  recentToolCalls: (limit = 5): Promise<{ toolCalls: ToolCallEntry[] }> =>
    ipcRenderer.invoke('voice:recent-tool-calls', limit),
  onAvailabilityChanged: (cb: (a: VoiceAvailability) => void): Unsubscribe =>
    subscribe('voice:availability-changed', cb),
  onStatusChanged: (cb: (s: RavenState) => void): Unsubscribe =>
    subscribe('voice:status-changed', cb),
  onTranscript: (cb: (entry: TranscriptEntry) => void): Unsubscribe =>
    subscribe('voice:transcript', cb),
  onToolCall: (cb: (entry: ToolCallEntry) => void): Unsubscribe =>
    subscribe('voice:tool-call', cb),
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
  files,
  mesh,
  voice,
}

contextBridge.exposeInMainWorld('homeOS', api)

export type HomeOSApi = typeof api

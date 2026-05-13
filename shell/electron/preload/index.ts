import { contextBridge, ipcRenderer } from 'electron'

// Shape of the daemon's RavenState — kept in sync with
// daemons/raven-daemon/src/types.ts. Duplicated rather than imported so the
// preload (a sandbox-loaded script) stays free of cross-package imports.
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

type Unsubscribe = () => void

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The single bridge surface for the renderer. Pattern lifted from Pulse:
// typed window.homeOS via contextBridge, no direct ipcRenderer access in
// renderer components.
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

  // Voice namespace — proxies to daemons/raven-daemon over loopback HTTP
  // via the main process. None of this is direct: the renderer never opens
  // sockets itself, and the daemon never accepts non-loopback traffic.
  voice: {
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
  },
}

contextBridge.exposeInMainWorld('homeOS', api)

export type HomeOSApi = typeof api

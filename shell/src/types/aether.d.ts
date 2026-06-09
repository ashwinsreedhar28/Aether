// Ambient typing for the `window.aether` bridge that Aether's shell preload
// exposes (mesh + voice + spawn). The absorbed Viewer renderer talks to the
// mesh and the raven assistant through this surface; window.electron (the
// Viewer fs/terminal/control surface) is typed separately in electron.d.ts.

export type RavenStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface RavenState {
  status: RavenStatus
  pid?: number
  startedAt?: string
  error?: string
}

export interface TranscriptEntry {
  id: string
  sessionId: string
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
  sessionId?: string
  lastTranscript?: TranscriptEntry
  lastToolCall?: ToolCallEntry
}

export interface MeshInvokeResult {
  ok: boolean
  // On success the response envelope carries the surface's payload.
  envelope?: { payload: Record<string, unknown> }
  error?: { status: number | null; message: string }
  durationMs?: number
}

export interface MeshStatus {
  coreUrl: string
  coreHealthy: boolean
  state: string
  error: string | null
}

type Unsub = () => void

export interface AetherBridge {
  mesh: {
    invoke: (target: string, payload?: Record<string, unknown>) => Promise<MeshInvokeResult>
    status: () => Promise<MeshStatus>
  }
  voice: {
    availability: () => Promise<VoiceAvailability>
    status: () => Promise<VoiceStatus>
    start: () => Promise<RavenState>
    stop: () => Promise<RavenState>
    sendText: (text: string) => Promise<{ ok: true } | { error: string }>
    recentTranscripts: (limit?: number) => Promise<{ transcripts: TranscriptEntry[] }>
    getTranscripts: (opts?: { limit?: number }) => Promise<{ transcripts: TranscriptEntry[] }>
    recentToolCalls: (limit?: number) => Promise<{ toolCalls: ToolCallEntry[] }>
    onAvailabilityChanged: (cb: (a: VoiceAvailability) => void) => Unsub
    onStatusChanged: (cb: (s: RavenState) => void) => Unsub
    onTranscript: (cb: (e: TranscriptEntry) => void) => Unsub
    onToolCall: (cb: (e: ToolCallEntry) => void) => Unsub
  }
}

declare global {
  interface Window {
    aether: AetherBridge
  }
}

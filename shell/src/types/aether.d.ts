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

// ---- Spawn (the self-build loop's approval surface) ------------------------

export type SpawnStatus = 'requested' | 'spawned' | 'closed' | 'dismissed' | 'failed'

export interface SpawnView {
  id: string
  ts: string
  requestedTs: string
  /** Absent/'draft' = draft-prompt spawn; 'lane' = issue-bound lane (#268). */
  kind?: 'draft' | 'lane'
  draftName: string
  draftPath: string
  issue?: number
  issueTitle?: string
  batchId?: string
  tmuxSession?: string
  status: SpawnStatus
  worktree?: string
  branch?: string
  step?: string
  error?: string
  ragBootstrap?: 'ok' | 'failed'
  ragStep?: string
  targetBranch: string
  targetWorktree: string
  preview?: string
  cleanup?: string
}

/** A lane-* tmux session alive with no terminal attached this app lifetime. */
export interface OrphanLane {
  session: string
  issue?: number
  worktree?: string
}

/** A folded "clean, proceed" relay (#310) — voice or card PROCEED; the shell
 * types it into the lane's pane and records the outcome. */
export type RelayStatus = 'requested' | 'relayed' | 'failed'

export interface RelayRecord {
  id: string
  ts: string
  requestedTs: string
  issue: number
  text: string
  status: RelayStatus
  error?: string
}

export interface SpawnSnapshot {
  spawns: SpawnView[]
  running: string | null
  runningStep: string | null
  queue: string[]
  busy: boolean
  liveCount: number
  maxLanes: number
  tmuxAvailable: boolean
  orphans: OrphanLane[]
  relays: RelayRecord[]
}

export interface SpawnActionResult {
  ok: boolean
  error?: string
  // 'live-session' (#305): complete() refused because the record's tmux
  // session is still alive — re-call with force after an explicit warning.
  code?: 'live-session'
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
    muted: () => Promise<boolean>
    setMuted: (muted: boolean) => Promise<{ muted: boolean }>
    onMutedChanged: (cb: (muted: boolean) => void) => Unsub
    sendText: (text: string) => Promise<{ ok: true } | { error: string }>
    recentTranscripts: (limit?: number) => Promise<{ transcripts: TranscriptEntry[] }>
    getTranscripts: (opts?: { limit?: number }) => Promise<{ transcripts: TranscriptEntry[] }>
    recentToolCalls: (limit?: number) => Promise<{ toolCalls: ToolCallEntry[] }>
    onAvailabilityChanged: (cb: (a: VoiceAvailability) => void) => Unsub
    onStatusChanged: (cb: (s: RavenState) => void) => Unsub
    onTranscript: (cb: (e: TranscriptEntry) => void) => Unsub
    onToolCall: (cb: (e: ToolCallEntry) => void) => Unsub
  }
  spawn: {
    list: () => Promise<SpawnSnapshot>
    approve: (id: string) => Promise<SpawnActionResult>
    dismiss: (id: string) => Promise<SpawnActionResult>
    complete: (id: string, force?: boolean) => Promise<SpawnActionResult>
    reattach: (session: string) => Promise<SpawnActionResult>
    proceed: (issue: number) => Promise<SpawnActionResult>
    onChanged: (cb: (snap: SpawnSnapshot) => void) => Unsub
  }
  shell: {
    /** Open an http(s) URL in the default browser — never throws. */
    openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>
  }
}

declare global {
  interface Window {
    aether: AetherBridge
  }
}

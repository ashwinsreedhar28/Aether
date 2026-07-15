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

export type SpawnStatus =
  | 'requested'
  | 'spawned'
  | 'closed'
  | 'dismissed'
  | 'failed'
  | 'teardown_failed'

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

/** A lane-* tmux session alive with no terminal attached this app lifetime.
 * recordId (#318) is present ⇔ the backing ledger record is live ('spawned'),
 * so the orphan row can also complete it; terminal-record sessions never
 * appear in the list. */
export interface OrphanLane {
  session: string
  issue?: number
  worktree?: string
  recordId?: string
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

/** A folded guarded teardown (#317) — voice close_lane or the card's CLOSE
 * OUT; the shell runs the canonical cleanup block and records the outcome. */
export type TeardownStatus = 'requested' | 'done' | 'failed'
export type TeardownGuardCode = 'pr-open' | 'dirty' | 'lane-busy'

export interface TeardownRecord {
  id: string
  ts: string
  requestedTs: string
  issue: number
  force: boolean
  status: TeardownStatus
  code?: TeardownGuardCode
  step?: string
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
  teardowns: TeardownRecord[]
}

/** The lane monitor's push (#378): one background-observed gate transition,
 * with the folded gate state riding along so the card merges without a
 * re-fetch. Shapes imported from the fold's own module — one source. */
export interface GateUpdate {
  issue: number
  phase: import('../utils/laneGate').GatePhase
  prev: import('../utils/laneGate').GatePhase
  gate: import('../utils/laneGate').LaneGateState
}

export interface SpawnActionResult {
  ok: boolean
  error?: string
  // 'live-session' (#305): complete() refused because the record's tmux
  // session is still alive — re-call with force after an explicit warning.
  // 'pr-open' / 'dirty' / 'lane-busy' (#317): closeLane guard outcomes —
  // only 'dirty' is force-overridable (the warn card's CLOSE ANYWAY).
  code?: 'live-session' | TeardownGuardCode
  // revise() only (#339): true when a DIRECTOR FEEDBACK comment was posted
  // to the issue thread on this call (typed feedback) — the card names the
  // post outcome separately from the relay's RELAY row.
  posted?: boolean
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
    /** Re-probe tmux and refold the orphan list (#318) — pull-based
     * freshness on Lanes open / card open / explicit refresh. */
    refreshOrphans: () => Promise<SpawnSnapshot>
    proceed: (issue: number) => Promise<SpawnActionResult>
    /** The revision loop (#339): post `feedbackText` (when non-empty) to the
     * issue thread as a DIRECTOR FEEDBACK comment, then relay the fixed
     * revise order into the lane's pane. A failed post relays nothing. */
    revise: (issue: number, feedbackText?: string) => Promise<SpawnActionResult>
    closeLane: (issue: number, force?: boolean) => Promise<SpawnActionResult>
    onChanged: (cb: (snap: SpawnSnapshot) => void) => Unsub
    /** Monitor push (#378): a background-observed gate transition for one
     * lane. The card merges it live; REFRESH stays as the manual override. */
    onGateUpdate: (cb: (update: GateUpdate) => void) => Unsub
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

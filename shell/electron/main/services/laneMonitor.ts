// The lane gate monitor (#378) — Rung 2.5's background observer. #310 built
// the pull-based gate fold (card open + explicit REFRESH; "no background
// poller in v1" — that deferral expires here) and lane #372 then sat at its
// gate for 8 days because nothing announced it. This service makes lane state
// self-announcing: every GATE_POLL_MS it reads each open lane's issue thread
// over the same shell → github.get_issue mesh edge the card uses, folds gate
// phase with the SAME laneGate code (imported, never duplicated — the parity
// law), records each observed phase transition as a ledger `gate` line, and
// fires host notifications. Observation only — no relay, no teardown, no
// autonomous action of any kind.
//
// Last-known phase per lane is DERIVED from the ledger's gate fold — no side
// state file — so the first successful poll after a boot naturally emits the
// transitions that happened while the shell was down (the #372 scenario,
// reproduced in the tests). A failed fetch (mesh still starting, github node
// down) skips the lane: no fold, no line, nothing fabricated — the next tick
// simply tries again, which is also why start() needs no mesh-ready gate.

import { foldGateComments, gatePhase, type GatePhase, type LaneGateState } from '../../../src/utils/laneGate.ts'
// .ts extension so `node --test` can load this module (same rule as the test
// files; tsconfig sets allowImportingTsExtensions).
import { SpawnLedger, type GateLedgerState, type SpawnRecord } from './spawnLedger.ts'

export const GATE_POLL_MS = 60_000
// Single-shot age alarms (minutes; index.ts parses the AETHER_AGE_REMIND_MIN /
// AETHER_STALL_MIN env overrides): one reminder when a lane sits
// at-gate/revising this long, one when a lane is still working with no report
// this long after its spawn. Each reminder is itself a ledger gate line
// (reminder:true), so an app restart never re-fires one.
export const AGE_REMIND_MIN = 120
export const STALL_MIN = 240

// The transition copy, spec-fixed shapes ("Lane #372 at gate"). A transition
// back to 'working' (a respawn's reset, a deleted comment) is recorded in the
// ledger but never announced — there is nothing for the Director to act on.
const TRANSITION_COPY: Record<GatePhase, string | null> = {
  working: null,
  'at-gate': 'at gate',
  revising: 'revising',
  'pr-opened': 'PR opened',
}

// What the monitor pushes over the 'spawn:gate-update' IPC channel on each
// observed transition — the folded gate state rides along so the card can
// merge without its own re-fetch (REFRESH stays as the manual override).
export interface GateUpdate {
  issue: number
  phase: GatePhase
  prev: GatePhase
  gate: LaneGateState
}

// Structural slice of mesh.ts's MeshInvokeResult — kept structural so this
// module (and its node --test file) never imports the Electron-bearing mesh
// stack.
export interface MonitorInvokeResult {
  ok: boolean
  envelope?: { payload?: unknown }
}

export interface LaneMonitorConfig {
  // The shared spawn ledger path. The monitor opens its OWN SpawnLedger over
  // it — the ledger refolds from disk on every call (no in-memory cache), so
  // a second instance is coherent by construction, exactly as the Python
  // writers already are.
  ledgerPath: string
  invoke: (target: string, payload: Record<string, unknown>) => Promise<MonitorInvokeResult>
  // Host notification, fire-and-forget — index.ts wires the shell →
  // host_notifications.notify mesh edge (the node the card's #340 toast
  // uses). A down notifier must never stall the poll.
  notify: (body: string) => void
  onGateUpdate: (update: GateUpdate) => void
  intervalMs?: number
  ageRemindMin?: number
  stallMin?: number
  // Test seam for the age alarms' clock.
  now?: () => number
}

export class LaneMonitor {
  private readonly ledger: SpawnLedger
  private readonly invoke: LaneMonitorConfig['invoke']
  private readonly notify: (body: string) => void
  private readonly onGateUpdate: (update: GateUpdate) => void
  private readonly intervalMs: number
  private readonly ageRemindMin: number
  private readonly stallMin: number
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(cfg: LaneMonitorConfig) {
    this.ledger = new SpawnLedger(cfg.ledgerPath)
    this.invoke = cfg.invoke
    this.notify = cfg.notify
    this.onGateUpdate = cfg.onGateUpdate
    this.intervalMs = cfg.intervalMs ?? GATE_POLL_MS
    this.ageRemindMin = cfg.ageRemindMin ?? AGE_REMIND_MIN
    this.stallMin = cfg.stallMin ?? STALL_MIN
    this.now = cfg.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    // First pass immediately: with the mesh still starting every fetch fails
    // gracefully and the boot diff simply lands on the first successful tick.
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One poll pass — public so the tests drive it without timers. Serialized:
   * a tick still in flight (slow github reads) makes the overlapping timer
   * fire a no-op rather than a double-fetch. */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const lane of this.openLanes()) {
        try {
          await this.checkLane(lane)
        } catch (err) {
          console.error(`[laneMonitor] lane #${lane.issue} check failed:`, err)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  // Open lanes = lane records whose NEWEST arm per issue is 'spawned' (an old
  // dismissed arm must not shadow the live respawn — lane_gate_tool.py's
  // _live_lanes doctrine). Records without a parseable spawnedTs never poll:
  // the fold's newer-than-spawn guard would reject every comment anyway.
  private openLanes(): Array<SpawnRecord & { issue: number; spawnedTs: string }> {
    const newestByIssue = new Map<number, SpawnRecord>()
    // list() is newest-request-first; first-seen per issue is the newest arm.
    for (const rec of this.ledger.list()) {
      if (rec.kind !== 'lane' || typeof rec.issue !== 'number') continue
      if (!newestByIssue.has(rec.issue)) newestByIssue.set(rec.issue, rec)
    }
    const open: Array<SpawnRecord & { issue: number; spawnedTs: string }> = []
    for (const rec of newestByIssue.values()) {
      if (rec.status !== 'spawned' || typeof rec.spawnedTs !== 'string') continue
      open.push(rec as SpawnRecord & { issue: number; spawnedTs: string })
    }
    return open
  }

  private async checkLane(lane: { issue: number; spawnedTs: string }): Promise<void> {
    const res = await this.invoke('github.get_issue', { number: lane.issue })
    // Transient failure (mesh starting, node down, rate limit) — never
    // fabricate a phase from a failed read; the next tick retries.
    if (!res.ok || !res.envelope) return
    const payload = res.envelope.payload as { comments?: unknown } | undefined
    const gate = foldGateComments(payload?.comments, lane.spawnedTs)
    const phase = gatePhase(gate)
    const known = this.ledger.lastGatePhases().get(lane.issue)
    const prev = known?.phase ?? 'working'
    if (phase !== prev) {
      // Ledger first (the durable record and the dedupe), notification and
      // card push second (best-effort observers of it).
      this.ledger.writeGateTransition(lane.issue, phase, prev)
      const copy = TRANSITION_COPY[phase]
      if (copy) this.notify(`Lane #${lane.issue} ${copy}`)
      this.onGateUpdate({ issue: lane.issue, phase, prev, gate })
      return // a fresh transition starts a fresh sitting — age it next tick
    }
    this.checkAlarms(lane, phase, known)
  }

  // The single-shot age alarms. Anchors are ledger-derived: the sitting
  // anchor is the last transition LINE's ts — when the monitor first observed
  // the phase, NOT the comment's own created_at (anchoring on reportAt would
  // make a boot that announces an 8-day-old transition immediately fire the
  // reminder too — one announcement per fact). The stall anchor is the spawn
  // record's own spawnedTs.
  private checkAlarms(
    lane: { issue: number; spawnedTs: string },
    phase: GatePhase,
    known: GateLedgerState | undefined,
  ): void {
    if (phase === 'at-gate' || phase === 'revising') {
      // One reminder per sitting: the fold re-arms reminderTs on each
      // transition, so a re-gate or a revising flip may remind once more.
      if (!known?.transitionTs || known.reminderTs !== null) return
      const sinceMs = this.now() - Date.parse(known.transitionTs)
      if (!Number.isFinite(sinceMs) || sinceMs < this.ageRemindMin * 60_000) return
      this.ledger.writeGateReminder(lane.issue, phase)
      const waited = fmtMinutes(sinceMs)
      this.notify(
        `Lane #${lane.issue} still ${phase === 'at-gate' ? 'at gate' : 'revising'} — ${waited} waiting`,
      )
      return
    }
    if (phase === 'working') {
      const spawnedMs = Date.parse(lane.spawnedTs)
      if (!Number.isFinite(spawnedMs)) return
      if (this.now() - spawnedMs < this.stallMin * 60_000) return
      // Deduped against the spawn, not the sitting: any reminder line at or
      // after THIS spawn means this stall already announced (a respawn's
      // fresh spawnedTs re-arms it).
      const remindedTs = known?.reminderTs ?? null
      if (remindedTs !== null) {
        const remindedAt = Date.parse(remindedTs)
        if (Number.isFinite(remindedAt) && remindedAt >= spawnedMs) return
      }
      this.ledger.writeGateReminder(lane.issue, 'working')
      this.notify(
        `Lane #${lane.issue} stalled — working ${fmtMinutes(this.now() - spawnedMs)} with no report`,
      )
    }
  }
}

// Readable wait durations for the reminder copy: minutes under two hours,
// whole hours after.
function fmtMinutes(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m >= 120 ? `${Math.floor(m / 60)}h` : `${m}m`
}

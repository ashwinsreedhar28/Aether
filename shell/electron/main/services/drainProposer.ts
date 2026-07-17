// The drain proposer (#393) — self-staffing v0, propose-only. Aether notices
// ratified, unclaimed work and PROPOSES it; the Director's tap remains the
// only spawn trigger. On boot, every DRAIN_TICK_MIN minutes, and on lane
// close-out (a live-count drop observed via spawnService's 'changed'
// broadcast) it scans the open lane-labeled issue board for candidates —
// no live lane record in the ledger fold, no HOLD label, an ARCHITECT
// RATIFICATION comment on the thread (per-issue get_issue over the same
// shell → github edges the Gaps panel and gate card already hold) — and,
// when capacity is free, arms ONE batch through the EXISTING work_on_issue
// machinery: the ledger's request-line shapes raise the same approval card,
// the same approve/dismiss, the same recipe (#380's law: import the rail,
// never build a parallel one). A dismissed card suppresses its candidates for
// DRAIN_SUPPRESS_HOURS via a drain-family ledger line — durable, so a restart
// never re-proposes what the Director just declined.
//
// laneMonitor's doctrine throughout: state is DERIVED from the ledger fold on
// every pass (no side files), a failed fetch skips the candidate (nothing
// fabricated; the next tick retries), the ledger line lands before the
// (best-effort) notification, and ticks are serialized.

import {
  SpawnLedger,
  type DrainLaneArm,
  type SpawnRecord,
  // .ts extension so `node --test` can load this module (same rule as the test
  // files; tsconfig sets allowImportingTsExtensions).
} from './spawnLedger.ts'
// The #376 opt-in check — import, never duplicate (its regex is the parity
// anchor with raven's _SUBMODULES_RE).
import { wantsSubmodules } from './spawnService.ts'
import type { MonitorInvokeResult } from './laneMonitor.ts'

// Config knobs (index.ts parses the AETHER_DRAIN_MAX_LANES /
// AETHER_DRAIN_TICK_MIN env overrides). DRAIN_MAX_LANES deliberately equals
// the human-gated spawn cap's default (#268): the proposer never asks for more
// than the Director could approve today. Per-class caps arrive with A2 arming
// (the Director's 2026-07-16 directive), not here.
export const DRAIN_MAX_LANES = 3
export const DRAIN_TICK_MIN = 30
export const DRAIN_SUPPRESS_HOURS = 24

// Marker regexes — shape parity with raven's work_on_issue_tool.py
// (_SPEC_MARKER_RE / _BRANCH_RE / _WORKTREE_RE): anchored at a line start,
// optional === fencing, so a mid-sentence mention never counts. The
// ratification marker is the drain gate's own (#393): a spec alone is a
// record; only the Director-visible RATIFICATION comment makes a candidate.
const RATIFICATION_RE = /^\s*(?:=+\s*)?ARCHITECT RATIFICATION/m
const SPEC_MARKER_RE = /^\s*(?:=+\s*)?ARCHITECT SPEC/m
const BRANCH_RE = /^[ \t]*Branch:[ \t]*(\S+)/m
const WORKTREE_RE = /(?:^|\s)Worktree:[ \t]*(\S+)/

// Structural slices of the github node payloads (list_issues / get_issue) —
// validated field-by-field, never trusted wholesale.
interface BoardIssue {
  number: number
  title: string
  labels: string[]
  created_at: string
}

export interface DrainProposerConfig {
  // The shared spawn ledger path. The proposer opens its OWN SpawnLedger over
  // it — the ledger refolds from disk on every call, so a second instance is
  // coherent by construction (laneMonitor's rule).
  ledgerPath: string
  invoke: (target: string, payload: Record<string, unknown>) => Promise<MonitorInvokeResult>
  // Host notification, fire-and-forget — index.ts wires the shell →
  // host_notifications.notify mesh edge. A down notifier must never stall a scan.
  notify: (body: string) => void
  maxLanes?: number
  tickMin?: number
  // Test seam for the suppression window's clock.
  now?: () => number
}

export class DrainProposer {
  private readonly ledger: SpawnLedger
  private readonly invoke: DrainProposerConfig['invoke']
  private readonly notify: (body: string) => void
  private readonly maxLanes: number
  private readonly intervalMs: number
  private readonly now: () => number
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private lastLive: number

  constructor(cfg: DrainProposerConfig) {
    this.ledger = new SpawnLedger(cfg.ledgerPath)
    this.invoke = cfg.invoke
    this.notify = cfg.notify
    this.maxLanes = cfg.maxLanes ?? DRAIN_MAX_LANES
    this.intervalMs = (cfg.tickMin ?? DRAIN_TICK_MIN) * 60_000
    this.now = cfg.now ?? Date.now
    this.lastLive = this.ledger.liveCount()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    // First pass immediately: with the mesh still starting the board fetch
    // fails gracefully and the boot scan simply lands on the first good tick.
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The ledger changed under us (spawnService's 'changed' broadcast, which
   * fires on every append — ours included). Bookkeeping always runs: a batch
   * the Director just dismissed gets its suppression line without waiting a
   * tick. A live-count DROP is a lane close-out — the third scan trigger. */
  onLedgerChanged(): void {
    this.observeDismissals()
    const live = this.ledger.liveCount()
    const dropped = live < this.lastLive
    this.lastLive = live
    if (dropped) void this.tick()
  }

  /** One scan pass — public so the tests drive it without timers. Serialized:
   * an overlapping trigger (timer + close-out landing together) makes the
   * second fire a no-op rather than a double-scan (laneMonitor's rule). */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.scan()
    } catch (err) {
      console.error('[drainProposer] scan failed:', err)
    } finally {
      this.ticking = false
    }
  }

  private async scan(): Promise<void> {
    this.observeDismissals()
    // Capacity mirrors raven's _committed_count: 'requested' holds a slot too
    // (a pending card is a claim awaiting the tap), 'spawned' and
    // 'teardown_failed' hold theirs per #317 — so a proposal never arms a
    // batch the approve gate would have to refuse.
    const committed = this.ledger
      .list()
      .filter(
        (r) => r.status === 'requested' || r.status === 'spawned' || r.status === 'teardown_failed',
      ).length
    const free = this.maxLanes - committed
    if (free <= 0) return
    // ONE proposal in flight, ever (#393): while a drain card sits undecided,
    // nothing new is proposed — the Director's queue never grows on its own.
    if (this.pendingProposal()) return

    const board = await this.fetchBoard()
    if (!board) return
    const suppressed = this.suppressedIssues()
    const blocked = this.blockedIssues()
    const candidates = board
      .filter((i) => !hasHold(i.labels) && !suppressed.has(i.number) && !blocked.has(i.number))
      // The board arrives newest-first; proposals go to the OLDEST ratified
      // work — the queue that has waited longest (#393: no priority scoring
      // beyond oldest-first).
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    const picks: DrainLaneArm[] = []
    for (const cand of candidates) {
      if (picks.length >= free) break // stop at capacity — no further fetches
      const arm = await this.ratifiedArm(cand.number)
      if (arm) picks.push(arm)
    }
    if (picks.length === 0) return

    // Ledger first (the durable record: proposal + batch in one fsynced
    // write), notification second — its best-effort observer. The armed lane
    // lines wake spawnService's own file watcher, which raises the ordinary
    // approval card; no card machinery is duplicated here.
    this.ledger.armDrainProposal(picks)
    this.notify(
      `Drain proposal: capacity ${free} — spawn ${picks.map((p) => `#${p.issue}`).join(', ')}?`,
    )
  }

  // A proposal is pending while its batch still holds 'requested' records —
  // approved batches spawn (records go 'spawned'), dismissed ones go
  // 'dismissed'; both free the proposer, DERIVED entirely from the fold.
  private pendingProposal(): boolean {
    const lanes = this.laneRecords()
    return this.ledger.listDrains().some(
      (d) =>
        d.dismissedTs === null &&
        lanes.some((r) => r.batchId === d.batchId && r.status === 'requested'),
    )
  }

  /** A drain card the Director dismissed: spawnService.dismiss marks the WHOLE
   * batch, so a not-yet-dismissed proposal whose batch folded all-'dismissed'
   * gets its dismissal line here — the durable 24h suppression anchor. */
  private observeDismissals(): void {
    const lanes = this.laneRecords()
    for (const d of this.ledger.listDrains()) {
      if (d.dismissedTs !== null) continue
      const batch = lanes.filter((r) => r.batchId === d.batchId)
      if (batch.length > 0 && batch.every((r) => r.status === 'dismissed')) {
        this.ledger.markDrainDismissed(d.id)
      }
    }
  }

  private laneRecords(): SpawnRecord[] {
    return this.ledger.list().filter((r) => r.kind === 'lane')
  }

  // Issues inside a proposal dismissed within the suppression window.
  private suppressedIssues(): Set<number> {
    const out = new Set<number>()
    const cutoff = this.now() - DRAIN_SUPPRESS_HOURS * 3_600_000
    for (const d of this.ledger.listDrains()) {
      if (d.dismissedTs === null) continue
      const at = Date.parse(d.dismissedTs)
      if (Number.isFinite(at) && at >= cutoff) for (const n of d.issues) out.add(n)
    }
    return out
  }

  // Issues already claimed: any non-terminal lane record — live ('spawned',
  // 'teardown_failed') or awaiting the tap ('requested'). Terminal records
  // (closed/dismissed/failed) don't block: finished work re-opens only via a
  // fresh issue, and a dismissed DRAIN batch suppresses via its own family.
  private blockedIssues(): Set<number> {
    const out = new Set<number>()
    for (const r of this.laneRecords()) {
      if (typeof r.issue !== 'number') continue
      if (r.status === 'requested' || r.status === 'spawned' || r.status === 'teardown_failed') {
        out.add(r.issue)
      }
    }
    return out
  }

  private async fetchBoard(): Promise<BoardIssue[] | null> {
    const res = await this.invoke('github.list_issues', { labels: 'lane' })
    // Transient failure or the tokenless degraded payload — nothing to scan;
    // never fabricate candidates from a failed read.
    if (!res.ok || !res.envelope) return null
    const payload = res.envelope.payload as { issues?: unknown } | undefined
    if (!Array.isArray(payload?.issues)) return null
    const out: BoardIssue[] = []
    for (const it of payload.issues) {
      const o = it as Record<string, unknown>
      if (typeof o.number !== 'number' || !Number.isInteger(o.number) || o.number < 1) continue
      out.push({
        number: o.number,
        title: typeof o.title === 'string' ? o.title : '',
        labels: Array.isArray(o.labels) ? o.labels.filter((l): l is string => typeof l === 'string') : [],
        created_at: typeof o.created_at === 'string' ? o.created_at : '',
      })
    }
    return out
  }

  /** The per-issue gate: still open, un-HELD, and RATIFIED — a comment
   * carrying the ARCHITECT RATIFICATION marker (a spec alone is a record, not
   * a contract; ratification is the Director-visible go). Returns the
   * work_on_issue-shaped arm (targets from the LATEST spec-marked text — body
   * or comment — else the #268 defaults, ~ unexpanded; the fold expands), or
   * null to skip. A failed fetch skips the same way: the next tick retries. */
  private async ratifiedArm(issue: number): Promise<DrainLaneArm | null> {
    const res = await this.invoke('github.get_issue', { number: issue })
    if (!res.ok || !res.envelope) return null
    const p = res.envelope.payload as Record<string, unknown> | undefined
    if (!p || p.state !== 'open') return null
    const labels = Array.isArray(p.labels)
      ? p.labels.filter((l): l is string => typeof l === 'string')
      : []
    if (hasHold(labels)) return null
    const comments = Array.isArray(p.comments) ? p.comments : []
    const bodies = comments
      .map((c) => (c as Record<string, unknown> | null)?.body)
      .filter((b): b is string => typeof b === 'string')
    if (!bodies.some((b) => RATIFICATION_RE.test(b))) return null

    const texts = [typeof p.body === 'string' ? p.body : '', ...bodies].filter(Boolean)
    const marked = texts.filter((t) => SPEC_MARKER_RE.test(t))
    const spec = marked.length > 0 ? (marked[marked.length - 1] as string) : null
    let branch = `lane/issue-${issue}`
    let worktree = `~/aether-lane-${issue}`
    if (spec) {
      const bm = BRANCH_RE.exec(spec)
      if (bm?.[1]) branch = bm[1]
      const wm = WORKTREE_RE.exec(spec)
      if (wm?.[1]) worktree = wm[1]
    }
    const arm: DrainLaneArm = {
      issue,
      title: typeof p.title === 'string' ? p.title : '',
      branch,
      worktree,
    }
    if (wantsSubmodules(spec)) arm.submodules = true
    return arm
  }
}

// Case-insensitive, the a2-shadow-check parity: a HOLD in any casing holds.
function hasHold(labels: string[]): boolean {
  return labels.some((l) => l.toUpperCase() === 'HOLD')
}

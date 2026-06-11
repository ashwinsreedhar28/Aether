import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  watch,
  type FSWatcher,
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { dirname, basename, join } from 'node:path'
import {
  SpawnLedger,
  targetsForDraft,
  targetsForLane,
  cleanupBlock,
  pythonCandidates,
  pickFirstCapable,
  type SpawnRecord,
  // .ts extension so `node --test` can load this module (same rule as the
  // test files; tsconfig sets allowImportingTsExtensions).
} from './spawnLedger.ts'
import type { ControlDispatch } from './viewerControl'

const execFileAsync = promisify(execFile)

// Recipe step timeouts. pnpm install on a cold worktree (full dep tree) is the
// long pole — minutes, not seconds — so it gets a generous ceiling; the whole
// recipe runs off the IPC return so nothing blocks on it.
const STEP_TIMEOUT_MS = 15 * 60 * 1000
const TERMINAL_TIMEOUT_MS = 30 * 1000
// Delivery oracle ceiling (#300): how long a lane pane gets to leave the bare
// shell after send-keys before the recipe calls the kickoff lost and fails the
// lane by name instead of recording a ghost.
const KICKOFF_TIMEOUT_MS = 5 * 1000
const KICKOFF_POLL_MS = 250
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const WATCH_DEBOUNCE_MS = 120

// A record enriched for the renderer: the derived target branch/worktree (so the
// approval card can show them before approval) and, for an actionable 'requested'
// record, the full prompt for preview — the draft text (draft kind) or the
// canonical lane kickoff (lane kind).
export interface SpawnView extends SpawnRecord {
  targetBranch: string
  targetWorktree: string
  preview?: string
  // The copyable teardown block for a worktree we actually created (recorded
  // branch + worktree). Present on 'spawned'/'closed' records; the card's
  // Mark-complete / cleanup view surfaces it.
  cleanup?: string
}

// A still-alive lane-* tmux session with no terminal window attached in THIS
// app lifetime — the relaunch-after-quit case (#268: detachment is the point).
// The card offers a one-tap reattach for each.
export interface OrphanLane {
  session: string
  // From the ledger record whose tmux_session matches, when one exists (a
  // hand-made lane-* session reattaches against the repo root instead).
  issue?: number
  worktree?: string
}

export interface SpawnSnapshot {
  spawns: SpawnView[]
  // The id of the spawn whose recipe is in flight (between approve and the
  // spawned/failed line landing), plus the current step for the card. null when
  // idle.
  running: string | null
  runningStep: string | null
  // Records queued behind the running one inside the current approval (#268
  // ruling: a batch's recipes serialize through the single in-flight slot).
  queue: string[]
  // Gate (#268 ruling): true while a recipe is in flight OR live spawned
  // records have reached the max_lanes cap.
  busy: boolean
  // Capacity, for the card's "k of n lanes live" line and approve gating.
  liveCount: number
  maxLanes: number
  // false ⇔ tmux is not installed: lanes fall back to a plain pty (app quit
  // kills them) and the card shows the `brew install tmux` remedy.
  tmuxAvailable: boolean
  orphans: OrphanLane[]
}

export interface SpawnServiceConfig {
  // The repo whose worktrees this service spawns. Passed in (not hardcoded) so
  // the recipe is repo-agnostic; for v0 the shell registers exactly one value —
  // this repo. A future multi-repo registry would key recipes by repo name.
  repoRoot: string
  // $AETHER_DATA_DIR/spawns/requests.jsonl — the same ledger the raven
  // request_spawn tool appends to.
  ledgerPath: string
  // Lane concurrency cap (#268, spawn.max_lanes — AETHER_SPAWN_MAX_LANES in
  // .env.local). Live spawned records, both kinds, count against it.
  maxLanes?: number
  // Reaches the renderer control bridge (open-lane-terminal, apply-layout).
  // Injected like viewerNode's — absent in tests; lane spawns then skip the
  // terminal/tiling steps but tmux still owns the process.
  dispatch?: ControlDispatch
}

/**
 * The spawn actor (shell side). Watches the append-only spawn ledger; raises the
 * approval card (via the 'changed' event → IPC broadcast) when a request lands;
 * and, on the Director's approval, runs the CLAUDE.md §13.12 worktree recipe.
 * Draft-kind spawns then launch a visible Terminal.app session against the
 * draft; lane-kind spawns (#268) hand the Claude Code process to a detached
 * tmux session (`lane-<issue>`), open an Aether terminal window attached to
 * it, and tile the desktop — app quit never kills a lane, and orphaned
 * sessions get one-tap reattach offers on the next boot.
 *
 * Human-gated by construction: the voice tool only RECORDS a request; nothing
 * spawns until the Director presses Approve here. Concurrency (#268 ruling):
 * recipes serialize through the single in-flight slot; up to max_lanes spawned
 * records (both kinds) may be live at once.
 */
export class SpawnService extends EventEmitter {
  private readonly repoRoot: string
  private readonly ledgerPath: string
  private readonly ledger: SpawnLedger
  private readonly maxLanes: number
  private readonly dispatch: ControlDispatch | null
  private watcher: FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null
  // In-process gate covering the window between approve() and the spawned/failed
  // line — the ledger doesn't show 'spawned' yet, so this prevents a double-approve.
  private running: string | null = null
  private runningStep: string | null = null
  // The rest of the approved batch, drained serially behind `running`.
  private queue: SpawnRecord[] = []
  // tmux probe results, resolved once in start(). Null until probed; the
  // pty-fallback path treats "unknown" as unavailable.
  private tmuxOk = false
  // lane-* sessions alive in tmux that no terminal window of THIS app lifetime
  // is attached to. Seeded at boot; sessions drop out on spawn/reattach.
  private orphans: OrphanLane[] = []

  constructor(cfg: SpawnServiceConfig) {
    super()
    this.repoRoot = cfg.repoRoot
    this.ledgerPath = cfg.ledgerPath
    this.maxLanes = cfg.maxLanes && cfg.maxLanes >= 1 ? cfg.maxLanes : 3
    this.dispatch = cfg.dispatch ?? null
    // Ledger ctor mkdirs the spawns dir, so the watcher below can attach even
    // before the first request is written.
    this.ledger = new SpawnLedger(cfg.ledgerPath)
  }

  /** Attach the file watcher and push an initial snapshot. Idempotent-ish: a
   * second call replaces the watcher. Also probes tmux and enumerates
   * orphaned lane-* sessions (#268: lanes outlive the app; relaunch offers
   * reattach) — async, off the return; the snapshot updates when it lands. */
  start(): void {
    const dir = dirname(this.ledgerPath)
    const file = basename(this.ledgerPath)
    try {
      this.watcher = watch(dir, (_event, filename) => {
        // filename is null on some platforms; treat that as "something changed".
        if (filename === null || filename === file) this.scheduleBroadcast()
      })
    } catch (err) {
      console.error('[spawnService] watch failed:', err)
    }
    this.broadcast()
    void this.probeTmux().then(() => this.broadcast())
  }

  stop(): void {
    if (this.debounce) {
      clearTimeout(this.debounce)
      this.debounce = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  snapshot(): SpawnSnapshot {
    return {
      spawns: this.ledger.list().map((r) => this.toView(r)),
      running: this.running,
      runningStep: this.runningStep,
      queue: this.queue.map((r) => r.id),
      busy: this.isBusy(),
      liveCount: this.ledger.liveCount(),
      maxLanes: this.maxLanes,
      tmuxAvailable: this.tmuxOk,
      orphans: [...this.orphans],
    }
  }

  /** #268 ruling: busy ⇔ a recipe is in flight OR live spawned records have
   * reached the cap. Live-but-under-cap no longer blocks an approve. */
  isBusy(): boolean {
    return this.running !== null || this.ledger.liveCount() >= this.maxLanes
  }

  /**
   * Approve a requested spawn — or, for a lane record / batch id, the WHOLE
   * batch (#268 addendum: one card, single approve spawns all). Returns
   * immediately — recipes run off the return because pnpm install can take
   * minutes; progress reports through the ledger + the 'changed' broadcast.
   * A batch's recipes drain serially through the single in-flight slot; the
   * batch is refused whole when it cannot fit under max_lanes (never a
   * silent partial spawn).
   */
  async approve(id: string): Promise<{ ok: boolean; error?: string }> {
    const unit = this.resolveApprovalUnit(id)
    if (unit.length === 0) return { ok: false, error: 'unknown spawn' }
    const notRequested = unit.find((r) => r.status !== 'requested')
    if (notRequested) {
      return { ok: false, error: `spawn is ${notRequested.status}, not awaiting approval` }
    }
    if (this.running !== null) {
      return { ok: false, error: 'a spawn recipe is already running — let it finish first' }
    }
    const live = this.ledger.liveCount()
    if (live + unit.length > this.maxLanes) {
      return {
        ok: false,
        error:
          `approving ${unit.length} lane(s) would exceed the cap ` +
          `(${live} live, max ${this.maxLanes}) — mark a spawn complete first`,
      }
    }
    this.running = unit[0]?.id ?? null
    this.runningStep = 'starting'
    this.queue = unit.slice(1)
    this.broadcast()
    void this.drainApproval(unit).finally(() => {
      this.running = null
      this.runningStep = null
      this.queue = []
      this.broadcast()
    })
    return { ok: true }
  }

  // One approval = one serial drain (#268 ruling) closed by ONE apply-layout
  // tile once the last lane is live (#268 addendum 3) — the card reports
  // per-lane progress meanwhile. A mid-batch failure is recorded on ITS
  // record and the drain carries on: the Director approved every lane, so the
  // survivors still spawn; the failed card stays up for acknowledgement.
  private async drainApproval(unit: SpawnRecord[]): Promise<void> {
    let anyLive = false
    for (let i = 0; i < unit.length; i++) {
      const rec = unit[i]
      if (!rec) continue
      this.running = rec.id
      this.queue = unit.slice(i + 1)
      const tag = unit.length > 1 ? ` (${i + 1}/${unit.length})` : ''
      const ok =
        rec.kind === 'lane'
          ? await this.runLaneRecipe(rec, tag)
          : await this.runRecipe(rec).then(
              () => this.ledger.find(rec.id)?.status === 'spawned',
            )
      anyLive = anyLive || ok
    }
    if (anyLive && this.dispatch && unit.some((r) => r.kind === 'lane')) {
      try {
        await this.dispatch('apply-layout', { preset: 'tile' })
      } catch (err) {
        // Tiling is presentation; the lanes are already alive. Never fail here.
        console.warn('[spawnService] apply-layout after spawn failed:', err)
      }
    }
  }

  // The approval unit behind an id: a lane batch (every still-requested record
  // sharing the batch id — `id` may be the batch id itself or any member's
  // record id), or the single record otherwise.
  private resolveApprovalUnit(id: string): SpawnRecord[] {
    const batch = this.ledger.requestedBatch(id)
    if (batch.length > 0) return batch
    const rec = this.ledger.find(id)
    if (!rec) return []
    if (rec.kind === 'lane' && rec.batchId) {
      const siblings = this.ledger.requestedBatch(rec.batchId)
      if (siblings.length > 0) return siblings
    }
    return [rec]
  }

  /** Dismiss a requested or failed spawn (appends 'dismissed'). For a lane
   * record or batch id this dismisses the WHOLE batch — cancel spawns none
   * (#268 addendum 1). */
  dismiss(id: string): { ok: boolean; error?: string } {
    const unit = this.resolveApprovalUnit(id)
    if (unit.length === 0) return { ok: false, error: 'unknown spawn' }
    const blocked = unit.find((r) => r.status !== 'requested' && r.status !== 'failed')
    if (blocked) {
      return { ok: false, error: `cannot dismiss a ${blocked.status} spawn` }
    }
    for (const rec of unit) this.ledger.markDismissed(rec.id)
    this.broadcast()
    return { ok: true }
  }

  /** Mark a live spawn complete (appends 'closed'), releasing the concurrency
   * gate. The Director calls this once the spawned session has finished. */
  complete(id: string): { ok: boolean; error?: string } {
    const rec = this.ledger.find(id)
    if (!rec) return { ok: false, error: 'unknown spawn' }
    if (rec.status === 'spawned') {
      this.ledger.markClosed(id)
      this.broadcast()
      return { ok: true }
    }
    return { ok: false, error: `cannot mark complete a ${rec.status} spawn` }
  }

  // ---- recipe ---------------------------------------------------------------

  // The CLAUDE.md §13.12 full-stack worktree recipe, codified. Each step appends
  // {status:'failed', step, error} on failure (surfaced on the card) and stops;
  // the final step appends {status:'spawned', worktree, branch}.
  private async runRecipe(rec: SpawnRecord): Promise<void> {
    if (process.platform !== 'darwin') {
      // Terminal.app + osascript are macOS-only (matches the rest of the shell).
      this.ledger.markFailed(rec.id, 'platform', 'spawn launch is macOS-only')
      return
    }

    // The draft is the contract: its own Branch:/Worktree: lines win over a
    // re-derivation from the (possibly divergent) spoken name. Read once here —
    // the same text becomes LANE.md below, so we never read the draft twice.
    const draftText = this.readDraft(rec.draftPath)
    const { branch, worktree } = targetsForDraft(rec.draftName, draftText)
    const setStep = (s: string): void => {
      this.runningStep = s
      this.broadcast()
    }

    try {
      setStep('git fetch origin')
      await this.runShell('git fetch origin', this.repoRoot)

      setStep('git worktree add')
      await this.runShell(
        `git worktree add ${sq(worktree)} -b ${sq(branch)} origin/main`,
        this.repoRoot,
      )

      setStep('git submodule update')
      await this.runShell('git submodule update --init --recursive', worktree)

      setStep('cp .env.local')
      const envSrc = join(this.repoRoot, '.env.local')
      // A worktree is not a fresh clone — gitignored local config doesn't copy.
      // Best-effort: a missing .env.local is fine (the lane may not need it).
      if (existsSync(envSrc)) copyFileSync(envSrc, join(worktree, '.env.local'))

      setStep('pnpm install')
      await this.runShell('pnpm install', worktree)

      // RAG bootstrap — best-effort. Build the worktree's aether-rag venv and
      // index the corpus so the spawned session's /mcp is GREEN from birth
      // (the #194 evidence: rag never connected because a fresh worktree has no
      // .venv / index). A failure is recorded on the card but NEVER aborts the
      // spawn — RAG arms the session, it doesn't gate it.
      const rag = await this.bootstrapRag(worktree, setStep)

      setStep('write LANE.md')
      // The draft prompt IS the lane brief; the spawned session reads it.
      writeFileSync(join(worktree, 'LANE.md'), draftText, 'utf8')

      setStep('launch Terminal')
      await this.launchTerminal(worktree)

      this.ledger.markSpawned(rec.id, worktree, branch, rag)
      console.log(
        `[spawnService] spawned ${branch} → ${worktree} (rag: ${rag.ok ? 'ok' : `failed@${rag.step}`})`,
      )
    } catch (err) {
      const step = this.runningStep ?? 'recipe'
      const msg = err instanceof Error ? err.message : String(err)
      this.ledger.markFailed(rec.id, step, msg.slice(0, 2000))
      console.error(`[spawnService] spawn ${branch} failed at ${step}:`, msg)
    }
  }

  // ---- lane recipes (#268) ---------------------------------------------------

  // The §13.12 recipe again, then the lane choreography: a detached tmux
  // session owns the Claude Code process (app quit never kills a lane), an
  // Aether terminal window attaches to it, and the caller tiles once the
  // whole approval has drained. Returns true ⇔ the lane went live.
  private async runLaneRecipe(rec: SpawnRecord, tag: string): Promise<boolean> {
    if (process.platform !== 'darwin') {
      this.ledger.markFailed(rec.id, 'platform', 'spawn launch is macOS-only')
      return false
    }
    const issue = rec.issue ?? 0
    // Fold already sanitized these; re-deriving through targetsForLane keeps
    // one code path for the both-fields-garbled fallback.
    const { branch, worktree } = targetsForLane(issue, rec.laneBranch, rec.laneWorktree)
    const session = `lane-${issue}`
    const setStep = (s: string): void => {
      this.runningStep = `${s}${tag}`
      this.broadcast()
    }

    try {
      // Worktree hygiene per standing law (#268 pre-decision 6): never spawn
      // into an existing path — collision is a clean error naming it. Same
      // for a leftover tmux session wearing this lane's name.
      setStep('preflight')
      if (existsSync(worktree)) {
        throw new Error(`worktree path already exists: ${worktree}`)
      }
      if (this.tmuxOk && (await this.tmuxHasSession(session))) {
        throw new Error(`tmux session already exists: ${session} (lane-done it or tmux kill-session first)`)
      }

      setStep('git fetch origin')
      await this.runShell('git fetch origin', this.repoRoot)

      setStep('git worktree add')
      await this.runShell(
        `git worktree add ${sq(worktree)} -b ${sq(branch)} origin/main`,
        this.repoRoot,
      )

      setStep('git submodule update')
      await this.runShell('git submodule update --init --recursive', worktree)

      setStep('cp .env.local')
      const envSrc = join(this.repoRoot, '.env.local')
      if (existsSync(envSrc)) copyFileSync(envSrc, join(worktree, '.env.local'))

      setStep('pnpm install')
      await this.runShell('pnpm install', worktree)

      const rag = await this.bootstrapRag(worktree, setStep)

      // No LANE.md for lane kind: the contract lives on the issue, and the
      // kickoff (whose first action is `gh issue view N --comments`) is
      // delivered as the session's first prompt. Delivery is file-based
      // (#300): the kickoff used to transit three quoting layers — sq() inside
      // sq() inside `$SHELL -lic` — and arrived EMPTY, leaving a virgin pane
      // and a hung recipe. Now the content goes to a file no shell touches,
      // and the line sent to the pane is FIXED (laneSendKeys) — nothing
      // interpolated but the session name.
      setStep('write kickoff')
      writeFileSync(join(worktree, '.lane-kickoff.md'), laneKickoff(issue))
      let tmuxSession: string | undefined
      if (this.tmuxOk) {
        setStep('tmux new-session')
        // A shell under claude, not claude AS the session command: when claude
        // exits, the session survives for post-mortem instead of vanishing.
        // The FIRST new-session of a boot starts the tmux SERVER, which inherits
        // this command's stdio. execFile resolves on stream CLOSE, not child exit —
        // without the redirect the immortal server holds the pipes and the promise
        // pends forever (the run-1/run-2 field hang; the timeout can't fire because
        // the child already exited).
        await this.runShell(`tmux new-session -d -s ${sq(session)} -c ${sq(worktree)} >/dev/null 2>&1`, worktree)
        await this.runShell(laneSendKeys(session), worktree)
        // Delivery oracle: a 0-exit send-keys only proves tmux accepted the
        // keystrokes (#219's pane was virgin after one). Wait for the pane to
        // actually leave the bare shell; a throw here is a named markFailed.
        setStep('kickoff delivery')
        await this.awaitKickoffDelivery(session, worktree)
        tmuxSession = session
      }

      setStep('open terminal')
      const paneCmd = tmuxSession ? `tmux attach -t ${sq('=' + session)}` : LANE_CLAUDE_CMD
      const opened = await this.openLaneTerminal(worktree, paneCmd, `Lane #${issue}`)
      if (!opened && !tmuxSession) {
        // pty fallback (#268 pre-decision 4): the terminal pane IS the process
        // home — no window means no lane.
        throw new Error('terminal window could not be opened (and tmux is not installed)')
      }
      if (!opened && tmuxSession) {
        // The lane is alive, just detached — surface it as a reattach offer.
        this.orphans.push({ session, issue, worktree })
      }

      this.ledger.markSpawned(rec.id, worktree, branch, rag, tmuxSession)
      console.log(
        `[spawnService] spawned lane #${issue} → ${worktree}` +
          (tmuxSession ? ` (tmux ${session})` : ' (pty fallback — app quit kills it)'),
      )
      return true
    } catch (err) {
      const step = this.runningStep ?? 'lane recipe'
      const msg = err instanceof Error ? err.message : String(err)
      this.ledger.markFailed(rec.id, step, msg.slice(0, 2000))
      console.error(`[spawnService] lane #${issue} failed at ${step}:`, msg)
      return false
    }
  }

  // Open an Aether terminal window running `command` in `cwd` via the
  // renderer control bridge. Returns false instead of throwing — the caller
  // decides whether the window is load-bearing (pty fallback) or presentation
  // (tmux lanes, which stay alive detached).
  private async openLaneTerminal(
    cwd: string,
    command: string,
    title: string,
    timeoutMs: number = TERMINAL_TIMEOUT_MS,
  ): Promise<boolean> {
    if (!this.dispatch) return false
    try {
      // Raced, never bare-awaited (#300): a renderer reply that never comes
      // used to pin the recipe forever with neither spawned nor failed
      // written. A timeout degrades to false — tmux lanes take the
      // orphan/reattach path; the pty fallback turns it into a named failure
      // at the call site.
      const res = (await withTimeout(
        this.dispatch('open-lane-terminal', { cwd, command, title }),
        timeoutMs,
      )) as { ok?: boolean } | null
      return res?.ok === true
    } catch (err) {
      console.warn('[spawnService] open-lane-terminal failed:', err)
      return false
    }
  }

  // The kickoff delivery oracle (#300): poll the pane's foreground command
  // until it stops being the bare shell (claude shows up as `claude`/`node`).
  // Past the deadline, THROW — the lane is not live, and a markFailed naming
  // this step beats a ghost lane whose pane sat virgin.
  private async awaitKickoffDelivery(session: string, worktree: string): Promise<void> {
    const shellName = basename(process.env.SHELL || '/bin/zsh')
    const deadline = Date.now() + KICKOFF_TIMEOUT_MS
    for (;;) {
      const pane = (
        await this.runShellCapture(
          `tmux display -p -t ${sq('=' + session)} '#{pane_current_command}'`,
          worktree,
        )
      ).trim()
      // A login shell can report a leading dash ("-zsh") — still bare.
      if (pane !== '' && pane.replace(/^-/, '') !== shellName) return
      if (Date.now() >= deadline) {
        throw new Error(
          `kickoff sent but the pane never left the shell (still ${pane || 'empty'} after ` +
            `${KICKOFF_TIMEOUT_MS / 1000}s) — session ${session} is alive; ` +
            `\`tmux kill-session -t ${session}\` before retrying`,
        )
      }
      await new Promise((r) => setTimeout(r, KICKOFF_POLL_MS))
    }
  }

  /** One-tap reattach for an orphaned lane session (#268 pre-decision 4):
   * opens an Aether terminal window running `tmux attach` against it. */
  async reattach(session: string): Promise<{ ok: boolean; error?: string }> {
    const orphan = this.orphans.find((o) => o.session === session)
    if (!orphan) return { ok: false, error: 'unknown orphan session' }
    const cwd = orphan.worktree ?? this.repoRoot
    const title = orphan.issue ? `Lane #${orphan.issue}` : orphan.session
    const opened = await this.openLaneTerminal(cwd, `tmux attach -t ${sq('=' + session)}`, title)
    if (!opened) return { ok: false, error: 'terminal window could not be opened' }
    this.orphans = this.orphans.filter((o) => o.session !== session)
    this.broadcast()
    return { ok: true }
  }

  // ---- tmux ------------------------------------------------------------------

  // Resolve tmux availability once (login-shell PATH, same as every recipe
  // step) and seed the orphan list from surviving lane-* sessions. tmux
  // absent is a supported degraded mode: the snapshot flags it and the card
  // names the `brew install tmux` remedy.
  private async probeTmux(): Promise<void> {
    if (process.platform !== 'darwin') return
    try {
      await this.runShell('command -v tmux', this.repoRoot)
      this.tmuxOk = true
    } catch {
      this.tmuxOk = false
      console.warn(
        '[spawnService] tmux not found — lane spawns fall back to plain ptys that die with the app (remedy: brew install tmux)',
      )
      return
    }
    try {
      // `|| true`: no tmux server running is the common, healthy case.
      const out = await this.runShellCapture(
        `tmux ls -F '#{session_name}' 2>/dev/null || true`,
        this.repoRoot,
      )
      const sessions = out
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => /^lane-/.test(s))
      if (sessions.length === 0) return
      const bySession = new Map<string, SpawnRecord>()
      for (const rec of this.ledger.list()) {
        if (rec.status === 'spawned' && rec.tmuxSession) bySession.set(rec.tmuxSession, rec)
      }
      this.orphans = sessions.map((session) => {
        const rec = bySession.get(session)
        return { session, issue: rec?.issue, worktree: rec?.worktree }
      })
      console.log(`[spawnService] ${sessions.length} orphaned lane session(s): ${sessions.join(', ')}`)
    } catch (err) {
      console.warn('[spawnService] tmux session enumeration failed:', err)
    }
  }

  private async tmuxHasSession(session: string): Promise<boolean> {
    try {
      // `=` pins exact-name matching — bare -t prefix-matches, so lane-2
      // would otherwise collide with a live lane-27.
      await this.runShell(`tmux has-session -t ${sq('=' + session)} 2>/dev/null`, this.repoRoot)
      return true
    } catch {
      return false
    }
  }

  // Best-effort RAG bootstrap inside the new worktree's daemons/aether-rag:
  // pick an extension-capable interpreter, create the venv from it, install
  // requirements, and reindex the corpus. Each step is surfaced on the card via
  // setStep. NEVER throws — a stumble (no aether-rag dir on an old branch, no
  // capable python, pip failure, offline model download) returns { ok:false,
  // step } so the recipe records it and carries on; the spawn still launches.
  // Success means the spawned session inherits a warm /mcp.
  private async bootstrapRag(
    worktree: string,
    setStep: (s: string) => void,
  ): Promise<{ ok: true } | { ok: false; step: string }> {
    const ragDir = join(worktree, 'daemons', 'aether-rag')
    if (!existsSync(ragDir)) return { ok: false, step: 'rag: no aether-rag dir' }

    // Pin the interpreter: macOS system python3's sqlite3 can't load the
    // sqlite-vec extension the index needs, and a bare `python3` here resolves
    // unpredictably in a spawned environment. Probe candidates (main's working
    // venv interpreter first) for extension-capable sqlite3 and create the venv
    // from the winner — the venv inherits its creator's sqlite build.
    setStep('rag: probe python')
    const capabilityProbe =
      'import sqlite3; c=sqlite3.connect(":memory:"); c.enable_load_extension(True)'
    const isCapable = async (py: string): Promise<boolean> => {
      try {
        await this.runShell(`${sq(py)} -c ${sq(capabilityProbe)}`, ragDir)
        return true
      } catch {
        return false
      }
    }
    const py = await pickFirstCapable(pythonCandidates(this.repoRoot), isCapable)
    if (!py) return { ok: false, step: 'rag: no extension-capable python' }
    console.log(`[spawnService] rag bootstrap using interpreter ${py}`)

    const steps: Array<{ label: string; cmd: string }> = [
      { label: 'rag: create venv', cmd: `${sq(py)} -m venv .venv` },
      { label: 'rag: pip install', cmd: '.venv/bin/pip install -q -r requirements.txt' },
      { label: 'rag: reindex corpus', cmd: 'bash reindex.sh' },
    ]
    for (const { label, cmd } of steps) {
      setStep(label)
      try {
        await this.runShell(cmd, ragDir)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[spawnService] ${label} failed (best-effort):`, msg)
        return { ok: false, step: label }
      }
    }
    return { ok: true }
  }

  // Run a command through the user's login+interactive shell so the recipe sees
  // the full PATH (Homebrew shellenv, corepack pnpm shim, node) — a GUI-launched
  // Electron main otherwise gets an impoverished PATH. Mirrors
  // ravenDaemonManager.resolveBin's `$SHELL -lic` strategy. cwd is set both via
  // the spawn option and an explicit `cd` so an rc-file `cd` can't relocate us.
  private async runShell(command: string, cwd: string): Promise<void> {
    await this.runShellCapture(command, cwd)
  }

  // As runShell, but hands back stdout (the tmux session enumeration needs
  // it). runShell stays the recipe-facing name; both share one error shape.
  private async runShellCapture(command: string, cwd: string): Promise<string> {
    const userShell = process.env.SHELL || '/bin/zsh'
    const full = `cd ${sq(cwd)} && ${command}`
    try {
      const { stdout } = await execFileAsync(userShell, ['-lic', full], {
        cwd,
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: process.env,
      })
      return stdout
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string }
      const detail = (e.stderr || e.stdout || e.message || String(err)).trim()
      throw new Error(`${command} — ${detail.slice(0, 1000)}`)
    }
  }

  // Launch a VISIBLE Terminal.app window that cd's into the worktree and runs
  // Claude Code against the lane. Terminal sessions are login shells, so `claude`
  // resolves there. Closing this window is the documented kill switch.
  private async launchTerminal(worktree: string): Promise<void> {
    const shellCmd =
      `cd ${sq(worktree)} && claude --dangerously-skip-permissions ${sq('Read LANE.md and execute the lane.')}`
    const osa = `tell application "Terminal" to do script ${osaStr(shellCmd)}`
    await execFileAsync(
      'osascript',
      ['-e', osa, '-e', 'tell application "Terminal" to activate'],
      { timeout: TERMINAL_TIMEOUT_MS },
    )
  }

  // ---- views / broadcast ----------------------------------------------------

  private toView(r: SpawnRecord): SpawnView {
    // Lane records carry their own targets (sanitized at fold time) and
    // preview the exact kickoff the spawned session will receive — no draft
    // file exists for them.
    if (r.kind === 'lane') {
      const targets = targetsForLane(r.issue ?? 0, r.laneBranch, r.laneWorktree)
      const view: SpawnView = { ...r, targetBranch: targets.branch, targetWorktree: targets.worktree }
      if (r.status === 'requested') view.preview = laneKickoff(r.issue ?? 0)
      if (r.worktree && r.branch) view.cleanup = cleanupBlock(this.repoRoot, r.worktree, r.branch)
      return view
    }
    // Read the draft only for the actionable request (where the card shows the
    // preview AND the to-be targets). For settled records the recipe already
    // recorded the real branch/worktree, so re-reading a possibly-moved draft
    // buys nothing — the cheap slug derivation backstops the display fields.
    const draftText = r.status === 'requested' ? this.readDraft(r.draftPath) : null
    const { branch, worktree } = targetsForDraft(r.draftName, draftText)
    const view: SpawnView = { ...r, targetBranch: branch, targetWorktree: worktree }
    if (draftText !== null) view.preview = draftText
    // Cleanup block for a worktree we actually created (recorded branch +
    // worktree) — surfaced on the active card and the post-complete view.
    if (r.worktree && r.branch) view.cleanup = cleanupBlock(this.repoRoot, r.worktree, r.branch)
    return view
  }

  private readDraft(p: string): string {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return '(draft file not found — it may have been moved or deleted)'
    }
  }

  private scheduleBroadcast(): void {
    if (this.debounce) return
    this.debounce = setTimeout(() => {
      this.debounce = null
      this.broadcast()
    }, WATCH_DEBOUNCE_MS)
  }

  private broadcast(): void {
    this.emit('changed', this.snapshot())
  }
}

// The canonical lane kickoff (#268 pre-decision 3) — the first prompt the
// spawned implementer receives. One template, shell-side only: the issue is
// the contract (first action reads it), so the kickoff stays issue-agnostic
// boilerplate plus the number. Exported for the card preview and tests.
export function laneKickoff(issue: number): string {
  return (
    `You are the Implementer for Aether issue #${issue}. ` +
    `FIRST ACTION: gh issue view ${issue} --comments — the issue's ARCHITECT SPEC ` +
    `(body plus any ADDENDUM comments) is the contract; do not start from a spec-less issue. ` +
    `CLAUDE.md §7/§11/§13 discipline. RECON before building: read the files the spec names ` +
    `before writing anything. Stop and report options on anything the spec doesn't cover. ` +
    `When done: run the verify suite and report the gate; open the PR only on "clean, proceed," ` +
    `with the full §7 self-review body, ending Closes #${issue}.`
  )
}

// The fixed lane launch line (#300): claude reads the kickoff from
// .lane-kickoff.md in the pane's cwd, so the content never transits shell
// quoting. Must stay single-quote-free — sq() then wraps it verbatim.
// Exported for tests.
export const LANE_CLAUDE_CMD = 'claude --dangerously-skip-permissions "$(cat .lane-kickoff.md)"'

// The exact line a lane session is sent (#300). The ONLY interpolated value is
// the session name; kickoff content must never appear here — unit-tested.
export function laneSendKeys(session: string): string {
  return `tmux send-keys -t ${sq('=' + session)} ${sq(LANE_CLAUDE_CMD)} Enter`
}

// Resolve to `p`'s value, or null once `ms` elapses — the timer side never
// rejects. Guards renderer dispatches: a reply that never comes must degrade,
// not pin the recipe (#300). Exported for tests.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

// POSIX single-quote a value for safe embedding in a shell command string.
function sq(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

// Produce a double-quoted AppleScript string literal (escape backslash + quote).
function osaStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

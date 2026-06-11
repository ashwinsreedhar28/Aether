import { EventEmitter } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  watch,
  type FSWatcher,
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, basename, join } from 'node:path'
import {
  SpawnLedger,
  targetsForDraft,
  targetsForLane,
  cleanupBlock,
  pythonCandidates,
  pickFirstCapable,
  RELAY_TEXT,
  type SpawnRecord,
  type RelayRecord,
  type TeardownRecord,
  type TeardownGuardCode,
  // .ts extension so `node --test` can load this module (same rule as the
  // test files; tsconfig sets allowImportingTsExtensions).
} from './spawnLedger.ts'
import type { ControlDispatch } from './viewerControl'
// .ts extension for `node --test` loadability, same rule as spawnLedger.
import { pickBinaryLine } from './shellCapture.ts'

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
  // The backing ledger record's id, present ⇔ that record is live ('spawned')
  // — the card's orphan rows complete it in place (#318). Sessions whose
  // newest matching record is terminal never appear here at all.
  recordId?: string
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
  // Folded relay records (#310), newest first — the card shows a lane's last
  // relay outcome (relayed/failed) so a voice "proceed lane N" is observable.
  relays: RelayRecord[]
  // Folded teardown records (#317), newest first — the card shows a lane's
  // last teardown outcome (pending/done/failed) so a voice "close out lane N"
  // is observable, and the warn/refusal codes drive its CLOSE ANYWAY state.
  teardowns: TeardownRecord[]
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
  // Absolute path of the tmux binary, resolved once in probeTmux through the
  // login shell (so PATH semantics stay Homebrew-aware). Lifecycle calls run
  // it DIRECTLY — never under a capturing shell (see runTmux).
  private tmuxBin: string | null = null
  // lane-* sessions alive in tmux that no terminal window of THIS app lifetime
  // is attached to. A pull-refreshed CACHE, not a boot snapshot (#318): the
  // boot probe seeds it, refreshOrphans() re-probes on demand (Lanes open,
  // card open, explicit refresh — no background poller, the Rung 2.5
  // philosophy), and entries drop when the session dies, the backing record
  // goes terminal, or a reattach consumes them.
  private orphans: OrphanLane[] = []
  // In-flight orphan re-probe (#318) — concurrent triggers (boot probe, a
  // Lanes open racing a card summon) share one tmux ls instead of stacking.
  private orphanRefresh: Promise<void> | null = null
  // Relay ids being executed RIGHT NOW (#310) — the in-process guard between
  // a request line landing and its outcome line: the watcher fires on our own
  // appends, so without this a card PROCEED would race the drain into a
  // double send-keys.
  private readonly relayInFlight = new Set<string>()
  // Relays execute only after the boot sweep has settled crash leftovers —
  // see armRelays(). Until then the drain is a no-op.
  private relaysArmed = false
  // The teardown id executing RIGHT NOW (#317) — teardowns are exclusive:
  // they mutate the main checkout (worktree remove, submodule update), so a
  // second teardown OR a spawn recipe must never run concurrently. Approve
  // checks this; executeTeardown checks `running`.
  private teardownRunning: string | null = null
  // Teardowns execute only after the boot sweep has settled crash leftovers —
  // see armTeardowns(). Until then the drain is a no-op.
  private teardownsArmed = false

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
    void this.probeTmux().then(() => {
      this.armRelays()
      this.armTeardowns()
      this.broadcast()
    })
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
      relays: this.ledger.listRelays(),
      teardowns: this.ledger.listTeardowns(),
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
    if (this.teardownRunning !== null) {
      // Same exclusivity, mirrored (#317): a teardown mutates the main
      // checkout (worktree remove, submodule update) — never under a recipe.
      return { ok: false, error: 'a lane teardown is in flight — approve when it finishes' }
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
   * gate. The Director calls this once the spawned session has finished.
   *
   * Dismiss-semantics audit (#305, field #304): a record whose tmux session is
   * still alive is REFUSED without `force` — the lane-232 incident was a silent
   * close on a live record, which discounted capacity and left the surviving
   * session matching nothing at the next boot's orphan seed (the matcher's
   * spawned-only filter is per contract). The refusal carries
   * `code: 'live-session'` so the card can warn explicitly and re-offer the
   * same action as a deliberate COMPLETE ANYWAY; the post-close cleanup block
   * then leads with the `tmux kill-session` line. tmux-unprobeable states
   * (binary missing, pty-fallback records with no session) close as before. */
  async complete(id: string, force = false): Promise<{ ok: boolean; error?: string; code?: 'live-session' }> {
    const rec = this.ledger.find(id)
    if (!rec) return { ok: false, error: 'unknown spawn' }
    if (rec.status !== 'spawned') {
      return { ok: false, error: `cannot mark complete a ${rec.status} spawn` }
    }
    if (!force && rec.tmuxSession && this.tmuxOk && (await this.tmuxHasSession(rec.tmuxSession))) {
      return {
        ok: false,
        code: 'live-session',
        error:
          `${rec.tmuxSession} is still ALIVE in tmux — closing this record frees its capacity ` +
          `slot and stops tracking the session, but does NOT stop it (the cleanup block on the ` +
          `next card leads with tmux kill-session). Complete anyway, or finish the session first.`,
      }
    }
    this.ledger.markClosed(id)
    // The record just went terminal, so its session no longer earns an orphan
    // row (#318: terminal-record entries drop from every strip) — drop it
    // synchronously rather than waiting for the next pull-based re-probe.
    if (rec.tmuxSession) {
      this.orphans = this.orphans.filter((o) => o.session !== rec.tmuxSession)
    }
    this.broadcast()
    return { ok: true }
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
      // and the send-keys argv is FIXED (laneSendKeysArgs) — nothing varies
      // but the session name.
      setStep('write kickoff')
      writeFileSync(join(worktree, '.lane-kickoff.md'), laneKickoff(issue))
      let tmuxSession: string | undefined
      if (this.tmuxOk) {
        // new-session — the one call that may BOOT the server — goes through
        // runTmux (binary direct, stdio ignored, resolve on exit): under the
        // capturing login shell, descriptors leak into the daemonized server
        // and the promise never settles; per-fd redirects don't fix it (see
        // runTmux). Everything AFTER it runs captured execFileAsync — the
        // server is up, short-lived clients hold their own pipes, and a
        // failure carries tmux's stderr instead of a bare exit code.
        setStep('tmux new-session')
        // A shell under claude, not claude AS the session command: when claude
        // exits, the session survives for post-mortem instead of vanishing.
        await this.runTmux(['new-session', '-d', '-s', session, '-c', worktree])
        // Pane-target commands address the immutable %pane_id, never the
        // session name (run-4 matrix; see resolveLanePaneId).
        setStep('resolve pane')
        const paneId = await this.resolveLanePaneId(session)
        setStep('tmux send-keys')
        await execFileAsync(this.requireTmuxBin(), laneSendKeysArgs(paneId), {
          timeout: TERMINAL_TIMEOUT_MS,
        })
        // Delivery oracle: a 0-exit send-keys only proves tmux accepted the
        // keystrokes (#219's pane was virgin after one). Wait for the pane to
        // actually leave the bare shell; a throw here is a named markFailed.
        setStep('kickoff delivery')
        await this.awaitKickoffDelivery(session, paneId)
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
        // The lane is alive, just detached — surface it as a reattach offer
        // (recordId so the row can also complete it, #318).
        this.orphans.push({ session, issue, worktree, recordId: rec.id })
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
  private async awaitKickoffDelivery(session: string, paneId: string): Promise<void> {
    const shellName = basename(process.env.SHELL || '/bin/zsh')
    const deadline = Date.now() + KICKOFF_TIMEOUT_MS
    for (;;) {
      // Direct execFileAsync against the resolved binary — needs stdout, and
      // capture is harmless here: display -p is a short-lived CLIENT of the
      // already-running server, holding its own pipes until it exits (unlike
      // new-session; see runTmux). Pane-typed target ⇒ %pane_id (run-4
      // matrix; see resolveLanePaneId).
      const { stdout } = await execFileAsync(
        this.requireTmuxBin(),
        ['display', '-p', '-t', paneId, '#{pane_current_command}'],
        { timeout: KICKOFF_TIMEOUT_MS },
      )
      const pane = stdout.trim()
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

  // ---- gate relays (#310) ------------------------------------------------------

  /** The card's PROCEED path: record a relay request for `issue` and execute
   * it immediately. Same ledger line the voice tool writes — one path, one
   * audit trail — but the card gets the outcome back on the return. */
  async proceed(issue: number): Promise<{ ok: boolean; error?: string }> {
    if (!Number.isInteger(issue) || issue < 1) {
      return { ok: false, error: 'bad issue number' }
    }
    const rec = this.ledger.requestRelay(issue)
    return this.executeRelay(rec.id)
  }

  // The boot sweep: a relay still 'requested' at startup is a crash leftover
  // (raven runs under the shell, so nothing appends while we're down). Fail
  // it by name instead of typing into a pane minutes after the words were
  // spoken — relays execute only when their request lands while the service
  // is live. Anything else would be auto-proceed, which #310 rules out.
  private armRelays(): void {
    for (const relay of this.ledger.pendingRelays()) {
      if (this.relayInFlight.has(relay.id)) continue
      this.ledger.markRelayFailed(
        relay.id,
        'found pending at shell boot — never auto-sent; say it again or press PROCEED',
      )
    }
    this.relaysArmed = true
  }

  // Drain pending relays FIFO — invoked from the ledger watcher, so a request
  // appended by the voice tool executes within the debounce window. Serial on
  // purpose: relays are human-paced one-liners.
  private async drainRelays(): Promise<void> {
    if (!this.relaysArmed) return
    for (const relay of this.ledger.pendingRelays()) {
      if (this.relayInFlight.has(relay.id)) continue
      await this.executeRelay(relay.id)
    }
  }

  // Execute one recorded relay: enforce the v1 allowlist, resolve the newest
  // LIVE lane record for the issue, and type the fixed line into its pane via
  // the same pane-id machinery the kickoff uses. Every exit writes an outcome
  // line — relayed or failed-with-reason — so the card (and the issue's
  // operator) can always see what happened to a spoken "proceed".
  private async executeRelay(id: string): Promise<{ ok: boolean; error?: string }> {
    const relay = this.ledger.findRelay(id)
    if (!relay || relay.status !== 'requested') {
      return { ok: false, error: 'unknown or already-settled relay' }
    }
    if (this.relayInFlight.has(id)) {
      return { ok: false, error: 'relay already in flight' }
    }
    this.relayInFlight.add(id)
    const fail = (error: string): { ok: false; error: string } => {
      this.ledger.markRelayFailed(id, error)
      this.broadcast()
      return { ok: false, error }
    }
    try {
      // THE ALLOWLIST (#310): the ledger is plain JSONL — a hand-edited line
      // must not be able to type arbitrary text into a live implementer
      // session. Enforced here, on the side that owns the pane.
      if (relay.text !== RELAY_TEXT) {
        return fail(`relay text not allowlisted — v1 relays only the literal "${RELAY_TEXT}"`)
      }
      const lane = this.ledger
        .list()
        .find((r) => r.kind === 'lane' && r.issue === relay.issue && r.status === 'spawned')
      if (!lane) return fail(`no live (spawned) lane record for issue #${relay.issue}`)
      if (!lane.tmuxSession) {
        return fail(
          `lane #${relay.issue} runs on the pty fallback (no tmux session) — type into its terminal window directly`,
        )
      }
      if (!this.tmuxOk) return fail('tmux is not available — cannot reach the lane pane')
      if (!(await this.tmuxHasSession(lane.tmuxSession))) {
        return fail(`tmux session ${lane.tmuxSession} is not alive — the lane may be done or torn down`)
      }
      const paneId = await this.resolveLanePaneId(lane.tmuxSession)
      await execFileAsync(this.requireTmuxBin(), relaySendKeysArgs(paneId), {
        timeout: TERMINAL_TIMEOUT_MS,
      })
      this.ledger.markRelayed(id)
      this.broadcast()
      console.log(`[spawnService] relayed "${RELAY_TEXT}" to lane #${relay.issue} (${lane.tmuxSession})`)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return fail(msg.slice(0, 1000))
    } finally {
      this.relayInFlight.delete(id)
    }
  }

  // ---- guarded teardown (#317) -------------------------------------------------

  /** The card's CLOSE OUT path: record a teardown request for `issue` (force
   * rides only the warn card's CLOSE ANYWAY) and execute it immediately. Same
   * ledger line the close_lane voice tool writes — one path, one audit trail —
   * but the card gets the outcome (and the guard code) back on the return. */
  async closeLane(
    issue: number,
    force = false,
  ): Promise<{ ok: boolean; error?: string; code?: TeardownGuardCode }> {
    if (!Number.isInteger(issue) || issue < 1) {
      return { ok: false, error: 'bad issue number' }
    }
    const rec = this.ledger.requestTeardown(issue, force)
    return this.executeTeardown(rec.id)
  }

  // The boot sweep — armRelays' sibling: a teardown still 'requested' at
  // startup is a crash leftover. Fail it by name instead of destroying a
  // worktree minutes after the words were spoken; teardowns execute only when
  // their request lands while the service is live. Anything else would be
  // auto-closeout, which the human-gated posture rules out.
  private armTeardowns(): void {
    for (const td of this.ledger.pendingTeardowns()) {
      this.ledger.markTeardownFailed(
        td.id,
        'found pending at shell boot — never auto-executed; say it again or press CLOSE OUT',
      )
    }
    this.teardownsArmed = true
  }

  // Drain pending teardowns FIFO — invoked from the ledger watcher, so a
  // request appended by the voice tool executes within the debounce window.
  // Serial on purpose: teardowns mutate the main checkout.
  private async drainTeardowns(): Promise<void> {
    if (!this.teardownsArmed) return
    for (const td of this.ledger.pendingTeardowns()) {
      await this.executeTeardown(td.id)
    }
  }

  // Execute one recorded teardown: guards first — pr-open refuse, lane-busy
  // refuse, then the dirty/ahead warn unless forced (refusals run BEFORE the
  // warn so a CLOSE ANYWAY can never land on a subsequent hard refusal) —
  // then the canonical cleanup block's steps, shell-executed in its exact
  // order. Every exit writes a teardown outcome line; the spawn RECORD gets
  // 'closed' only after ALL steps succeed, or 'teardown_failed' naming the
  // failing step (capacity is freed only by 'closed'). Steps are
  // precondition-guarded so a retry after a partial failure resumes cleanly.
  private async executeTeardown(
    id: string,
  ): Promise<{ ok: boolean; error?: string; code?: TeardownGuardCode }> {
    const td = this.ledger.findTeardown(id)
    if (!td || td.status !== 'requested') {
      return { ok: false, error: 'unknown or already-settled teardown' }
    }
    if (this.teardownRunning !== null) {
      return { ok: false, error: 'a teardown is already in flight — let it finish first' }
    }
    this.teardownRunning = id
    const fail = (
      error: string,
      code?: TeardownGuardCode,
      step?: string,
    ): { ok: false; error: string; code?: TeardownGuardCode } => {
      this.ledger.markTeardownFailed(id, error, { code, step })
      this.broadcast()
      return { ok: false, error, code }
    }
    try {
      if (this.running !== null) {
        return fail('a spawn recipe is in flight — close out when it finishes')
      }
      // Newest live lane record for the issue: 'spawned', or 'teardown_failed'
      // (the retry path — destruction is resumable). The RECORDED worktree and
      // branch are the only targets the executor will touch (the cleanupBlock
      // law: never a re-derivation).
      const lane = this.ledger
        .list()
        .find(
          (r) =>
            r.kind === 'lane' &&
            r.issue === td.issue &&
            (r.status === 'spawned' || r.status === 'teardown_failed'),
        )
      if (!lane) return fail(`no live lane record for issue #${td.issue}`)
      const { worktree, branch } = lane
      if (!worktree || !branch) {
        return fail(
          `lane #${td.issue} recorded no worktree/branch — nothing the executor can safely destroy`,
        )
      }
      if (worktree === this.repoRoot) {
        return fail('recorded worktree IS the main checkout — refusing')
      }

      // GUARD 1 — pr-open (no force path): an open PR on the record's branch
      // means review is mid-flight; merge or close it first. Fail-closed: a
      // probe error refuses too — never destroy on unverified PR state.
      let pr: { number?: number; url?: string } | null
      try {
        pr = await this.probeOpenPr(branch)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return fail(
          `could not verify PR state for ${branch} (${msg.slice(0, 300)}) — ` +
            'refusing to close out while PR state is unknown',
        )
      }
      if (pr) {
        return fail(`PR #${pr.number ?? '?'} is open on ${branch} — merge or close it first`, 'pr-open')
      }

      // GUARD 2 — lane-busy (no force path): the pane's foreground-command
      // probe (#300's delivery oracle, inverted). A pane that has left the
      // bare shell is still running its session — killing it destroys live
      // context. Probe errors refuse fail-closed.
      let busy: string | null
      try {
        busy = await this.paneBusyCommand(lane.tmuxSession)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return fail(`could not probe lane #${td.issue}'s pane (${msg.slice(0, 300)}) — refusing`)
      }
      if (busy) {
        return fail(
          `lane #${td.issue}'s pane is still running ${busy} — let it finish (or exit the session) first`,
          'lane-busy',
        )
      }

      // GUARD 3 — dirty/ahead (the #308 warn-and-force law): uncommitted or
      // unpushed work draws the warn; only an explicit CLOSE ANYWAY (force)
      // proceeds past it. Probe errors refuse fail-closed.
      if (!td.force) {
        try {
          const dirty = await this.worktreeDirty(worktree)
          if (dirty) {
            return fail(
              `worktree has uncommitted changes (${dirty}) — CLOSE ANYWAY discards them`,
              'dirty',
            )
          }
          const unpushed = await this.branchUnpushed(branch)
          if (unpushed > 0) {
            return fail(
              `${branch} has ${unpushed} commit(s) on no remote — CLOSE ANYWAY deletes them`,
              'dirty',
            )
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return fail(`could not verify the worktree is clean (${msg.slice(0, 300)}) — refusing`)
        }
      }

      // EXECUTE — the canonical cleanup block's exact order (cleanupBlock in
      // spawnLedger.ts), each step precondition-guarded for retry idempotency.
      let step = 'tmux kill-session'
      try {
        if (lane.tmuxSession && this.tmuxOk && (await this.tmuxHasSession(lane.tmuxSession))) {
          await execFileAsync(
            this.requireTmuxBin(),
            ['kill-session', '-t', '=' + lane.tmuxSession],
            { timeout: TERMINAL_TIMEOUT_MS },
          )
        }
        step = 'rm .lane-kickoff.md'
        if (existsSync(worktree)) rmSync(join(worktree, '.lane-kickoff.md'), { force: true })
        step = 'git submodule deinit'
        if (existsSync(worktree)) await this.runShell('git submodule deinit -f --all', worktree)
        step = 'git worktree remove'
        if (existsSync(worktree)) {
          await this.runShell(`git worktree remove --force ${sq(worktree)}`, this.repoRoot)
        }
        step = 'git branch -D'
        if (await this.branchExists(branch)) {
          await this.runShell(`git branch -D ${sq(branch)}`, this.repoRoot)
        }
        // deinit is GLOBAL across worktrees sharing this .git (§13.12) — the
        // closing step restores the main checkout's submodules.
        step = 'git submodule update'
        await this.runShell('git submodule update --init --recursive', this.repoRoot)
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 2000)
        this.ledger.markRecordTeardownFailed(lane.id, step, msg)
        console.error(`[spawnService] teardown of lane #${td.issue} failed at ${step}:`, msg)
        return fail(`${step} — ${msg}`, undefined, step)
      }

      this.ledger.markClosed(lane.id)
      this.ledger.markTeardownDone(id)
      // The session is gone — a stale orphan offer for it must not survive.
      if (lane.tmuxSession) {
        this.orphans = this.orphans.filter((o) => o.session !== lane.tmuxSession)
      }
      this.broadcast()
      console.log(
        `[spawnService] closed out lane #${td.issue} — ${worktree} removed, ${branch} deleted`,
      )
      return { ok: true }
    } finally {
      this.teardownRunning = null
    }
  }

  // ---- teardown guard probes ---------------------------------------------------

  // Is a PR open with `branch` as head? Probed through the gh CLI in the main
  // checkout (login-shell PATH — the toolchain the lane itself ships with).
  // Returns the first open PR or null; THROWS on a probe failure (gh missing,
  // unauthenticated, offline) so the caller refuses fail-closed. NOTE: a
  // deliberate, ADR-flagged exception to the #310 "GitHub access lives in the
  // github node" posture — the node has no PR-by-head-branch surface and this
  // guard runs main-side at execution time (see the #317 ADR + PR notes).
  private async probeOpenPr(branch: string): Promise<{ number?: number; url?: string } | null> {
    const out = await this.runShellCapture(
      `gh pr list --head ${sq(branch)} --state open --json number,url --limit 1`,
      this.repoRoot,
    )
    // -lic capture hygiene (the pickBinaryLine lesson): rc files may write
    // banner lines, so scan for the line that parses as the JSON array gh
    // emits (compact, single-line) instead of trusting the whole capture.
    for (const line of out.split('\n').reverse()) {
      const t = line.trim()
      if (!t.startsWith('[')) continue
      try {
        const arr = JSON.parse(t) as Array<{ number?: number; url?: string }>
        return arr[0] ?? null
      } catch {
        /* keep scanning */
      }
    }
    throw new Error(`gh pr list returned no JSON (got ${JSON.stringify(out.slice(0, 200))})`)
  }

  // The lane-busy probe: the pane's foreground command, or null when idle.
  // tmux-unprobeable states (no recorded session, binary missing, session
  // already dead) read as idle — there is no live process a kill-session
  // could destroy in any of them.
  private async paneBusyCommand(session: string | undefined): Promise<string | null> {
    if (!session || !this.tmuxOk) return null
    if (!(await this.tmuxHasSession(session))) return null
    const paneId = await this.resolveLanePaneId(session)
    const { stdout } = await execFileAsync(
      this.requireTmuxBin(),
      ['display', '-p', '-t', paneId, '#{pane_current_command}'],
      { timeout: TERMINAL_TIMEOUT_MS },
    )
    const pane = stdout.trim()
    // A login shell can report a leading dash ("-zsh") — still bare (the same
    // normalization as awaitKickoffDelivery).
    const shellName = basename(process.env.SHELL || '/bin/zsh')
    if (pane === '' || pane.replace(/^-/, '') === shellName) return null
    return pane
  }

  // First real dirty line of `git status --porcelain`, or null for a clean
  // (or already-removed) worktree. The recipe's own kickoff file is excluded:
  // .lane-kickoff.md sits untracked in EVERY lane worktree, so counting it
  // would draw the warn card on every closeout.
  private async worktreeDirty(worktree: string): Promise<string | null> {
    if (!existsSync(worktree)) return null
    const out = await this.runShellCapture('git status --porcelain', worktree)
    for (const line of out.split('\n')) {
      // Porcelain shape: two status chars + space + path (-lic banner hygiene:
      // anything else in the capture is not a status line).
      if (!/^[ MTADRCU?!]{2} /.test(line)) continue
      const path = line.slice(3).trim()
      if (path === '.lane-kickoff.md') continue
      return line.trim()
    }
    return null
  }

  // Commits reachable from `branch` but from NO remote ref — covers both a
  // never-pushed branch and one ahead of its pushed counterpart (a normal
  // shipped lane was pushed for its PR, so its tip is on origin and counts 0).
  // A branch already deleted (the retry path) counts 0 too.
  private async branchUnpushed(branch: string): Promise<number> {
    if (!(await this.branchExists(branch))) return 0
    const out = await this.runShellCapture(
      `git rev-list --count ${sq(branch)} --not --remotes`,
      this.repoRoot,
    )
    // -lic banner hygiene: the count is the last purely numeric line.
    for (const line of out.split('\n').reverse()) {
      const t = line.trim()
      if (/^\d+$/.test(t)) return parseInt(t, 10)
    }
    return 0
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.runShell(
        `git show-ref --verify --quiet ${sq('refs/heads/' + branch)}`,
        this.repoRoot,
      )
      return true
    } catch {
      return false
    }
  }

  // ---- tmux ------------------------------------------------------------------

  // Resolve the tmux BINARY once through the login shell (Homebrew shellenv
  // PATH, same semantics as every recipe step) and seed the orphan list from
  // surviving lane-* sessions. The path is kept on the instance so every
  // lifecycle call can run it directly, shell-free (see runTmux). tmux absent
  // is a supported degraded mode: the snapshot flags it and the card names
  // the `brew install tmux` remedy.
  private async probeTmux(): Promise<void> {
    if (process.platform !== 'darwin') return
    try {
      const captured = await this.runShellCapture('command -v tmux', this.repoRoot)
      // Never trim()-trust a -lic capture: rc files write arbitrary lines to
      // stdout — Apple Terminal's restored-session banner rode ABOVE the
      // path on some boots and poisoned tmuxBin (defect 6; verbatim fixture
      // and the extraction law live in shellCapture.ts). Extract the path
      // line, then let the filesystem confirm it.
      const bin = pickBinaryLine(captured)
      if (!bin || !existsSync(bin)) {
        this.tmuxOk = false
        console.warn(
          '[spawnService] tmux probe captured no usable binary path — lane spawns fall back to ' +
            'plain ptys that die with the app (remedy: brew install tmux). ' +
            `Captured output: ${JSON.stringify(captured)}`,
        )
        return
      }
      this.tmuxBin = bin
      this.tmuxOk = true
    } catch {
      this.tmuxOk = false
      console.warn(
        '[spawnService] tmux not found — lane spawns fall back to plain ptys that die with the app (remedy: brew install tmux)',
      )
      return
    }
    // Seed the cache through the same pull-based fold every later re-probe
    // runs (#318: the boot seed is the first refresh, not a one-shot snapshot).
    await this.refreshOrphans()
    if (this.orphans.length > 0) {
      console.log(
        `[spawnService] ${this.orphans.length} orphaned lane session(s): ` +
          this.orphans.map((o) => o.session).join(', '),
      )
    }
  }

  /** Pull-based orphan freshness (#318). Re-probe tmux for surviving lane-*
   * sessions and refold against the ledger — entries whose session is dead or
   * whose newest matching record is terminal drop from every strip. Broadcasts
   * only when the list changed; returns the (now-fresh) snapshot so the
   * renderer triggers (Lanes open, card open, explicit refresh) get truth on
   * the return. No background poller by spec; concurrent calls share one probe. */
  async refreshOrphans(): Promise<SpawnSnapshot> {
    this.orphanRefresh ??= this.refoldOrphans().finally(() => {
      this.orphanRefresh = null
    })
    await this.orphanRefresh
    return this.snapshot()
  }

  // The probe + fold behind refreshOrphans. A failed enumeration KEEPS the
  // cache — a flaky probe must not blank real reattach offers; "no server
  // running" is an empty enumeration (zero sessions), not a failure.
  private async refoldOrphans(): Promise<void> {
    let sessions: string[] = []
    if (this.tmuxOk) {
      try {
        sessions = await this.listDetachedLaneSessions()
      } catch (err) {
        console.warn('[spawnService] tmux session enumeration failed:', err)
        return
      }
    }
    const next = this.foldOrphans(sessions)
    if (JSON.stringify(next) === JSON.stringify(this.orphans)) return
    this.orphans = next
    this.broadcast()
  }

  // Surviving DETACHED lane-* session names — attachment read from tmux
  // itself (#{session_attached}), never from optimistic shell bookkeeping: a
  // session reattached this lifetime (or spawned with its terminal still
  // open) reports attached ≥ 1 and stays off the orphan list across
  // re-probes. Throws on a real enumeration failure; "no server running"
  // (tmux's healthy idle state) is just zero sessions.
  private async listDetachedLaneSessions(): Promise<string[]> {
    try {
      // Direct client call — needs stdout, harmless pipes (the client exits;
      // see runTmux for why lifecycle calls can't do this).
      const { stdout } = await execFileAsync(
        this.requireTmuxBin(),
        ['ls', '-F', '#{session_attached} #{session_name}'],
        { timeout: TERMINAL_TIMEOUT_MS },
      )
      const out: string[] = []
      for (const line of stdout.split('\n')) {
        const m = /^(\d+) (lane-\S+)$/.exec(line.trim())
        if (m && m[1] === '0' && m[2]) out.push(m[2])
      }
      return out
    } catch (err) {
      // No server running is the common, healthy case: tmux exits nonzero
      // with "no server running on …" (older builds: "error connecting to …").
      const stderr = (err as { stderr?: string }).stderr ?? ''
      if (/no server running|error connecting/i.test(stderr)) return []
      throw err
    }
  }

  // Fold detached sessions against the ledger (#318). The newest record
  // claiming a session wins (list() is newest-first; session names recur
  // across a lane's retries): a live ('spawned') record → an actionable row
  // carrying its id; a terminal record (closed/dismissed/failed) → the lane's
  // lifecycle is over, NO row — its cleanup block owns the teardown; no
  // record at all → a hand-made session, reattach-only row. The in-flight
  // recipe's own session is skipped: between new-session and its terminal
  // attaching it is detached-by-construction, not orphaned.
  private foldOrphans(sessions: string[]): OrphanLane[] {
    const running = this.running ? this.ledger.find(this.running) : undefined
    const runningSession = running?.issue != null ? `lane-${running.issue}` : null
    const bySession = new Map<string, SpawnRecord>()
    for (const rec of this.ledger.list()) {
      if (rec.tmuxSession && !bySession.has(rec.tmuxSession)) bySession.set(rec.tmuxSession, rec)
    }
    const out: OrphanLane[] = []
    for (const session of sessions) {
      if (session === runningSession) continue
      const rec = bySession.get(session)
      if (!rec) {
        out.push({ session })
      } else if (rec.status === 'spawned') {
        out.push({ session, issue: rec.issue, worktree: rec.worktree, recordId: rec.id })
      } else if (rec.status === 'teardown_failed') {
        // Not terminal (#317: holds capacity, retryable) — a session alive
        // past a failed kill-session step stays reattachable for post-mortem,
        // but its closeout is the card's CLOSE OUT retry, never COMPLETE
        // (complete() refuses non-'spawned' records), so no recordId.
        out.push({ session, issue: rec.issue, worktree: rec.worktree })
      }
    }
    return out
  }

  // Resolve the lane's pane to its immutable %pane_id, once, right after
  // new-session. Run-4 field matrix (#302): send-keys against `-t =lane-232`
  // failed with the verbatim error `can't find pane: =lane-232` (reproduced
  // manually), while `display -p` and `list-panes` ACCEPTED the same
  // =-target, and send-keys against the bare name or the %pane_id both exit
  // 0 — '=' exact-match is parsed per command and is session-typed only.
  // Rule going forward, rather than litigating =-semantics per command:
  // pane-target commands (send-keys, display -p) address #{pane_id}; '='
  // stays only on session-typed targets (has-session, attach, kill-session);
  // pipes are forbidden only across a server boot (new-session — see
  // runTmux).
  private async resolveLanePaneId(session: string): Promise<string> {
    const { stdout } = await execFileAsync(
      this.requireTmuxBin(),
      ['list-panes', '-s', '-t', '=' + session, '-F', '#{pane_id}'],
      { timeout: TERMINAL_TIMEOUT_MS },
    )
    return parsePaneId(stdout, session)
  }

  private async tmuxHasSession(session: string): Promise<boolean> {
    try {
      // `=` pins exact-name matching — bare -t prefix-matches, so lane-2
      // would otherwise collide with a live lane-27. Session-typed target,
      // where '=' is proven working (run-4 matrix; see resolveLanePaneId).
      // Captured execFileAsync, not runTmux: has-session never boots a
      // server (no server ⇒ fast nonzero exit), so pipes are harmless.
      await execFileAsync(this.requireTmuxBin(), ['has-session', '-t', '=' + session], {
        timeout: TERMINAL_TIMEOUT_MS,
      })
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

  // Run new-session — and ONLY new-session — as the resolved binary directly:
  // argv array, no shell, stdio fully ignored, resolution on EXIT code, never
  // on streams. Why (run-2/run-3 field probes on #302): the first new-session
  // of a boot daemonizes the immortal tmux SERVER, and the capturing
  // `$SHELL -lic` wrapper holds duplicate descriptors of Node's pipes above
  // fd 2 that the server inherits — so execFile, which resolves on stream
  // CLOSE rather than child exit, pends forever. Per-fd redirects are
  // unwinnable in principle: `>/dev/null 2>&1` left the promise pending;
  // adding `</dev/null` still left it pending. The fix removes both the shell
  // and the pipes. The no-pipes law is boot-scoped: every other tmux call
  // talks to the already-running server through captured execFileAsync —
  // stdio:'ignore' here costs the stderr (run 4's send-keys failure arrived
  // as a bare exit code), a price only the boot call has to pay.
  private async runTmux(args: string[]): Promise<void> {
    const bin = this.requireTmuxBin()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: 'ignore' })
      child.once('error', (err) => {
        reject(new Error(`tmux ${args.join(' ')} — ${err.message}`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) resolve()
        else {
          reject(
            new Error(
              `tmux ${args.join(' ')} — exited ${code === null ? `on signal ${signal}` : `with code ${code}`}`,
            ),
          )
        }
      })
    })
  }

  private requireTmuxBin(): string {
    if (!this.tmuxBin) {
      throw new Error('tmux binary not resolved — probeTmux must succeed before lifecycle calls')
    }
    return this.tmuxBin
  }

  // Run a command through the user's login+interactive shell so the recipe sees
  // the full PATH (Homebrew shellenv, corepack pnpm shim, node) — a GUI-launched
  // Electron main otherwise gets an impoverished PATH. Mirrors
  // ravenDaemonManager.resolveBin's `$SHELL -lic` strategy. cwd is set both via
  // the spawn option and an explicit `cd` so an rc-file `cd` can't relocate us.
  // NEVER route tmux lifecycle commands through here — see runTmux.
  private async runShell(command: string, cwd: string): Promise<void> {
    await this.runShellCapture(command, cwd)
  }

  // As runShell, but hands back stdout (the tmux binary probe needs it).
  // runShell stays the recipe-facing name; both share one error shape.
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
      if (r.worktree && r.branch) {
        view.cleanup = cleanupBlock(this.repoRoot, r.worktree, r.branch, r.tmuxSession)
      }
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
    if (r.worktree && r.branch) {
      view.cleanup = cleanupBlock(this.repoRoot, r.worktree, r.branch, r.tmuxSession)
    }
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
      // The watcher is also the relay (#310) and teardown (#317) trigger: a
      // request line appended by the voice tool executes here, off the
      // broadcast tick. Off the return — the snapshot push must not wait on
      // tmux or git.
      void this.drainRelays()
      void this.drainTeardowns()
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
// boilerplate plus the number. Rung 2.5 (#310): the gate report and the PR
// link are POSTED TO THE ISSUE THREAD with fixed prefixes — the thread is the
// machine-readable lane channel the card's AT GATE / PR OPENED states fold
// (prefix literals kept in sync with shell/src/utils/laneGate.ts; both sides
// pin them in tests). Exported for the card preview and tests.
export function laneKickoff(issue: number): string {
  return (
    `You are the Implementer for Aether issue #${issue}. ` +
    `FIRST ACTION: gh issue view ${issue} --comments — the issue's ARCHITECT SPEC ` +
    `(body plus any ADDENDUM comments) is the contract; do not start from a spec-less issue. ` +
    `CLAUDE.md §7/§11/§13 discipline. RECON before building: read the files the spec names ` +
    `before writing anything. Stop and report options on anything the spec doesn't cover. ` +
    `Changelog/ADR law (§8): record your entry as changelog/unreleased/${issue}-<slug>.md and ` +
    `any decision as a new decisions/<date>-<slug>.md (+ regenerated index) — NEVER edit ` +
    `CHANGELOG.md or DECISIONS.md; both are generated. ` +
    `When done: run the verify suite, then post the FULL gate report as a comment on issue ` +
    `#${issue}, prefixed exactly "GATE REPORT — " (gh issue comment ${issue} --body-file <file>), ` +
    `and stop at the gate. Open the PR only on "clean, proceed," with the full §7 self-review ` +
    `body, ending Closes #${issue}; the moment the PR is open, comment ` +
    `"PR OPENED — #<pr-number> <pr-url>" on issue #${issue}.`
  )
}

// The fixed lane launch line (#300): claude reads the kickoff from
// .lane-kickoff.md in the pane's cwd, so the content never transits shell
// quoting. Reaches the pane as ONE raw send-keys argv element (below) — tmux
// types it literally and the pane's shell expands the $(cat). Also the
// pty-fallback command. Exported for tests.
export const LANE_CLAUDE_CMD = 'claude --dangerously-skip-permissions "$(cat .lane-kickoff.md)"'

// The exact send-keys argv for a lane pane — an args array handed straight
// to the tmux binary, zero shell and zero quoting layers between here and
// the pane. Targets the immutable %pane_id, not the session name: run-4
// proved send-keys refuses '='-targets that display -p and list-panes accept
// (see resolveLanePaneId). The ONLY varying element is the pane id; kickoff
// content must never appear here — unit-tested. Exported for tests.
export function laneSendKeysArgs(paneId: string): string[] {
  return ['send-keys', '-t', paneId, LANE_CLAUDE_CMD, 'Enter']
}

// The exact send-keys argv for a gate relay (#310) — same no-quoting law as
// laneSendKeysArgs: handed straight to the tmux binary, the pane id is the
// ONLY varying element, and the typed line is the RELAY_TEXT allowlist
// literal. This function taking no text parameter IS the v1 scope fence —
// arbitrary relay text has no code path to the pane. Exported for tests.
export function relaySendKeysArgs(paneId: string): string[] {
  return ['send-keys', '-t', paneId, RELAY_TEXT, 'Enter']
}

// First line of `list-panes -F '#{pane_id}'` output, validated against the
// immutable %N shape — a named throw beats handing send-keys a garbage
// target. Exported for tests.
export function parsePaneId(stdout: string, session: string): string {
  const first = (stdout.split('\n')[0] ?? '').trim()
  if (!/^%\d+$/.test(first)) {
    throw new Error(
      `list-panes for ${session} returned no usable pane id (got ${JSON.stringify(first)})`,
    )
  }
  return first
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

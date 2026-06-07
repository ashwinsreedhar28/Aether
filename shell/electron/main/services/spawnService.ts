import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import {
  watch,
  type FSWatcher,
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { SpawnLedger, slugForName, type SpawnRecord } from './spawnLedger'

const execFileAsync = promisify(execFile)

// Recipe step timeouts. pnpm install on a cold worktree (full dep tree) is the
// long pole — minutes, not seconds — so it gets a generous ceiling; the whole
// recipe runs off the IPC return so nothing blocks on it.
const STEP_TIMEOUT_MS = 15 * 60 * 1000
const TERMINAL_TIMEOUT_MS = 30 * 1000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const WATCH_DEBOUNCE_MS = 120

// A record enriched for the renderer: the derived target branch/worktree (so the
// approval card can show them before approval) and, for an actionable 'requested'
// record, the full draft prompt for preview.
export interface SpawnView extends SpawnRecord {
  targetBranch: string
  targetWorktree: string
  preview?: string
}

export interface SpawnSnapshot {
  spawns: SpawnView[]
  // The id of the spawn whose recipe is in flight (between approve and the
  // spawned/failed line landing), plus the current step for the card. null when
  // idle.
  running: string | null
  runningStep: string | null
  // Concurrency=1 gate: true while a recipe is in flight OR a 'spawned' record is
  // still open (the Director hasn't marked it complete).
  busy: boolean
}

export interface SpawnServiceConfig {
  // The repo whose worktrees this service spawns. Passed in (not hardcoded) so
  // the recipe is repo-agnostic; for v0 the shell registers exactly one value —
  // this repo. A future multi-repo registry would key recipes by repo name.
  repoRoot: string
  // $AETHER_DATA_DIR/spawns/requests.jsonl — the same ledger the raven
  // request_spawn tool appends to.
  ledgerPath: string
}

/**
 * The spawn actor (shell side). Watches the append-only spawn ledger; raises the
 * approval card (via the 'changed' event → IPC broadcast) when a request lands;
 * and, on the Director's approval, runs the CLAUDE.md §13.12 worktree recipe and
 * launches a visible Terminal.app session running Claude Code against the draft.
 *
 * Human-gated by construction: the voice tool only RECORDS a request; nothing
 * spawns until the Director presses Approve here. Concurrency is capped at one
 * live spawn. Closing the spawned Terminal window is the kill switch.
 */
export class SpawnService extends EventEmitter {
  private readonly repoRoot: string
  private readonly ledgerPath: string
  private readonly ledger: SpawnLedger
  private watcher: FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null
  // In-process gate covering the window between approve() and the spawned/failed
  // line — the ledger doesn't show 'spawned' yet, so this prevents a double-approve.
  private running: string | null = null
  private runningStep: string | null = null

  constructor(cfg: SpawnServiceConfig) {
    super()
    this.repoRoot = cfg.repoRoot
    this.ledgerPath = cfg.ledgerPath
    // Ledger ctor mkdirs the spawns dir, so the watcher below can attach even
    // before the first request is written.
    this.ledger = new SpawnLedger(cfg.ledgerPath)
  }

  /** Attach the file watcher and push an initial snapshot. Idempotent-ish: a
   * second call replaces the watcher. */
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
      busy: this.isBusy(),
    }
  }

  isBusy(): boolean {
    return this.running !== null || this.ledger.busy()
  }

  /**
   * Approve a requested spawn: run the recipe and (on success) launch the
   * Terminal. Returns immediately — the recipe runs off the return because pnpm
   * install can take minutes; progress is reported through the ledger + the
   * 'changed' broadcast. Refuses if the record isn't awaiting approval or a spawn
   * is already running (concurrency=1).
   */
  async approve(id: string): Promise<{ ok: boolean; error?: string }> {
    const rec = this.ledger.find(id)
    if (!rec) return { ok: false, error: 'unknown spawn' }
    if (rec.status !== 'requested') {
      return { ok: false, error: `spawn is ${rec.status}, not awaiting approval` }
    }
    if (this.isBusy()) {
      return { ok: false, error: 'a spawn is already running — mark it complete first' }
    }
    this.running = id
    this.runningStep = 'starting'
    this.broadcast()
    void this.runRecipe(rec).finally(() => {
      this.running = null
      this.runningStep = null
      this.broadcast()
    })
    return { ok: true }
  }

  /** Dismiss a requested or failed spawn (appends 'dismissed'). */
  dismiss(id: string): { ok: boolean; error?: string } {
    const rec = this.ledger.find(id)
    if (!rec) return { ok: false, error: 'unknown spawn' }
    if (rec.status === 'requested' || rec.status === 'failed') {
      this.ledger.markDismissed(id)
      this.broadcast()
      return { ok: true }
    }
    return { ok: false, error: `cannot dismiss a ${rec.status} spawn` }
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

    const slug = slugForName(rec.draftName)
    const branch = `feat/${slug}`
    const worktree = join(homedir(), `aether-${slug}`)
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

      setStep('write LANE.md')
      // The draft prompt IS the lane brief; the spawned session reads it.
      writeFileSync(join(worktree, 'LANE.md'), this.readDraft(rec.draftPath), 'utf8')

      setStep('launch Terminal')
      await this.launchTerminal(worktree)

      this.ledger.markSpawned(rec.id, worktree, branch)
      console.log(`[spawnService] spawned ${slug} → ${worktree} (${branch})`)
    } catch (err) {
      const step = this.runningStep ?? 'recipe'
      const msg = err instanceof Error ? err.message : String(err)
      this.ledger.markFailed(rec.id, step, msg.slice(0, 2000))
      console.error(`[spawnService] spawn ${slug} failed at ${step}:`, msg)
    }
  }

  // Run a command through the user's login+interactive shell so the recipe sees
  // the full PATH (Homebrew shellenv, corepack pnpm shim, node) — a GUI-launched
  // Electron main otherwise gets an impoverished PATH. Mirrors
  // ravenDaemonManager.resolveBin's `$SHELL -lic` strategy. cwd is set both via
  // the spawn option and an explicit `cd` so an rc-file `cd` can't relocate us.
  private async runShell(command: string, cwd: string): Promise<void> {
    const userShell = process.env.SHELL || '/bin/zsh'
    const full = `cd ${sq(cwd)} && ${command}`
    try {
      await execFileAsync(userShell, ['-lic', full], {
        cwd,
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: process.env,
      })
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
    const slug = slugForName(r.draftName)
    const view: SpawnView = {
      ...r,
      targetBranch: `feat/${slug}`,
      targetWorktree: join(homedir(), `aether-${slug}`),
    }
    // Only the actionable request needs the full prompt preview on the card.
    if (r.status === 'requested') view.preview = this.readDraft(r.draftPath)
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

// POSIX single-quote a value for safe embedding in a shell command string.
function sq(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

// Produce a double-quoted AppleScript string literal (escape backslash + quote).
function osaStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

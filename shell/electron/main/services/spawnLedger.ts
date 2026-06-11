import { randomUUID } from 'node:crypto'
import {
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  readFileSync,
  existsSync,
  realpathSync,
  mkdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

// Append-only, event-sourced ledger for the spawn actor — the shell-side reader
// of the same $AETHER_DATA_DIR/spawns/requests.jsonl the raven request_spawn tool
// appends to (one JSON object per line). It deliberately mirrors the retired
// intents gap store (nodes/intents, removed in #258 — see git history):
// low-frequency, append-only, never rewritten, fsync'd per append, and
// trivially inspectable with `cat`.
//
// Pure on purpose — no Electron imports — so the orchestrator (spawnService.ts)
// and the isolated test both consume it. The voice tool writes the *request*
// line (in Python); the shell appends *lifecycle* events here. Both agree on the
// path because both resolve $userData/data (AETHER_DATA_DIR).
//
// Two line families share the log, folded oldest → newest:
//   • a REQUEST line — draft kind:
//       { id, ts, draft_path, draft_name, status:'requested' }
//     or lane kind (#268, written by raven's work_on_issue tool):
//       { id, ts, kind:'lane', batch_id, issue, issue_title, branch, worktree,
//         status:'requested' }
//   • a LIFECYCLE event — { id, ts, status:'spawned'|'closed'|'dismissed'|'failed',
//                           worktree?, branch?, step?, error?, tmux_session? }
// Discriminator: a line with a string `draft_path` is a draft request; a line
// with kind === 'lane' and a numeric `issue` is a lane request; any other line
// with `id` + `status` is a lifecycle event flipping that request's state. Folding
// forward lets a crash leave a partial log that still reads correctly, and lets
// the human-gated states (requested → spawned → closed, or → dismissed/failed) be
// reconstructed without ever rewriting a line. Lane requests sharing a batch_id
// form ONE approval unit (#268 addendum): one card, approve-all or cancel-all.

export type SpawnStatus = 'requested' | 'spawned' | 'closed' | 'dismissed' | 'failed'

// One spawn's current (folded) state. `ts` is the latest event's time;
// `requestedTs` is the original request's time (for stable newest-first order).
export interface SpawnRecord {
  id: string
  ts: string
  requestedTs: string
  // Absent/'draft' = the original draft-prompt spawn; 'lane' = an issue-bound
  // lane (#268). Lane records carry issue/batchId and have empty draft fields.
  kind?: 'draft' | 'lane'
  draftName: string
  draftPath: string
  // Lane kind only: the GitHub issue this lane works, its title (for the
  // card), and the batch this request belongs to (one card per batch).
  issue?: number
  issueTitle?: string
  batchId?: string
  // Lane kind only: the request's own targets, sanitized at fold time. For
  // draft records these stay on the draft (THE SLUG CONTRACT); for lane
  // records the request line itself is the source of truth.
  laneBranch?: string
  laneWorktree?: string
  // The tmux session owning a spawned lane's process (recorded on 'spawned';
  // absent on pty-fallback spawns where the terminal pane owns the process).
  tmuxSession?: string
  status: SpawnStatus
  // Present once the recipe has launched a worktree (status 'spawned').
  worktree?: string
  branch?: string
  // Present when the recipe failed at a step (status 'failed').
  step?: string
  error?: string
  // Best-effort RAG bootstrap outcome, recorded on the 'spawned' event: 'ok'
  // means the worktree's aether-rag venv was built + indexed (the spawned
  // session's /mcp is green from birth); 'failed' means the bootstrap stumbled
  // (the spawn still launched — RAG is best-effort). `ragStep` names the step
  // that failed.
  ragBootstrap?: 'ok' | 'failed'
  ragStep?: string
}

// kebab-case slug — MUST match the Python tool's _slugify so the branch/worktree
// the Director sees on the card derive identically (feat/<slug>, ~/aether-<slug>).
export function slugForName(name: string): string {
  const slug = (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'lane'
}

// THE SLUG CONTRACT. The draft prompt is the source of truth for the branch and
// worktree — not a re-derivation from the spoken lane name. draft_lane writes a
// literal `Branch: feat/<slug>   Worktree: ~/aether-<slug>` header line, and a
// hand-written lane can set the two independently (this very lane spawned into
// `~/aether-spawn11` on `feat/spawn-v1.1` — the worktree is NOT derivable from
// the branch slug). Parsing the draft verbatim is what stops the
// 'smart-home-control' → 'smart-home' class of divergence, where the slug baked
// into the draft differs from the slugified spoken name recorded in the ledger.
//
// Shape parsed (both tokens are the first whitespace-delimited run after the
// colon, so the two may share one line or sit on separate lines):
//   Branch: <git-ref>      e.g. feat/spawn-v1.1
//   Worktree: <path>       e.g. ~/aether-spawn11   (~ expands to $HOME)
export function parseDraftTargets(text: string): { branch?: string; worktree?: string } {
  const branchM = text.match(/^[ \t]*Branch:[ \t]*(\S+)/m)
  const worktreeM = text.match(/(?:^|\s)Worktree:[ \t]*(\S+)/)
  return {
    branch: branchM ? sanitizeBranch(branchM[1]) : undefined,
    worktree: worktreeM ? sanitizeWorktree(worktreeM[1]) : undefined,
  }
}

// Accept only a plausible git ref (the chars a branch name can hold); reject
// anything that could smuggle shell metacharacters into the recipe command.
function sanitizeBranch(raw: string | undefined): string | undefined {
  const b = (raw ?? '').trim()
  return b && /^[A-Za-z0-9._/-]+$/.test(b) ? b : undefined
}

// Expand a leading ~ to $HOME and constrain the result to live under $HOME with
// no traversal — the recipe is going to `git worktree add` here, so a garbled or
// hostile draft must not be able to point it at an arbitrary absolute path.
function sanitizeWorktree(raw: string | undefined): string | undefined {
  let p = (raw ?? '').trim()
  if (!p) return undefined
  if (p === '~') p = homedir()
  else if (p.startsWith('~/')) p = join(homedir(), p.slice(2))
  if (!p.startsWith('/') || p.includes('..')) return undefined
  const home = homedir()
  if (p !== home && !p.startsWith(home + '/')) return undefined
  return p
}

// Resolve the branch + worktree for a draft: the draft's own header lines win
// (the slug contract); absent a parseable draft, fall back to the ONE documented
// derivation rule — feat/<slug> and ~/aether-<slug> from the recorded draft name.
export function targetsForDraft(
  draftName: string,
  draftText: string | null,
): { branch: string; worktree: string } {
  const parsed = draftText ? parseDraftTargets(draftText) : {}
  const slug = slugForName(draftName)
  return {
    branch: parsed.branch ?? `feat/${slug}`,
    worktree: parsed.worktree ?? join(homedir(), `aether-${slug}`),
  }
}

// Lane-kind sibling of targetsForDraft (#268). The request line's own
// branch/worktree win (the raven tool parsed them from the issue's ARCHITECT
// SPEC); a missing or unsanitizable value falls back to the ONE documented
// lane derivation — lane/issue-N and ~/aether-lane-N — so a garbled line
// still folds into something the card can show and the recipe can refuse
// cleanly. Sanitization here is the enforcement point: the Python tool
// records what it parsed, this side runs the commands.
export function targetsForLane(
  issue: number,
  rawBranch?: string,
  rawWorktree?: string,
): { branch: string; worktree: string } {
  return {
    branch: sanitizeBranch(rawBranch) ?? `lane/issue-${issue}`,
    worktree: sanitizeWorktree(rawWorktree) ?? join(homedir(), `aether-lane-${issue}`),
  }
}

// The exact, copyable teardown for a spawned worktree, built from the RECORDED
// branch + worktree (never a re-derivation). Encodes the CLAUDE.md §13.12
// teardown gotcha: submodule `deinit` must run BEFORE `worktree remove`, and
// because deinit is global across worktrees sharing one .git, main's submodules
// are restored at the end. No auto-run in v1.1 — the Director copies and runs it.
// A lane's recorded tmux session is killed FIRST (#305 dismiss-semantics audit:
// closing the record never stops the session, so the teardown must) — '=' pins
// exact-name matching, and `|| true` keeps an already-dead session from
// aborting the block.
export function cleanupBlock(
  repoRoot: string,
  worktree: string,
  branch: string,
  tmuxSession?: string,
): string {
  return [
    '# Tear down the spawned worktree — run from the main checkout.',
    '# deinit is global across worktrees sharing this .git, so the last line',
    "# restores main's submodules (CLAUDE.md §13.12 teardown).",
    `cd ${shq(repoRoot)}`,
    ...(tmuxSession ? [`tmux kill-session -t ${shq('=' + tmuxSession)} || true`] : []),
    `rm -f ${shq(join(worktree, '.lane-kickoff.md'))}`,
    `git -C ${shq(worktree)} submodule deinit -f --all`,
    `git worktree remove --force ${shq(worktree)}`,
    `git branch -D ${shq(branch)}`,
    'git submodule update --init --recursive',
  ].join('\n')
}

// POSIX single-quote for safe embedding in the copyable cleanup block.
function shq(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

// THE INTERPRETER PIN. macOS system python3's sqlite3 is built WITHOUT
// load-extension support, so `sqlite-vec` (which the aether-rag index needs)
// cannot load and `reindex.sh` dies. A venv inherits its creator interpreter's
// sqlite build, so the RAG bootstrap must pick an extension-capable interpreter
// EXPLICITLY rather than trust a bare `python3` resolved through a spawned
// process's sparse PATH (see governance-log 2026-06-07). Candidates, in order:
//   (a) the interpreter behind the repo's OWN working aether-rag venv, fully
//       symlink-resolved — ground truth that this machine has a capable sqlite3;
//   (b) Homebrew's python3 (the usual capable build on macOS);
//   (c) bare `python3` (login-shell PATH — last resort).
export function pythonCandidates(repoRoot: string): string[] {
  const out: string[] = []
  const venvPy = join(repoRoot, 'daemons', 'aether-rag', '.venv', 'bin', 'python')
  try {
    if (existsSync(venvPy)) out.push(realpathSync(venvPy))
  } catch {
    // unreadable / broken symlink — skip; the other candidates still apply
  }
  out.push('/opt/homebrew/bin/python3')
  out.push('python3')
  return [...new Set(out)] // de-dupe, order preserved
}

// Pure: return the first candidate the capability predicate accepts (probed in
// order, short-circuiting on the first pass), else null. Split out from the
// I/O-bearing probe so the ORDERING is unit-tested with stubbed candidates.
export async function pickFirstCapable(
  candidates: string[],
  isCapable: (py: string) => Promise<boolean>,
): Promise<string | null> {
  for (const py of candidates) {
    if (await isCapable(py)) return py
  }
  return null
}

export class SpawnLedger {
  private readonly path: string

  constructor(path: string) {
    this.path = path
    // Ensure the spawns dir exists so a watcher can attach and the first append
    // never races a missing parent.
    mkdirSync(dirname(path), { recursive: true })
  }

  /**
   * Append a request line. The live flow writes this from the Python tool; this
   * method exists for completeness and for the isolated test, and documents the
   * exact on-disk shape the tool must produce.
   */
  request(draftName: string, draftPath: string): SpawnRecord {
    const rec: SpawnRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      requestedTs: '',
      draftName,
      draftPath,
      status: 'requested',
    }
    rec.requestedTs = rec.ts
    this.append({
      id: rec.id,
      ts: rec.ts,
      draft_path: draftPath,
      draft_name: draftName,
      status: 'requested',
    })
    return rec
  }

  markSpawned(
    id: string,
    worktree: string,
    branch: string,
    rag?: { ok: boolean; step?: string },
    tmuxSession?: string,
  ): void {
    const event: Record<string, unknown> = {
      id,
      ts: new Date().toISOString(),
      status: 'spawned',
      worktree,
      branch,
    }
    if (rag) {
      event.rag_bootstrap = rag.ok ? 'ok' : 'failed'
      if (!rag.ok && rag.step) event.rag_step = rag.step
    }
    if (tmuxSession) event.tmux_session = tmuxSession
    this.append(event)
  }

  markFailed(id: string, step: string, error: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'failed', step, error })
  }

  markClosed(id: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'closed' })
  }

  markDismissed(id: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'dismissed' })
  }

  /** Folded state, newest request first. */
  list(): SpawnRecord[] {
    const byId = this.fold()
    return [...byId.values()].sort((a, b) => b.requestedTs.localeCompare(a.requestedTs))
  }

  find(id: string): SpawnRecord | undefined {
    return this.fold().get(id)
  }

  /** How many records sit in the non-terminal 'spawned' state — live
   * worktrees the Director hasn't marked complete. The service compares this
   * against the max_lanes cap (#268 ruling: live count, both kinds, is what
   * holds capacity; recipes serialize separately through the in-flight slot). */
  liveCount(): number {
    let live = 0
    for (const rec of this.fold().values()) {
      if (rec.status === 'spawned') live++
    }
    return live
  }

  /** Every still-'requested' record in a batch, oldest request first — the
   * approval unit (#268 addendum): one card, approve-all or cancel-all. */
  requestedBatch(batchId: string): SpawnRecord[] {
    return [...this.fold().values()]
      .filter((rec) => rec.batchId === batchId && rec.status === 'requested')
      .sort((a, b) => a.requestedTs.localeCompare(b.requestedTs))
  }

  // Fold the whole log into current-state records, oldest → newest. A malformed
  // line is skipped (a partial write or hand-edit must not blind the log). A
  // lifecycle event for an unknown id seeds a stub so it is never silently lost.
  private fold(): Map<string, SpawnRecord> {
    const byId = new Map<string, SpawnRecord>()
    if (!existsSync(this.path)) return byId

    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch {
      return byId
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue /* skip malformed line */
      }
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      const ts = typeof obj.ts === 'string' ? obj.ts : ''

      // Request line — carries the draft identity.
      if (typeof obj.draft_path === 'string') {
        const existing = byId.get(id)
        byId.set(id, {
          id,
          ts,
          requestedTs: ts,
          draftName: typeof obj.draft_name === 'string' ? obj.draft_name : '',
          draftPath: obj.draft_path,
          status: 'requested',
          // Preserve any lifecycle already folded if a request line arrives late.
          ...(existing
            ? {
                ts: existing.ts || ts,
                status: existing.status,
                worktree: existing.worktree,
                branch: existing.branch,
                step: existing.step,
                error: existing.error,
              }
            : {}),
        })
        continue
      }

      // Lane request line (#268) — carries the issue identity and its own
      // targets, sanitized HERE (the ledger is plain JSONL on disk; a garbled
      // or hand-edited line must not reach the recipe's shell commands).
      if (obj.kind === 'lane' && typeof obj.issue === 'number' && Number.isInteger(obj.issue) && obj.issue >= 1) {
        const existing = byId.get(id)
        const targets = targetsForLane(
          obj.issue,
          typeof obj.branch === 'string' ? obj.branch : undefined,
          typeof obj.worktree === 'string' ? obj.worktree : undefined,
        )
        byId.set(id, {
          id,
          ts,
          requestedTs: ts,
          kind: 'lane',
          draftName: '',
          draftPath: '',
          issue: obj.issue,
          issueTitle: typeof obj.issue_title === 'string' ? obj.issue_title : '',
          batchId: typeof obj.batch_id === 'string' ? obj.batch_id : undefined,
          laneBranch: targets.branch,
          laneWorktree: targets.worktree,
          status: 'requested',
          // Preserve any lifecycle already folded if a request line arrives late.
          ...(existing
            ? {
                ts: existing.ts || ts,
                status: existing.status,
                worktree: existing.worktree,
                branch: existing.branch,
                step: existing.step,
                error: existing.error,
                tmuxSession: existing.tmuxSession,
              }
            : {}),
        })
        continue
      }

      // Lifecycle event — flips the status of an existing (or stub) record.
      const status = obj.status
      if (typeof status !== 'string' || !isSpawnStatus(status)) continue
      const existing =
        byId.get(id) ??
        ({
          id,
          ts,
          requestedTs: ts,
          draftName: '',
          draftPath: '',
          status,
        } as SpawnRecord)
      existing.status = status
      existing.ts = ts
      if (typeof obj.worktree === 'string') existing.worktree = obj.worktree
      if (typeof obj.branch === 'string') existing.branch = obj.branch
      if (typeof obj.step === 'string') existing.step = obj.step
      if (typeof obj.error === 'string') existing.error = obj.error
      if (obj.rag_bootstrap === 'ok' || obj.rag_bootstrap === 'failed') {
        existing.ragBootstrap = obj.rag_bootstrap
      }
      if (typeof obj.rag_step === 'string') existing.ragStep = obj.rag_step
      if (typeof obj.tmux_session === 'string') existing.tmuxSession = obj.tmux_session
      byId.set(id, existing)
    }

    return byId
  }

  // One append + fsync — the durability path lives in exactly one place (the
  // retired intents store's pattern). Per-call open/close is fine: spawns fire
  // minutes apart.
  private append(obj: Record<string, unknown>): void {
    const fd = openSync(this.path, 'a')
    try {
      writeSync(fd, JSON.stringify(obj) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}

function isSpawnStatus(s: string): s is SpawnStatus {
  return (
    s === 'requested' ||
    s === 'spawned' ||
    s === 'closed' ||
    s === 'dismissed' ||
    s === 'failed'
  )
}

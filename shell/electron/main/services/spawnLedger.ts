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
// The gate family (#378) validates its `phase` against the SAME closed set
// the card's fold derives — imported, never duplicated (the parity law; this
// module stays pure: laneGate.ts has no React or Electron imports either).
// .ts extension so `node --test` can load this module (same rule as the test
// files; tsconfig sets allowImportingTsExtensions).
import { GATE_PHASES, type GatePhase } from '../../../src/utils/laneGate.ts'

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
// Six line families share the log, folded oldest → newest:
//   • a REQUEST line — draft kind:
//       { id, ts, draft_path, draft_name, status:'requested' }
//     or lane kind (#268, written by raven's work_on_issue tool):
//       { id, ts, kind:'lane', batch_id, issue, issue_title, branch, worktree,
//         submodules?, status:'requested' }
//   • a LIFECYCLE event — { id, ts, status:'spawned'|'closed'|'dismissed'|
//                           'failed'|'teardown_failed',
//                           worktree?, branch?, step?, error?, tmux_session? }
//   • a RELAY line (#310, both request and outcome — see the relay section
//     below): every relay line carries kind:'relay' and folds separately.
//   • a TEARDOWN line (#317, both request and outcome — see the teardown
//     section below): every teardown line carries kind:'teardown' and folds
//     separately; its OUTCOME on the spawn record rides the lifecycle family
//     ('closed' on success, 'teardown_failed' on a failed step).
//   • a TELEMETRY line (#364, single-line — see the telemetry section below):
//     one kind:'telemetry' line per closed lane, written when its teardown
//     completes. Analytics only: it folds separately, has no lifecycle pair,
//     and carries NO status field, so the Python tools' capacity folds (which
//     key lifecycle on a string `status`) ignore it without edits.
//   • a GATE line (#378, single-line — see the gate section below): one
//     kind:'gate' line per phase transition the lane monitor observes on a
//     lane's issue thread (plus reminder:true alarm lines). Telemetry's
//     posture exactly: separate fold, no lifecycle pair, NO status field —
//     inert in every other fold, TS and Python, and never holding capacity.
// Discriminator: a line with kind === 'relay', 'teardown', 'telemetry', or
// 'gate' belongs to its own fold and never touches a spawn record; a line with a
// string `draft_path` is a draft request; a line with kind === 'lane' and a
// numeric `issue` is a lane request; any other line with `id` + `status` is a
// lifecycle event flipping that request's state. Folding forward lets a crash
// leave a partial log that still reads correctly, and lets the human-gated
// states (requested → spawned → closed, or → dismissed/failed) be
// reconstructed without ever rewriting a line. Lane requests sharing a
// batch_id form ONE approval unit (#268 addendum): one card, approve-all or
// cancel-all.

export type SpawnStatus =
  | 'requested'
  | 'spawned'
  | 'closed'
  | 'dismissed'
  | 'failed'
  | 'teardown_failed'

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
  // Lane kind only (#376): the request line's submodule opt-in. `Submodules:
  // on` in the ARCHITECT SPEC makes work_on_issue_tool record `submodules:
  // true`, and the spawn recipe runs `git submodule update --init --recursive`
  // in the fresh worktree. Absent = default OFF (ordinary lanes never read
  // `_ingest/` from the worktree — see the #376 audit).
  submodules?: boolean
  // The tmux session owning a spawned lane's process (recorded on 'spawned';
  // absent on pty-fallback spawns where the terminal pane owns the process).
  tmuxSession?: string
  status: SpawnStatus
  // Present once the recipe has launched a worktree (status 'spawned').
  worktree?: string
  branch?: string
  // The 'spawned' event's own timestamp, kept distinct from `ts` (which later
  // events overwrite) — the telemetry family (#364) anchors its newer-than-
  // spawn guards on it, exactly the laneGate fold's doctrine.
  spawnedTs?: string
  // Present when the recipe failed at a step (status 'failed') or a guarded
  // teardown failed mid-destruction (status 'teardown_failed', #317).
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

// ---- relay line family (#310) -----------------------------------------------
// Rung 2.5's go-ahead channel: a relay REQUEST asks the shell to type a fixed
// line into a live lane's pane ("clean, proceed" — a lane stopped at its gate
// ships on it); the shell appends the relayed/failed outcome. Every relay line
// — request AND lifecycle — carries kind:'relay', so this fold, the spawn fold
// above, and the Python tools' capacity count can all segregate the family
// without tracking ids across families.
//   • request:   { id, ts, kind:'relay', issue, text, status:'requested' }
//     (written by raven's lane_proceed tool, or by the card's PROCEED button
//     through SpawnService.proceed — one path, one audit trail)
//   • lifecycle: { id, ts, kind:'relay', status:'relayed'|'failed', error? }

// THE RELAY ALLOWLIST: the only sentences a relay may type into a lane pane.
// Arbitrary relay text is out of scope by spec (#310, reaffirmed #339 law
// iii: freeform feedback travels the issue thread only — the allowlist is a
// pane-input property). Two literals since the R2 revision loop (#339):
//   • RELAY_TEXT  — the go-ahead; a lane stopped at its gate ships on it.
//     Kept in sync with lane_proceed_tool.py's RELAY_TEXT.
//   • REVISE_TEXT — the revise order; a gated lane reads the latest DIRECTOR
//     FEEDBACK comment on its issue, addresses it, and re-gates. Kept in
//     sync with lane_revise_tool.py's REVISE_TEXT.
// The Python tools offer no text argument, requestRelay() below refuses
// anything off-list, and the shell refuses again at execution time — a
// hand-edited ledger line still has no code path to the pane.
export const RELAY_TEXT = 'clean, proceed'
export const REVISE_TEXT = 'revise per the latest DIRECTOR FEEDBACK, then re-gate'
export const RELAY_ALLOWLIST: readonly string[] = [RELAY_TEXT, REVISE_TEXT]

export type RelayStatus = 'requested' | 'relayed' | 'failed'

// One relay's current (folded) state. `ts` is the latest event's time;
// `requestedTs` the request's (for stable newest-first ordering).
export interface RelayRecord {
  id: string
  ts: string
  requestedTs: string
  // The lane this relay targets, by issue number (how the voice path names
  // lanes); the executor resolves it to the newest live lane record.
  issue: number
  // Recorded verbatim from the request line. requestRelay() refuses off-list
  // text at write time, and the ALLOWLIST is enforced AGAIN at execution time
  // by the side that owns the pane (SpawnService) — the ledger is plain JSONL
  // and a hand-edited line must still fold legibly without ever reaching a
  // pane.
  text: string
  status: RelayStatus
  // Present when the relay failed (status 'failed').
  error?: string
}

// ---- teardown line family (#317) ---------------------------------------------
// The spawn's mirror: a teardown REQUEST asks the shell to run the canonical
// cleanup block (tmux kill-session → rm kickoff → submodule deinit → worktree
// remove → branch -D → restore main's submodules) against the newest live lane
// record for `issue`. Requested by voice (raven's close_lane tool) or the
// card's CLOSE OUT button — one ledger line, one audit trail, exactly the
// relay family's shape. Every teardown line carries kind:'teardown' so the
// spawn fold, the relay fold, and the Python tools' capacity count all
// segregate it by tag.
//   • request:   { id, ts, kind:'teardown', issue, force?, status:'requested' }
//     (`force` rides only the card's CLOSE ANYWAY — the #308 warn-and-force
//     law; the voice tool never writes it)
//   • lifecycle: { id, ts, kind:'teardown', status:'done'|'failed',
//                  code?, step?, error? }
// The spawn RECORD's outcome rides the lifecycle family instead: 'closed' is
// written only after every step succeeds; a failed step writes
// 'teardown_failed' naming it. Capacity is freed only by 'closed' — see
// liveCount().

export type TeardownStatus = 'requested' | 'done' | 'failed'

// Guard refusals, surfaced so the card can present each correctly: 'pr-open'
// and 'lane-busy' are hard refusals (no force path); 'dirty' draws the warn
// card whose CLOSE ANYWAY re-requests with force.
export type TeardownGuardCode = 'pr-open' | 'dirty' | 'lane-busy'

// One teardown's current (folded) state. `ts` is the latest event's time;
// `requestedTs` the request's (for stable newest-first ordering).
export interface TeardownRecord {
  id: string
  ts: string
  requestedTs: string
  // The lane this teardown targets, by issue number (how the voice path
  // names lanes); the executor resolves it to the newest live lane record.
  issue: number
  // True only on the card's CLOSE ANYWAY re-request: overrides the
  // dirty/ahead warn guard and NOTHING else.
  force: boolean
  status: TeardownStatus
  // Present when the teardown failed (status 'failed').
  code?: TeardownGuardCode
  step?: string
  error?: string
}

// ---- telemetry line family (#364) ---------------------------------------------
// The measurement substrate for the self-improvement loop: one line per CLOSED
// lane, written by the teardown executor when every destruction step has
// succeeded. Law (the #364 ADR): capture facts, classify later — no failure
// taxonomy here; analytics never blocks teardown — every scraped field is
// individually fallible and a scrape failure writes null plus an error note,
// never a refused closeout; null-over-guess — an unrecoverable field is null,
// not a plausible value.
//
// Single-line family: unlike relay/teardown there is no request/lifecycle
// pair — the line is complete at write time. Every line carries
// kind:'telemetry' so the spawn fold skips it; it deliberately carries NO
// `status` field, so the Python tools' capacity folds (which key lifecycle
// lines on a string `status`) ignore it with zero edits — no capacity impact.
//   { id, ts, kind:'telemetry', issue, spawned_at, closed_at, wall_seconds,
//     model, effort, tokens:{input,output,cache_read,cache_write},
//     gate_reports, revises, proceeds,
//     diff:{files_changed,insertions,deletions}, outcome, error? }
// The ledger JSONL is the v1 read surface (jq); no renderer surface by spec.

// Token totals summed from the lane's Claude Code session transcripts (the
// JSONL under ~/.claude/projects/ keyed by the worktree cwd — the binding
// lives in laneTelemetry.ts).
export interface LaneTokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// `git diff main...HEAD --shortstat` captured in the worktree BEFORE removal.
// A zero-commit lane records zeros (an empty shortstat IS the fact).
export interface LaneDiffStat {
  filesChanged: number
  insertions: number
  deletions: number
}

// Derived from the same gh-CLI PR-by-head-branch surface the teardown's
// pr-open refusal consults: a merged PR on the lane's branch ⇒ 'merged';
// none ⇒ 'abandoned'. A failed probe records null (null-over-guess).
export type LaneOutcome = 'merged' | 'abandoned'

// What the teardown executor captured for one closing lane — writeTelemetry's
// input. Every nullable field is null when its scrape failed or its source
// was unrecoverable; `error` carries the semicolon-joined scrape notes.
export interface TelemetryCapture {
  issue: number
  spawnedAt: string | null
  model: string | null
  effort: string | null
  tokens: LaneTokenTotals | null
  gateReports: number | null
  revises: number | null
  proceeds: number | null
  diff: LaneDiffStat | null
  outcome: LaneOutcome | null
  error?: string
}

// One telemetry line, folded. `ts` doubles as `closedAt` (the line is written
// at teardown completion); `wallSeconds` is spawn→close, computed at write.
export interface TelemetryRecord extends TelemetryCapture {
  id: string
  ts: string
  closedAt: string
  wallSeconds: number | null
}

// ---- gate line family (#378) ---------------------------------------------------
// The lane monitor's observation record: one line per OBSERVED phase change
// on a lane's issue thread, appended when the freshly folded phase differs
// from the last gate line for that issue (the dedupe rule — laneMonitor owns
// it). Last-known phase per lane is DERIVED from this fold — no side state
// file — so a boot's first successful poll naturally emits the transitions
// that happened while the shell was down (the #372 blind spot).
// Telemetry's posture exactly: single-line (no request/lifecycle pair), every
// line carries kind:'gate' so the other folds skip it, and deliberately NO
// `status` field, so the Python capacity folds (which key lifecycle on a
// string `status`) ignore it with zero edits — a gate line never holds lane
// capacity.
//   • transition: { id, ts, kind:'gate', issue, phase, prev }
//   • reminder:   { id, ts, kind:'gate', issue, phase, reminder:true }
//     (the single-shot age/stall alarms — the reminder line IS the dedupe
//     record, so an app restart never re-fires one)

// One gate line, folded. `phase` is laneGate.gatePhase over the issue thread
// at observation time; `prev` is the phase the transition left (null on
// reminder lines — they restate the sitting phase, never move it).
export interface GateRecord {
  id: string
  ts: string
  issue: number
  phase: GatePhase
  prev: GatePhase | null
  reminder: boolean
}

// Per-issue derivation for the monitor: the last-known phase plus the anchors
// the single-shot alarms dedupe against. `transitionTs` is the last
// transition line's ts — when the monitor first OBSERVED the sitting (null
// when only reminder lines exist: a stall alarm can precede any transition);
// `reminderTs` is the last reminder line at/after that transition — a fresh
// transition resets it, so each new sitting may remind once.
export interface GateLedgerState {
  phase: GatePhase
  transitionTs: string | null
  reminderTs: string | null
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
// are restored at the end. Since #317 the shell can also EXECUTE these same
// steps itself (SpawnService.executeTeardown — guarded, confirm-gated; the
// 2026-06-11 ADR supersedes the v1.1 copy-only clause); this block stays the
// copyable manual path, and the executor mirrors its order exactly.
// A lane's recorded tmux session is killed FIRST (#305 dismiss-semantics audit:
// closing the record never stops the session, so the teardown must) — '=' pins
// exact-name matching, and `|| true` keeps an already-dead session from
// aborting the block. The #363 submodule-die fallback (rm -rf → worktree
// prune → the branch -D that follows) rides along as commented lines beside
// the remove, exactly the recovery the executor automates — the manual
// operator gets the same script the shell runs.
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
    "# If the remove dies on 'working trees containing submodules' (#363),",
    '# fall back — rm -rf, prune the stale admin dir, THEN the branch -D:',
    `#   rm -rf ${shq(worktree)}`,
    '#   git worktree prune',
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

  // ---- relay family (#310) ---------------------------------------------------

  /** Append a relay request line — the card's PROCEED path (RELAY_TEXT) and
   * its REVISE path (REVISE_TEXT, #339). The live voice flows write the
   * identical shapes from lane_proceed_tool.py / lane_revise_tool.py; this
   * method documents the on-disk contract. The allowlist is enforced HERE as
   * well as at execution time: this method throws on any off-list text, so no
   * shell code path can even record a freeform relay. */
  requestRelay(issue: number, text: string = RELAY_TEXT): RelayRecord {
    if (!RELAY_ALLOWLIST.includes(text)) {
      throw new Error(
        `relay text not allowlisted — relays carry only "${RELAY_TEXT}" or "${REVISE_TEXT}"`,
      )
    }
    const rec: RelayRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      requestedTs: '',
      issue,
      text,
      status: 'requested',
    }
    rec.requestedTs = rec.ts
    this.append({ id: rec.id, ts: rec.ts, kind: 'relay', issue, text, status: 'requested' })
    return rec
  }

  markRelayed(id: string): void {
    this.append({ id, ts: new Date().toISOString(), kind: 'relay', status: 'relayed' })
  }

  markRelayFailed(id: string, error: string): void {
    this.append({ id, ts: new Date().toISOString(), kind: 'relay', status: 'failed', error })
  }

  // ---- teardown family (#317) -------------------------------------------------

  /** Append a teardown request line — the card's CLOSE OUT path (force rides
   * only its CLOSE ANYWAY). The live voice flow writes the identical force-less
   * shape from close_lane_tool.py; this method documents the on-disk contract. */
  requestTeardown(issue: number, force = false): TeardownRecord {
    const rec: TeardownRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      requestedTs: '',
      issue,
      force,
      status: 'requested',
    }
    rec.requestedTs = rec.ts
    const line: Record<string, unknown> = {
      id: rec.id,
      ts: rec.ts,
      kind: 'teardown',
      issue,
      status: 'requested',
    }
    if (force) line.force = true
    this.append(line)
    return rec
  }

  markTeardownDone(id: string): void {
    this.append({ id, ts: new Date().toISOString(), kind: 'teardown', status: 'done' })
  }

  markTeardownFailed(
    id: string,
    error: string,
    opts: { code?: TeardownGuardCode; step?: string } = {},
  ): void {
    const line: Record<string, unknown> = {
      id,
      ts: new Date().toISOString(),
      kind: 'teardown',
      status: 'failed',
      error,
    }
    if (opts.code) line.code = opts.code
    if (opts.step) line.step = opts.step
    this.append(line)
  }

  /** The spawn RECORD's failed-teardown outcome (#317): a destruction step
   * failed mid-teardown, so the record must keep holding its capacity slot
   * (only 'closed' frees it — see liveCount) while naming the failing step. */
  markRecordTeardownFailed(id: string, step: string, error: string): void {
    this.append({ id, ts: new Date().toISOString(), status: 'teardown_failed', step, error })
  }

  /** Folded teardown state, newest request first (for the snapshot/card). */
  listTeardowns(): TeardownRecord[] {
    return [...this.foldTeardowns().values()].sort((a, b) =>
      b.requestedTs.localeCompare(a.requestedTs),
    )
  }

  /** Still-'requested' teardowns, oldest first — the executor's FIFO. */
  pendingTeardowns(): TeardownRecord[] {
    return [...this.foldTeardowns().values()]
      .filter((t) => t.status === 'requested')
      .sort((a, b) => a.requestedTs.localeCompare(b.requestedTs))
  }

  findTeardown(id: string): TeardownRecord | undefined {
    return this.foldTeardowns().get(id)
  }

  // ---- telemetry family (#364) -------------------------------------------------

  /** Append one telemetry line for a lane whose teardown just completed.
   * Stamps the write moment as both `ts` and `closedAt` and computes
   * `wallSeconds` from the capture's spawnedAt (null when either side is
   * missing or unparseable — null-over-guess). The CALLER guards this:
   * analytics never blocks teardown, so a throwing append is caught and
   * logged, never surfaced as a teardown failure. */
  writeTelemetry(t: TelemetryCapture): TelemetryRecord {
    const closedAt = new Date().toISOString()
    const spawned = t.spawnedAt === null ? NaN : Date.parse(t.spawnedAt)
    const wallSeconds = Number.isFinite(spawned)
      ? Math.round((Date.parse(closedAt) - spawned) / 1000)
      : null
    const rec: TelemetryRecord = {
      ...t,
      id: randomUUID(),
      ts: closedAt,
      closedAt,
      wallSeconds,
    }
    const line: Record<string, unknown> = {
      id: rec.id,
      ts: rec.ts,
      kind: 'telemetry',
      issue: t.issue,
      spawned_at: t.spawnedAt,
      closed_at: closedAt,
      wall_seconds: wallSeconds,
      model: t.model,
      effort: t.effort,
      tokens: t.tokens
        ? {
            input: t.tokens.input,
            output: t.tokens.output,
            cache_read: t.tokens.cacheRead,
            cache_write: t.tokens.cacheWrite,
          }
        : null,
      gate_reports: t.gateReports,
      revises: t.revises,
      proceeds: t.proceeds,
      diff: t.diff
        ? {
            files_changed: t.diff.filesChanged,
            insertions: t.diff.insertions,
            deletions: t.diff.deletions,
          }
        : null,
      outcome: t.outcome,
    }
    if (t.error) line.error = t.error
    this.append(line)
    return rec
  }

  /** Folded telemetry lines, newest first (the jq-adjacent programmatic read). */
  listTelemetry(): TelemetryRecord[] {
    return [...this.foldTelemetry().values()].sort((a, b) => b.ts.localeCompare(a.ts))
  }

  /** The newest telemetry line for `issue` — respawns close more than once. */
  findTelemetry(issue: number): TelemetryRecord | undefined {
    return this.listTelemetry().find((t) => t.issue === issue)
  }

  // ---- gate family (#378) ------------------------------------------------------

  /** Append one observed phase transition. The dedupe rule lives with the
   * caller (laneMonitor): append only when the freshly folded phase differs
   * from lastGatePhases() — this method just records the on-disk contract
   * (see the family note above). */
  writeGateTransition(issue: number, phase: GatePhase, prev: GatePhase): GateRecord {
    const rec: GateRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      issue,
      phase,
      prev,
      reminder: false,
    }
    this.append({ id: rec.id, ts: rec.ts, kind: 'gate', issue, phase, prev })
    return rec
  }

  /** Append one single-shot alarm line (`reminder:true`) — the durable record
   * that this sitting (age alarm) or this spawn's stall window (stall alarm)
   * already reminded, so a restart never re-fires it. */
  writeGateReminder(issue: number, phase: GatePhase): GateRecord {
    const rec: GateRecord = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      issue,
      phase,
      prev: null,
      reminder: true,
    }
    this.append({ id: rec.id, ts: rec.ts, kind: 'gate', issue, phase, reminder: true })
    return rec
  }

  /** Gate lines, oldest → newest (tests + the jq-adjacent programmatic read). */
  listGates(): GateRecord[] {
    return this.foldGates()
  }

  /** Last-known gate state per issue — the monitor's whole memory. Derived
   * from the fold on every call (no cache, no side state), which is what
   * makes the boot diff automatic: whatever the ledger last recorded is
   * "known", and the first fresh fetch diffs against it. */
  lastGatePhases(): Map<number, GateLedgerState> {
    const byIssue = new Map<number, GateLedgerState>()
    for (const g of this.foldGates()) {
      const prior = byIssue.get(g.issue)
      if (g.reminder) {
        // A reminder records its ts but never moves the phase (a stall
        // reminder with no prior transition seeds the entry — phase
        // 'working' — without inventing a transition anchor).
        byIssue.set(g.issue, {
          phase: prior?.phase ?? g.phase,
          transitionTs: prior?.transitionTs ?? null,
          reminderTs: g.ts,
        })
      } else {
        // A transition starts a fresh sitting: the reminder slot re-arms.
        byIssue.set(g.issue, { phase: g.phase, transitionTs: g.ts, reminderTs: null })
      }
    }
    return byIssue
  }

  /** Count the two allowlisted relay sentences DELIVERED to `issue`'s lane
   * since `sinceIso` (the record's spawned event — the laneGate doctrine: a
   * respawn on the same issue must never inherit the previous run's counts).
   * Only status 'relayed' counts: a failed or boot-swept relay never reached
   * the pane, so it drove no cycle. */
  countRelayTexts(issue: number, sinceIso: string): { revises: number; proceeds: number } {
    const since = Date.parse(sinceIso)
    let revises = 0
    let proceeds = 0
    if (!Number.isFinite(since)) return { revises, proceeds }
    for (const r of this.foldRelays().values()) {
      if (r.issue !== issue || r.status !== 'relayed') continue
      const at = Date.parse(r.requestedTs)
      if (!Number.isFinite(at) || at <= since) continue
      if (r.text === REVISE_TEXT) revises++
      else if (r.text === RELAY_TEXT) proceeds++
    }
    return { revises, proceeds }
  }

  /** Folded relay state, newest request first (for the snapshot/card). */
  listRelays(): RelayRecord[] {
    return [...this.foldRelays().values()].sort((a, b) =>
      b.requestedTs.localeCompare(a.requestedTs),
    )
  }

  /** Still-'requested' relays, oldest first — the executor's FIFO. */
  pendingRelays(): RelayRecord[] {
    return [...this.foldRelays().values()]
      .filter((r) => r.status === 'requested')
      .sort((a, b) => a.requestedTs.localeCompare(b.requestedTs))
  }

  findRelay(id: string): RelayRecord | undefined {
    return this.foldRelays().get(id)
  }

  /** Folded state, newest request first. */
  list(): SpawnRecord[] {
    const byId = this.fold()
    return [...byId.values()].sort((a, b) => b.requestedTs.localeCompare(a.requestedTs))
  }

  find(id: string): SpawnRecord | undefined {
    return this.fold().get(id)
  }

  /** How many records sit in a non-terminal live state — 'spawned' worktrees
   * the Director hasn't marked complete, plus 'teardown_failed' records whose
   * worktree/branch still exist in some part (#317: capacity is freed only by
   * 'closed', so a failed teardown keeps holding its slot until a retry
   * succeeds). The service compares this against the max_lanes cap (#268
   * ruling: live count, both kinds, is what holds capacity; recipes serialize
   * separately through the in-flight slot). */
  liveCount(): number {
    let live = 0
    for (const rec of this.fold().values()) {
      if (rec.status === 'spawned' || rec.status === 'teardown_failed') live++
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

      // Relay (#310), teardown (#317), telemetry (#364), and gate (#378)
      // lines fold separately (foldRelays / foldTeardowns / foldTelemetry /
      // foldGates); without this skip a relay or teardown request would seed
      // a ghost 'requested' spawn stub and a failed outcome would raise a
      // SPAWN FAILED card for a record that never existed.
      if (
        obj.kind === 'relay' ||
        obj.kind === 'teardown' ||
        obj.kind === 'telemetry' ||
        obj.kind === 'gate'
      ) {
        continue
      }

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
                spawnedTs: existing.spawnedTs,
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
          submodules: obj.submodules === true ? true : undefined,
          status: 'requested',
          // Preserve any lifecycle already folded if a request line arrives late.
          ...(existing
            ? {
                ts: existing.ts || ts,
                status: existing.status,
                worktree: existing.worktree,
                branch: existing.branch,
                spawnedTs: existing.spawnedTs,
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
      if (status === 'spawned') existing.spawnedTs = ts
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

  // Fold the relay family (#310), oldest → newest — the kind:'relay' sibling
  // of fold() above. A malformed line is skipped; a lifecycle line for an
  // unknown relay id is dropped (unlike spawn lifecycle events, which seed
  // stubs: a relay with no request line has no issue to execute against and
  // nothing the card could usefully show).
  private foldRelays(): Map<string, RelayRecord> {
    const byId = new Map<string, RelayRecord>()
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
      if (obj.kind !== 'relay') continue
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      const ts = typeof obj.ts === 'string' ? obj.ts : ''

      // Request line — carries the target issue and the recorded text.
      if (
        typeof obj.issue === 'number' &&
        Number.isInteger(obj.issue) &&
        obj.issue >= 1 &&
        typeof obj.text === 'string'
      ) {
        const existing = byId.get(id)
        byId.set(id, {
          id,
          ts: existing?.ts || ts,
          requestedTs: ts,
          issue: obj.issue,
          text: obj.text,
          status: existing?.status ?? 'requested',
          error: existing?.error,
        })
        continue
      }

      // Outcome line — flips an existing relay's status.
      const status = obj.status
      if (status !== 'relayed' && status !== 'failed') continue
      const existing = byId.get(id)
      if (!existing) continue
      existing.status = status
      existing.ts = ts
      if (typeof obj.error === 'string') existing.error = obj.error
    }

    return byId
  }

  // Fold the teardown family (#317), oldest → newest — the kind:'teardown'
  // sibling of foldRelays() above, with the same posture: a malformed line is
  // skipped; an outcome line for an unknown teardown id is dropped (a teardown
  // with no request line has no issue to execute against and nothing the card
  // could usefully show).
  private foldTeardowns(): Map<string, TeardownRecord> {
    const byId = new Map<string, TeardownRecord>()
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
      if (obj.kind !== 'teardown') continue
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      const ts = typeof obj.ts === 'string' ? obj.ts : ''

      // Request line — carries the target issue (and the card-only force flag).
      if (typeof obj.issue === 'number' && Number.isInteger(obj.issue) && obj.issue >= 1) {
        const existing = byId.get(id)
        byId.set(id, {
          id,
          ts: existing?.ts || ts,
          requestedTs: ts,
          issue: obj.issue,
          force: obj.force === true,
          status: existing?.status ?? 'requested',
          code: existing?.code,
          step: existing?.step,
          error: existing?.error,
        })
        continue
      }

      // Outcome line — flips an existing teardown's status.
      const status = obj.status
      if (status !== 'done' && status !== 'failed') continue
      const existing = byId.get(id)
      if (!existing) continue
      existing.status = status
      existing.ts = ts
      if (obj.code === 'pr-open' || obj.code === 'dirty' || obj.code === 'lane-busy') {
        existing.code = obj.code
      }
      if (typeof obj.step === 'string') existing.step = obj.step
      if (typeof obj.error === 'string') existing.error = obj.error
    }

    return byId
  }

  // Fold the telemetry family (#364), oldest → newest — single-line records,
  // so "folding" is shape-validation plus last-write-wins on a duplicated id
  // (a hand-edit hazard, not a live path). A malformed line is skipped; a
  // line without a valid issue is dropped (nothing to key analytics on).
  // Nullable fields stay null unless the line carries the right shape —
  // reading is as null-over-guess as writing.
  private foldTelemetry(): Map<string, TelemetryRecord> {
    const byId = new Map<string, TelemetryRecord>()
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
      if (obj.kind !== 'telemetry') continue
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      if (typeof obj.issue !== 'number' || !Number.isInteger(obj.issue) || obj.issue < 1) continue
      const ts = typeof obj.ts === 'string' ? obj.ts : ''

      const tokensRaw = obj.tokens as Record<string, unknown> | null | undefined
      const tokens =
        tokensRaw &&
        typeof tokensRaw === 'object' &&
        typeof tokensRaw.input === 'number' &&
        typeof tokensRaw.output === 'number' &&
        typeof tokensRaw.cache_read === 'number' &&
        typeof tokensRaw.cache_write === 'number'
          ? {
              input: tokensRaw.input,
              output: tokensRaw.output,
              cacheRead: tokensRaw.cache_read,
              cacheWrite: tokensRaw.cache_write,
            }
          : null

      const diffRaw = obj.diff as Record<string, unknown> | null | undefined
      const diff =
        diffRaw &&
        typeof diffRaw === 'object' &&
        typeof diffRaw.files_changed === 'number' &&
        typeof diffRaw.insertions === 'number' &&
        typeof diffRaw.deletions === 'number'
          ? {
              filesChanged: diffRaw.files_changed,
              insertions: diffRaw.insertions,
              deletions: diffRaw.deletions,
            }
          : null

      byId.set(id, {
        id,
        ts,
        issue: obj.issue,
        spawnedAt: typeof obj.spawned_at === 'string' ? obj.spawned_at : null,
        closedAt: typeof obj.closed_at === 'string' ? obj.closed_at : ts,
        wallSeconds: typeof obj.wall_seconds === 'number' ? obj.wall_seconds : null,
        model: typeof obj.model === 'string' ? obj.model : null,
        effort: typeof obj.effort === 'string' ? obj.effort : null,
        tokens,
        gateReports: typeof obj.gate_reports === 'number' ? obj.gate_reports : null,
        revises: typeof obj.revises === 'number' ? obj.revises : null,
        proceeds: typeof obj.proceeds === 'number' ? obj.proceeds : null,
        diff,
        outcome: obj.outcome === 'merged' || obj.outcome === 'abandoned' ? obj.outcome : null,
        ...(typeof obj.error === 'string' ? { error: obj.error } : {}),
      })
    }

    return byId
  }

  // Fold the gate family (#378), oldest → newest — single-line records like
  // telemetry, so "folding" is shape validation in append order. A malformed
  // line, an invalid issue, or an off-list phase is skipped (the ledger is
  // plain JSONL on disk; a hand-edited line must not fabricate a transition
  // or blind the monitor's dedupe).
  private foldGates(): GateRecord[] {
    const out: GateRecord[] = []
    if (!existsSync(this.path)) return out

    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch {
      return out
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
      if (obj.kind !== 'gate') continue
      const id = typeof obj.id === 'string' ? obj.id : null
      if (!id) continue
      if (typeof obj.issue !== 'number' || !Number.isInteger(obj.issue) || obj.issue < 1) continue
      if (!isGatePhase(obj.phase)) continue
      out.push({
        id,
        ts: typeof obj.ts === 'string' ? obj.ts : '',
        issue: obj.issue,
        phase: obj.phase,
        prev: isGatePhase(obj.prev) ? obj.prev : null,
        reminder: obj.reminder === true,
      })
    }

    return out
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

function isGatePhase(p: unknown): p is GatePhase {
  return typeof p === 'string' && (GATE_PHASES as readonly string[]).includes(p)
}

function isSpawnStatus(s: string): s is SpawnStatus {
  return (
    s === 'requested' ||
    s === 'spawned' ||
    s === 'closed' ||
    s === 'dismissed' ||
    s === 'failed' ||
    s === 'teardown_failed'
  )
}

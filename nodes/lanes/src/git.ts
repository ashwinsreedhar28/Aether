import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { CollectResult, Lane } from './types'

// All git work is synchronous (execFileSync). The commands are local, fast, and
// O(worktrees): one `git worktree list` per tick, then `status` + `log` per
// worktree. A 10s poll cadence leaves the event loop idle the rest of the time,
// so blocking for the few ms each git call takes is simpler than juggling async
// child processes and races nothing the node also does concurrently.
const GIT_TIMEOUT_MS = 5_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'utf8',
  })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface RawWorktree {
  path: string
  branch: string | null
  detached: boolean
  bare: boolean
}

// Parse `git worktree list --porcelain`. Blocks are separated by blank lines;
// each block leads with `worktree <path>` and may carry `branch refs/heads/<x>`,
// `detached`, or `bare` attribute lines. Unknown attributes pass through ignored.
function parseWorktrees(porcelain: string): RawWorktree[] {
  const out: RawWorktree[] = []
  let cur: RawWorktree | null = null
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') {
      if (cur) out.push(cur)
      cur = null
      continue
    }
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice('worktree '.length), branch: null, detached: false, bare: false }
    } else if (!cur) {
      continue
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'detached') {
      cur.detached = true
    } else if (line === 'bare') {
      cur.bare = true
    }
  }
  if (cur) out.push(cur)
  return out
}

// `git status --porcelain` line → repo-relative path. Lines are `XY <path>`;
// the path begins at index 3. Renames/copies render `XY old -> new` — we take
// the destination (the file that now exists). Quoted paths (special chars) are
// left as-is; statSync simply fails on them and the file is skipped, which only
// loses a single mtime sample, never the whole lane.
function dirtyPath(statusLine: string): string {
  const body = statusLine.slice(3)
  const arrow = body.indexOf(' -> ')
  return arrow === -1 ? body : body.slice(arrow + 4)
}

function collectLane(wt: RawWorktree, now: number, activeWindowMs: number): Lane {
  const branch = wt.detached || !wt.branch ? '(detached)' : wt.branch

  // Per-worktree git can fail if the worktree directory was removed but not yet
  // pruned. Treat that as a clean, commit-less lane rather than failing the whole
  // snapshot — `git worktree list` already proved the repo itself is readable.
  let dirtyLines: string[] = []
  let lastCommitMs: number | null = null
  let lastCommitMsg: string | null = null
  try {
    const status = git(['status', '--porcelain'], wt.path)
    dirtyLines = status.split('\n').filter((l) => l.trim() !== '')
    // One `git log` call yields both the commit time (%ct) and subject (%s),
    // newline-separated, so we don't spawn git twice. Subject is single-line.
    const logOut = git(['log', '-1', '--format=%ct%n%s'], wt.path)
    const logLines = logOut.split('\n')
    const ct = (logLines[0] ?? '').trim()
    if (ct !== '') lastCommitMs = Number.parseInt(ct, 10) * 1000
    const subject = (logLines[1] ?? '').trim()
    if (subject !== '') lastCommitMsg = subject
  } catch {
    /* worktree unreadable — best-effort defaults below */
  }

  // last_activity_ms = max(last commit, mtime of each dirty file). Stat ONLY the
  // dirty-listed files (never a tree walk). Deleted files / unstattable paths are
  // skipped silently.
  let lastActivityMs = lastCommitMs ?? 0
  for (const line of dirtyLines) {
    try {
      const m = statSync(join(wt.path, dirtyPath(line))).mtimeMs
      if (m > lastActivityMs) lastActivityMs = m
    } catch {
      /* deleted or unstattable — skip this sample */
    }
  }

  return {
    name: basename(wt.path),
    path: wt.path,
    branch,
    is_main: branch === 'main',
    dirty_count: dirtyLines.length,
    last_commit_ms: lastCommitMs,
    last_commit_msg: lastCommitMsg,
    last_activity_ms: lastActivityMs,
    state: now - lastActivityMs <= activeWindowMs ? 'active' : 'idle',
  }
}

// One snapshot of every worktree of the shared repo. `git worktree list` returns
// ALL worktrees regardless of which one we run from, so this works identically in
// any lane. A failure of the top-level list command means git itself is broken or
// the path isn't a repo → repo_unreadable (mapped to MeshDeny by the caller).
export function collectLanes(repoRoot: string, activeWindowMs: number): CollectResult {
  let listOut: string
  try {
    listOut = git(['worktree', 'list', '--porcelain'], repoRoot)
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
  const now = Date.now()
  const lanes = parseWorktrees(listOut)
    .filter((wt) => !wt.bare)
    .map((wt) => collectLane(wt, now, activeWindowMs))
  return { ok: true, data: { lanes } }
}

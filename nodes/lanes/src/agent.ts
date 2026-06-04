import { execFileSync } from 'node:child_process'
import { sep } from 'node:path'
import type { AgentInfo } from './types'

// macOS live-agent detection. A lane "has an agent" when a Claude Code session
// (CC) is running with its cwd inside that worktree. CC runs as a process named
// literally `claude` (verified on this machine: `claude --dangerously-skip-
// permissions`), so we ask lsof for the cwd of every such process in ONE call:
//
//   lsof -a -c claude -d cwd -Fpn
//
// -a ANDs the selectors; -c claude selects commands beginning with "claude";
// -d cwd restricts to the cwd file descriptor; -Fpn emits a machine-parseable
// stream of `p<pid>` / `f<fd>` / `n<path>` lines. lsof is the only macOS
// mechanism that exposes a process cwd — there is no /proc, and `ps` has no cwd
// column. The call is local and ~25ms (same order as the git calls in git.ts),
// so it rides the synchronous 10s git poll rather than warranting its own
// cadence (unlike the network gh poll, which is async + slow; see gh.ts).
//
// Cost: one extra short-lived `lsof` per 10s poll. Best-effort and SYNCHRONOUS,
// mirroring git.ts — it degrades to null (detection unavailable) rather than
// throwing, so a missing lsof never breaks the git snapshot.
//
// Cross-platform: macOS-targeted. On a host without lsof (e.g. the collaborator's
// Windows tree) the spawn fails ENOENT and `agent` reports null everywhere — the
// Windows tree need undo nothing; a native detector is a future lane. No
// `process.platform` guard on purpose: lsof-based detection also works on Linux
// (the eventual substrate), so we let the ENOENT path do the gating instead of
// hard-coding darwin-only.

const LSOF_TIMEOUT_MS = 5_000
const LSOF_MAX_BUFFER = 4 * 1024 * 1024

// Pull the cwd paths out of the -Fpn stream. Each `n<path>` line is one cwd;
// with `-d cwd` there is exactly one per matched process, so the number of
// n-lines IS the number of live `claude` sessions.
function parseCwds(output: string): string[] {
  const cwds: string[] = []
  for (const line of output.split('\n')) {
    if (line.startsWith('n')) cwds.push(line.slice(1))
  }
  return cwds
}

// The cwd of every live `claude` process, or null when detection is
// unavailable. Synchronous + best-effort, mirroring git.ts.
export function collectAgentCwds(): string[] | null {
  try {
    const out = execFileSync('lsof', ['-a', '-c', 'claude', '-d', 'cwd', '-Fpn'], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: LSOF_MAX_BUFFER,
      encoding: 'utf8',
    })
    return parseCwds(out)
  } catch (err) {
    // CRITICAL: lsof exits 1 (status 1, no error code) with empty stdout when
    // NOTHING matches the filter — that is the "no agents running" case, not a
    // failure. Parse whatever stdout it produced (empty → []). Any OTHER failure
    // (lsof missing → code ENOENT, or a timeout kill → status null) returns null:
    // detection unavailable, deliberately distinct from "detection ran, found
    // zero" so the surface can report the difference.
    const e = err as { status?: number | null; stdout?: string | Buffer }
    if (e.status === 1) return parseCwds(typeof e.stdout === 'string' ? e.stdout : '')
    return null
  }
}

// Per-worktree agent info from the flat cwd list. A worktree "has" an agent
// when a claude cwd equals it OR sits beneath it (a session cd'd into a subdir,
// e.g. shell/). The `path + sep` guard prevents a sibling-prefix false match:
// `/x/aether-agents` must never count toward the `/x/aether` lane.
export function agentForPath(path: string, cwds: string[]): AgentInfo {
  let count = 0
  for (const cwd of cwds) {
    if (cwd === path || cwd.startsWith(path + sep)) count++
  }
  return { active: count > 0, count }
}

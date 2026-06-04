// Local types for the lanes sensor. A "lane" is one git worktree of the shared
// Aether repository — each parallel CC session works a branch in its own
// worktree (see CLAUDE.md §13 lanes model). The node turns `git worktree list`
// + per-worktree dirtiness/commit data into an activity snapshot.

export type LaneState = 'active' | 'idle'

// Live Claude Code session detection for a lane (see agent.ts). `active` is
// `count > 0`. The whole field is null on the Lane when process detection is
// UNAVAILABLE (lsof missing/errored) — deliberately distinct from
// `{ active: false, count: 0 }`, which means detection ran and found no live
// session in the worktree.
export interface AgentInfo {
  active: boolean
  count: number
}

// A pull request for a lane's branch, as resolved from `gh pr list`. `state` is
// gh's own value ('OPEN' | 'CLOSED' | 'MERGED') passed through verbatim — the
// Lanes view maps it to a colour; we don't normalise it here.
export interface PullRequest {
  number: number
  state: string
  url: string
}

export interface Lane {
  // basename of the worktree path (e.g. 'aether-lanes').
  name: string
  // absolute worktree path.
  path: string
  // short branch name (refs/heads/<x> stripped), or '(detached)'.
  branch: string
  // true when this worktree is on `main` — the canonical/primary lane.
  is_main: boolean
  // `git status --porcelain` line count for the worktree.
  dirty_count: number
  // epoch-ms of the last commit (HEAD), or null if the worktree has no commits.
  last_commit_ms: number | null
  // subject line (%s) of the HEAD commit, or null if the worktree has no commits.
  last_commit_msg: string | null
  // max(mtime of each dirty file, last_commit_ms) — the freshest signal we have
  // that someone is working this lane. File-mtime heuristic only (see README).
  last_activity_ms: number
  // 'active' if last_activity_ms is within the active window, else 'idle'.
  // This is the FILE-MTIME activity signal; `agent` below is the orthogonal
  // live-process signal (a lane can have an agent attached yet read file-idle,
  // or read file-active with no agent because another tool touched files).
  state: LaneState
  // Live CC session(s) whose cwd is at or under this worktree (lsof process
  // detection; see agent.ts). null when detection is unavailable.
  agent: AgentInfo | null
}

// The served shape of a lane: the git-collected Lane plus the PR resolved on the
// slower gh cadence. `pr` is null for the main worktree (is_main), for branches
// with no PR, and whenever gh is unavailable (see LanesSnapshot.gh_available).
export interface ServedLane extends Lane {
  pr: PullRequest | null
}

export interface LanesSnapshot {
  lanes: Lane[]
}

// Mirrors mesh_introspection's FetchResult shape: a single ok/err discriminated
// union so the poll loop can branch without exceptions for the common failure.
export type CollectResult =
  | { ok: true; data: LanesSnapshot }
  | { ok: false; error: string }

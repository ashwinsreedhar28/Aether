// Local types for the lanes sensor. A "lane" is one git worktree of the shared
// Aether repository — each parallel CC session works a branch in its own
// worktree (see CLAUDE.md §13 lanes model). The node turns `git worktree list`
// + per-worktree dirtiness/commit data into an activity snapshot.

export type LaneState = 'active' | 'idle'

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
  // max(mtime of each dirty file, last_commit_ms) — the freshest signal we have
  // that someone is working this lane. File-mtime heuristic only (see README).
  last_activity_ms: number
  // 'active' if last_activity_ms is within the active window, else 'idle'.
  state: LaneState
}

export interface LanesSnapshot {
  lanes: Lane[]
}

// Mirrors mesh_introspection's FetchResult shape: a single ok/err discriminated
// union so the poll loop can branch without exceptions for the common failure.
export type CollectResult =
  | { ok: true; data: LanesSnapshot }
  | { ok: false; error: string }

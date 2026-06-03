# lanes

Sensor mesh node that polls git worktree state at 10s cadence and exposes
which development "lanes" (worktrees) are active vs idle through one mesh
surface. Each parallel CC session works a branch in its own worktree
(CLAUDE.md §13 lanes model); this node is the cockpit's "which agents are
working" layer. First-class consumer is the visualizer, which composes a
`dashboard.lanes` backdrop panel from this surface.

## Surfaces

- `lanes.status` — latest snapshot of every worktree of the shared repo.
  No params. Returns `{ lanes, fetched_at_ms, stale }` where each lane is
  `{ name, path, branch, is_main, dirty_count, last_commit_ms,
  last_activity_ms, state }` and `state` is `'active' | 'idle'`.

Cache-then-serve: invocations return the most recent successfully-collected
snapshot. If the cache is older than 30s, `stale: true` is set. If no poll
has succeeded yet (git unreadable at boot), the surface returns
`MeshDeny('repo_unreadable')`.

## Activity heuristic (and its limits)

A lane is `active` when its **freshest activity** —
`max(last commit, mtime of each dirty file)` — falls within a 5-minute
window, else `idle`. Per worktree the node runs `git status --porcelain`
(dirty count + which files to stat) and `git log -1 --format=%ct` (last
commit). It stats **only** the dirty-listed files; it never walks the tree.

This is a file-mtime heuristic, **not** live process detection. A lane with
a CC session attached but editing nothing reads `idle`; a lane whose files
were touched by an unrelated tool reads `active`. Detecting the actual CC
process per worktree is an explicit future enhancement, deliberately out of
scope here.

## Notifications

The node tracks each lane's previous state across polls. On an **observed**
`active → idle` transition (active on the prior poll, idle now — never on
first sight of a lane) it fires `host_notifications.notify`
(`"Lane idle: <branch>"`). Notify failures (missing edge, notifier down) are
logged and swallowed — a notification never crashes the sensor.

## State

In-memory cache only. No SQLite. The standard `running` marker file is
written under `$AETHER_DATA_DIR/lanes/running` after Core registration.

## Environment

- `MESH_LANES_SECRET` — required. Mesh identity secret, injected by the
  shell at startup.
- `MESH_CORE_URL` — defaults to `http://127.0.0.1:8000`.
- `AETHER_DATA_DIR` — required (marker file only).
- `LANES_ACTIVE_WINDOW_MS` — optional. Overrides the 5-minute active window
  (used by smoke tests to force an `active → idle` transition quickly).

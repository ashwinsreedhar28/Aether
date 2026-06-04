import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { REPO_ROOT } from './paths'

// Boot-time hygiene guard for the TS mesh nodes.
//
// TS nodes run from compiled dist/ (NodeManager spawns `node nodes/<name>/dist/
// index.js`), but `pnpm install` does NOT build them — only `pnpm -r build`
// does. So a fresh checkout, or a branch switch that touched a node's src/, can
// leave dist/ older than src/ and the shell will silently spawn stale code
// (the install-≠-build trap that served a stale visualizer dist off "fresh
// main"; see PR #168's stale-daemon finding for the sibling raven case).
//
// This walks both trees with mtime only — no hashing, no new deps — and logs a
// LOUD warning naming the node when src/ is newer than dist/. Warn-only v1: we
// never auto-build; the warning tells the Director to run `pnpm -r build`.
// Python nodes are out of scope (they run from source, so there is no dist/ to
// drift); NodeManager only spawns TS nodes, so calling this from spawnNode
// covers exactly the right set.

// Cheapest possible freshness signal: the newest file mtime anywhere under
// `dir`. Returns 0 for a missing/empty/unreadable tree so the caller treats it
// as "nothing built yet" rather than throwing during boot.
function newestMtimeMs(dir: string): number {
  let newest = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        try {
          const m = statSync(full).mtimeMs
          if (m > newest) newest = m
        } catch {
          /* unreadable file — skip, don't let it abort the walk */
        }
      }
    }
  }
  return newest
}

// `entry` is the spawn target: <repo>/nodes/<name>/dist/index.js.
export function warnIfDistStale(entry: string): void {
  const distDir = dirname(entry) // nodes/<name>/dist
  const nodeRoot = dirname(distDir) // nodes/<name>
  const srcDir = join(nodeRoot, 'src')
  // Nothing to compare if either tree is absent (e.g. a node shipped without a
  // src/ checkout). Strict `>` so an equal-mtime fresh build never false-warns
  // — a real build writes dist/ after src/, leaving dist mtime >= src mtime.
  if (!existsSync(srcDir) || !existsSync(distDir)) return
  if (newestMtimeMs(srcDir) > newestMtimeMs(distDir)) {
    const label = relative(REPO_ROOT, nodeRoot) // e.g. nodes/visualizer
    console.warn(`[guard] ${label} dist older than src — run pnpm -r build`)
  }
}

import { existsSync, readdirSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

// Boot-time freshness guard for the aether-rag retrieval index — the sibling of
// staleDist.ts (which guards compiled node dist/ against newer src/).
//
// The index (daemons/aether-rag/.rag/index.db) is a DERIVED, gitignored
// artifact: reindex.sh embeds the corpus into a sqlite-vec store by hand, so it
// drifts behind the corpus (docs, DECISIONS, CLAUDE.md, manifest, node READMEs)
// between manual reindexes — the same install-≠-build trap staleDist guards.
//
// At boot we compare the newest corpus-file mtime against the index mtime
// (mtime only, no hashing — mirrors staleDist) and act on the verdict:
//   - index EXISTS and is STALE → heal it: reindex.sh runs as a detached
//     background child (it owns the long embedding work; boot never blocks on
//     it) with start + finish logged.
//   - index MISSING or venv MISSING → warn only. We never bootstrap from
//     nothing at shell boot (predictable startup over magic; server.py's
//     missing-index path takes the same stance).
//
// The AUTHORITATIVE staleness *warning* lives in server.py, which derives the
// corpus from rag_lib.CORPUS_GLOBS directly (single source of truth). This boot
// heal is best-effort convenience layered on top, so if the mirror below drifts
// from CORPUS_GLOBS the only cost is the heal missing one file's change until
// the lists re-converge — the in-session warning stays correct regardless.

// MIRRORS rag_lib.py CORPUS_GLOBS — keep in sync. See the note above on why
// drift here is low-severity (server.py is the source of truth). The exact-sync
// is nonetheless enforced: staleRagIndex.test.ts parses CORPUS_GLOBS out of
// rag_lib.py and asserts CORPUS_GLOB_MIRROR (below) matches it, so the *next*
// CORPUS_GLOBS edit that isn't mirrored here fails a test rather than silently
// blinding the boot heal. Fixed paths are listed verbatim; the glob
// patterns are expanded by directory walks in newestCorpusMtimeMs.
const CORPUS_FIXED_FILES = [
  'docs/governance-log.md',
  'docs/rebase-playbook.md',
  'DECISIONS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'docs/claude-reference.md',
  'docs/scene-protocol.md',
  'docs/README.md',
  'README.md',
  'manifest.yaml',
] as const

// The glob-pattern corpus entries (the * cases CORPUS_FIXED_FILES can't
// hold). The directory walks in newestCorpusMtimeMs are these patterns'
// expansion; they live here as strings so the mirror below is the full set.
const CORPUS_RELEASES_GLOB = 'docs/releases/*.md'
const CORPUS_NODE_READMES_GLOB = 'nodes/*/README.md'
// #222: per-lane changelog fragments + one-ADR-per-file split.
const CORPUS_CHANGELOG_FRAGMENTS_GLOB = 'changelog/unreleased/*.md'
const CORPUS_DECISIONS_GLOB = 'decisions/*.md'

// The complete glob set this guard mirrors from rag_lib.py CORPUS_GLOBS, order
// irrelevant (rag_lib notes order is cosmetic). Exported solely for the sync
// test; the boot heal itself consumes CORPUS_FIXED_FILES + the walks.
export const CORPUS_GLOB_MIRROR: readonly string[] = [
  ...CORPUS_FIXED_FILES,
  CORPUS_RELEASES_GLOB,
  CORPUS_NODE_READMES_GLOB,
  CORPUS_CHANGELOG_FRAGMENTS_GLOB,
  CORPUS_DECISIONS_GLOB,
]

// Newest mtime (ms) across every existing corpus file under `repoRoot`. Returns
// 0 when nothing matches, so a fresh checkout with no corpus reads as "older
// than any index" rather than throwing during boot.
export function newestCorpusMtimeMs(repoRoot: string): number {
  let newest = 0
  const consider = (path: string): void => {
    try {
      const m = statSync(path).mtimeMs
      if (m > newest) newest = m
    } catch {
      /* missing/unreadable corpus file — skip, don't abort the scan */
    }
  }

  for (const rel of CORPUS_FIXED_FILES) consider(join(repoRoot, rel))

  // The flat-directory *.md globs: docs/releases/*.md,
  // changelog/unreleased/*.md, decisions/*.md (#222).
  for (const dir of [
    join(repoRoot, 'docs', 'releases'),
    join(repoRoot, 'changelog', 'unreleased'),
    join(repoRoot, 'decisions'),
  ]) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          consider(join(dir, entry.name))
        }
      }
    } catch {
      /* directory missing — skip */
    }
  }

  // nodes/*/README.md
  const nodesDir = join(repoRoot, 'nodes')
  try {
    for (const entry of readdirSync(nodesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) consider(join(nodesDir, entry.name, 'README.md'))
    }
  } catch {
    /* no nodes/ — skip */
  }

  return newest
}

export type RagIndexState = 'missing-venv' | 'missing-index' | 'fresh' | 'stale'

export interface RagIndexStatus {
  state: RagIndexState
  indexMtimeMs: number | null
  corpusMtimeMs: number
  ragDir: string
}

// Pure classification — no spawn, no logging — so the mtime logic is testable
// in isolation against a throwaway repo root (see staleRagIndex.test.ts).
export function classifyRagIndex(repoRoot: string): RagIndexStatus {
  const ragDir = join(repoRoot, 'daemons', 'aether-rag')
  const venvPython = join(ragDir, '.venv', 'bin', 'python')
  const indexDb = join(ragDir, '.rag', 'index.db')

  // reindex.sh needs .venv/bin/python; without it we cannot heal, and
  // bootstrapping a venv at shell boot is out of bounds.
  if (!existsSync(venvPython)) {
    return { state: 'missing-venv', indexMtimeMs: null, corpusMtimeMs: 0, ragDir }
  }
  if (!existsSync(indexDb)) {
    return { state: 'missing-index', indexMtimeMs: null, corpusMtimeMs: 0, ragDir }
  }
  let indexMtimeMs: number
  try {
    indexMtimeMs = statSync(indexDb).mtimeMs
  } catch {
    // Raced away between existsSync and stat — treat as missing.
    return { state: 'missing-index', indexMtimeMs: null, corpusMtimeMs: 0, ragDir }
  }
  const corpusMtimeMs = newestCorpusMtimeMs(repoRoot)
  // Strict `>`: reindex.sh writes the DB after reading the sources, so a fresh
  // build leaves index >= every corpus mtime; an equal mtime reads as fresh.
  return {
    state: corpusMtimeMs > indexMtimeMs ? 'stale' : 'fresh',
    indexMtimeMs,
    corpusMtimeMs,
    ragDir,
  }
}

// Boot entry point. Fire-and-forget: classifies the index, warns on
// missing-venv / missing-index, and kicks reindex.sh as a background child when
// (and only when) an existing index is stale. Returns immediately; the reindex
// runs detached and logs its own completion. `repoRoot` is injected (rather
// than imported from ./paths) so the module stays free of the electron
// dependency and the mtime logic above is unit-testable under `node --test`.
export function healStaleRagIndexAtBoot(repoRoot: string): void {
  const status = classifyRagIndex(repoRoot)
  const relDir = 'daemons/aether-rag'

  switch (status.state) {
    case 'missing-venv':
      console.warn(
        `[rag-guard] aether-rag venv missing (${relDir}/.venv) — skipping index freshness check; run setup + reindex.sh`,
      )
      return
    case 'missing-index':
      console.warn(
        `[rag-guard] aether-rag index missing (${relDir}/.rag/index.db) — run reindex.sh (boot never bootstraps it)`,
      )
      return
    case 'fresh':
      return
    case 'stale':
      break
  }

  const reindexScript = join(status.ragDir, 'reindex.sh')
  if (!existsSync(reindexScript)) {
    console.warn(`[rag-guard] index stale but ${relDir}/reindex.sh missing — cannot heal`)
    return
  }

  console.log(
    '[rag-guard] aether-rag index stale (corpus newer than index) — running reindex.sh in background',
  )
  const startedAt = Date.now()
  const child = spawn(reindexScript, [], { cwd: status.ragDir, stdio: 'ignore' })
  child.on('error', (err) => {
    console.warn('[rag-guard] reindex.sh failed to spawn:', err.message)
  })
  child.on('exit', (code, signal) => {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (code === 0) {
      console.log(`[rag-guard] aether-rag reindex finished in ${secs}s — index now fresh`)
    } else {
      console.warn(
        `[rag-guard] aether-rag reindex exited code=${code} signal=${signal ?? 'none'} after ${secs}s — index may still be stale`,
      )
    }
  })
  // Fire-and-forget by design — deliberately NOT registered in index.ts's
  // stopAllChildren() / appLifecycle latch (which exist to stop port-holding
  // daemons orphaning on quit). reindex.sh is a one-shot batch that holds no
  // port and exits on its own; letting it finish after a quit just leaves a
  // FRESH index for the next boot, whereas killing it mid-run would leave a
  // wiped/partial one (reindex.sh rm's the DB first). unref() so it never
  // holds the event loop open or delays shutdown.
  child.unref()
}

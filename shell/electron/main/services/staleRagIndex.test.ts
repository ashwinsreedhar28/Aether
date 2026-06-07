// Isolated test for the aether-rag boot freshness guard — the mtime
// classification only (no Electron, no reindex spawn), exercised against a
// throwaway temp repo root with mtimes pinned via utimesSync.
//
// Run with Node's built-in runner (Node 22 strips types):
//   node --test shell/electron/main/services/staleRagIndex.test.ts
// The relative import carries a .ts extension because the runner resolves it;
// tsconfig sets allowImportingTsExtensions so `tsc --noEmit` accepts it too.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { classifyRagIndex, newestCorpusMtimeMs, CORPUS_GLOB_MIRROR } from './staleRagIndex.ts'

// services → main → electron → shell → repo root (four levels up).
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

// Epoch seconds for deterministic, well-separated mtimes.
const T_OLD = 1_700_000_000
const T_NEW = 1_800_000_000

function write(root: string, rel: string, mtimeSec: number): string {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rel)
  utimesSync(path, mtimeSec, mtimeSec)
  return path
}

function freshRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'rag-stale-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const RAG = 'daemons/aether-rag'

test('missing venv → missing-venv (warn-only, never heal)', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, 'DECISIONS.md', T_OLD)
    write(root, `${RAG}/.rag/index.db`, T_NEW)
    // no .venv/bin/python
    assert.equal(classifyRagIndex(root).state, 'missing-venv')
  } finally {
    cleanup()
  }
})

test('venv present, no index → missing-index (boot never bootstraps)', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, `${RAG}/.venv/bin/python`, T_OLD)
    write(root, 'DECISIONS.md', T_NEW)
    assert.equal(classifyRagIndex(root).state, 'missing-index')
  } finally {
    cleanup()
  }
})

test('index newer than corpus → fresh', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, `${RAG}/.venv/bin/python`, T_OLD)
    write(root, 'DECISIONS.md', T_OLD)
    write(root, 'docs/rebase-playbook.md', T_OLD)
    write(root, `${RAG}/.rag/index.db`, T_NEW)
    assert.equal(classifyRagIndex(root).state, 'fresh')
  } finally {
    cleanup()
  }
})

test('a corpus file newer than index → stale', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, `${RAG}/.venv/bin/python`, T_OLD)
    write(root, `${RAG}/.rag/index.db`, T_OLD)
    // The smoke-test file: touching it must flip the verdict to stale.
    write(root, 'docs/rebase-playbook.md', T_NEW)
    assert.equal(classifyRagIndex(root).state, 'stale')
  } finally {
    cleanup()
  }
})

test('equal mtime is fresh, not stale (no false-positive heal)', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, `${RAG}/.venv/bin/python`, T_OLD)
    write(root, 'DECISIONS.md', T_NEW)
    write(root, `${RAG}/.rag/index.db`, T_NEW)
    assert.equal(classifyRagIndex(root).state, 'fresh')
  } finally {
    cleanup()
  }
})

test('newestCorpusMtimeMs spans fixed files, docs/releases/*.md, nodes/*/README.md', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, 'CLAUDE.md', T_OLD)
    write(root, 'docs/releases/v0.1.0.md', T_OLD)
    // The newest signal comes from a per-node README (a glob-expanded source).
    write(root, 'nodes/weather/README.md', T_NEW)
    assert.equal(newestCorpusMtimeMs(root), T_NEW * 1000)
  } finally {
    cleanup()
  }
})

test('newestCorpusMtimeMs ignores non-corpus files', () => {
  const { root, cleanup } = freshRoot()
  try {
    write(root, 'CLAUDE.md', T_OLD)
    // Not in the corpus: a stray newer file must not inflate the verdict.
    write(root, 'src/some-code.ts', T_NEW)
    write(root, 'docs/not-indexed.txt', T_NEW)
    assert.equal(newestCorpusMtimeMs(root), T_OLD * 1000)
  } finally {
    cleanup()
  }
})

// --- Mirror-sync guard ------------------------------------------------------
// The boot heal mirrors rag_lib.py CORPUS_GLOBS (the Python source of truth) in
// TS. These two tests make a CORPUS_GLOBS change that isn't mirrored here fail
// CI/local instead of silently blinding the guard (a stale mirror would just
// stop noticing edits to the un-mirrored glob).

// Parse the CORPUS_GLOBS tuple out of rag_lib.py without importing Python.
function pythonCorpusGlobs(repoRoot: string): string[] {
  const src = readFileSync(join(repoRoot, 'daemons', 'aether-rag', 'rag_lib.py'), 'utf8')
  const block = src.match(/CORPUS_GLOBS[^=]*=\s*\(([\s\S]*?)\)/)
  assert.ok(block, 'CORPUS_GLOBS tuple not found in rag_lib.py')
  return [...(block[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')
}

test('CORPUS_GLOB_MIRROR has the expected entries (tripwire on intentional change)', () => {
  // Length + entries. A deliberate corpus change updates this list AND the
  // Python tuple in the same PR; an accidental divergence trips here.
  assert.deepEqual(
    [...CORPUS_GLOB_MIRROR],
    [
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
      'docs/releases/*.md',
      'nodes/*/README.md',
    ],
  )
})

test('CORPUS_GLOB_MIRROR matches rag_lib.py CORPUS_GLOBS exactly', () => {
  const py = pythonCorpusGlobs(REPO_ROOT)
  // Order is cosmetic (rag_lib says so) — compare as sorted sets.
  assert.deepEqual([...CORPUS_GLOB_MIRROR].sort(), [...py].sort())
})

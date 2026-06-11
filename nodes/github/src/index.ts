import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode } from '@aether/mesh-node-sdk'
import { GithubClient } from './github'
import {
  makeCommentIssueHandler,
  makeCreateIssueHandler,
  makeListIssuesHandler,
} from './handlers'

// github is the mesh's GitHub Actor (the one-rail arc, #255/#256): gaps file
// as GitHub issues instead of a local ledger, and the open issue board is the
// work queue every surface reads. Three surfaces: create_issue (dedup inside —
// a repeat ask comments the existing gap issue and returns { deduped: true }),
// list_issues (the board, cache-then-serve), comment_issue (add detail by
// number). Auth is a fine-grained PAT in AETHER_GITHUB_TOKEN (Issues RW only);
// the token is read once at boot and NEVER logged — presence only. Token
// absent = degraded mode: the node still boots and registers, list_issues
// serves a clean no-token payload, writes deny with github_no_token.

const NODE_ID = 'github'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

// Repo as config, never constant (#255 ruling 5 — the multi-repo seed). The
// default is Aether's own repo; both env vars are recorded for #223's
// env-contract blessing.
const DEFAULT_REPO = 'ashwinsreedhar28/Aether'
const REPO_SHAPE = /^[\w.-]+\/[\w.-]+$/

function log(msg: string): void {
  // Plain stdout is safe here — Core consumes HTTP/SSE over loopback, not
  // stdout (CLAUDE.md §10 applies only to JSON-RPC daemons).
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

async function main(): Promise<void> {
  const secret = process.env.MESH_GITHUB_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_GITHUB_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  const repo = (process.env.AETHER_GITHUB_REPO ?? '').trim() || DEFAULT_REPO
  if (!REPO_SHAPE.test(repo)) {
    // A malformed repo is misconfiguration, not a missing capability — fail
    // loud at boot rather than 404 on every invocation.
    process.stderr.write(`[${NODE_ID}] AETHER_GITHUB_REPO must be owner/name; refusing to start.\n`)
    process.exit(2)
  }

  // Missing token is NOT fatal (#255 item 2): boot degraded, stay clean.
  const token = (process.env.AETHER_GITHUB_TOKEN ?? '').trim()
  const client = token ? new GithubClient(repo, token) : null

  const nodeDir = join(dataDir, NODE_ID)
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const deps = { client, log }
  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('create_issue', makeCreateIssueHandler(deps))
  node.on('list_issues', makeListIssuesHandler(deps))
  node.on('comment_issue', makeCommentIssueHandler(deps))
  await node.start()
  log(
    `registered with core at ${CORE_URL}; repo ${repo}; token ${
      client ? 'present' : 'ABSENT — degraded no-token mode'
    }`,
  )

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    try {
      unlinkSync(markerPath)
    } catch {
      /* already gone */
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})

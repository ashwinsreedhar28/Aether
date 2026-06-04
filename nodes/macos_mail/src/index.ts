import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { MailPoller } from './poller'
import { MailStore } from './storage'

const execFileP = promisify(execFile)

const NODE_ID = 'macos_mail'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

interface RecentArgs {
  limit?: number
  since?: string
  unread_only?: boolean
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with a structured protocol — Core
  // consumes HTTP/SSE over loopback, not stdout — so plain stdout is
  // safe here. (See CLAUDE.md §10 for the case where it isn't.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > MAX_LIMIT) return MAX_LIMIT
  return n
}

function makeRecentHandler(store: MailStore) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as RecentArgs
    const limit = clampLimit(payload?.limit ?? DEFAULT_LIMIT)
    const since = typeof payload?.since === 'string' ? payload.since : undefined
    if (since !== undefined) {
      const t = Date.parse(since)
      if (Number.isNaN(t)) {
        throw new MeshDeny('macos_mail_bad_since', { since })
      }
    }
    const unreadOnly = payload?.unread_only === true
    // Each message carries its captured body (plain-text, normalized,
    // ~1500-char cap) and bodyTruncated flag; body is null when unreadable
    // or for rows captured before the v2 schema.
    const messages = store.recent({ limit, since, unreadOnly })
    return { messages }
  }
}

interface OpenMessageArgs {
  id?: unknown
}

// Actor surface: open a specific message in Mail.app. Deliberately via
// LaunchServices (`open message://…`) and NOT AppleScript — the message: URL
// scheme is handled by Mail's URL handler, which stays responsive even when
// Mail's Apple-Event interface is degraded (the latency that blocks the
// poller). The stored uid IS the RFC Message-ID (Mail's `message id`), which
// is exactly what the message: scheme matches on.
async function handleOpenMessage(env: Envelope): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new MeshDeny('macos_mail_unsupported', {
      platform: process.platform,
      reason: 'macOS-only; message:// open is a LaunchServices/Mail.app path',
    })
  }
  const payload = env.payload as OpenMessageArgs
  const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
  // A real RFC Message-ID is a dot-atom@domain (or quoted) token — never
  // contains whitespace or angle brackets. Reject anything that would break
  // the URL rather than handing junk to LaunchServices.
  if (id.length === 0 || /[\s<>]/.test(id)) {
    throw new MeshDeny('macos_mail_bad_message_id', { id: payload?.id })
  }
  // Angle brackets are percent-encoded (%3c/%3e); the Message-ID itself is a
  // URL-safe token and used as-is (verified against the live message: scheme).
  const url = `message://%3c${id}%3e`
  try {
    await execFileP('open', [url])
  } catch (e) {
    throw new MeshDeny('macos_mail_open_failed', {
      details: (e as Error).message,
    })
  }
  return { opened: true, id }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_MACOS_MAIL_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_MACOS_MAIL_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }

  const nodeDir = join(dataDir, 'macos_mail')
  mkdirSync(nodeDir, { recursive: true })
  const dbPath = join(nodeDir, 'mail.db')
  const markerPath = join(nodeDir, 'running')

  const store = new MailStore(dbPath)
  log(`storage opened at ${dbPath} (existing rows=${store.count()})`)

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('recent', makeRecentHandler(store))
  node.on('open_message', handleOpenMessage)
  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  const poller = new MailPoller({ store, log })
  poller.start()
  log(`poller started — 60s cadence via @aether/macos-applescript`)

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
      poller.stop()
    } catch (e) {
      log(`poller stop error: ${(e as Error).message}`)
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    try {
      store.close()
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

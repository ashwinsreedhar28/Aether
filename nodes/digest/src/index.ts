import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode } from '@homeos/mesh-node-sdk'
import { composeBriefing } from './composer'
import { BriefingScheduler, schedulerEnabled } from './scheduler'
import type { TimeOfDay } from './types'

const NODE_ID = 'digest'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function makeBriefingHandler(node: MeshNode, timeOfDay: TimeOfDay) {
  // Surface handler is a thin wrapper around composeBriefing. The
  // composer never throws — upstream failures degrade to
  // "available: false" sections — so we don't need a try/catch here.
  // The Envelope arg is unused (no params on either surface), so we
  // take zero args and rely on the SDK accepting fewer-arity handlers.
  return async (): Promise<Record<string, unknown>> => {
    const result = await composeBriefing(timeOfDay, { node })
    return result as unknown as Record<string, unknown>
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_DIGEST_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_DIGEST_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  const dataDir = process.env.HOMEOS_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] HOMEOS_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }
  // Marker file under HOMEOS_DATA_DIR mirrors news_feeds / finance for
  // liveness consistency, even though digest has no DB or other
  // persisted state. Future PRs (last-fired briefing stamp) may use it.
  const nodeDir = join(dataDir, 'digest')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  node.on('morning', makeBriefingHandler(node, 'morning'))
  node.on('evening', makeBriefingHandler(node, 'evening'))

  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  let scheduler: BriefingScheduler | null = null
  if (schedulerEnabled()) {
    scheduler = new BriefingScheduler({ node, log })
    scheduler.start()
  } else {
    log('scheduler disabled (set DIGEST_SCHEDULED=true to enable)')
  }

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    scheduler?.stop()
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

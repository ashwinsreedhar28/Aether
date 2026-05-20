import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

const NODE_ID = 'time'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

type Format = 'iso' | 'human'

interface NowArgs {
  zone?: unknown
  format?: unknown
}

function log(msg: string): void {
  // Mesh nodes don't share stdout with anyone speaking a structured
  // protocol — Core consumes the HTTP/SSE stream over loopback, not
  // stdout — so plain stdout is safe. (CLAUDE.md §10 — applies only
  // to JSON-RPC daemons.)
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function isValidZone(zone: string): boolean {
  // Intl.DateTimeFormat throws RangeError on unknown IANA names. Wrap
  // construction and treat the throw as the validation signal — there
  // is no public Intl API for "is this a known zone?".
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return true
  } catch (err) {
    if (err instanceof RangeError) return false
    throw err
  }
}

function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function formatIso(now: Date, zone: string): string {
  // formatToParts with longOffset yields a part like 'GMT-04:00' (or
  // 'GMT' for UTC). We strip the 'GMT' prefix to produce a true ISO
  // 8601 offset suffix; bare UTC becomes 'Z'.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(now)

  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // hour12:false renders midnight as '24' on some ICU builds; normalize.
  const hour = map.hour === '24' ? '00' : (map.hour ?? '00')
  const year = map.year ?? '0000'
  const month = map.month ?? '01'
  const day = map.day ?? '01'
  const minute = map.minute ?? '00'
  const second = map.second ?? '00'
  const tzName = map.timeZoneName ?? ''
  let suffix: string
  if (tzName === 'GMT' || tzName === '') {
    suffix = 'Z'
  } else if (tzName.startsWith('GMT')) {
    suffix = tzName.slice(3)
  } else {
    suffix = tzName
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`
}

function formatHuman(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(now)
}

function makeNowHandler() {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as NowArgs
    const zoneRaw = payload.zone
    const formatRaw = payload.format

    let zone: string
    if (zoneRaw === undefined || zoneRaw === null || zoneRaw === '') {
      zone = systemZone()
    } else if (typeof zoneRaw !== 'string' || !isValidZone(zoneRaw)) {
      throw new MeshDeny('time_bad_zone', { zone: zoneRaw })
    } else {
      zone = zoneRaw
    }

    const format: Format = formatRaw === 'human' ? 'human' : 'iso'
    const now = new Date()
    const time = format === 'iso' ? formatIso(now, zone) : formatHuman(now, zone)
    return { time, zone, unix_ms: now.getTime() }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_TIME_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_TIME_SECRET is required; refusing to start.\n`,
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

  const nodeDir = join(dataDir, 'time')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const node = new MeshNode(NODE_ID, secret, CORE_URL)
  node.on('now', makeNowHandler())
  await node.start()
  log(`registered with core at ${CORE_URL}`)

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

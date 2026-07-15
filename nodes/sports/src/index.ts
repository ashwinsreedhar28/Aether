import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'
import { SportsClient, SportsClientError } from './client'
import { LEAGUE_IDS, fmtEspnDate, leagueById, listLeagues } from './catalog'
import type { Game, GameDetail, SportsTeam } from './types'

const NODE_ID = 'sports'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface ScoresArgs {
  league?: unknown
  date?: unknown
}

interface GameArgs {
  league?: unknown
  event_id?: unknown
}

interface TeamsArgs {
  league?: unknown
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

// Validate a `league` arg against the catalog. Throws MeshDeny with the
// valid id list on miss — mirrors how finance rejects untracked symbols.
function requireLeague(payload: { league?: unknown }): string {
  const league = typeof payload?.league === 'string' ? payload.league.toLowerCase() : ''
  if (!league) {
    throw new MeshDeny('sports_league_required', { valid: LEAGUE_IDS })
  }
  if (!leagueById(league)) {
    throw new MeshDeny('sports_unknown_league', { league, valid: LEAGUE_IDS })
  }
  return league
}

// Map a SportsClientError (HTTP/timeout/network) to a named MeshDeny so
// the caller sees a clean denial rather than a raw exception.
function denyFromClientError(e: unknown, context: Record<string, unknown>): never {
  if (e instanceof SportsClientError) {
    throw new MeshDeny(`sports_${e.reason}`, { ...context, ...e.details })
  }
  throw new MeshDeny('sports_fetch_failed', { ...context, details: (e as Error).message })
}

function makeLeaguesHandler() {
  return async (): Promise<Record<string, unknown>> => {
    // Pure: catalog + per-call season/playoff flags, no network.
    return { leagues: listLeagues() }
  }
}

function makeScoresHandler(client: SportsClient) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as ScoresArgs
    const league = requireLeague(payload)

    // date is optional; default today. Accept ISO YYYY-MM-DD and convert
    // to ESPN's YYYYMMDD. An off-season / no-games date yields an empty
    // games array (not an error) — ESPN 404s are absorbed in the client.
    let isoDate: string
    let espnDate: string
    if (payload.date === undefined || payload.date === null) {
      espnDate = fmtEspnDate(new Date())
      isoDate = `${espnDate.slice(0, 4)}-${espnDate.slice(4, 6)}-${espnDate.slice(6, 8)}`
    } else {
      if (typeof payload.date !== 'string' || !ISO_DATE_RE.test(payload.date)) {
        throw new MeshDeny('sports_bad_date', { date: payload.date, format: 'YYYY-MM-DD' })
      }
      isoDate = payload.date
      espnDate = payload.date.replace(/-/g, '')
    }

    let games: Game[]
    try {
      games = await client.listGames(league, espnDate)
    } catch (e) {
      denyFromClientError(e, { league, date: isoDate })
    }
    return { league, date: isoDate, games }
  }
}

function makeGameHandler(client: SportsClient) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as GameArgs
    const league = requireLeague(payload)
    const eventId = typeof payload?.event_id === 'string' ? payload.event_id.trim() : ''
    if (!eventId) {
      throw new MeshDeny('sports_event_required', { detail: 'event_id_required' })
    }

    let detail: GameDetail | null
    try {
      detail = await client.getGameDetail(league, eventId)
    } catch (e) {
      denyFromClientError(e, { league, event_id: eventId })
    }
    if (!detail) {
      throw new MeshDeny('sports_game_not_found', { league, event_id: eventId })
    }
    return { game: detail }
  }
}

function makeTeamsHandler(client: SportsClient) {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = env.payload as TeamsArgs
    const league = requireLeague(payload)

    let teams: SportsTeam[]
    try {
      teams = await client.listTeams(league)
    } catch (e) {
      denyFromClientError(e, { league })
    }
    return { league, teams }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_SPORTS_SECRET
  if (!secret) {
    process.stderr.write(`[${NODE_ID}] MESH_SPORTS_SECRET is required; refusing to start.\n`)
    process.exit(2)
  }
  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`)
    process.exit(2)
  }

  // Marker file under AETHER_DATA_DIR is the node's liveness signal
  // (matches the other data nodes). No SQLite — the TTL caches live in
  // memory, so a cold start just refetches from ESPN on first call.
  const nodeDir = join(dataDir, 'sports')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const client = new SportsClient({ log })
  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  node.on('leagues', makeLeaguesHandler())
  node.on('scores', makeScoresHandler(client))
  node.on('game', makeGameHandler(client))
  node.on('teams', makeTeamsHandler(client))

  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`ready — ${LEAGUE_IDS.length} leagues, on-demand ESPN fetch`)

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

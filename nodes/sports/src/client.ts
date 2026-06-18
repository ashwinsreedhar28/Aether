import { leagueById } from './catalog'
import { TtlCache } from './storage'
import type {
  Game,
  GameDetail,
  GameDetailStat,
  GameHeadline,
  GameSeries,
  GameStatus,
  GameTeam,
  SportsTeam,
} from './types'

// ESPN's public (unofficial) site API. No API key, no quota to track.
//   Scoreboard: GET /{path}/scoreboard?dates=YYYYMMDD[-YYYYMMDD]
//   Summary:    GET /{path}/summary?event={eventId}
//   Teams:      GET /{path}/teams?limit=200
// where {path} is the league's ESPN path segment (e.g. 'basketball/nba').
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const FETCH_TIMEOUT_MS = 12_000

// Per-surface TTLs, lifted from Pulse. Scoreboard is near-real-time during
// live games; summary (box score) tolerates a slightly longer window;
// teams change once a season.
const SCOREBOARD_TTL_MS = 15_000
const SUMMARY_TTL_MS = 60_000
const TEAMS_TTL_MS = 24 * 60 * 60 * 1000

// Failure taxonomy surfaced to the handler (which maps reason → MeshDeny).
//   http_error  → ESPN returned a non-2xx (status carried in details)
//   timeout     → the request exceeded FETCH_TIMEOUT_MS
//   network     → fetch threw (DNS / connection / abort that wasn't a timeout)
export type SportsClientReason = 'http_error' | 'timeout' | 'network'

export class SportsClientError extends Error {
  constructor(
    public readonly reason: SportsClientReason,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`${reason}: ${JSON.stringify(details)}`)
    this.name = 'SportsClientError'
  }
}

export interface SportsClientOptions {
  /** Override for tests / fault injection. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Log sink for non-fatal warnings. Defaults to no-op so the client
   *  stays embeddable. */
  log?: (msg: string) => void
}

export class SportsClient {
  private readonly fetchImpl: typeof fetch
  private readonly log: (msg: string) => void
  private readonly scoreboardCache = new TtlCache<Game[]>(SCOREBOARD_TTL_MS)
  private readonly summaryCache = new TtlCache<GameDetail>(SUMMARY_TTL_MS)
  private readonly teamsCache = new TtlCache<SportsTeam[]>(TEAMS_TTL_MS)

  constructor(opts: SportsClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.log = opts.log ?? ((): void => {})
  }

  // Scoreboard for a single ESPN date (YYYYMMDD). An HTTP 404 means ESPN
  // has no events for that date (routine off-season / no-games day) — we
  // return [] rather than erroring, so an off-season query is empty-not-
  // failed. Other HTTP/network errors propagate as SportsClientError.
  async listGames(leagueId: string, espnDate: string): Promise<Game[]> {
    const league = leagueById(leagueId)
    if (!league) return []
    const path = league.paths[0] as string
    const cacheKey = `${leagueId}:${espnDate}`
    const cached = this.scoreboardCache.get(cacheKey)
    if (cached) return cached

    const url = `${ESPN_BASE}/${path}/scoreboard?dates=${espnDate}`
    let json: unknown
    try {
      json = await this.fetchJson(url)
    } catch (e) {
      if (e instanceof SportsClientError && e.reason === 'http_error' && e.details.status === 404) {
        this.scoreboardCache.set(cacheKey, [])
        return []
      }
      throw e
    }
    const games = extractGames(json, leagueId, path).sort((a, b) => a.date - b.date)
    this.scoreboardCache.set(cacheKey, games)
    return games
  }

  // Box-score detail for one event. Returns null when ESPN's summary has
  // no parseable game (unknown event id); network/HTTP errors propagate.
  async getGameDetail(leagueId: string, eventId: string): Promise<GameDetail | null> {
    const league = leagueById(leagueId)
    if (!league) return null
    const path = league.paths[0] as string
    const cacheKey = `${path}:${eventId}`
    const cached = this.summaryCache.get(cacheKey)
    if (cached) return cached

    const url = `${ESPN_BASE}/${path}/summary?event=${encodeURIComponent(eventId)}`
    let json: unknown
    try {
      json = await this.fetchJson(url)
    } catch (e) {
      // ESPN 404s an unknown event id rather than returning an empty
      // summary — treat that as "not found" (→ sports_game_not_found),
      // not an upstream error. Other failures propagate.
      if (e instanceof SportsClientError && e.reason === 'http_error' && e.details.status === 404) {
        return null
      }
      throw e
    }
    const detail = extractGameDetail(json, leagueId, path, eventId)
    if (!detail) return null
    this.summaryCache.set(cacheKey, detail)
    return detail
  }

  // Team directory for a league, alphabetised by display name.
  async listTeams(leagueId: string): Promise<SportsTeam[]> {
    const league = leagueById(leagueId)
    if (!league) return []
    const path = league.paths[0] as string
    const cached = this.teamsCache.get(leagueId)
    if (cached) return cached

    const url = `${ESPN_BASE}/${path}/teams?limit=200`
    const json = (await this.fetchJson(url)) as EspnTeamsResponse
    const collected: SportsTeam[] = []
    const seen = new Set<string>()
    const entries = json.sports?.[0]?.leagues?.[0]?.teams ?? []
    for (const entry of entries) {
      const t = entry.team
      if (!t?.id) continue
      const id = String(t.id)
      if (seen.has(id)) continue
      seen.add(id)
      collected.push({
        id,
        name: t.name ?? t.displayName ?? t.shortDisplayName ?? id,
        displayName: t.displayName ?? t.name ?? id,
        shortName: t.shortDisplayName ?? t.displayName ?? t.name ?? id,
        abbreviation: t.abbreviation ?? id.toUpperCase(),
        location: t.location ?? null,
        logoURL: t.logos?.[0]?.href ?? null,
      })
    }
    collected.sort((a, b) => a.displayName.localeCompare(b.displayName))
    this.teamsCache.set(leagueId, collected)
    return collected
  }

  private async fetchJson(url: string): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': 'Aether/0.1 (sports node)', Accept: 'application/json' },
        signal: ctrl.signal,
      })
    } catch (e) {
      if (ctrl.signal.aborted) {
        throw new SportsClientError('timeout', { timeout_ms: FETCH_TIMEOUT_MS })
      }
      throw new SportsClientError('network', { message: (e as Error).message })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      throw new SportsClientError('http_error', { status: res.status })
    }
    return res.json()
  }
}

// ---------- ESPN payload shapes (narrow — only the fields we read) ----------

interface EspnTeamsResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team?: {
          id?: string | number
          displayName?: string
          shortDisplayName?: string
          abbreviation?: string
          location?: string
          name?: string
          logos?: Array<{ href?: string }>
        }
      }>
    }>
  }>
}

interface EspnCompetitor {
  id?: string
  homeAway?: string
  winner?: boolean
  score?: string | number
  records?: Array<{ summary?: string; type?: string }>
  team?: {
    id?: string
    displayName?: string
    shortDisplayName?: string
    abbreviation?: string
    logo?: string
    logos?: Array<{ href?: string }>
    color?: string
    alternateColor?: string
  }
}

interface EspnCompetition {
  id?: string
  date?: string
  venue?: { fullName?: string; address?: { city?: string; state?: string } }
  broadcasts?: Array<{ names?: string[]; media?: { shortName?: string } }>
  competitors?: EspnCompetitor[]
  status?: EspnStatus
  note?: string
  series?: {
    title?: string
    summary?: string
    competitors?: Array<{ id?: string | number; wins?: number }>
  }
  notes?: Array<{ headline?: string; type?: string }>
}

interface EspnStatus {
  type?: {
    name?: string
    state?: string
    detail?: string
    shortDetail?: string
  }
  period?: number
  displayClock?: string
}

interface EspnEvent {
  id?: string
  date?: string
  competitions?: EspnCompetition[]
  status?: EspnStatus
}

// A team's box-score statistics come in two shapes depending on the
// sport: a flat list of leaf stats (NBA/NFL/NHL/soccer —
// `{ label, displayValue }`) or grouped (MLB — `{ displayName, stats: [
// { displayName, displayValue } ] }` for batting/pitching/fielding).
// teamStatRows() flattens both into a label→value map.
interface EspnStatLeaf {
  label?: string
  name?: string
  displayName?: string
  shortDisplayName?: string
  abbreviation?: string
  displayValue?: string
}

interface EspnTeamStatEntry extends EspnStatLeaf {
  stats?: EspnStatLeaf[]
}

interface EspnBoxscoreTeam {
  team?: { homeAway?: string }
  homeAway?: string
  statistics?: EspnTeamStatEntry[]
}

interface EspnSummaryJson {
  header?: { competitions?: EspnCompetition[] }
  boxscore?: { teams?: EspnBoxscoreTeam[] }
  headlines?: Array<{
    description?: string
    title?: string
    type?: string
    links?: { web?: { href?: string } }
  }>
}

// ---------- parse helpers (lifted, trimmed) ----------

function extractGames(json: unknown, leagueId: string, leaguePath: string): Game[] {
  const events = (json as { events?: EspnEvent[] }).events ?? []
  const out: Game[] = []
  for (const event of events) {
    const game = buildGameFromEvent(event, leagueId, leaguePath)
    if (game) out.push(game)
  }
  return out
}

function buildGameFromEvent(
  event: EspnEvent,
  leagueId: string,
  leaguePath: string,
): Game | null {
  const comp = event.competitions?.[0]
  if (!comp) return null
  const competitors = comp.competitors ?? []
  const homeRaw = competitors.find((c) => c.homeAway === 'home') ?? competitors[0]
  const awayRaw = competitors.find((c) => c.homeAway === 'away') ?? competitors[1]
  if (!homeRaw || !awayRaw) return null
  const status = event.status ?? comp.status
  const state = status?.type?.state ?? 'pre'
  const normalized: GameStatus =
    state === 'in' ? 'in_progress' : state === 'post' ? 'final' : 'scheduled'
  const typeName = (status?.type?.name ?? '').toUpperCase()
  const isPostponed = typeName.includes('POSTPONED')
  const isCanceled = typeName.includes('CANCEL')
  const finalStatus: GameStatus = isPostponed
    ? 'postponed'
    : isCanceled
      ? 'canceled'
      : normalized

  const fallbackVenue =
    [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', ') || null
  const venueName = comp.venue?.fullName ?? fallbackVenue

  const broadcasts: string[] = []
  for (const b of comp.broadcasts ?? []) {
    if (b.names) broadcasts.push(...b.names)
    else if (b.media?.shortName) broadcasts.push(b.media.shortName)
  }

  return {
    id: event.id ?? comp.id ?? `${leagueId}-${event.date}`,
    leagueId,
    leaguePath,
    date: Date.parse(event.date ?? comp.date ?? '') || 0,
    status: finalStatus,
    statusDetail: status?.type?.detail ?? '',
    statusShort: status?.type?.shortDetail ?? '',
    period: status?.period ?? null,
    displayClock: status?.displayClock ?? null,
    home: toTeam(homeRaw, true),
    away: toTeam(awayRaw, false),
    venue: venueName,
    broadcasts: Array.from(new Set(broadcasts)),
    note: comp.note ?? null,
    series: extractSeriesSummary(comp, homeRaw, awayRaw),
  }
}

function extractSeriesSummary(
  comp: EspnCompetition,
  homeRaw: EspnCompetitor,
  awayRaw: EspnCompetitor,
): GameSeries | null {
  // Path 1: a competitor 'playoff'/'postseason' record summarises the
  // series as "W-L".
  const seriesType = /playoff|postseason/i
  const homeRec = (homeRaw.records ?? []).find((r) => seriesType.test(r.type ?? ''))
  const awayRec = (awayRaw.records ?? []).find((r) => seriesType.test(r.type ?? ''))
  let homeWins: number | null = null
  let awayWins: number | null = null
  if (homeRec?.summary) {
    const m = homeRec.summary.match(/^(\d+)\s*-\s*(\d+)/)
    if (m) homeWins = Number(m[1])
  }
  if (awayRec?.summary) {
    const m = awayRec.summary.match(/^(\d+)\s*-\s*(\d+)/)
    if (m) awayWins = Number(m[1])
  }
  // Path 2: a top-level series object.
  if (homeWins === null || awayWins === null) {
    const ss = comp.series
    if (ss?.competitors) {
      for (const c of ss.competitors) {
        if (typeof c.wins !== 'number') continue
        const cid = c.id !== undefined ? String(c.id) : ''
        if (homeWins === null && cid === String(homeRaw.id ?? homeRaw.team?.id ?? '')) {
          homeWins = c.wins
        } else if (awayWins === null && cid === String(awayRaw.id ?? awayRaw.team?.id ?? '')) {
          awayWins = c.wins
        }
      }
    }
  }
  let title: string | null = comp.series?.title ?? comp.series?.summary ?? null
  if (!title && Array.isArray(comp.notes)) {
    const note = comp.notes.find((n) =>
      /series|finals|championship|conference/i.test(n.headline ?? ''),
    )
    if (note?.headline) title = note.headline
  }
  let summary: string | null = null
  if (Array.isArray(comp.notes)) {
    const note = comp.notes.find((n) => /series|leads|tied|wins/i.test(n.headline ?? ''))
    if (note?.headline) summary = note.headline
  }
  if (homeWins !== null && awayWins !== null) {
    return { title, homeWins, awayWins, summary }
  }
  if (title || summary) {
    return { title, homeWins: 0, awayWins: 0, summary }
  }
  return null
}

function toTeam(raw: EspnCompetitor, isHome: boolean): GameTeam {
  const team = raw.team ?? {}
  const logo = team.logo ?? team.logos?.[0]?.href ?? null
  const scoreNum = raw.score !== undefined ? Number(raw.score) : null
  const record =
    raw.records?.find((r) => (r.type ?? 'total') === 'total')?.summary ??
    raw.records?.[0]?.summary ??
    null
  return {
    id: String(raw.id ?? team.id ?? ''),
    name: team.displayName ?? team.shortDisplayName ?? 'TBD',
    shortName: team.shortDisplayName ?? team.displayName ?? 'TBD',
    abbreviation: team.abbreviation ?? (team.displayName ?? '??').slice(0, 3).toUpperCase(),
    logoURL: logo,
    score: scoreNum !== null && Number.isFinite(scoreNum) ? scoreNum : null,
    record,
    isHome,
    winner: raw.winner ?? null,
    color: normalizeHex(team.color),
    altColor: normalizeHex(team.alternateColor),
  }
}

function normalizeHex(v: string | undefined): string | null {
  if (!v) return null
  const t = v.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(t)) return null
  return `#${t}`
}

// Flatten a team's box-score statistics into a label→displayValue map,
// handling both the flat shape (NBA/NFL/NHL) and the grouped shape (MLB,
// where stats nest under batting/pitching/fielding groups). Grouped leaves
// are prefixed with the group name so e.g. batting strikeouts and pitching
// strikeouts stay distinct. First value for a label wins; insertion order
// preserves ESPN's ship order.
function teamStatRows(team: EspnBoxscoreTeam): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of team.statistics ?? []) {
    if (Array.isArray(entry.stats)) {
      const group = entry.displayName ?? entry.name ?? ''
      for (const leaf of entry.stats) {
        const name = leaf.displayName ?? leaf.label ?? leaf.shortDisplayName ?? leaf.abbreviation
        if (!name || leaf.displayValue === undefined) continue
        const label = group ? `${group} · ${name}` : name
        if (!out.has(label)) out.set(label, leaf.displayValue)
      }
    } else {
      const label = entry.label ?? entry.name
      if (!label || entry.displayValue === undefined) continue
      if (!out.has(label)) out.set(label, entry.displayValue)
    }
  }
  return out
}

// Box-score detail = base game + home/away team-stat comparison +
// headlines. Player stat lines, league leaders (headshots), and MLB
// linescores are deliberately NOT lifted — they're this vertical's
// explicit non-goals (see types.ts and the PR body §11.8 note).
function extractGameDetail(
  json: unknown,
  leagueId: string,
  leaguePath: string,
  eventId: string,
): GameDetail | null {
  const summary = json as EspnSummaryJson
  const compFromHeader = summary.header?.competitions?.[0]
  const base = buildGameFromEvent(
    { id: eventId, competitions: compFromHeader ? [compFromHeader] : [] },
    leagueId,
    leaguePath,
  )
  if (!base) return null

  const stats: GameDetailStat[] = []
  const teams = summary.boxscore?.teams ?? []
  // ESPN puts homeAway either at the top level or on the nested team
  // object depending on the league; check both, then fall back to order.
  const sideOf = (t: EspnBoxscoreTeam): string | undefined => t.homeAway ?? t.team?.homeAway
  const homeTeam = teams.find((t) => sideOf(t) === 'home') ?? teams[0]
  const awayTeam = teams.find((t) => sideOf(t) === 'away') ?? teams[1]
  if (homeTeam && awayTeam && homeTeam !== awayTeam) {
    const homeMap = teamStatRows(homeTeam)
    const awayMap = teamStatRows(awayTeam)
    // Preserve ESPN's ship order (home first, then any away-only rows) —
    // it's a meaningful ordering, not alphabetical (§11.1).
    const seen = new Set<string>()
    const labels: string[] = []
    for (const k of [...homeMap.keys(), ...awayMap.keys()]) {
      if (!seen.has(k)) {
        seen.add(k)
        labels.push(k)
      }
    }
    for (const label of labels) {
      stats.push({ label, home: homeMap.get(label) ?? '—', away: awayMap.get(label) ?? '—' })
    }
  }

  const headlines: GameHeadline[] = (summary.headlines ?? [])
    .filter((h) => (h.type ?? '').toLowerCase() !== 'video')
    .slice(0, 5)
    .map((h) => ({
      title: h.title ?? h.description ?? '',
      description: h.description ?? null,
      link: h.links?.web?.href ?? null,
    }))

  return { ...base, stats, headlines }
}

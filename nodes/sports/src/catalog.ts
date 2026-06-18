import type {
  LeagueCatalogEntry,
  SeasonRange,
  SportsLeague,
} from './types'

// League catalog + season/playoff window logic, lifted from Pulse's
// sportsService.ts. Pure (no I/O) so it stays trivially testable and the
// client / handlers can call it freely. inSeason / inPlayoffs are computed
// per call from the hardcoded windows because they change with the date.

export const LEAGUE_CATALOG: LeagueCatalogEntry[] = [
  { id: 'nfl', name: 'NFL', shortName: 'NFL', sport: 'American Football', paths: ['football/nfl'] },
  { id: 'nba', name: 'NBA', shortName: 'NBA', sport: 'Basketball', paths: ['basketball/nba'] },
  { id: 'mlb', name: 'MLB', shortName: 'MLB', sport: 'Baseball', paths: ['baseball/mlb'] },
  { id: 'nhl', name: 'NHL', shortName: 'NHL', sport: 'Hockey', paths: ['hockey/nhl'] },
  {
    id: 'ncaaf',
    name: 'College Football',
    shortName: 'CFB',
    sport: 'American Football',
    paths: ['football/college-football'],
  },
  {
    id: 'ncaam',
    name: "Men's College Basketball",
    shortName: 'CBB',
    sport: 'Basketball',
    paths: ['basketball/mens-college-basketball'],
  },
  {
    id: 'ucl',
    name: 'UEFA Champions League',
    shortName: 'UCL',
    sport: 'Soccer',
    paths: ['soccer/uefa.champions'],
  },
  { id: 'epl', name: 'Premier League', shortName: 'EPL', sport: 'Soccer', paths: ['soccer/eng.1'] },
  { id: 'laliga', name: 'La Liga', shortName: 'La Liga', sport: 'Soccer', paths: ['soccer/esp.1'] },
  { id: 'seriea', name: 'Serie A', shortName: 'Serie A', sport: 'Soccer', paths: ['soccer/ita.1'] },
  { id: 'mls', name: 'MLS', shortName: 'MLS', sport: 'Soccer', paths: ['soccer/usa.1'] },
  // FIFA World Cup — appended after the continuous club/domestic leagues
  // since it's a quadrennial national-team tournament, not a regular
  // season. Its in-season window is a fixed absolute-date range (see
  // TOURNAMENT_WINDOWS), not a recurring month/day window — the recurring
  // model would falsely claim "in season" every summer in off-years.
  { id: 'worldcup', name: 'World Cup', shortName: 'World Cup', sport: 'Soccer', paths: ['soccer/fifa.world'] },
]

export const LEAGUE_IDS: string[] = LEAGUE_CATALOG.map((l) => l.id)

export function leagueById(id: string): LeagueCatalogEntry | undefined {
  return LEAGUE_CATALOG.find((l) => l.id === id)
}

// Hardcoded season windows per league. Month is 0-indexed (JS Date
// convention). When today sits outside the window, currentSeasonRange
// reports the most recent completed season so offseason queries still
// resolve to a real calendar.
interface SeasonWindow {
  startMonth: number // 0-11
  startDay: number
  endMonth: number
  endDay: number
}

const SEASON_WINDOWS: Record<string, SeasonWindow> = {
  nfl: { startMonth: 8, startDay: 1, endMonth: 1, endDay: 15 }, // Sep 1 → Feb 15
  nba: { startMonth: 9, startDay: 15, endMonth: 5, endDay: 30 }, // Oct 15 → Jun 30
  mlb: { startMonth: 2, startDay: 20, endMonth: 10, endDay: 5 }, // Mar 20 → Nov 5
  nhl: { startMonth: 9, startDay: 1, endMonth: 5, endDay: 30 }, // Oct 1 → Jun 30
  ncaaf: { startMonth: 7, startDay: 20, endMonth: 0, endDay: 15 }, // Aug 20 → Jan 15
  ncaam: { startMonth: 9, startDay: 25, endMonth: 3, endDay: 15 }, // Oct 25 → Apr 15
  ucl: { startMonth: 8, startDay: 1, endMonth: 4, endDay: 31 }, // Sep 1 → May 31
  epl: { startMonth: 7, startDay: 10, endMonth: 4, endDay: 31 }, // Aug 10 → May 31
  laliga: { startMonth: 7, startDay: 15, endMonth: 4, endDay: 31 },
  seriea: { startMonth: 7, startDay: 15, endMonth: 4, endDay: 31 },
  mls: { startMonth: 1, startDay: 15, endMonth: 10, endDay: 15 }, // Feb 15 → Nov 15
}

// Hardcoded postseason windows for US sports leagues. Soccer leagues
// don't fit a fixed-window playoff model (knockouts vary), so they're
// omitted and isLeagueInPlayoffs returns false for them.
const PLAYOFF_WINDOWS: Record<string, SeasonWindow> = {
  nba: { startMonth: 3, startDay: 15, endMonth: 5, endDay: 25 }, // mid-Apr → late Jun
  nfl: { startMonth: 0, startDay: 5, endMonth: 1, endDay: 15 }, // early Jan → mid Feb
  mlb: { startMonth: 9, startDay: 1, endMonth: 10, endDay: 5 }, // Oct → early Nov
  nhl: { startMonth: 3, startDay: 10, endMonth: 5, endDay: 25 }, // mid-Apr → late Jun
  ncaaf: { startMonth: 11, startDay: 18, endMonth: 0, endDay: 15 }, // mid-Dec → mid-Jan (CFP)
}

// Absolute-date in-season windows for one-off / quadrennial tournaments
// that don't fit the recurring month/day model. Checked before
// SEASON_WINDOWS in isLeagueInSeason. The 2026 FIFA World Cup runs
// Jun 11 – Jul 19 2026 (US/CA/MX); the bound is intentionally a touch
// generous — `scores` returns empty for dates with no actual fixtures.
// NEEDS A NEW ENTRY for the 2030 World Cup (≈Jun–Jul 2030) when relevant;
// until then worldcup is correctly off outside this 2026 range.
const TOURNAMENT_WINDOWS: Record<string, { start: string; end: string }> = {
  worldcup: { start: '2026-06-11', end: '2026-07-19' },
}

// Generic month-day window-membership check shared by season + playoff
// detection. Cross-year windows (e.g. NFL Sep → Feb) OR their bounds;
// same-year windows AND them. `now` is injectable for tests.
function isInsideWindow(window: SeasonWindow, now: Date = new Date()): boolean {
  const nowKey = (now.getMonth() + 1) * 100 + now.getDate()
  const startKey = (window.startMonth + 1) * 100 + window.startDay
  const endKey = (window.endMonth + 1) * 100 + window.endDay
  if (window.startMonth > window.endMonth) {
    return nowKey >= startKey || nowKey <= endKey
  }
  return nowKey >= startKey && nowKey <= endKey
}

// True when today sits inside the league's season window. Untagged
// leagues default to true — we'd rather show a league we don't track the
// calendar for than hide it.
export function isLeagueInSeason(leagueId: string, now: Date = new Date()): boolean {
  // Absolute-date tournament windows (World Cup) take precedence — they're
  // year-specific, so they're never "in season" in off-years.
  const tournament = TOURNAMENT_WINDOWS[leagueId]
  if (tournament) {
    const t = now.getTime()
    return t >= Date.parse(`${tournament.start}T00:00:00`) && t <= Date.parse(`${tournament.end}T23:59:59`)
  }
  const window = SEASON_WINDOWS[leagueId]
  if (!window) return true
  return isInsideWindow(window, now)
}

// True when today sits inside the league's postseason window. Leagues
// without a fixed window (soccer) return false.
export function isLeagueInPlayoffs(leagueId: string, now: Date = new Date()): boolean {
  const window = PLAYOFF_WINDOWS[leagueId]
  if (!window) return false
  return isInsideWindow(window, now)
}

export function listLeagues(now: Date = new Date()): SportsLeague[] {
  return LEAGUE_CATALOG.map((l) => ({
    ...l,
    inSeason: isLeagueInSeason(l.id, now),
    inPlayoffs: isLeagueInPlayoffs(l.id, now),
  }))
}

function seasonLabel(start: Date, end: Date, crossesYear: boolean): string {
  if (crossesYear) {
    return `${start.getFullYear()}-${String(end.getFullYear()).slice(-2)}`
  }
  return String(start.getFullYear())
}

// Resolve the season range containing `now`, falling back to the most
// recent completed season when `now` precedes this year's start. Returns
// ms-since-epoch bounds (JSON-serializable) rather than Date objects.
export function currentSeasonRange(
  leagueId: string,
  now: Date = new Date(),
): SeasonRange | null {
  const window = SEASON_WINDOWS[leagueId]
  if (!window) return null
  const year = now.getFullYear()
  const crossesYear = window.startMonth > window.endMonth
  const candidateStartYear = crossesYear
    ? now.getMonth() < window.startMonth
      ? year - 1
      : year
    : year
  const start = new Date(candidateStartYear, window.startMonth, window.startDay)
  const end = new Date(
    crossesYear ? candidateStartYear + 1 : candidateStartYear,
    window.endMonth,
    window.endDay,
    23,
    59,
    59,
  )
  if (now < start) {
    const prevStart = new Date(candidateStartYear - 1, window.startMonth, window.startDay)
    const prevEnd = new Date(
      crossesYear ? candidateStartYear : candidateStartYear - 1,
      window.endMonth,
      window.endDay,
      23,
      59,
      59,
    )
    return {
      start: prevStart.getTime(),
      end: prevEnd.getTime(),
      label: seasonLabel(prevStart, prevEnd, crossesYear),
    }
  }
  return {
    start: start.getTime(),
    end: end.getTime(),
    label: seasonLabel(start, end, crossesYear),
  }
}

// ESPN scoreboard `dates` param format: YYYYMMDD in UTC.
export function fmtEspnDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${y}${m}${day}`
}

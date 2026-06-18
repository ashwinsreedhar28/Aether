import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, RefreshCw, Trophy } from 'lucide-react';
import { useMeshSurface } from '../../hooks/useMeshSurface';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { app as browserApp } from '../browser';

// The sports vertical's face (Wave 1 of the Pulse-vertical program, mirrors
// the music #335 / news #344 / stocks #347 MeshApps). sports is a Sensor —
// this app is read-only over the manifest's shell → sports.{leagues,scores,
// game,teams} edges. Voice still drives the sports_* tools; the app is the
// visible slate, not a new control path. Two views: the league SLATE (a list
// of game tiles) and a per-game DETAIL (box score), toggled by tapping a tile.

// Wire shapes mirrored from nodes/sports/src/types.ts — inlined rather than
// imported (the way Stocks/Music/News inline their node types) so the shell
// never reaches across into a node package. Source of truth lives there.
type GameStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'canceled';

interface GameTeam {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logoURL: string | null;
  score: number | null;
  record: string | null;
  isHome: boolean;
  winner: boolean | null;
  color: string | null;
  altColor: string | null;
}

interface GameSeries {
  title: string | null;
  homeWins: number;
  awayWins: number;
  summary: string | null;
}

interface Game {
  id: string;
  leagueId: string;
  leaguePath: string;
  date: number;
  status: GameStatus;
  statusDetail: string;
  statusShort: string;
  period: number | null;
  displayClock: string | null;
  home: GameTeam;
  away: GameTeam;
  venue: string | null;
  broadcasts: string[];
  note: string | null;
  series: GameSeries | null;
}

interface GameDetailStat {
  label: string;
  home: string;
  away: string;
}
interface GameHeadline {
  title: string;
  description: string | null;
  link: string | null;
}
interface GameDetail extends Game {
  stats: GameDetailStat[];
  headlines: GameHeadline[];
}

interface SportsLeague {
  id: string;
  name: string;
  shortName: string;
  sport: string;
  paths: string[];
  inSeason: boolean;
  inPlayoffs: boolean;
}

interface LeaguesPayload {
  leagues: SportsLeague[];
}
interface ScoresPayload {
  league: string;
  date: string;
  games: Game[];
}

// MLB (and any grouped-box-score league) ships ~169 team-stat rows across
// batting/pitching/fielding groups — far too many to dump. The node returns
// everything; the app curates. Grouped rows are detectable by the ' · '
// group prefix the node emits ("Batting · Hits"); flat-shape leagues (NBA/
// NFL/NHL/soccer, ~14-25 rows) are shown in full. The whitelist is matched
// on the leaf stat name (after the prefix) so it's league-shape-driven, not
// a hardcoded MLB check (§11).
const GROUPED_STAT_LEAVES = new Set([
  'Hits',
  'Runs',
  'Errors',
  'Home Runs',
  'RBIs',
  'Strikeouts',
  'Walks',
  'Stolen Bases',
  'Batting Average',
  'ERA',
  'Earned Runs',
]);

function curateStats(stats: GameDetailStat[]): GameDetailStat[] {
  const grouped = stats.some((s) => s.label.includes(' · '));
  if (!grouped) return stats;
  return stats.filter((s) => {
    const leaf = s.label.split(' · ').pop() ?? s.label;
    return GROUPED_STAT_LEAVES.has(leaf);
  });
}

function statusLabel(game: Game): string {
  if (game.status === 'final') return game.statusShort || 'Final';
  if (game.status === 'in_progress') return game.statusShort || 'Live';
  if (game.status === 'postponed') return 'Postponed';
  if (game.status === 'canceled') return 'Canceled';
  return game.statusShort || 'Scheduled';
}

function scoreStr(n: number | null): string {
  return typeof n === 'number' ? String(n) : '—';
}

function TeamLogo({ team }: { team: GameTeam }) {
  if (team.logoURL) {
    return (
      <img
        src={team.logoURL}
        alt=""
        width={20}
        height={20}
        style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }}
        // ESPN CDN logos occasionally 404 for lesser teams — hide the broken
        // glyph rather than show a torn-image icon.
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <span
      className="text-[10px] font-semibold w-5 text-center text-[var(--holo-muted)]"
      style={{ flexShrink: 0 }}
    >
      {team.abbreviation}
    </span>
  );
}

function TeamRow({ team, live }: { team: GameTeam; live: boolean }) {
  // Winner is bold + full-text; the loser dims. Mid-game (live), neither side
  // is a winner yet, so both stay at normal weight.
  const won = team.winner === true;
  const lost = live ? false : team.winner === false;
  return (
    <div className="flex items-center gap-2">
      <TeamLogo team={team} />
      <span
        className={`text-sm truncate ${won ? 'font-semibold text-[var(--holo-text)]' : lost ? 'text-[var(--holo-muted)]' : 'text-[var(--holo-text)]'}`}
        title={team.name}
      >
        {team.shortName}
      </span>
      {team.record && (
        <span className="text-[10px] text-[var(--holo-muted)]">({team.record})</span>
      )}
      <span
        className={`ml-auto text-sm tabular-nums ${won ? 'font-semibold text-[var(--holo-text)]' : lost ? 'text-[var(--holo-muted)]' : 'text-[var(--holo-text)]'}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {scoreStr(team.score)}
      </span>
    </div>
  );
}

function GameTile({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const live = game.status === 'in_progress';
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border p-3 flex flex-col gap-1.5 hover:bg-white/[0.04] transition-colors"
      style={{ borderColor: 'var(--holo-border)', background: 'var(--holo-panel)' }}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={`text-[10px] uppercase tracking-wider ${live ? 'text-red-300' : 'text-[var(--holo-muted)]'}`}
        >
          {live && '● '}
          {statusLabel(game)}
        </span>
        {game.broadcasts.length > 0 && (
          <span className="text-[10px] text-[var(--holo-muted)] truncate">
            {game.broadcasts[0]}
          </span>
        )}
        {game.series?.summary && (
          <span className="ml-auto text-[10px] text-[var(--holo-accent)] truncate" title={game.series.summary}>
            {game.series.summary}
          </span>
        )}
      </div>
      <TeamRow team={game.away} live={live} />
      <TeamRow team={game.home} live={live} />
    </button>
  );
}

function StatComparison({ stats }: { stats: GameDetailStat[] }) {
  const rows = curateStats(stats);
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--holo-muted)] px-1 py-2">
        No team stats yet — they populate once the game is underway.
      </p>
    );
  }
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--holo-border)' }}>
      {rows.map((s, i) => (
        <div
          key={s.label}
          className="grid items-center px-3 py-1.5 text-xs"
          style={{
            gridTemplateColumns: '1fr auto 1fr',
            background: i % 2 ? 'transparent' : 'var(--holo-panel)',
          }}
        >
          <span className="text-right tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {s.away}
          </span>
          <span className="text-center text-[10px] uppercase tracking-wider text-[var(--holo-muted)] px-3">
            {s.label}
          </span>
          <span className="text-left tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {s.home}
          </span>
        </div>
      ))}
    </div>
  );
}

function GameDetailView({
  league,
  game,
  onBack,
}: {
  league: string;
  game: Game;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openWindow = useWorkspaceStore((s) => s.openWindow);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.aether.mesh.invoke('sports.game', { league, event_id: game.id });
      if (res.ok && res.envelope) {
        const payload = res.envelope.payload as unknown as { game: GameDetail };
        setDetail(payload.game);
      } else {
        setError(res.error?.message ?? 'box score unavailable');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'box score unavailable');
    } finally {
      setLoading(false);
    }
  }, [league, game.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Header always shows the slate-level game (instant); stats stream in below.
  const headlines = detail?.headlines ?? [];

  const openHeadline = (h: GameHeadline) => {
    if (!h.link) return;
    openWindow({
      title: h.title,
      appId: 'browser',
      filePath: h.link,
      position: { x: 150 + Math.random() * 100, y: 80 + Math.random() * 100 },
      size: browserApp.defaultSize || { width: 1024, height: 768 },
      isMinimized: false,
      isMaximized: false,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-3 border-b border-[var(--holo-border)]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors mb-2"
        >
          <ChevronLeft size={13} /> Slate
        </button>
        <div className="text-[10px] uppercase tracking-wider text-[var(--holo-muted)] mb-1.5">
          {statusLabel(game)}
          {game.venue ? ` · ${game.venue}` : ''}
        </div>
        <div className="flex flex-col gap-1.5">
          <TeamRow team={game.away} live={game.status === 'in_progress'} />
          <TeamRow team={game.home} live={game.status === 'in_progress'} />
        </div>
        {game.series?.summary && (
          <div className="text-[11px] text-[var(--holo-accent)] mt-2">{game.series.summary}</div>
        )}
      </div>

      <div className="p-3 space-y-4">
        {loading && <p className="text-sm text-[var(--holo-muted)] px-1">Loading box score…</p>}
        {!loading && error && <p className="text-sm text-amber-300 px-1">{error}</p>}
        {!loading && !error && detail && <StatComparison stats={detail.stats} />}

        {headlines.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-[var(--holo-muted)] uppercase tracking-wider mb-1.5 px-1">
              Headlines
            </h2>
            <div className="flex flex-col">
              {headlines.map((h, i) => (
                <button
                  key={i}
                  onClick={() => openHeadline(h)}
                  disabled={!h.link}
                  className="text-left text-xs px-1 py-1.5 border-b border-[var(--holo-border)] text-[var(--holo-text)] hover:text-[var(--holo-accent)] disabled:hover:text-[var(--holo-text)] transition-colors"
                  title={h.description ?? undefined}
                >
                  {h.title}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export function SportsApp() {
  // League catalog — changes slowly (season flags flip on day boundaries), so
  // a long poll is plenty. Drives the tab strip and the default selection.
  const leaguesState = useMeshSurface<LeaguesPayload>('sports.leagues', {}, {
    pollMs: 300000,
    cacheKey: 'sports-leagues',
  });
  const leagues = useMemo(() => leaguesState.data?.leagues ?? [], [leaguesState.data]);

  const [selected, setSelected] = useState<string | null>(null);
  const [openGame, setOpenGame] = useState<Game | null>(null);

  // Default to an in-season league once the catalog lands (prefer one in
  // playoffs — that's the liveliest slate), else the first league.
  useEffect(() => {
    if (selected || leagues.length === 0) return;
    const playoff = leagues.find((l) => l.inSeason && l.inPlayoffs);
    const inSeason = leagues.find((l) => l.inSeason);
    setSelected((playoff ?? inSeason ?? leagues[0])?.id ?? null);
  }, [leagues, selected]);

  const scores = useMeshSurface<ScoresPayload>(
    'sports.scores',
    useMemo(() => (selected ? { league: selected } : {}), [selected]),
    { pollMs: 30000, cacheKey: 'sports-scores' },
  );

  // The hook refetches on `target` change, NOT on payload change (its effect
  // deps are [target, pollMs, visibleOnly]); a league switch keeps the same
  // target, so nudge a refetch rather than waiting out the 30s poll (NewsApp
  // category-chip precedent). Held in a ref so the effect depends on `selected`
  // alone, and skip the first run (the hook already fetched on mount).
  const refetchRef = useRef(scores.refetch);
  refetchRef.current = scores.refetch;
  const firstSel = useRef(true);
  useEffect(() => {
    if (firstSel.current) {
      firstSel.current = false;
      return;
    }
    setOpenGame(null);
    refetchRef.current();
  }, [selected]);

  const games = scores.data?.games ?? [];
  const offline = scores.error != null && scores.data != null;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--holo-bg)] text-[var(--holo-text)]">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--holo-border)]">
        <Trophy size={18} className="text-[var(--holo-accent)]" />
        <h1 className="text-sm font-medium">Sports</h1>
        {!openGame && (
          <span className="text-xs text-[var(--holo-muted)] font-mono">
            {games.length} game{games.length === 1 ? '' : 's'}
            {offline ? ' · offline' : ''}
          </span>
        )}
        <button
          onClick={() => scores.refetch()}
          className="ml-auto text-[var(--holo-muted)] hover:text-[var(--holo-accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={scores.refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      {/* League tabs — catalog (semantic) order: US majors → college → soccer
          → World Cup. In-playoffs leagues get a small dot. */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--holo-border)] overflow-x-auto">
        {leagues.map((l) => {
          const active = l.id === selected;
          return (
            <button
              key={l.id}
              onClick={() => setSelected(l.id)}
              className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors ${
                active
                  ? 'border-[var(--holo-accent)]/60 bg-[var(--holo-accent)]/20 text-[var(--holo-accent)]'
                  : 'border-[var(--holo-border)] text-[var(--holo-muted)] hover:text-[var(--holo-text)]'
              }`}
              title={l.inPlayoffs ? `${l.name} — playoffs` : l.name}
            >
              {l.shortName}
              {l.inPlayoffs && <span className="text-amber-300"> •</span>}
            </button>
          );
        })}
      </div>

      {openGame && selected ? (
        <GameDetailView league={selected} game={openGame} onBack={() => setOpenGame(null)} />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {scores.loading && (
            <p className="text-sm text-[var(--holo-muted)] px-1">Reading the slate…</p>
          )}
          {!scores.loading && scores.error && games.length === 0 && (
            <p className="text-sm text-amber-300 px-1">{scores.error}</p>
          )}
          {!scores.loading && !scores.error && games.length === 0 && (
            <div className="flex flex-col items-center gap-2 text-center py-12">
              <Trophy size={48} style={{ color: 'rgba(255,255,255,0.1)' }} />
              <p className="text-sm text-[var(--holo-muted)]">No games today</p>
              <p className="text-xs text-[var(--holo-muted)]">
                Nothing scheduled for this league right now.
              </p>
            </div>
          )}
          {games.map((g) => (
            <GameTile key={g.id} game={g} onOpen={() => setOpenGame(g)} />
          ))}
        </div>
      )}
    </div>
  );
}

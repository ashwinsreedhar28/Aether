# Sports Node

Mesh Sensor that answers "what's the score / how's my team" over [ESPN's public site API](https://site.api.espn.com/apis/site/v2/sports). No API key. Request-driven: each surface fetches on demand and caches the result in memory for a short window — there is no background poller and nothing persists to disk.

Lifts the data-source + season/window logic from Pulse's `sportsService.ts` (re-housed in the Aether mesh-node pattern; Pulse's IPC/service structure was **not** copied).

## Surfaces

- **`sports.leagues`** `{}` — supported leagues with per-call `inSeason` / `inPlayoffs` flags (computed from hardcoded season/playoff windows against today's date). No network call.
- **`sports.scores`** `{ league, date? }` — scoreboard games for a league on a single date (default today, ISO `YYYY-MM-DD`). Off-season / no-games dates return an empty `games` array, not an error. Cached ~15s.
- **`sports.game`** `{ league, event_id }` — box-score detail for one game: the game header plus the home/away team-stat comparison and a few headlines. `event_id` comes from a `sports.scores` game's `id`. Cached ~60s.
- **`sports.teams`** `{ league }` — team directory for a league, alphabetised by display name. Cached ~24h.

Bad `league` → `MeshDeny: sports_unknown_league` (with the valid id list); bad/missing `event_id` → `sports_event_required`; unknown event → `sports_game_not_found`; upstream HTTP/timeout/network failures → `sports_http_error` / `sports_timeout` / `sports_network`.

## Leagues

`nfl`, `nba`, `mlb`, `nhl`, `ncaaf`, `ncaam` (US majors + college), then soccer: `ucl`, `epl`, `laliga`, `seriea`, `mls`, and `worldcup` (FIFA World Cup). The World Cup is a quadrennial tournament, so instead of a recurring month/day season window it uses a fixed absolute-date window (in-season ~Jun 11 – Jul 19 2026; needs a new entry for the 2030 tournament).

## Environment Variables

Required:
- `MESH_SPORTS_SECRET` — HMAC secret for mesh authentication
- `AETHER_DATA_DIR` — parent directory for the node's liveness marker (`sports/running`)

## API

ESPN public (unofficial) site API. No API key, no quota to track. 12s fetch timeout per request.

## MVP scope / non-goals (§11.8)

This is the **Lane A** node (substrate). Voice tools (`sports_*`) and the Sports MeshApp land in **Lane B**, along with the `raven → sports.*` and `shell → sports.*` consumer edges.

Deliberately **not** lifted from Pulse to keep the MVP bounded: league/team **leaders**, **standings**, **favorites**, live **milestone alerts**, NCAA **conference filters**, bulk **season-games**, and player **headshots** / per-player box-score stat lines. `sports.game`'s box score is the team-stat comparison + headlines only.

## Future-Arc Candidates (§11.6)

- League/team leaders + standings
- Favorite teams/athletes with milestone alerts
- NCAA conference filters; bulk season-game listings
- Multi-day `scores` windows (Pulse fetched ±21 days; this MVP is single-date)

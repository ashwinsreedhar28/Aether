"""Sports Tool — live scores, box scores, and what's-in-season by voice.

Three voice tools, all routed through ``mesh_invoke`` to the sports node
(Lane A registered the node + surfaces; this is the Lane B voice face,
the news_tool / finance_tool read-only precedent):

  - ``sports_scores(league, date?)`` → ``sports.scores``
  - ``sports_game(league, event_id)`` → ``sports.game``  (drill into one game)
  - ``sports_leagues()``             → ``sports.leagues`` (what's in season)

Read-only Sensor reads — non-destructive, never confirm-gated. Every
result carries a ``spoken`` field pre-written for the situation (the
finance_history / music precedent), so the reply stays short and the
node's named denies surface as friendly speech instead of error strings.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "sports_scores",
    "sports_game",
    "sports_leagues",
]

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# League id → spoken display name. Mirrors nodes/sports/src/catalog.ts
# LEAGUE_CATALOG (the node returns the id, not the name, on sports.scores);
# keep in sync if the catalog changes. Also doubles as the alias target set.
_LEAGUE_NAMES: dict[str, str] = {
    "nfl": "NFL",
    "nba": "NBA",
    "mlb": "MLB",
    "nhl": "NHL",
    "ncaaf": "College Football",
    "ncaam": "Men's College Basketball",
    "ucl": "Champions League",
    "epl": "Premier League",
    "laliga": "La Liga",
    "seriea": "Serie A",
    "mls": "MLS",
    "worldcup": "World Cup",
}

# Spoken aliases → catalog id, so a natural phrase still resolves when Gemini
# doesn't pass the bare id. Normalised (lowercased, spaces collapsed) on both
# sides. The bare ids are accepted directly and need no alias entry.
_LEAGUE_ALIASES: dict[str, str] = {
    "premier league": "epl",
    "english premier league": "epl",
    "champions league": "ucl",
    "uefa champions league": "ucl",
    "la liga": "laliga",
    "serie a": "seriea",
    "world cup": "worldcup",
    "fifa world cup": "worldcup",
    "college football": "ncaaf",
    "college basketball": "ncaam",
    "mens college basketball": "ncaam",
    "soccer": "epl",
}

_FRIENDLY_DENIES: dict[str, str] = {
    "sports_league_required": "Which league, sir?",
    "sports_unknown_league": "I don't follow that league, sir.",
    "sports_bad_date": "I didn't catch that date, sir.",
    "sports_event_required": "Which game, sir?",
    "sports_game_not_found": "I couldn't find that game, sir.",
    "sports_http_error": "ESPN isn't answering right now, sir.",
    "sports_timeout": "The sports feed timed out, sir.",
    "sports_network": "I can't reach the sports feed right now, sir.",
}

_FALLBACK_SPOKEN = "Sports are unavailable right now, sir."

# How many game lines sports_scores reads before summarising the rest.
_SPOKEN_GAME_CAP = 4


def _deny_result(e: MeshUnavailable) -> dict[str, Any]:
    reason = e.reason or "mesh_unavailable"
    return {
        "error": reason,
        "spoken": _FRIENDLY_DENIES.get(reason, _FALLBACK_SPOKEN),
        "detail": str(e),
    }


def _normalize(text: str) -> str:
    return " ".join(text.lower().strip().split())


def _resolve_league(value: Any) -> str | None:
    """Map a Gemini-supplied league arg to a catalog id, or None if absent."""
    if not isinstance(value, str):
        return None
    norm = _normalize(value)
    if not norm:
        return None
    compact = norm.replace(" ", "")
    if compact in _LEAGUE_NAMES:
        return compact
    if norm in _LEAGUE_ALIASES:
        return _LEAGUE_ALIASES[norm]
    return compact  # let the node deny sports_unknown_league with its valid list


def _league_name(league_id: str) -> str:
    return _LEAGUE_NAMES.get(league_id, league_id.upper())


def _team_label(team: dict[str, Any]) -> str:
    """Speech-friendly team label — shortName ('Lakers') over the full name."""
    if not isinstance(team, dict):
        return "TBD"
    return str(team.get("shortName") or team.get("name") or team.get("abbreviation") or "TBD")


def _score_str(value: Any) -> str:
    if isinstance(value, (int, float)):
        return str(int(value))
    return "0"


def _spoken_list(items: list[str]) -> str:
    """'A', 'A and B', or 'A, B, and C' — natural spoken enumeration."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + (", and " if len(items) > 2 else " and ") + items[-1]


def _game_phrase(game: dict[str, Any]) -> str:
    home = game.get("home") or {}
    away = game.get("away") or {}
    h_name, a_name = _team_label(home), _team_label(away)
    status = game.get("status")
    if status == "final":
        h_s, a_s = _score_str(home.get("score")), _score_str(away.get("score"))
        if home.get("winner"):
            return f"{h_name} beat {a_name} {h_s} to {a_s}"
        if away.get("winner"):
            return f"{a_name} beat {h_name} {a_s} to {h_s}"
        return f"{a_name} {a_s}, {h_name} {h_s}, final"
    if status == "in_progress":
        detail = game.get("statusShort") or "in progress"
        return f"{a_name} {_score_str(away.get('score'))}, {h_name} {_score_str(home.get('score'))}, {detail}"
    if status in ("postponed", "canceled"):
        return f"{a_name} at {h_name}, {status}"
    # scheduled
    detail = game.get("statusShort")
    return f"{a_name} at {h_name}" + (f", {detail}" if detail else "")


def _date_label(date: Any) -> str:
    today = datetime.now(timezone.utc).date().isoformat()
    if isinstance(date, str) and _ISO_DATE_RE.match(date):
        return "today" if date == today else f"on {date}"
    return "today"


def _summarize_scores(league_id: str, date: Any, games: list[dict[str, Any]]) -> str:
    league = _league_name(league_id)
    when = _date_label(date)
    if not games:
        return f"No {league} games {when}, sir."
    n = len(games)
    shown = [_game_phrase(g) for g in games[:_SPOKEN_GAME_CAP]]
    body = "; ".join(shown)
    head = f"{n} {league} game{'s' if n != 1 else ''} {when}, sir"
    if n > _SPOKEN_GAME_CAP:
        return f"{head}: {body}; and {n - _SPOKEN_GAME_CAP} more."
    return f"{head}: {body}."


async def _sports_scores(league_id: str, date: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"league": league_id}
    if date:
        payload["date"] = date
    try:
        response = await mesh_invoke("sports.scores", payload)
    except MeshUnavailable as e:
        return _deny_result(e)
    games = response.get("games")
    games = games if isinstance(games, list) else []
    return {**response, "spoken": _summarize_scores(league_id, response.get("date", date), games)}


async def _sports_game(league_id: str, event_id: str) -> dict[str, Any]:
    try:
        response = await mesh_invoke("sports.game", {"league": league_id, "event_id": event_id})
    except MeshUnavailable as e:
        return _deny_result(e)
    game = response.get("game")
    if not isinstance(game, dict):
        return {**response, "spoken": "I couldn't find that game, sir."}
    return {**response, "spoken": f"{_game_phrase(game)}, sir."}


async def _sports_leagues() -> dict[str, Any]:
    try:
        response = await mesh_invoke("sports.leagues", {})
    except MeshUnavailable as e:
        return _deny_result(e)
    leagues = response.get("leagues")
    leagues = leagues if isinstance(leagues, list) else []
    in_season: list[str] = []
    for l in leagues:
        if not isinstance(l, dict) or not l.get("inSeason"):
            continue
        name = _league_name(str(l.get("id", "")))
        in_season.append(f"{name} (playoffs)" if l.get("inPlayoffs") else name)
    if not in_season:
        spoken = "Nothing's in season right now, sir."
    else:
        spoken = f"In season right now, sir: {_spoken_list(in_season)}."
    return {**response, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for the sports_tool group."""
    scores_func = types.FunctionDeclaration(
        name="sports_scores",
        description=(
            "Get today's scores/slate for a sports league ('what's the NBA "
            "score', 'MLB scores today', 'did the Lakers win', 'how are the "
            "Yankees doing'). INFER the league from the team or competition "
            "the user names — Lakers/Celtics → nba, Yankees/Dodgers → mlb, "
            "Chiefs/49ers → nfl, Rangers/Bruins → nhl, Arsenal/Real Madrid → "
            "epl/laliga, and the World Cup → worldcup. Pass the league id in "
            "`league`. Returns the day's games with scores and status; the "
            "result's `spoken` field is pre-written for the situation (an "
            "empty slate says so) — read it verbatim. Each returned game has "
            "an `id` — use it with sports_game to drill into one. Distinct "
            "from news 'sports' category: this is live SCORES/RESULTS, not "
            "sports articles."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "league": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "League id: nfl, nba, mlb, nhl, ncaaf, ncaam, ucl, "
                        "epl, laliga, seriea, mls, worldcup. Infer it from the "
                        "team/competition the user named."
                    ),
                ),
                "date": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional ISO date (YYYY-MM-DD). Omit for today — you "
                        "do not know today's date, so never guess one; only "
                        "pass a date the user stated explicitly as YYYY-MM-DD."
                    ),
                ),
            },
            required=["league"],
        ),
    )
    game_func = types.FunctionDeclaration(
        name="sports_game",
        description=(
            "Drill into ONE game's box score (score, status, team-stat "
            "comparison) after a sports_scores result ('how did that game "
            "go', 'box score for the Lakers game', 'tell me about the first "
            "one'). Pass the same `league` and the game's `event_id` — the "
            "`id` field from a prior sports_scores game. The result's "
            "`spoken` field is pre-written — read it verbatim; only elaborate "
            "on team stats from the payload if the user asks for detail."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "league": types.Schema(
                    type=types.Type.STRING,
                    description="League id of the game (same as the sports_scores call).",
                ),
                "event_id": types.Schema(
                    type=types.Type.STRING,
                    description="ESPN event id — the `id` field of a game from sports_scores.",
                ),
            },
            required=["league", "event_id"],
        ),
    )
    leagues_func = types.FunctionDeclaration(
        name="sports_leagues",
        description=(
            "List which leagues are in season (and in playoffs) right now "
            "('what's in season', 'what sports are on', 'any leagues in "
            "playoffs'). No arguments. The result's `spoken` field names the "
            "in-season leagues — read it verbatim."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    return [types.Tool(function_declarations=[scores_func, game_func, leagues_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "sports_scores":
        league = _resolve_league(args.get("league"))
        if not league:
            return {"error": "sports_league_required", "spoken": "Which league, sir?"}
        raw_date = args.get("date")
        date = raw_date if isinstance(raw_date, str) and _ISO_DATE_RE.match(raw_date) else None
        return await _sports_scores(league, date)
    if name == "sports_game":
        league = _resolve_league(args.get("league"))
        if not league:
            return {"error": "sports_league_required", "spoken": "Which league's game, sir?"}
        event_id = args.get("event_id")
        event_id = event_id.strip() if isinstance(event_id, str) else ""
        if not event_id:
            return {"error": "sports_event_required", "spoken": "Which game, sir?"}
        return await _sports_game(league, event_id)
    if name == "sports_leagues":
        return await _sports_leagues()
    return None

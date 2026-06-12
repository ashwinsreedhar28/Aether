"""Music Tool - Spotify playback control by voice via the mesh.

Five voice tools, all routed through ``mesh_invoke`` to the music node
(#225, Lane B — the node itself is Lane A, #332/#333):

  - ``play_music(query?)``      → ``music.play``   (empty query = RESUME)
  - ``pause_music()``           → ``music.pause``
  - ``skip_track(direction?)``  → ``music.skip``   (default next)
  - ``queue_music(query)``      → ``music.queue``
  - ``whats_playing()``         → ``music.now_playing``

NOT confirm-gated, by standing Architect ruling on #225: media controls
are non-destructive and instantly reversible — the confirm convention
covers spawn/teardown/draft class actions, not playback. Gemini calls
these immediately on the user's word.

Every result — success or failure — carries a ``spoken`` field
pre-written for the situation (finance_history precedent), so the
spoken reply stays short and natural ("Playing So What by Miles Davis,
sir.", "Paused, sir.") and the node's named denies surface as friendly
speech (``music_no_active_device`` → "Spotify isn't open on any
device…") instead of error strings read aloud.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "play_music",
    "pause_music",
    "skip_track",
    "queue_music",
    "whats_playing",
]

# Mirrors nodes/music/src/handlers.ts QUERY_MAX — the node truncates at the
# same bound, so clamping here just keeps the wire payload tidy.
QUERY_MAX_LEN = 300

# The music node's named denies (nodes/music README "Named errors"),
# translated to the friendly lines Gemini reads aloud. Anything not listed
# falls back to the generic unavailable line — never a raw reason string.
_FRIENDLY_DENIES: dict[str, str] = {
    "music_no_active_device": (
        "Spotify isn't open on any device, sir — open the Spotify app and "
        "play anything once, then ask me again."
    ),
    "music_no_client_id": (
        "Spotify isn't configured yet, sir — SPOTIFY_CLIENT_ID is missing "
        "from the environment."
    ),
    "music_not_authenticated": (
        "Spotify isn't linked yet, sir — ask me to play something and I'll "
        "start the sign-in."
    ),
    "music_token_revoked": (
        "Spotify's link was revoked, sir — ask me to play something to "
        "re-authorize."
    ),
    "music_auth_pending": (
        "A Spotify sign-in is already waiting in your browser, sir — finish "
        "that grant first."
    ),
    "music_auth_timeout": "The Spotify sign-in timed out, sir — try again when you're ready.",
    "music_auth_denied": "The Spotify grant was declined, sir.",
    "music_no_match": "I couldn't find that track on Spotify, sir.",
    "music_rate_limited": "Spotify is rate-limiting us, sir — give it a moment and try again.",
    "music_forbidden": (
        "Spotify refused the command, sir — player control needs a Premium account."
    ),
    "music_spotify_unreachable": "I can't reach Spotify right now, sir.",
}

_FALLBACK_SPOKEN = "Music is unavailable right now, sir."


def _deny_result(e: MeshUnavailable) -> dict[str, Any]:
    """Translate a mesh failure into { error, spoken } Gemini can relay.

    ``e.reason`` is the node's named deny when the node refused, or None
    when the mesh itself never came up — both get a friendly line.
    """
    reason = e.reason or "mesh_unavailable"
    return {
        "error": reason,
        "spoken": _FRIENDLY_DENIES.get(reason, _FALLBACK_SPOKEN),
        "detail": str(e),
    }


def _clean_query(value: Any) -> str | None:
    """Strip + clamp a Gemini-supplied query; None when absent or empty."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:QUERY_MAX_LEN]
    return cleaned or None


def _track_phrase(result: dict[str, Any]) -> str | None:
    """'<name> by <artist>' from the node's search-resolved track echo."""
    track = result.get("track")
    if not isinstance(track, dict):
        return None
    name = track.get("name")
    artist = track.get("artist")
    if not name:
        return None
    return f"{name} by {artist}" if artist else str(name)


async def _play_music(query: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": query} if query else {}
    try:
        response = await mesh_invoke("music.play", payload)
    except MeshUnavailable as e:
        return _deny_result(e)

    if response.get("resumed"):
        return {**response, "spoken": "Resuming playback, sir."}
    phrase = _track_phrase(response)
    spoken = f"Playing {phrase}, sir." if phrase else "Playing, sir."
    return {**response, "spoken": spoken}


async def _pause_music() -> dict[str, Any]:
    try:
        response = await mesh_invoke("music.pause", {})
    except MeshUnavailable as e:
        return _deny_result(e)
    return {**response, "spoken": "Paused, sir."}


async def _skip_track(direction: str) -> dict[str, Any]:
    try:
        response = await mesh_invoke("music.skip", {"direction": direction})
    except MeshUnavailable as e:
        return _deny_result(e)
    spoken = "Skipped, sir." if direction == "next" else "Back a track, sir."
    return {**response, "spoken": spoken}


async def _queue_music(query: str) -> dict[str, Any]:
    try:
        response = await mesh_invoke("music.queue", {"query": query})
    except MeshUnavailable as e:
        return _deny_result(e)
    phrase = _track_phrase(response)
    spoken = f"Queued {phrase}, sir." if phrase else "Queued, sir."
    return {**response, "spoken": spoken}


async def _whats_playing() -> dict[str, Any]:
    try:
        response = await mesh_invoke("music.now_playing", {})
    except MeshUnavailable as e:
        return _deny_result(e)

    track = response.get("track")
    if not isinstance(track, dict) or not track.get("name"):
        return {**response, "spoken": "Nothing's playing right now, sir."}
    name = track.get("name")
    artist = track.get("artist")
    album = track.get("album")
    phrase = f"{name} by {artist}" if artist else str(name)
    if response.get("is_playing"):
        spoken = f"{phrase}, from {album}, sir." if album else f"{phrase}, sir."
    else:
        spoken = f"Paused on {phrase}, sir."
    return {**response, "spoken": spoken}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for the music_tool group."""
    play_func = types.FunctionDeclaration(
        name="play_music",
        description=(
            "Start Spotify playback on the user's active device, or RESUME "
            "paused playback. With a query ('play take five', 'put on some "
            "Miles Davis') the top track-search match plays. With NO query "
            "('play music', 'resume', 'unpause', 'keep playing') paused "
            "playback resumes where it left off — omit the query for those. "
            "A media control: non-destructive and instantly reversible, so "
            "call it IMMEDIATELY on the user's word — never ask for "
            "confirmation. The result carries a `spoken` field pre-written "
            "for the situation (success and failure alike) — read it "
            "verbatim and stop."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional free-text track search — the song and/or "
                        "artist the user named ('take five', 'so what miles "
                        "davis'). OMIT entirely when the user asked to "
                        "resume/continue without naming anything."
                    ),
                ),
            },
        ),
    )
    pause_func = types.FunctionDeclaration(
        name="pause_music",
        description=(
            "Pause Spotify playback on the active device ('pause', 'pause "
            "the music', 'stop the music for a sec'). No confirmation — "
            "call it immediately. Read the result's `spoken` field verbatim."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    skip_func = types.FunctionDeclaration(
        name="skip_track",
        description=(
            "Jump to the next or previous track ('skip', 'next song' → "
            "next; 'go back', 'previous track', 'play that again' → prev). "
            "Default is next. No confirmation — call it immediately. Read "
            "the result's `spoken` field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "direction": types.Schema(
                    type=types.Type.STRING,
                    enum=["next", "prev"],
                    description="Optional. 'next' (default) or 'prev'.",
                ),
            },
        ),
    )
    queue_func = types.FunctionDeclaration(
        name="queue_music",
        description=(
            "Add a track to the Spotify queue WITHOUT interrupting what's "
            "currently playing ('queue up blue in green', 'play take five "
            "next', 'add that to the queue'). The top track-search match is "
            "appended. No confirmation — call it immediately. Read the "
            "result's `spoken` field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Free-text track search — the song and/or artist to "
                        "append to the queue."
                    ),
                ),
            },
            required=["query"],
        ),
    )
    whats_playing_func = types.FunctionDeclaration(
        name="whats_playing",
        description=(
            "Read back the current Spotify track ('what's playing', 'what "
            "song is this', 'who is this'). Returns track, artist, album, "
            "and play/pause state, with a `spoken` field pre-written for "
            "the situation — read it verbatim. If nothing is playing the "
            "spoken line says so; never invent a track."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    )
    return [
        types.Tool(
            function_declarations=[
                play_func,
                pause_func,
                skip_func,
                queue_func,
                whats_playing_func,
            ]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "play_music":
        return await _play_music(_clean_query(args.get("query")))
    if name == "pause_music":
        return await _pause_music()
    if name == "skip_track":
        raw = args.get("direction")
        direction = "prev" if isinstance(raw, str) and raw.strip().lower() in (
            "prev",
            "previous",
            "back",
        ) else "next"
        return await _skip_track(direction)
    if name == "queue_music":
        query = _clean_query(args.get("query"))
        if not query:
            return {
                "error": "bad query",
                "spoken": "What should I queue, sir?",
            }
        return await _queue_music(query)
    if name == "whats_playing":
        return await _whats_playing()
    return None

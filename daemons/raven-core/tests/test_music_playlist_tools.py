"""Playlist + last-song voice tools (#334, Lane C): the case-insensitive
fuzzy playlist matcher, the friendly no-match deny that names what was
heard, last-song replay from history (and its empty-history line), and
the list_playlists spoken cap of five with a total count.

The mesh hop is mocked (patch music_tool.mesh_invoke), so these run
without a live mesh — same pattern as test_viewer_tool_resolution.py.
"""
import asyncio
import sys
import unittest.mock as mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# Same global mock test_tool_registry.py uses: importing raven_core.tools
# (the package __init__) pulls session_context's deep import chain.
if "raven_core.session_context" not in sys.modules:
    sys.modules["raven_core.session_context"] = mock.MagicMock()

import raven_core.tools.music_tool as mt
from raven_core.mesh_client import MeshUnavailable

PLAYLISTS = [
    {"name": "Jazz Classics", "uri": "spotify:playlist:pl1", "track_count": 42},
    {"name": "Workout Mix!", "uri": "spotify:playlist:pl2", "track_count": 30},
    {"name": "Deep Focus", "uri": "spotify:playlist:pl3", "track_count": 12},
]


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- fuzzy match

def test_exact_match_is_case_insensitive():
    assert mt._match_playlist("jazz classics", PLAYLISTS)["uri"] == "spotify:playlist:pl1"


def test_substring_matches_either_way():
    # spoken fragment finds the longer name…
    assert mt._match_playlist("workout", PLAYLISTS)["uri"] == "spotify:playlist:pl2"
    # …and a wordier utterance finds the shorter name.
    assert mt._match_playlist("my deep focus mix", PLAYLISTS)["uri"] == "spotify:playlist:pl3"


def test_normalization_strips_punctuation():
    assert mt._match_playlist("workout mix", PLAYLISTS)["uri"] == "spotify:playlist:pl2"


def test_close_match_absorbs_small_slips():
    assert mt._match_playlist("jaz classics", PLAYLISTS)["uri"] == "spotify:playlist:pl1"


def test_no_match_returns_none():
    assert mt._match_playlist("flerbnerb", PLAYLISTS) is None
    assert mt._match_playlist("", PLAYLISTS) is None
    assert mt._match_playlist("jazz", []) is None


# --------------------------------------------------------------- play_playlist

def test_play_playlist_plays_matched_context():
    calls = []

    async def fake_invoke(target, payload):
        calls.append((target, payload))
        if target == "music.playlists":
            return {"ok": True, "playlists": PLAYLISTS, "total": 3}
        return {"ok": True, "played": payload["uri"]}

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        result = run(mt._play_playlist("jazz classics"))

    assert calls == [
        ("music.playlists", {}),
        ("music.play", {"uri": "spotify:playlist:pl1"}),
    ]
    assert result["spoken"] == "Playing your Jazz Classics playlist, sir."
    assert result["playlist"]["uri"] == "spotify:playlist:pl1"


def test_play_playlist_no_match_names_what_it_heard():
    async def fake_invoke(target, payload):
        return {"ok": True, "playlists": PLAYLISTS, "total": 3}

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        result = run(mt._play_playlist("flerbnerb"))

    assert result["error"] == "music_no_playlist_match"
    assert "flerbnerb" in result["spoken"]


def test_play_playlist_mesh_deny_is_friendly():
    async def fake_invoke(target, payload):
        raise MeshUnavailable("denied", reason="music_not_authenticated")

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        result = run(mt._play_playlist("jazz"))

    assert result["error"] == "music_not_authenticated"
    assert result["spoken"] == mt._FRIENDLY_DENIES["music_not_authenticated"]


# -------------------------------------------------------------- play_last_song

def test_play_last_song_replays_history_head():
    calls = []

    async def fake_invoke(target, payload):
        calls.append((target, payload))
        if target == "music.recently_played":
            return {
                "ok": True,
                "tracks": [
                    {
                        "name": "Blue in Green",
                        "artist": "Miles Davis",
                        "uri": "spotify:track:big1",
                        "played_at": "2026-06-11T10:00:00.000Z",
                    }
                ],
            }
        return {"ok": True, "played": payload["uri"]}

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        result = run(mt._play_last_song())

    assert calls[0] == ("music.recently_played", {"limit": 1})
    assert calls[1] == ("music.play", {"uri": "spotify:track:big1"})
    assert result["spoken"] == "Playing Blue in Green by Miles Davis again, sir."


def test_play_last_song_empty_history():
    async def fake_invoke(target, payload):
        return {"ok": True, "tracks": []}

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        result = run(mt._play_last_song())

    assert result["error"] == "music_no_recent_tracks"
    assert "sir" in result["spoken"]


# -------------------------------------------------------------- list_playlists

def _playlist_stub(count, total):
    async def fake_invoke(target, payload):
        return {
            "ok": True,
            "playlists": [
                {"name": f"List {i}", "uri": f"spotify:playlist:p{i}", "track_count": i}
                for i in range(1, count + 1)
            ],
            "total": total,
        }

    return fake_invoke


def test_list_playlists_caps_spoken_at_five_with_count():
    with mock.patch.object(mt, "mesh_invoke", _playlist_stub(14, 14)):
        result = run(mt._list_playlists())
    assert result["spoken"] == (
        "You have 14, sir; the first 5 are List 1, List 2, List 3, List 4, and List 5."
    )


def test_list_playlists_small_collection_reads_all():
    with mock.patch.object(mt, "mesh_invoke", _playlist_stub(3, 3)):
        result = run(mt._list_playlists())
    assert result["spoken"] == "You have 3 playlists, sir: List 1, List 2, and List 3."


def test_list_playlists_empty():
    with mock.patch.object(mt, "mesh_invoke", _playlist_stub(0, 0)):
        result = run(mt._list_playlists())
    assert result["spoken"] == "You don't have any playlists, sir."


# ------------------------------------------------------------------- dispatch

def test_dispatch_routes_new_tools():
    async def fake_invoke(target, payload):
        if target == "music.playlists":
            return {"ok": True, "playlists": PLAYLISTS, "total": 3}
        if target == "music.recently_played":
            return {"ok": True, "tracks": [{"name": "X", "artist": "Y", "uri": "spotify:track:x"}]}
        return {"ok": True}

    with mock.patch.object(mt, "mesh_invoke", fake_invoke):
        assert run(mt.handle_call_async("play_playlist", {"name": "deep focus"}))["ok"]
        assert run(mt.handle_call_async("play_last_song", {}))["ok"]
        assert run(mt.handle_call_async("list_playlists", {}))["ok"]
        empty = run(mt.handle_call_async("play_playlist", {"name": "  "}))
        assert empty["spoken"] == "Which playlist, sir?"

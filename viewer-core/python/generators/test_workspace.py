"""workspace generator (Python side) + cross-language parity pins.

The default cockpit and the alternate briefing workspaces are deterministic, so
the byte-exact SHA-256 of the WHOLE emitted View[] (compact-serialized) is a
stable contract. The vitest suite (src/generators/workspace.test.ts) asserts the
SAME two hashes against the TS `build`. One constant per theme, two readers: if
either side's content drifts by a single byte, that side turns red.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators` / `workspace`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import get_generator, run_generator  # noqa: E402
from workspace import (  # noqa: E402
    register_workspace_generator,
    workspace_build,
    workspace_generator,
)

# Byte-exact SHA-256 of json.dumps(views, separators=(",",":")) per theme.
# Must equal the TS pins.
COCKPIT_SHA = "0c8baf3e0e558ece57fd987765a3b396bd222ef63469e55a6e0a04b2d4c9dcb9"
BRIEFING_SHA = "e1c9e1305dfda537d5c5b1619ca7c1e7dd827efdcd82fc8a77f9349410884a04"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _serialize(views: list[dict]) -> str:
    return json.dumps(views, separators=(",", ":"), ensure_ascii=False)


def test_emits_five_valid_mixed_type_views():
    views = run_generator(workspace_build, {})
    assert len(views) == 5
    for v in views:
        assert_view(v)
    assert [v["type"] for v in views] == ["markdown", "html", "table", "mermaid", "kanban"]
    assert [v["id"] for v in views] == [
        "cockpit-summary",
        "cockpit-kpis",
        "cockpit-table",
        "cockpit-flow",
        "cockpit-board",
    ]


def test_every_panel_carries_grid_placement_in_meta():
    views = workspace_build()
    for v in views:
        assert "meta" in v
        for k in ("gx", "gy", "gw", "gh"):
            assert isinstance(v["meta"][k], int)
    cells = [f"{v['meta']['gx']},{v['meta']['gy']}" for v in views]
    assert len(set(cells)) == len(views)


def test_default_cockpit_matches_ts_mirror_sha():
    assert _sha256(_serialize(workspace_build())) == COCKPIT_SHA


def test_briefing_theme_matches_ts_mirror_sha():
    assert _sha256(_serialize(workspace_build({"theme": "briefing"}))) == BRIEFING_SHA


def test_unknown_theme_falls_back_to_cockpit():
    assert _sha256(_serialize(workspace_build({"theme": "nonsense"}))) == COCKPIT_SHA


def test_panels_carry_real_type_correct_content():
    md, html, table, mermaid, board = workspace_build()
    assert md["source"]["value"].startswith("# Project Cockpit")
    assert "## Highlights" in md["source"]["value"]
    assert "grid-template-columns:repeat(3,1fr)" in html["source"]["value"]
    assert "82%" in html["source"]["value"]
    assert table["source"]["mediaType"] == "text/csv"
    assert table["source"]["value"].split("\n")[0] == "Service,Owner,Status,Uptime,p95 ms"
    assert mermaid["source"]["value"].startswith("graph LR")
    parsed = json.loads(board["source"]["value"])
    assert [c["title"] for c in parsed["columns"]] == ["Backlog", "In Progress", "Review", "Done"]


def test_registers_under_its_slug():
    register_workspace_generator()
    assert get_generator("workspace")["slug"] == "workspace"
    assert workspace_generator["slug"] == "workspace"

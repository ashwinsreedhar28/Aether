"""Cross-language sprint-board generator parity (Python side) + unit coverage.

The parity test runs the SHARED fixture (../../generators/sprint-board-fixture.json)
through `sprint_board_build`. The vitest suite (src/generators/sprint-board.test.ts)
runs the SAME file through the TS `build`. One fixture, two readers — the
generators cannot drift: both must emit `expectedView` exactly, including the
byte-identical compact `source.value` JSON string.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `sprint_board`

from viewer_core import assert_view  # noqa: E402
from sprint_board import (  # noqa: E402
    register_sprint_board_generator,
    sprint_board_build,
    sprint_board_generator,
)

FIXTURE = json.loads((HERE.parent.parent / "generators" / "sprint-board-fixture.json").read_text())


def test_emits_exactly_the_fixture_expected_view():
    views = sprint_board_build(FIXTURE["input"])
    assert len(views) == 1
    assert views[0] == FIXTURE["expectedView"]


def test_emitted_view_is_valid_and_parseable():
    views = sprint_board_build(FIXTURE["input"])
    assert_view(views[0])
    content = json.loads(views[0]["source"]["value"])
    assert len(content["columns"]) == 2
    assert len(content["columns"][0]["cards"]) == 1


def test_default_dataset_produces_a_real_board():
    views = sprint_board_build()
    assert_view(views[0])
    assert views[0]["type"] == "kanban"
    content = json.loads(views[0]["source"]["value"])
    assert [c["title"] for c in content["columns"]] == ["Backlog", "In Progress", "Review", "Done"]
    total = sum(len(c.get("cards", [])) for c in content["columns"])
    assert total >= 12


def test_optional_keys_omitted_when_absent():
    # The fixture's second column has no color and its card has no optional keys.
    views = sprint_board_build(FIXTURE["input"])
    content = json.loads(views[0]["source"]["value"])
    doing = content["columns"][1]
    assert "color" not in doing
    assert doing["cards"][0] == {"id": "c2", "title": "Second"}


def test_generator_entry_shape():
    assert sprint_board_generator["slug"] == "sprint_board"
    assert callable(sprint_board_generator["generate"])


def test_register_sprint_board_generator_uses_injected_registry():
    captured = {}
    register_sprint_board_generator(lambda entry: captured.update({entry["slug"]: entry}))
    assert captured["sprint_board"]["slug"] == "sprint_board"

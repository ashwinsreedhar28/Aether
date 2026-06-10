"""Cross-language knowledge-graph generator parity (Python side) + unit coverage.

The parity test runs the SHARED fixture (../../generators/kg-fixture.json) through
`knowledge_graph_build`. The vitest suite (src/generators/parity.test.ts) runs the
SAME file through the TS `build`. One fixture, two readers — the generators cannot
drift: both must emit `expectedView` exactly, including the byte-identical compact
`source.value` JSON string.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `viewer_generators`

from viewer_core import assert_view  # noqa: E402
from viewer_generators import (  # noqa: E402
    get_generator,
    knowledge_graph_build,
    knowledge_graph_generator,
    list_generators,
    register_generator,
    run_generator,
)

FIXTURE = json.loads((HERE.parent.parent / "generators" / "kg-fixture.json").read_text())


def test_emits_exactly_the_fixture_expected_view():
    views = knowledge_graph_build(FIXTURE["input"])
    assert len(views) == 1
    assert views[0] == FIXTURE["expectedView"]


def test_emitted_view_is_valid_and_parseable():
    views = run_generator(knowledge_graph_build, FIXTURE["input"])
    assert_view(views[0])
    content = json.loads(views[0]["source"]["value"])
    assert len(content["nodes"]) == 2
    assert len(content["edges"]) == 1


def test_default_dataset_produces_a_real_graph():
    views = knowledge_graph_build()
    content = json.loads(views[0]["source"]["value"])
    assert len(content["nodes"]) >= 5
    assert any(n["title"] == "View contract" for n in content["nodes"])


def test_run_generator_accepts_entry_dict():
    views = run_generator(knowledge_graph_generator, {})
    assert views[0]["type"] == "knowledge-graph"


def test_run_generator_rejects_invalid_view():
    bad = lambda _p: [{"id": "", "type": "nope", "source": {"kind": "x", "value": ""}}]
    with pytest.raises(ValueError, match="invalid View at index 0"):
        run_generator(bad, {})


def test_run_generator_rejects_non_list():
    with pytest.raises(ValueError, match="must return a list"):
        run_generator(lambda _p: {"not": "a list"}, {})


def test_registry_register_get_list():
    register_generator(knowledge_graph_generator)
    assert get_generator("knowledge-graph")["slug"] == "knowledge-graph"
    assert "knowledge-graph" in [g["slug"] for g in list_generators()]
    assert get_generator("nope") is None

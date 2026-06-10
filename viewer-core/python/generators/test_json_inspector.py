"""json_inspector generator coverage + cross-language parity (Python side).

The EXPECTED_JSON constant below is byte-identical to the one pinned in the
vitest suite (src/generators/json_inspector.test.ts). Both sides assert their
generator's `source.value` equals this exact string, so the two generators
cannot drift: a shape change on either side turns that side's run red.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `json_inspector`

from viewer_core import assert_view  # noqa: E402
from json_inspector import (  # noqa: E402
    DEFAULT_DATA,
    json_inspector_build,
    json_inspector_generator,
    register_json_inspector_generator,
)

# Byte-exact mirror of the TS EXPECTED_JSON. The parity contract lives here.
EXPECTED_JSON = (
    '{"mesh":"lattice","captured":"2026-06-06T11:02:55Z","node_count":3,"nodes":['
    '{"id":"viewer_session","kind":"stateful","status":"online","revision":47,'
    '"surfaces":[{"name":"session_get","io":"read","returns":"Session"},'
    '{"name":"session_set","io":"write","accepts":"Session"},'
    '{"name":"session_handoff","io":"write","accepts":"HandoffTarget"}],'
    '"peers":["viewer_desktop","viewer_spatial"]},'
    '{"id":"generator_host","kind":"compute","status":"online","revision":12,'
    '"surfaces":[{"name":"generators_list","io":"read","returns":"GeneratorEntry[]"},'
    '{"name":"generator_run","io":"invoke","accepts":"RunRequest"}],'
    '"peers":["viewer_session"]},'
    '{"id":"renderer_registry","kind":"static","status":"degraded","revision":8,'
    '"surfaces":[{"name":"renderers_list","io":"read","returns":"RendererEntry[]"},'
    '{"name":"renderer_resolve","io":"read","returns":"ResolvedViewData"}],'
    '"peers":["viewer_desktop","viewer_spatial","generator_host"]}]}'
)


def test_default_emits_one_valid_json_view():
    views = json_inspector_build()
    assert len(views) == 1
    view = views[0]
    assert_view(view)
    assert view["type"] == "json"
    assert view["id"] == "json"
    assert view["title"] == "Mesh Introspect"
    assert view["source"]["kind"] == "inline"
    assert view["source"]["mediaType"] == "application/json"


def test_default_content_is_byte_exact_json():
    view = json_inspector_build()[0]
    assert view["source"]["value"] == EXPECTED_JSON


def test_default_value_parses_to_populated_mesh_payload():
    parsed = json.loads(json_inspector_build()[0]["source"]["value"])
    assert parsed["mesh"] == "lattice"
    assert parsed["node_count"] == 3
    assert len(parsed["nodes"]) == 3
    for node in parsed["nodes"]:
        assert isinstance(node["id"], str)
        assert isinstance(node["surfaces"], list)
        assert len(node["surfaces"]) > 0
    # node_count is honest about the payload it describes.
    assert parsed["node_count"] == len(DEFAULT_DATA["nodes"])


def test_supplied_data_serialized_compactly():
    view = json_inspector_build({"data": {"a": 1, "b": [2, 3]}, "title": "Custom"})[0]
    assert view["source"]["value"] == '{"a":1,"b":[2,3]}'
    assert view["title"] == "Custom"


def test_generator_entry_shape():
    assert json_inspector_generator["slug"] == "json_inspector"
    assert callable(json_inspector_generator["generate"])


def test_register_uses_supplied_registry():
    captured = {}
    register_json_inspector_generator(lambda entry: captured.update(entry))
    assert captured["slug"] == "json_inspector"


def test_id_and_title_overridable():
    view = json_inspector_build({"id": "inspect1", "title": "Snapshot"})[0]
    assert view["id"] == "inspect1"
    assert view["title"] == "Snapshot"

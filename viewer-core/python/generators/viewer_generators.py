"""viewer_generators — Python mirror of @viewer/core's generators module.

So the spatial server can run generators server-side (POST /generators/{slug}/run)
and have the result be IDENTICAL to what the TS generator emits. A generator is
a pure function `params -> list[View dict]`; `run_generator` `assert_view`s every
emitted View — the same safety the TS `runGenerator` gives the declarative path.

The knowledge-graph generator is the proof case. Its inline source JSON is built
with a FIXED key order and compact separators (",", ":") so the serialized string
equals the TS side's `JSON.stringify(content)` byte-for-byte. The shared fixture
(../../generators/kg-fixture.json) pins this down on both sides.

Keep this in lockstep with src/generators/. Dependency-free besides viewer_core.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from viewer_core import assert_view

# A generator is just params -> list[View dict].
Generator = Callable[[dict], list[dict]]


def run_generator(gen: Any, params: dict) -> list[dict]:
    """Run a generator (callable or entry dict) and validate every emitted View.

    Raises ValueError on a non-list result or any invalid emitted View.
    """
    fn = gen["generate"] if isinstance(gen, dict) else gen
    out = fn(params)
    if not isinstance(out, list):
        raise ValueError("generator must return a list of Views")
    validated: list[dict] = []
    for i, v in enumerate(out):
        try:
            assert_view(v)
        except ValueError as e:
            raise ValueError(f"generator emitted invalid View at index {i}: {e}")
        validated.append(v)
    return validated


# --- the knowledge-graph generator (proof case) ----------------------------

DEFAULT_NAME = "Viewer Ecosystem"
DEFAULT_NODES: list[dict] = [
    {"id": "view", "title": "View contract", "position": {"x": 240, "y": 40}, "color": "#4a9eff"},
    {"id": "desktop", "title": "viewer-desktop", "position": {"x": 40, "y": 200}},
    {"id": "spatial", "title": "viewer-spatial", "position": {"x": 440, "y": 200}},
    {"id": "renderers", "title": "Shared renderers", "position": {"x": 40, "y": 360}},
    {"id": "generators", "title": "Generators", "position": {"x": 440, "y": 360}, "color": "#7bd88f"},
    {"id": "tools", "title": "Tools", "position": {"x": 240, "y": 440}},
]
DEFAULT_EDGES: list[dict] = [
    {"id": "e1", "source": "view", "target": "desktop", "label": "renders"},
    {"id": "e2", "source": "view", "target": "spatial", "label": "renders"},
    {"id": "e3", "source": "renderers", "target": "view", "label": "draw"},
    {"id": "e4", "source": "generators", "target": "view", "label": "emit"},
    {"id": "e5", "source": "tools", "target": "view", "label": "place"},
]


def _build_content(name: str, nodes: list[dict], edges: list[dict]) -> dict:
    """Canonical mindmap content: fixed key order, optional keys only when present.

    Must match the TS `buildContent` so the compact serialization is identical.
    """
    return {
        "name": name,
        "nodes": [
            {
                "id": n["id"],
                "title": n["title"],
                "position": {"x": n["position"]["x"], "y": n["position"]["y"]},
                **({"color": n["color"]} if n.get("color") is not None else {}),
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e["id"],
                "source": e["source"],
                "target": e["target"],
                **({"label": e["label"]} if e.get("label") is not None else {}),
            }
            for e in edges
        ],
    }


def knowledge_graph_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one knowledge-graph View (as a dict)."""
    params = params or {}
    name = params.get("name", DEFAULT_NAME)
    nodes = params.get("nodes", DEFAULT_NODES)
    edges = params.get("edges", DEFAULT_EDGES)
    content = _build_content(name, nodes, edges)
    # Compact separators => byte-identical to TS JSON.stringify(content).
    value = json.dumps(content, separators=(",", ":"), ensure_ascii=False)
    return [
        {
            "id": params.get("id", "kg"),
            "type": "knowledge-graph",
            "title": params.get("title", "Knowledge Graph"),
            "source": {"kind": "inline", "value": value},
            "layout": {"w": 1.2, "h": 0.9, "hint": "wide"},
        }
    ]


knowledge_graph_generator: dict = {
    "slug": "knowledge-graph",
    "describe": "Emit a knowledge-graph View from nodes + edges (defaults to a demo graph).",
    "generate": knowledge_graph_build,
}


# --- tiny registry (mirrors the TS one) ------------------------------------

_REGISTRY: dict[str, dict] = {}


def register_generator(entry: dict) -> None:
    _REGISTRY[entry["slug"]] = entry


def get_generator(slug: str) -> dict | None:
    return _REGISTRY.get(slug)


def list_generators() -> list[dict]:
    return list(_REGISTRY.values())


def _reset_generators() -> None:
    _REGISTRY.clear()


# Register the built-in generator on import (mirrors registerBuiltinRenderers).
register_generator(knowledge_graph_generator)

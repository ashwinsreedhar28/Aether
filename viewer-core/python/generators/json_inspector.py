"""json_inspector — Python mirror of @viewer/core's json_inspector generator.

So the spatial server can run this generator server-side and emit a result
IDENTICAL to the TS side (src/generators/json_inspector.ts). A generator is a
pure function `params -> list[View dict]`.

The emitted `json` View carries a JSON string as inline `source.value`; the
shared json renderer parses it and shows a collapsible tree. The string is
serialized with a FIXED key order and compact separators (",", ":") so it is
byte-identical to the TS side's `JSON.stringify(content)`. Calling with no
params yields a real demo: a fake "mesh introspect" payload — 3 Lattice mesh
nodes, each with its exposed surfaces and peers. Dependency-free besides
viewer_core.
"""
from __future__ import annotations

import json

from viewer_core import assert_view

# A believable `mesh introspect` payload: the Lattice mesh's viewer nodes, each
# with the surfaces it exposes and the peers it talks to. Fixed key order — the
# literal IS the canonical shape, so json.dumps(compact) matches TS stringify.
DEFAULT_DATA: dict = {
    "mesh": "lattice",
    "captured": "2026-06-06T11:02:55Z",
    "node_count": 3,
    "nodes": [
        {
            "id": "viewer_session",
            "kind": "stateful",
            "status": "online",
            "revision": 47,
            "surfaces": [
                {"name": "session_get", "io": "read", "returns": "Session"},
                {"name": "session_set", "io": "write", "accepts": "Session"},
                {"name": "session_handoff", "io": "write", "accepts": "HandoffTarget"},
            ],
            "peers": ["viewer_desktop", "viewer_spatial"],
        },
        {
            "id": "generator_host",
            "kind": "compute",
            "status": "online",
            "revision": 12,
            "surfaces": [
                {"name": "generators_list", "io": "read", "returns": "GeneratorEntry[]"},
                {"name": "generator_run", "io": "invoke", "accepts": "RunRequest"},
            ],
            "peers": ["viewer_session"],
        },
        {
            "id": "renderer_registry",
            "kind": "static",
            "status": "degraded",
            "revision": 8,
            "surfaces": [
                {"name": "renderers_list", "io": "read", "returns": "RendererEntry[]"},
                {"name": "renderer_resolve", "io": "read", "returns": "ResolvedViewData"},
            ],
            "peers": ["viewer_desktop", "viewer_spatial", "generator_host"],
        },
    ],
}


def json_inspector_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one json View (as a dict).

    `data` (any JSON-serializable value) overrides the default payload. The
    value is serialized with compact separators so it stays byte-identical to
    the TS `JSON.stringify` output.
    """
    params = params or {}
    data = params.get("data", DEFAULT_DATA)
    # Compact separators => byte-identical to TS JSON.stringify(content).
    value = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return [
        {
            "id": params.get("id", "json"),
            "type": "json",
            "title": params.get("title", "Mesh Introspect"),
            "source": {"kind": "inline", "value": value, "mediaType": "application/json"},
            "layout": {"w": 1.2, "h": 0.9, "hint": "wide"},
        }
    ]


json_inspector_generator: dict = {
    "slug": "json_inspector",
    "describe": "Emit a collapsible json tree View (defaults to a mesh introspect payload).",
    "generate": json_inspector_build,
}


def register_json_inspector_generator(register_generator) -> None:
    """Register the json_inspector generator with a shared registry's register fn."""
    register_generator(json_inspector_generator)

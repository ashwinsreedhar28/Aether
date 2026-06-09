"""flow_diagram — Python mirror of @viewer/core's flow_diagram generator.

A pure `params -> list[View dict]` that emits ONE `mermaid` View whose inline
source is raw Mermaid diagram text. The renderer (src/renderers/mermaid.tsx)
reads `data.content` straight as Mermaid source — there is NO JSON envelope, so
`source.value` IS the diagram string and TS/Python parity is just an identical
constant.

The default diagram documents the viewer ecosystem itself (agent -> generator ->
View -> validate -> both shells) and doubles as living documentation. The text
is assembled by joining a fixed line array with "\\n", byte-identical to the TS
mirror's DEFAULT_DIAGRAM_LINES (src/generators/flow_diagram.ts). ASCII-only so
the two serializations stay encoding-agnostic.

Keep this in lockstep with src/generators/flow_diagram.ts. Dependency-free.
"""
from __future__ import annotations

DEFAULT_TITLE = "Viewer Ecosystem Flow"

# Must stay byte-identical to the TS DEFAULT_DIAGRAM_LINES.
DEFAULT_DIAGRAM_LINES: list[str] = [
    "graph TD",
    "  subgraph Authoring",
    '    A["Agent (TS or Python)"]',
    '    G["Generator: build(params) -> View[]"]',
    "  end",
    "  subgraph Contract",
    '    V["View {id, type, source, layout}"]',
    '    R["runGenerator / assert_view"]',
    "  end",
    "  subgraph Shells",
    '    D["viewer-desktop (Electron window)"]',
    '    S["viewer-spatial (Vision Pro panel)"]',
    "  end",
    '  RND["Shared renderers"]',
    "  A -->|authors| G",
    "  G -->|emits| V",
    "  V -->|validated by| R",
    "  R -->|valid Views| D",
    "  R -->|valid Views| S",
    "  RND -->|draw| D",
    "  RND -->|draw| S",
    "  V -.->|same JSON, two surfaces| RND",
]
DEFAULT_DIAGRAM = "\n".join(DEFAULT_DIAGRAM_LINES)


def flow_diagram_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one mermaid View (as a dict)."""
    params = params or {}
    diagram = params.get("diagram", DEFAULT_DIAGRAM)
    return [
        {
            "id": params.get("id", "flow"),
            "type": "mermaid",
            "title": params.get("title", DEFAULT_TITLE),
            "source": {"kind": "inline", "value": diagram},
            "layout": {"w": 1.4, "h": 0.95, "hint": "wide"},
        }
    ]


flow_diagram_generator: dict = {
    "slug": "flow_diagram",
    "describe": "Emit a mermaid View (defaults to the viewer ecosystem flow diagram).",
    "generate": flow_diagram_build,
}


def register_flow_diagram_generator() -> None:
    """Register the flow_diagram generator with the shared registry.

    Imports the shared registry lazily so this module stays standalone — build()
    has no dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(flow_diagram_generator)

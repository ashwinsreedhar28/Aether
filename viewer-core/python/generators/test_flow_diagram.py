"""flow_diagram generator coverage + cross-language parity pin (Python side).

EXPECTED_DIAGRAM below is the byte-exact default Mermaid source. The vitest
suite (src/generators/flow_diagram.test.ts) pins the SAME literal. Both
generators must emit it verbatim, so the TS and Python sides cannot drift.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PYTHON_DIR = HERE.parent  # for `viewer_core`
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(HERE))  # for `flow_diagram` + `viewer_generators`

from viewer_core import assert_view  # noqa: E402
from flow_diagram import (  # noqa: E402
    flow_diagram_build,
    flow_diagram_generator,
    register_flow_diagram_generator,
)
from viewer_generators import get_generator, run_generator  # noqa: E402

# Byte-identical to src/generators/flow_diagram.test.ts::EXPECTED_DIAGRAM.
EXPECTED_DIAGRAM = "\n".join(
    [
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
)


def test_default_build_emits_exactly_one_mermaid_view():
    views = flow_diagram_build()
    assert len(views) == 1
    assert views[0] == {
        "id": "flow",
        "type": "mermaid",
        "title": "Viewer Ecosystem Flow",
        "source": {"kind": "inline", "value": EXPECTED_DIAGRAM},
        "layout": {"w": 1.4, "h": 0.95, "hint": "wide"},
    }


def test_default_source_value_is_byte_exact_mermaid():
    # Cross-language parity pin — same literal as the vitest suite.
    assert flow_diagram_build()[0]["source"]["value"] == EXPECTED_DIAGRAM


def test_emitted_view_is_valid():
    views = run_generator(flow_diagram_build, {})
    assert_view(views[0])
    assert views[0]["type"] == "mermaid"
    assert "graph TD" in views[0]["source"]["value"]


def test_honors_overrides():
    view = flow_diagram_build({"id": "x", "title": "Custom", "diagram": "graph LR\nA-->B"})[0]
    assert view["id"] == "x"
    assert view["title"] == "Custom"
    assert view["source"]["value"] == "graph LR\nA-->B"


def test_register_adds_entry_to_shared_registry():
    register_flow_diagram_generator()
    assert get_generator("flow_diagram")["slug"] == "flow_diagram"
    assert flow_diagram_generator["describe"].startswith("Emit a mermaid View")

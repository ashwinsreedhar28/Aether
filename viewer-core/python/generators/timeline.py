"""timeline — Python mirror of @viewer/core's timeline generator.

Emits ONE `html` View: a self-contained, dark-theme vertical timeline (a project
history / product roadmap) with a single inline `<style>` block and NO external
scripts or resources, so it renders identically in the desktop shell's window and
the spatial shell's sandboxed WKWebView panel. The shared html renderer reads
`source.value` as the document HTML.

The HTML document is assembled from a fixed array of lines joined by "\\n" so it
is byte-identical to the TS mirror (src/generators/timeline.ts) for the same
input. Calling with no params yields a full Viewer Ecosystem Roadmap.

Keep this in lockstep with src/generators/timeline.ts. Dependency-free besides
the registry helpers it imports from viewer_generators.
"""
from __future__ import annotations

DEFAULT_TITLE = "Viewer Ecosystem Roadmap"
DEFAULT_SUBTITLE = "From the View contract to a ten-archetype demo gallery"
DEFAULT_EVENTS: list[dict] = [
    {
        "date": "2025 Q1",
        "title": "View contract v1",
        "body": "Locked the platform-agnostic View schema — id, type, source, layout — shared by the desktop and spatial shells.",
    },
    {
        "date": "2025 Q2",
        "title": "Desktop shell ships",
        "body": "viewer-desktop (Electron) renders every View type in tabbed windows using the shared React renderers.",
    },
    {
        "date": "2025 Q3",
        "title": "Spatial shell preview",
        "body": "viewer-spatial brings the same Views to Vision Pro as floating WKWebView panels — zero renderer forks.",
    },
    {
        "date": "2025 Q4",
        "title": "Declarative generator path",
        "body": "Pure params -> View[] generators land, with a Python mirror that emits byte-identical JSON server-side.",
    },
    {
        "date": "2026 Q1",
        "title": "Mesh-backed sessions",
        "body": "Lattice viewer sessions enable one-call workspace handoff between the desktop and the headset.",
    },
    {
        "date": "2026 Q2",
        "title": "Cross-language parity suite",
        "body": "Fixtures pin markdown, kanban, table, and graph output to the byte — both shells stay in lockstep.",
    },
    {
        "date": "2026 Q3",
        "title": "Public demo gallery",
        "body": "Ten archetype demos ship as the canonical showcase for authoring Views in either shell.",
    },
]

# CSS for the timeline. A fixed array of lines so TS and Python join identically.
STYLE_LINES: list[str] = [
    "*{box-sizing:border-box;}",
    "body{margin:0;padding:32px;background:#0d1117;color:#e6edf3;",
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
    ".timeline-title{font-size:24px;font-weight:600;margin:0 0 4px;}",
    ".timeline-sub{color:#8b949e;font-size:14px;margin:0 0 28px;}",
    "ol.timeline{list-style:none;margin:0;padding:0;position:relative;}",
    'ol.timeline::before{content:"";position:absolute;left:11px;top:6px;bottom:6px;width:2px;background:#30363d;}',
    "li.event{position:relative;padding:0 0 28px 40px;}",
    "li.event:last-child{padding-bottom:0;}",
    'li.event::before{content:"";position:absolute;left:4px;top:4px;width:16px;height:16px;border-radius:50%;',
    "background:#4a9eff;border:3px solid #0d1117;box-shadow:0 0 0 1px #30363d;}",
    ".event-date{color:#4a9eff;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;}",
    ".event-title{font-size:16px;font-weight:600;margin:2px 0 4px;}",
    ".event-body{color:#8b949e;font-size:14px;line-height:1.5;margin:0;}",
]


def _escape_html(s: str) -> str:
    """Minimal HTML-text escaping. Order matters: `&` first. Matches the TS mirror."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _build_html(title: str, subtitle: str, events: list[dict]) -> str:
    """Assemble the full HTML document from a fixed line array joined by "\\n".

    Must match the TS `buildHtml` so the serialized string is identical.
    """
    event_lines = [
        (
            '<li class="event"><div class="event-date">'
            + _escape_html(e["date"])
            + '</div><div class="event-title">'
            + _escape_html(e["title"])
            + '</div><p class="event-body">'
            + _escape_html(e["body"])
            + "</p></li>"
        )
        for e in events
    ]
    lines = [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<style>",
        *STYLE_LINES,
        "</style>",
        "</head>",
        "<body>",
        '<h1 class="timeline-title">' + _escape_html(title) + "</h1>",
        '<p class="timeline-sub">' + _escape_html(subtitle) + "</p>",
        '<ol class="timeline">',
        *event_lines,
        "</ol>",
        "</body>",
        "</html>",
    ]
    return "\n".join(lines)


def timeline_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one html timeline View (as a dict)."""
    params = params or {}
    title = params.get("title", DEFAULT_TITLE)
    subtitle = params.get("subtitle", DEFAULT_SUBTITLE)
    events = params.get("events", DEFAULT_EVENTS)
    html = _build_html(title, subtitle, events)
    return [
        {
            "id": params.get("id", "timeline"),
            "type": "html",
            "title": title,
            "source": {"kind": "inline", "value": html},
            "layout": {"w": 0.9, "h": 1, "hint": "tall"},
        }
    ]


timeline_generator: dict = {
    "slug": "timeline",
    "describe": "Emit an html vertical-timeline View from chronological events (defaults to a demo roadmap).",
    "generate": timeline_build,
}


def register_timeline_generator() -> None:
    """Register the timeline generator with the shared registry.

    Imports the registry lazily so this module stays standalone — build() has no
    dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(timeline_generator)

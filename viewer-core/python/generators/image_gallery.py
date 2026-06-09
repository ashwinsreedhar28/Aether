"""image_gallery — Python mirror of @viewer/core's image_gallery generator.

A pure `params -> list[View dict]` that emits ONE `html` View whose inline source
is a complete, self-contained HTML document. The renderer (src/renderers/html.tsx)
drops `data.content` straight into an iframe `srcDoc`. The default document is a
dark-theme, responsive CSS grid of programmatically generated INLINE SVG tiles
(gradients + decorative shapes + labels) with NO external URLs, so it renders
identically in the desktop iframe and the sandboxed spatial WKWebView (no network).

The HTML is assembled by joining fixed line arrays with "\\n" and composing each
card as a single deterministic line, byte-identical to the TS mirror
(src/generators/image_gallery.ts). The cross-language SHA pin in the test suites
asserts that identity. ASCII-only on purpose so the two serializations stay
encoding-agnostic.

Keep this in lockstep with src/generators/image_gallery.ts. Dependency-free.
"""
from __future__ import annotations

DEFAULT_TITLE = "Spatial Gallery"

# Must stay byte-identical to the TS DEFAULT_TILES.
DEFAULT_TILES: list[dict] = [
    {
        "id": "a",
        "label": "Nebula",
        "caption": "Generative gradient field",
        "c0": "#6a5cff",
        "c1": "#22d3ee",
        "accent": '<circle cx="320" cy="80" r="70" fill="#ffffff" opacity="0.12"/><circle cx="120" cy="220" r="50" fill="#ffffff" opacity="0.10"/>',
    },
    {
        "id": "b",
        "label": "Ember",
        "caption": "Warm radial bloom",
        "c0": "#ff7a45",
        "c1": "#ff1f6b",
        "accent": '<circle cx="200" cy="150" r="42" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.28"/><circle cx="200" cy="150" r="82" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.16"/>',
    },
    {
        "id": "c",
        "label": "Tide",
        "caption": "Layered wave forms",
        "c0": "#10b981",
        "c1": "#0ea5e9",
        "accent": '<path d="M0 200 Q100 160 200 200 T400 200 V300 H0 Z" fill="#ffffff" opacity="0.12"/><path d="M0 240 Q100 210 200 240 T400 240 V300 H0 Z" fill="#ffffff" opacity="0.10"/>',
    },
    {
        "id": "d",
        "label": "Dusk",
        "caption": "Violet horizon",
        "c0": "#a855f7",
        "c1": "#ec4899",
        "accent": '<rect x="160" y="60" width="80" height="80" transform="rotate(45 200 100)" fill="#ffffff" opacity="0.14"/><rect x="280" y="180" width="60" height="60" transform="rotate(45 310 210)" fill="#ffffff" opacity="0.12"/>',
    },
    {
        "id": "e",
        "label": "Solar",
        "caption": "Radiant ray burst",
        "c0": "#fbbf24",
        "c1": "#f97316",
        "accent": '<g stroke="#ffffff" stroke-width="6" opacity="0.18"><line x1="200" y1="150" x2="200" y2="20"/><line x1="200" y1="150" x2="330" y2="80"/><line x1="200" y1="150" x2="360" y2="150"/><line x1="200" y1="150" x2="330" y2="220"/></g><circle cx="200" cy="150" r="28" fill="#ffffff" opacity="0.22"/>',
    },
    {
        "id": "f",
        "label": "Frost",
        "caption": "Crystalline lattice",
        "c0": "#38bdf8",
        "c1": "#818cf8",
        "accent": '<polygon points="200,70 270,110 270,190 200,230 130,190 130,110" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.22"/><polygon points="200,110 235,130 235,170 200,190 165,170 165,130" fill="#ffffff" opacity="0.12"/>',
    },
]

# Fixed <style> body. Must match the TS STYLE_LINES.
STYLE_LINES: list[str] = [
    "*{box-sizing:border-box;}",
    "html,body{margin:0;height:100%;}",
    'body{background:#0b0d12;color:#e7e9ee;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;}',
    "header{padding:28px 32px 8px;}",
    "h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-0.01em;}",
    "p.sub{margin:6px 0 0;color:#9aa3b2;font-size:14px;}",
    "main{padding:20px 32px 40px;}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;}",
    ".card{margin:0;background:#141821;border:1px solid #232a36;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.35);transition:transform .18s ease,border-color .18s ease;}",
    ".card:hover{transform:translateY(-4px);border-color:#3a445a;}",
    ".thumb{aspect-ratio:4 / 3;width:100%;display:block;background:#0e1117;}",
    ".thumb svg,.thumb img{width:100%;height:100%;display:block;object-fit:cover;}",
    "figcaption{padding:12px 14px 14px;font-size:14px;color:#c7cdd9;}",
]


def _esc(s: str) -> str:
    """Minimal HTML-escape (text + double-quoted attributes). Ampersand first."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _svg_tile(t: dict) -> str:
    """Build one tile's inline SVG as a single line (no internal newlines)."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="'
        + _esc(t["label"])
        + '">'
        + '<defs><linearGradient id="grad-'
        + t["id"]
        + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'
        + t["c0"]
        + '"/><stop offset="1" stop-color="'
        + t["c1"]
        + '"/></linearGradient></defs>'
        + '<rect width="400" height="300" fill="url(#grad-'
        + t["id"]
        + ')"/>'
        + t["accent"]
        + '<text x="24" y="48" font-family="ui-sans-serif,system-ui,sans-serif" font-size="34" font-weight="700" fill="#ffffff" opacity="0.95">'
        + _esc(t["label"])
        + "</text>"
        + "</svg>"
    )


def _tile_card(t: dict) -> str:
    """A default (SVG) card as a single line."""
    return (
        '<figure class="card"><div class="thumb">'
        + _svg_tile(t)
        + '</div><figcaption>'
        + _esc(t["caption"])
        + "</figcaption></figure>"
    )


def _image_card(img: dict) -> str:
    """A custom-image card as a single line."""
    return (
        '<figure class="card"><div class="thumb"><img src="'
        + _esc(img["src"])
        + '" alt="'
        + _esc(img["caption"])
        + '" loading="lazy"/></div><figcaption>'
        + _esc(img["caption"])
        + "</figcaption></figure>"
    )


def _build_html(title: str, subtitle: str, cards: list[str]) -> str:
    """Assemble the full self-contained HTML document."""
    head: list[str] = [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8"/>',
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
        "<title>" + _esc(title) + "</title>",
        "<style>",
        *STYLE_LINES,
        "</style>",
        "</head>",
        "<body>",
        "<header>",
        "<h1>" + _esc(title) + "</h1>",
        '<p class="sub">' + _esc(subtitle) + "</p>",
        "</header>",
        "<main>",
        '<div class="grid">',
    ]
    foot: list[str] = ["</div>", "</main>", "</body>", "</html>"]
    return "\n".join([*head, *cards, *foot])


def image_gallery_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one html View (as a dict)."""
    params = params or {}
    title = params.get("title", DEFAULT_TITLE)
    images = params.get("images")
    if images is not None:
        cards = [_image_card(img) for img in images]
        count = len(images)
    else:
        cards = [_tile_card(t) for t in DEFAULT_TILES]
        count = len(DEFAULT_TILES)
    subtitle = params.get(
        "subtitle", str(count) + " panels - self-contained, no external assets"
    )
    html = _build_html(title, subtitle, cards)
    return [
        {
            "id": params.get("id", "gallery"),
            "type": "html",
            "title": title,
            "source": {"kind": "inline", "value": html},
            "layout": {"w": 1.4, "h": 1, "hint": "wide"},
        }
    ]


image_gallery_generator: dict = {
    "slug": "image_gallery",
    "describe": "Emit an html View: a dark-theme responsive grid of inline-SVG tiles (defaults to a 6-tile gallery).",
    "generate": image_gallery_build,
}


def register_image_gallery_generator() -> None:
    """Register the image_gallery generator with the shared registry.

    Imports the shared registry lazily so this module stays standalone — build()
    has no dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(image_gallery_generator)

"""metric_tiles — Python mirror of @viewer/core's metric_tiles generator.

Emits ONE `html` View whose inline source is a fully self-contained KPI
dashboard: big-number stat tiles in a responsive grid, dark theme, all CSS
inlined, NO external resources or scripts (so it renders inside the sandboxed
iframe/WKWebView the html renderer uses). The shared html renderer drops
`source.value` straight into the iframe `srcDoc`.

The HTML is assembled from an ordered list of lines joined by '\\n' so it is
byte-identical to the TS mirror (src/generators/metric_tiles.ts) for the same
input. Calling with no params yields a believable product dashboard.

Keep this in lockstep with src/generators/metric_tiles.ts. Dependency-free
besides the registry helpers it imports from viewer_generators.
"""
from __future__ import annotations

DEFAULT_TITLE = "Product Metrics"
DEFAULT_TILES: list[dict] = [
    {"label": "Monthly Revenue", "value": "$1.24M", "delta": "↑ 12.4%"},
    {"label": "Active Users", "value": "84,312", "delta": "↑ 6.1%"},
    {"label": "Uptime (30d)", "value": "99.97%", "delta": "↑ 0.02%"},
    {"label": "Net Revenue Retention", "value": "118%", "delta": "↑ 3 pts"},
    {"label": "Gross Margin", "value": "74%", "delta": "↓ 1.2%"},
    {"label": "Cash Runway", "value": "16 mo", "delta": "↓ 2 mo"},
    {"label": "NPS", "value": "62", "delta": "↑ 4"},
    {"label": "Deploys / week", "value": "37", "delta": "↑ 9"},
]

# Inlined dark-theme CSS, line-for-line identical to the TS mirror.
CSS_LINES: list[str] = [
    ":root{--bg:#0b0e14;--panel:#141a24;--panel2:#1b2330;--text:#e6edf3;--muted:#8b98a9;--up:#3fb950;--down:#f85149;--flat:#8b98a9;--accent:#4a9eff;--border:#222c3a}",
    "*{box-sizing:border-box;margin:0;padding:0}",
    "html,body{height:100%}",
    'body{background:radial-gradient(1200px 800px at 20% -10%,#16202e 0%,var(--bg) 60%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:32px}',
    ".dash{max-width:1100px;margin:0 auto}",
    ".dash__head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:16px}",
    ".dash__title{font-size:22px;font-weight:650;letter-spacing:.2px}",
    ".dash__sub{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}",
    ".tile{position:relative;background:linear-gradient(180deg,var(--panel2) 0%,var(--panel) 100%);border:1px solid var(--border);border-radius:14px;padding:20px 22px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 8px 24px rgba(0,0,0,.35);overflow:hidden}",
    '.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);opacity:.6}',
    ".tile__label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px}",
    ".tile__value{font-size:34px;font-weight:700;line-height:1.05;letter-spacing:-.5px;font-variant-numeric:tabular-nums}",
    ".tile__delta{display:inline-flex;align-items:center;margin-top:12px;font-size:13px;font-weight:600;padding:3px 9px;border-radius:999px;font-variant-numeric:tabular-nums}",
    ".tile__delta--up{color:var(--up);background:rgba(63,185,80,.12)}",
    ".tile__delta--down{color:var(--down);background:rgba(248,81,73,.12)}",
    ".tile__delta--flat{color:var(--flat);background:rgba(139,152,169,.12)}",
]


def _esc(s: str) -> str:
    """HTML-escape a value (& first, fixed order). Must match the TS `esc`."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _trend(delta: str) -> str:
    """Classify a delta by its leading glyph: up (↑/+), down (↓/-/−), else flat."""
    c = delta.strip()[:1]
    if c in ("↑", "+"):
        return "up"
    if c in ("↓", "-", "\u2212"):
        return "down"
    return "flat"


def _build_html(title: str, tiles: list[dict]) -> str:
    """Assemble the self-contained dashboard from ordered lines joined by '\\n'.

    Must match the TS `buildHtml` so the resulting string is byte-identical.
    """
    lines: list[str] = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        f"<title>{_esc(title)}</title>",
        "<style>",
        *CSS_LINES,
        "</style>",
        "</head>",
        "<body>",
        '<main class="dash">',
        '<header class="dash__head">',
        f'<h1 class="dash__title">{_esc(title)}</h1>',
        f'<p class="dash__sub">{len(tiles)} live metrics</p>',
        "</header>",
        '<section class="grid">',
    ]
    for t in tiles:
        lines.append('<article class="tile">')
        lines.append(f'<div class="tile__label">{_esc(t["label"])}</div>')
        lines.append(f'<div class="tile__value">{_esc(t["value"])}</div>')
        if t.get("delta") is not None:
            lines.append(
                f'<div class="tile__delta tile__delta--{_trend(t["delta"])}">{_esc(t["delta"])}</div>'
            )
        lines.append("</article>")
    lines.append("</section>")
    lines.append("</main>")
    lines.append("</body>")
    lines.append("</html>")
    return "\n".join(lines)


def metric_tiles_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one html View (as a dict)."""
    params = params or {}
    title = params.get("title", DEFAULT_TITLE)
    tiles = params.get("tiles", DEFAULT_TILES)
    content = _build_html(title, tiles)
    return [
        {
            "id": params.get("id", "metrics"),
            "type": "html",
            "title": params.get("title", DEFAULT_TITLE),
            "source": {"kind": "inline", "value": content},
            "layout": {"w": 1.2, "h": 0.8, "hint": "wide"},
        }
    ]


metric_tiles_generator: dict = {
    "slug": "metric_tiles",
    "describe": "Emit a self-contained HTML KPI-tile dashboard View (defaults to a product dashboard).",
    "generate": metric_tiles_build,
}


def register_metric_tiles_generator() -> None:
    """Register the metric_tiles generator with the shared registry.

    Imports the registry lazily so this module stays standalone — build() has no
    dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(metric_tiles_generator)

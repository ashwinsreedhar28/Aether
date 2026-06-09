"""workspace — Python mirror of @viewer/core's workspace generator.

The headline composite demo: ONE generator call emits SEVERAL Views of DIFFERENT
types — a whole arranged multi-panel workspace, not a single panel. The default
build is a live "Project Cockpit": a markdown summary, an html KPI-tile grid, a
CSV service-health table, a mermaid deploy pipeline, and a kanban release board.
An optional `theme` param swaps in a second fully-authored preset ("briefing", a
personal Morning Briefing) to prove a generator can author distinct workspaces.

Every panel carries a `meta` grid hint ({gx,gy,gw,gh}) so a shell can arrange the
panels into a real dashboard instead of stacking them. All content strings are
assembled deterministically (fixed key order, compact JSON separators, the same
CSV/HTML/markdown builders as the TS side) so the full emitted View[] serializes
byte-identically to the TS mirror (src/generators/workspace.ts) for the same
input — that string identity is what the cross-language parity test pins down.

Keep this in lockstep with src/generators/workspace.ts. Dependency-free besides
the registry helpers it imports from viewer_generators.
"""
from __future__ import annotations

import json

# --- preset content (two fully-authored workspaces) ------------------------

THEMES: dict[str, dict] = {
    "cockpit": {
        "label": "Project Cockpit",
        "subtitle": "Atlas Platform - Release 4.7 - Live Mission Control",
        "accent": "#4a9eff",
        "summary": (
            "Release 4.7 is 82% complete and tracking green for Friday's cut. "
            "Two epics remain in review and there are no open Sev-1s. Burn-down "
            "is a full day ahead of plan."
        ),
        "highlights": [
            "- **4 of 5 epics** merged to `release/4.7`; spatial-handoff is in final review.",
            "- **p95 latency** across the mesh holds at **138 ms** against a 200 ms budget.",
            "- **Zero** open Sev-1s for nine days running.",
        ],
        "kpis": [
            {"label": "Sprint Progress", "value": "82%", "delta": "+6% vs plan", "good": True},
            {"label": "Open Bugs", "value": "14", "delta": "-5 this week", "good": True},
            {"label": "p95 Latency", "value": "138 ms", "delta": "-12 ms", "good": True},
            {"label": "CI Pass Rate", "value": "96.4%", "delta": "+1.2%", "good": True},
            {"label": "Cloud Spend", "value": "$23.1k", "delta": "+$1.4k", "good": False},
            {"label": "Days to Cut", "value": "2", "delta": "on track", "good": True},
        ],
        "table_title": "Service Health",
        "table_header": ["Service", "Owner", "Status", "Uptime", "p95 ms"],
        "table_rows": [
            ["mesh-gateway", "Priya", "green", "99.98%", "132"],
            ["viewer-spatial", "Marcus", "green", "99.95%", "145"],
            ["viewer-desktop", "Lena", "green", "99.99%", "88"],
            ["auth-edge", "Sam", "amber", "99.90%", "210"],
            ["telemetry", "Dana", "green", "99.97%", "118"],
        ],
        "flow_title": "Deploy Pipeline",
        "mermaid": (
            "graph LR\n"
            "  A[Commit] --> B[CI Build]\n"
            "  B --> C{Tests}\n"
            "  C -->|pass| D[Stage]\n"
            "  C -->|fail| A\n"
            "  D --> E[Canary 5%]\n"
            "  E --> F[Release 4.7]"
        ),
        "board": {
            "name": "Release 4.7 Board",
            "columns": [
                {
                    "id": "bk",
                    "title": "Backlog",
                    "cards": [
                        {"id": "c1", "title": "Offline session cache", "description": "Persist views for handoff", "tags": ["spatial", "P2"]},
                        {"id": "c2", "title": "Theme tokens", "description": "Shared accent palette", "tags": ["desktop"]},
                    ],
                },
                {
                    "id": "ip",
                    "title": "In Progress",
                    "cards": [
                        {"id": "c3", "title": "Spatial handoff epic", "description": "Move workspace desktop -> AVP", "tags": ["epic", "P1"]},
                    ],
                },
                {
                    "id": "rv",
                    "title": "Review",
                    "cards": [
                        {"id": "c4", "title": "Mermaid renderer perf", "description": "Cache parsed graphs", "tags": ["perf"]},
                    ],
                },
                {
                    "id": "dn",
                    "title": "Done",
                    "cards": [
                        {"id": "c5", "title": "CSV table sort", "description": "Click-to-sort columns", "tags": ["desktop"]},
                        {"id": "c6", "title": "KPI tiles", "description": "Metric grid html view", "tags": ["spatial"]},
                    ],
                },
            ],
        },
    },
    "briefing": {
        "label": "Morning Briefing",
        "subtitle": "Tuesday, 6 Jun 2026 - Personal Command Center",
        "accent": "#f0a830",
        "summary": (
            "Six meetings today with a two-hour focus block protected at 14:00. "
            "Inbox is at 12 unread, three flagged. Travel for Thursday's offsite "
            "is booked and confirmed."
        ),
        "highlights": [
            "- **Focus block** 14:00-16:00 held for the Q3 roadmap draft.",
            "- **3 flagged** emails need replies before noon.",
            "- **Gym + reading** streak at **18 days**; keep it alive.",
        ],
        "kpis": [
            {"label": "Meetings Today", "value": "6", "delta": "2 back-to-back", "good": False},
            {"label": "Inbox Unread", "value": "12", "delta": "-8 since 7am", "good": True},
            {"label": "Focus Hours", "value": "2.0", "delta": "protected", "good": True},
            {"label": "Steps", "value": "3,480", "delta": "behind pace", "good": False},
            {"label": "Tasks Due", "value": "5", "delta": "2 overdue", "good": False},
            {"label": "Streak (days)", "value": "18", "delta": "+1", "good": True},
        ],
        "table_title": "Today's Schedule",
        "table_header": ["Time", "Event", "With", "Where", "Prep"],
        "table_rows": [
            ["09:00", "Standup", "Platform team", "Zoom", "none"],
            ["10:30", "1:1 with Priya", "Priya", "Room 4", "notes"],
            ["12:00", "Lunch + walk", "-", "Outside", "-"],
            ["14:00", "Focus: Q3 roadmap", "-", "Desk", "deck"],
            ["16:30", "Design review", "Design guild", "AVP space", "figma"],
        ],
        "flow_title": "Day Flow",
        "mermaid": (
            "graph TD\n"
            "  M[Morning] --> S[Standup]\n"
            "  S --> O[1:1s]\n"
            "  O --> L[Lunch + Walk]\n"
            "  L --> F[Focus Block]\n"
            "  F --> R[Design Review]\n"
            "  R --> W[Wrap-up]"
        ),
        "board": {
            "name": "Today",
            "columns": [
                {
                    "id": "td",
                    "title": "To Do",
                    "cards": [
                        {"id": "t1", "title": "Reply to flagged email", "description": "3 threads waiting", "tags": ["inbox"]},
                        {"id": "t2", "title": "Book dentist", "description": "Overdue 2 days", "tags": ["personal", "overdue"]},
                    ],
                },
                {
                    "id": "dg",
                    "title": "Doing",
                    "cards": [
                        {"id": "t3", "title": "Q3 roadmap draft", "description": "Focus block 14:00", "tags": ["deep-work"]},
                    ],
                },
                {
                    "id": "dn",
                    "title": "Done",
                    "cards": [
                        {"id": "t4", "title": "Standup", "description": "Shared blockers", "tags": ["team"]},
                        {"id": "t5", "title": "Morning workout", "description": "Day 18 streak", "tags": ["health"]},
                    ],
                },
            ],
        },
    },
}

DEFAULT_THEME = "cockpit"

# Grid placement (4-wide dashboard): summary|kpis / table|mermaid / board-full.
_GRID: list[dict] = [
    {"gx": 0, "gy": 0, "gw": 2, "gh": 1},
    {"gx": 2, "gy": 0, "gw": 2, "gh": 1},
    {"gx": 0, "gy": 1, "gw": 2, "gh": 1},
    {"gx": 2, "gy": 1, "gw": 2, "gh": 1},
    {"gx": 0, "gy": 2, "gw": 4, "gh": 1},
]
_LAYOUT: list[dict] = [
    {"w": 1.4, "h": 0.8, "hint": "wide"},
    {"w": 1.4, "h": 0.8, "hint": "wide"},
    {"w": 1.4, "h": 0.8, "hint": "wide"},
    {"w": 1.4, "h": 0.8, "hint": "tall"},
    {"w": 2.8, "h": 0.9, "hint": "wide"},
]


def _escape_csv_field(field: str) -> str:
    """Quote a field only when it contains a comma, quote, or newline (RFC 4180)."""
    if any(c in field for c in ',"\n\r'):
        return '"' + field.replace('"', '""') + '"'
    return field


def _to_csv(header: list[str], rows: list[list[str]]) -> str:
    """CSV with fixed row/column order. Mirrors the TS `toCsv`."""
    lines = [",".join(_escape_csv_field(c) for c in r) for r in [header, *rows]]
    return "\n".join(lines)


def _summary_md(label: str, subtitle: str, summary: str, highlights: list[str]) -> str:
    """Markdown summary block. Mirrors the TS `summaryMd`."""
    blocks = [
        f"# {label}",
        f"_{subtitle}_",
        f"> {summary}",
        "## Highlights\n\n" + "\n".join(highlights),
    ]
    return "\n\n".join(blocks)


def _kpi_html(label: str, accent: str, tiles: list[dict]) -> str:
    """A self-contained KPI-tile grid as an HTML string. Mirrors the TS `kpiHtml`."""
    head = (
        '<div style="font-family:-apple-system,system-ui,sans-serif;'
        'padding:20px;background:#0f1117;color:#e6e6e6">'
        f'<h2 style="margin:0 0 16px;color:{accent}">{label} - Key Metrics</h2>'
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'
    )
    cells = []
    for t in tiles:
        color = "#7bd88f" if t["good"] else "#ff6b6b"
        cells.append(
            '<div style="background:#1a1d27;border-radius:12px;padding:16px;'
            f'border-left:3px solid {accent}">'
            '<div style="font-size:12px;color:#8b8f9a;text-transform:uppercase;'
            f'letter-spacing:.05em">{t["label"]}</div>'
            f'<div style="font-size:28px;font-weight:700;margin:6px 0">{t["value"]}</div>'
            f'<div style="font-size:13px;color:{color}">{t["delta"]}</div>'
            "</div>"
        )
    return head + "".join(cells) + "</div></div>"


def _board_content(board: dict) -> str:
    """Canonical kanban content: fixed key order, compact JSON. Mirrors TS `boardContent`."""
    obj = {
        "name": board["name"],
        "columns": [
            {
                "id": c["id"],
                "title": c["title"],
                "cards": [
                    {
                        "id": card["id"],
                        "title": card["title"],
                        "description": card["description"],
                        "tags": card["tags"],
                    }
                    for card in c["cards"]
                ],
            }
            for c in board["columns"]
        ],
    }
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def workspace_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> several Views of mixed type (a whole workspace)."""
    params = params or {}
    theme = params.get("theme") or DEFAULT_THEME
    key = theme if theme in THEMES else DEFAULT_THEME
    p = THEMES[key]

    summary = _summary_md(p["label"], p["subtitle"], p["summary"], p["highlights"])
    kpis = _kpi_html(p["label"], p["accent"], p["kpis"])
    csv = _to_csv(p["table_header"], p["table_rows"])
    mermaid = p["mermaid"]
    board = _board_content(p["board"])

    return [
        {
            "id": f"{key}-summary",
            "type": "markdown",
            "title": p["label"],
            "source": {"kind": "inline", "value": summary},
            "layout": _LAYOUT[0],
            "meta": _GRID[0],
        },
        {
            "id": f"{key}-kpis",
            "type": "html",
            "title": "Key Metrics",
            "source": {"kind": "inline", "value": kpis},
            "layout": _LAYOUT[1],
            "meta": _GRID[1],
        },
        {
            "id": f"{key}-table",
            "type": "table",
            "title": p["table_title"],
            "source": {"kind": "inline", "value": csv, "mediaType": "text/csv"},
            "layout": _LAYOUT[2],
            "meta": _GRID[2],
        },
        {
            "id": f"{key}-flow",
            "type": "mermaid",
            "title": p["flow_title"],
            "source": {"kind": "inline", "value": mermaid},
            "layout": _LAYOUT[3],
            "meta": _GRID[3],
        },
        {
            "id": f"{key}-board",
            "type": "kanban",
            "title": p["board"]["name"],
            "source": {"kind": "inline", "value": board},
            "layout": _LAYOUT[4],
            "meta": _GRID[4],
        },
    ]


workspace_generator: dict = {
    "slug": "workspace",
    "describe": "Emit a whole arranged multi-panel workspace (markdown+html+table+mermaid+kanban); theme defaults to a live Project Cockpit.",
    "generate": workspace_build,
}


def register_workspace_generator() -> None:
    """Register the workspace generator with the shared registry.

    Imports the registry lazily so this module stays standalone — build() has no
    dependency on viewer_generators; only registration does.
    """
    from viewer_generators import register_generator

    register_generator(workspace_generator)

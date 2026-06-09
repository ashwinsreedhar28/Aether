"""sprint_board — Python mirror of @viewer/core's sprint-board generator.

A pure `params -> list[View dict]` that emits ONE `kanban` View whose inline
source is the EXACT JSON the shared kanban renderer parses (board document
`{name?, description?, columns:[{id,title,color?,cards?:[{id,title,description?,
tags?,priority?,dueDate?}]}]}`).

The inline source JSON is built with a FIXED key order and compact separators
(",", ":") so the serialized string equals the TS side's `JSON.stringify(content)`
byte-for-byte. The shared fixture (../../generators/sprint-board-fixture.json)
pins this down on both sides.

Keep this in lockstep with src/generators/sprint-board.ts. Dependency-free
besides viewer_core.
"""
from __future__ import annotations

import json

DEFAULT_NAME = "Lattice — Auth & API · Sprint 14"
DEFAULT_DESCRIPTION = "Two-week sprint · 6 engineers · goal: ship SSO + cursor pagination"
DEFAULT_COLUMNS: list[dict] = [
    {
        "id": "backlog",
        "title": "Backlog",
        "color": "#64748b",
        "cards": [
            {
                "id": "bl-1",
                "title": "OAuth refresh-token rotation",
                "description": "Rotate the refresh token on every use and revoke the prior one to kill replay.",
                "tags": ["backend", "auth"],
                "priority": "P1",
                "dueDate": "2026-06-19",
            },
            {
                "id": "bl-2",
                "title": "Rate-limit the public /search API",
                "description": "Sliding-window limiter at the gateway: 100 req/min per API key.",
                "tags": ["backend", "api"],
                "priority": "P2",
            },
            {
                "id": "bl-3",
                "title": "Dark-mode contrast audit",
                "description": "WCAG AA pass across the settings and billing screens.",
                "tags": ["frontend", "a11y"],
                "priority": "P3",
            },
            {
                "id": "bl-4",
                "title": "Migrate sessions table to Postgres 16",
                "description": "Drop the legacy MySQL store; backfill ~2M rows behind a dual-write.",
                "tags": ["infra"],
                "priority": "P2",
            },
        ],
    },
    {
        "id": "in-progress",
        "title": "In Progress",
        "color": "#3b82f6",
        "cards": [
            {
                "id": "ip-1",
                "title": "SSO login via SAML",
                "description": "Okta + Azure AD; finishing assertion signature validation.",
                "tags": ["backend", "auth"],
                "priority": "P1",
                "dueDate": "2026-06-12",
            },
            {
                "id": "ip-2",
                "title": "Redesign the onboarding wizard",
                "description": "Three-step flow that persists progress between steps.",
                "tags": ["frontend"],
                "priority": "P2",
            },
            {
                "id": "ip-3",
                "title": "Fix N+1 query on dashboard load",
                "description": "Batch the per-widget metric fetch into a single round-trip.",
                "tags": ["backend", "perf"],
                "priority": "P1",
            },
        ],
    },
    {
        "id": "review",
        "title": "Review",
        "color": "#f59e0b",
        "cards": [
            {
                "id": "rv-1",
                "title": "Cursor pagination for /events",
                "description": "Replace offset paging with opaque base64 cursors.",
                "tags": ["api", "backend"],
                "priority": "P2",
            },
            {
                "id": "rv-2",
                "title": "Card drag-and-drop polish",
                "description": "Keyboard reorder plus a reduced-motion fallback.",
                "tags": ["frontend"],
                "priority": "P3",
            },
            {
                "id": "rv-3",
                "title": "Audit-log CSV export",
                "description": "Stream the export so large tenants never OOM the worker.",
                "tags": ["backend"],
                "priority": "P2",
                "dueDate": "2026-06-10",
            },
        ],
    },
    {
        "id": "done",
        "title": "Done",
        "color": "#22c55e",
        "cards": [
            {
                "id": "dn-1",
                "title": "Password breach check (HIBP)",
                "description": "k-anonymity range query on signup and password reset.",
                "tags": ["auth", "security"],
                "priority": "P1",
            },
            {
                "id": "dn-2",
                "title": "Upgrade React 18 → 19",
                "description": "Adopt concurrent features; removed the last findDOMNode call.",
                "tags": ["frontend"],
                "priority": "P2",
            },
            {
                "id": "dn-3",
                "title": "Stabilize flaky checkout e2e",
                "description": "Wait on network-idle instead of a fixed sleep.",
                "tags": ["qa"],
                "priority": "P3",
            },
            {
                "id": "dn-4",
                "title": "Add /healthz readiness probe",
                "description": "Gateway now reports DB + cache health for the k8s probe.",
                "tags": ["infra"],
                "priority": "P3",
            },
        ],
    },
]


def _build_content(name: str, description: str | None, columns: list[dict]) -> dict:
    """Canonical board content: fixed key order, optional keys only when present.

    Must match the TS `buildContent` so the compact serialization is identical.
    """
    board: dict = {"name": name}
    if description is not None:
        board["description"] = description
    board["columns"] = [
        {
            "id": col["id"],
            "title": col["title"],
            **({"color": col["color"]} if col.get("color") is not None else {}),
            **(
                {
                    "cards": [
                        {
                            "id": card["id"],
                            "title": card["title"],
                            **({"description": card["description"]} if card.get("description") is not None else {}),
                            **({"tags": [t for t in card["tags"]]} if card.get("tags") is not None else {}),
                            **({"priority": card["priority"]} if card.get("priority") is not None else {}),
                            **({"dueDate": card["dueDate"]} if card.get("dueDate") is not None else {}),
                        }
                        for card in col["cards"]
                    ]
                }
                if col.get("cards") is not None
                else {}
            ),
        }
        for col in columns
    ]
    return board


def sprint_board_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one kanban View (as a dict)."""
    params = params or {}
    name = params.get("name", DEFAULT_NAME)
    description = params.get("description", DEFAULT_DESCRIPTION)
    columns = params.get("columns", DEFAULT_COLUMNS)
    content = _build_content(name, description, columns)
    # Compact separators => byte-identical to TS JSON.stringify(content).
    value = json.dumps(content, separators=(",", ":"), ensure_ascii=False)
    return [
        {
            "id": params.get("id", "sprint-board"),
            "type": "kanban",
            "title": params.get("title", "Sprint Board"),
            "source": {"kind": "inline", "value": value},
            "layout": {"w": 1.4, "h": 1.0, "hint": "wide"},
        }
    ]


sprint_board_generator: dict = {
    "slug": "sprint_board",
    "describe": "Emit a kanban View of a software sprint board (defaults to a populated demo board).",
    "generate": sprint_board_build,
}


def register_sprint_board_generator(register_generator) -> None:
    """Register the sprint-board generator with the shared registry.

    Takes the registry's `register_generator` to avoid importing — and thereby
    coupling to — viewer_generators' module-level registry at import time.
    """
    register_generator(sprint_board_generator)

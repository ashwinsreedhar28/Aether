"""data_table — Python mirror of @viewer/core's data_table generator.

So the spatial server can run this generator server-side and emit a result
IDENTICAL to the TS side (src/generators/data_table.ts). A generator is a pure
function `params -> list[View dict]`.

The emitted `table` View carries a CSV string as inline `source.value`; the
shared table renderer reads it as delimited text (first row = header, comma by
default). The CSV is assembled with a fixed column order and a deterministic
RFC-4180-ish escaper so the serialized content is byte-identical to the TS side's
`toCsv` output. Calling with no params yields a real demo: a 10-session
strength-training log. Dependency-free besides viewer_core.
"""
from __future__ import annotations

from viewer_core import assert_view

# Header + body for the default demo. A real 10-session training log.
DEFAULT_HEADER: list[str] = ["Date", "Focus", "Exercises", "Sets", "Volume (lbs)"]
DEFAULT_ROWS: list[list[str]] = [
    ["5 Oct 2025", "Back & Biceps", "7", "24", "17190"],
    ["7 Oct 2025", "Full Body", "5", "16", "16156"],
    ["8 Oct 2025", "Chest & Triceps", "6", "22", "9350"],
    ["12 Oct 2025", "Back & Biceps", "5", "18", "14020"],
    ["22 Oct 2025", "Back & Biceps", "5", "18", "16380"],
    ["23 Oct 2025", "Chest & Triceps", "4", "16", "13670"],
    ["26 Oct 2025", "Back & Biceps", "3", "11", "9750"],
    ["28 Oct 2025", "Legs", "5", "15", "19000"],
    ["30 Oct 2025", "Chest & Triceps", "5", "19", "11900"],
    ["2 Nov 2025", "Back & Biceps", "4", "16", "14680"],
]


def _escape_field(field: str) -> str:
    """Quote a field only when it contains a comma, quote, or newline (RFC 4180)."""
    if any(c in field for c in (",", '"', "\n", "\r")):
        return '"' + field.replace('"', '""') + '"'
    return field


def _to_csv(header: list[str], rows: list[list[str]]) -> str:
    """Build a CSV string with fixed row/column order.

    Must match the TS `toCsv` so the serialized content is byte-identical.
    """
    lines = [",".join(_escape_field(c) for c in r) for r in [header, *rows]]
    return "\n".join(lines)


def data_table_build(params: dict | None = None) -> list[dict]:
    """Pure build: params -> exactly one table View (as a dict)."""
    params = params or {}
    value = params.get("csv")
    if value is None:
        value = _to_csv(DEFAULT_HEADER, DEFAULT_ROWS)
    return [
        {
            "id": params.get("id", "table"),
            "type": "table",
            "title": params.get("title", "Training Log"),
            "source": {"kind": "inline", "value": value, "mediaType": "text/csv"},
            "layout": {"w": 1.2, "h": 0.9, "hint": "wide"},
        }
    ]


data_table_generator: dict = {
    "slug": "data_table",
    "describe": "Emit a sortable table View from CSV (defaults to a real training log).",
    "generate": data_table_build,
}


def register_data_table_generator(register_generator) -> None:
    """Register the data_table generator with a shared registry's register fn."""
    register_generator(data_table_generator)

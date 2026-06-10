"""
viewer_core — Python mirror of the @viewer/core View contract.

The spatial bridge node (Python) and the scene server validate incoming Views
with the SAME rules the TS side enforces, so an agent's open_view payload is
accepted or rejected identically regardless of which shell receives it.

Keep this in lockstep with src/schema/view.ts and schema/view.schema.json.
Dependency-free: hand-rolled validation, no jsonschema required.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

VIEW_TYPES = (
    "markdown",
    "text",
    "json",
    "mermaid",
    "kanban",
    "knowledge-graph",
    "image",
    "html",
    "latex",
    "table",
)

SOURCE_KINDS = ("inline", "path", "url")
LAYOUT_HINTS = ("default", "wide", "tall", "compact", "focus")


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def _is_obj(x: Any) -> bool:
    return isinstance(x, dict)


def _validate_source(src: Any, errors: list[str]) -> None:
    if not _is_obj(src):
        errors.append("source must be an object")
        return
    kind = src.get("kind")
    if not isinstance(kind, str) or kind not in SOURCE_KINDS:
        errors.append(f"source.kind must be one of inline|path|url (got {kind!r})")
    value = src.get("value")
    if not isinstance(value, str):
        errors.append("source.value must be a string")
    elif value == "":
        errors.append("source.value must be non-empty")
    if "mediaType" in src and not isinstance(src["mediaType"], str):
        errors.append("source.mediaType must be a string when present")


def _validate_layout(layout: Any, errors: list[str]) -> None:
    if not _is_obj(layout):
        errors.append("layout must be an object when present")
        return
    for k in ("w", "h"):
        if k in layout and not isinstance(layout[k], (int, float)):
            errors.append(f"layout.{k} must be a number when present")
    if "hint" in layout and layout["hint"] not in LAYOUT_HINTS:
        errors.append(f"layout.hint must be one of {'|'.join(LAYOUT_HINTS)}")


def validate_view(value: Any) -> ValidationResult:
    """Validate an arbitrary value as a View. Returns all errors, not just first."""
    errors: list[str] = []
    if not _is_obj(value):
        return ValidationResult(False, ["view must be an object"])

    vid = value.get("id")
    if not isinstance(vid, str) or vid == "":
        errors.append("id must be a non-empty string")

    vtype = value.get("type")
    if not isinstance(vtype, str) or vtype not in VIEW_TYPES:
        errors.append(f"type must be one of {'|'.join(VIEW_TYPES)} (got {vtype!r})")

    if "title" in value and not isinstance(value["title"], str):
        errors.append("title must be a string when present")

    if "source" not in value:
        errors.append("source is required")
    else:
        _validate_source(value["source"], errors)

    if "layout" in value:
        _validate_layout(value["layout"], errors)

    if "meta" in value and not _is_obj(value["meta"]):
        errors.append("meta must be an object when present")

    return ValidationResult(len(errors) == 0, errors)


def assert_view(value: Any) -> dict:
    """Throwing variant — returns the dict if valid, raises ValueError otherwise."""
    r = validate_view(value)
    if not r.ok:
        raise ValueError("Invalid View: " + "; ".join(r.errors))
    return value

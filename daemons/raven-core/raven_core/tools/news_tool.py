"""News Tool - Read recent headlines via the mesh.

Voice tool that maps ``news_recent`` calls onto the
``news_feeds.recent`` mesh surface. Same pattern as notify_tool: declare
the function for Gemini, implement as a thin ``await mesh_invoke(...)``,
add the edge in manifest.yaml. The renderer-side News app drives the
same surface — proves the mesh is a real graph, not point-to-point IPC.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["news_recent"]

# Gemini Live reads results aloud. Five articles is ~30s of speech for
# title+source — about as much as a user wants in a single hit. Cap at
# 10 so the model can't lock the audio stream by asking for 100.
DEFAULT_LIMIT = 5
MAX_LIMIT = 10


def _clamp_limit(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    if n < 1:
        return 1
    if n > MAX_LIMIT:
        return MAX_LIMIT
    return n


async def _news_recent(limit: int) -> dict[str, Any]:
    try:
        response = await mesh_invoke("news_feeds.recent", {"limit": limit})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    # Strip url / id / fetched_at / published_at — Gemini doesn't need
    # them to speak headlines aloud, and dropping them keeps the model's
    # output focused on the readable fields rather than reciting URLs.
    articles = []
    for raw in raw_articles:
        if not isinstance(raw, dict):
            continue
        articles.append(
            {
                "title": raw.get("title", ""),
                "source": raw.get("feed", ""),
                "summary": raw.get("summary", ""),
            }
        )
    return {"articles": articles, "count": len(articles)}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declaration for news_recent."""
    func = types.FunctionDeclaration(
        name="news_recent",
        description=(
            "Get recent news headlines. Use when the user asks about news, "
            "headlines, current events, or what's happening. Returns a list "
            "of recent articles with title, source, and a brief summary. "
            "Read the titles and sources aloud; use the summary for context "
            "if the user asks for more detail on a specific story."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        f"Optional. How many headlines to return. Default "
                        f"{DEFAULT_LIMIT}, max {MAX_LIMIT}. Prefer the "
                        "default unless the user asks for more or fewer."
                    ),
                ),
                "category": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Reserved for a future per-category filter. "
                        "Accepted today but ignored — all categories are "
                        "returned regardless of value."
                    ),
                ),
            },
        ),
    )
    return [types.Tool(function_declarations=[func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "news_recent":
        return await _news_recent(limit=_clamp_limit(args.get("limit", DEFAULT_LIMIT)))
    return None

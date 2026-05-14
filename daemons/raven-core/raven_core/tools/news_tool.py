"""News Tool - Read recent headlines and keyword-search via the mesh.

Two voice tools, both routed through ``mesh_invoke`` to the news_feeds
node:

  - ``news_recent(limit?, category?)`` → ``news_feeds.recent``
  - ``news_search(query, category?)``  → ``news_feeds.search``

Same pattern as notify_tool / finance_tool: declare the function for
Gemini, implement as a thin ``await mesh_invoke(...)``, add the edge in
manifest.yaml. The renderer-side News app drives the same surfaces —
proves the mesh is a real graph, not point-to-point IPC.

Categories: both tools accept an optional ``category`` parameter that
maps natural-language phrasing ("tech news", "local headlines") onto
the seven-category taxonomy declared in
``nodes/news_feeds/src/types.ts``. The mesh schema enum-validates the
value; an unknown category surfaces as a clean error rather than a
silent no-op.

Search scope: news_search hits the user's curated feed pool only (FTS5
over the polled articles table) — NOT the open web. The system prompt
makes that scope explicit so Gemini doesn't promise the user a
google-style search.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["news_recent", "news_search"]

# Gemini Live reads results aloud. Five articles is ~30s of speech for
# title+source — about as much as a user wants in a single hit. Cap at
# 10 so the model can't lock the audio stream by asking for 100.
DEFAULT_LIMIT = 5
MAX_LIMIT = 10

# Search uses the same spoken-bandwidth ceiling as news_recent — Gemini
# will read at most a handful of matches aloud regardless of how deep
# the FTS5 result set goes. The node itself accepts up to 50.
SEARCH_DEFAULT_LIMIT = 5
SEARCH_MAX_LIMIT = 10
SEARCH_QUERY_MAX_LEN = 200

# Mirrors nodes/news_feeds/src/types.ts CATEGORIES — broad → specific.
# Keep the order in sync across this list, the JSON Schema enum, and the
# system prompt's enumeration; readers in any of the three see the same
# sequence.
CATEGORIES: tuple[str, ...] = (
    "world",
    "us",
    "tech",
    "business",
    "sports",
    "science",
    "local",
)
_CATEGORY_SET = frozenset(CATEGORIES)


def _clamp_limit(value: Any, *, default: int = DEFAULT_LIMIT, ceiling: int = MAX_LIMIT) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < 1:
        return 1
    if n > ceiling:
        return ceiling
    return n


def _normalise_category(value: Any) -> str | None:
    """Accept a single category string from Gemini; reject anything else.

    Gemini occasionally emits trailing whitespace or different casing —
    normalise both before checking membership. Unknown values return
    None so the call falls back to "all categories" rather than handing
    the mesh a value it'll reject; the prompt should keep Gemini on the
    enum, but a hallucinated category shouldn't blow up the headline read.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    if cleaned in _CATEGORY_SET:
        return cleaned
    return None


def _strip_article(raw: Any) -> dict[str, Any] | None:
    """Reduce a stored article to the spoken-readable fields.

    Drops url / id / fetched_at / published_at — Gemini doesn't need
    them to speak headlines aloud, and dropping them keeps the model's
    output focused on the readable fields rather than reciting URLs.
    Category is included so the model can confirm scope when the user
    asks "what categories did you read"-style follow-ups.
    """
    if not isinstance(raw, dict):
        return None
    return {
        "title": raw.get("title", ""),
        "source": raw.get("feed", ""),
        "category": raw.get("category", ""),
        "summary": raw.get("summary", ""),
    }


async def _news_recent(limit: int, category: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"limit": limit}
    if category is not None:
        payload["category"] = category
    try:
        response = await mesh_invoke("news_feeds.recent", payload)
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    articles = [a for a in (_strip_article(r) for r in raw_articles) if a is not None]
    return {"articles": articles, "count": len(articles), "filtered_category": category}


async def _news_search(query: str, limit: int, category: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": query, "limit": limit}
    if category is not None:
        payload["category"] = category
    try:
        response = await mesh_invoke("news_feeds.search", payload)
    except MeshUnavailable as e:
        # news_feeds_bad_query is the empty/oversize-string MeshDeny
        # from the node. Surface it as a structured error so Gemini
        # speaks a clean "didn't catch the topic, sir" line rather
        # than reading "mesh unavailable" for what is really user input.
        if e.reason == "news_feeds_bad_query":
            return {"error": "bad query", "detail": str(e)}
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    articles = [a for a in (_strip_article(r) for r in raw_articles) if a is not None]
    return {
        "articles": articles,
        "count": len(articles),
        "query": query,
        "filtered_category": category,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for news_recent + news_search."""
    recent_func = types.FunctionDeclaration(
        name="news_recent",
        description=(
            "Get recent news headlines. Use when the user asks broadly "
            "about news, headlines, current events, or what's happening "
            "WITHOUT naming a specific topic. Returns a list of recent "
            "articles with title, source, category, and a brief summary. "
            "Read the titles and sources aloud; use the summary for "
            "context if the user asks for more detail on a specific "
            "story. For topic-specific questions ('what's the latest "
            "on X', 'any news about Y') prefer news_search."
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
                    enum=list(CATEGORIES),
                    description=(
                        "Optional filter to a single news category. Valid "
                        "values: world (international), us (national US), "
                        "tech (technology), business, sports, science, "
                        "local (Bay Area). Omit for top headlines across "
                        "all categories. Map natural-language phrasing "
                        "to one of these enum values; do not invent new "
                        "categories."
                    ),
                ),
            },
        ),
    )
    search_func = types.FunctionDeclaration(
        name="news_search",
        description=(
            "Keyword-search the user's curated news feeds for a specific "
            "topic, person, place, or event. Use whenever the user names "
            "a subject — 'what's the latest on Iran', 'any news about "
            "wildfires', 'anything on the Lakers'. Returns articles whose "
            "title, summary, or source matches the query (porter "
            "stemming, so 'wildfire' matches 'wildfires'). Search scope "
            "is the polled feed pool ONLY — this is not an open-web "
            "search; topics outside the curated feeds return an empty "
            "list. An empty result means no matching coverage in the "
            "current feed pool, not 'nothing is happening' — say so "
            "plainly. Prefer this tool over news_recent whenever the "
            "user mentions a specific topic."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Keyword query — the topic, person, place, or "
                        "event the user named. Plain words; the node "
                        "tokenises and AND-combines them. Example: user "
                        "asks 'what's the latest on Iran' → pass "
                        "'Iran'. User asks 'any news about OpenAI and "
                        "Microsoft' → pass 'OpenAI Microsoft'."
                    ),
                ),
                "category": types.Schema(
                    type=types.Type.STRING,
                    enum=list(CATEGORIES),
                    description=(
                        "Optional. Same seven-category enum as "
                        "news_recent. Pass when the user's phrasing "
                        "narrows the search to one category — 'tech "
                        "news about OpenAI' → tech, 'sports news on "
                        "the Lakers' → sports. Omit for cross-category "
                        "search."
                    ),
                ),
            },
            required=["query"],
        ),
    )
    return [types.Tool(function_declarations=[recent_func, search_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "news_recent":
        return await _news_recent(
            limit=_clamp_limit(args.get("limit", DEFAULT_LIMIT)),
            category=_normalise_category(args.get("category")),
        )
    if name == "news_search":
        raw_query = args.get("query", "")
        if not isinstance(raw_query, str):
            return {"error": "bad query", "detail": "query must be a string"}
        query = raw_query.strip()[:SEARCH_QUERY_MAX_LEN]
        if not query:
            return {"error": "bad query", "detail": "query is empty"}
        return await _news_search(
            query=query,
            limit=_clamp_limit(
                args.get("limit", SEARCH_DEFAULT_LIMIT),
                default=SEARCH_DEFAULT_LIMIT,
                ceiling=SEARCH_MAX_LIMIT,
            ),
            category=_normalise_category(args.get("category")),
        )
    return None

"""News Tool - Read recent headlines, keyword-search, surface
breaking-urgency items, and look up entities via the mesh.

Four voice tools, all routed through ``mesh_invoke`` to the news_feeds
node:

  - ``news_recent(limit?, category?, urgency?)``         → ``news_feeds.recent``
  - ``news_search(query, category?, urgency?)``          → ``news_feeds.search``
  - ``news_breaking(limit?)``                            → ``news_feeds.breaking``
  - ``news_search_by_entity(entity, kind?)``             → ``news_feeds.search_by_entity``

Same pattern as notify_tool / finance_tool: declare the function for
Gemini, implement as a thin ``await mesh_invoke(...)``, add the edge in
manifest.yaml. The renderer-side News app drives the same surfaces —
proves the mesh is a real graph, not point-to-point IPC.

Categories: news_recent / news_search accept an optional ``category``
that maps natural-language phrasing ("tech news", "local headlines")
onto the seven-category taxonomy declared in
``nodes/news_feeds/src/types.ts``. The mesh schema enum-validates the
value; an unknown category surfaces as a clean error rather than a
silent no-op.

Urgency: news_recent / news_search additionally accept an optional
``urgency`` filter (low / medium / high) so the model can narrow to
breaking-bucket items within a category — e.g. "what's important in
tech" maps to news_recent(category='tech', urgency='high'). The
shortcut ``news_breaking`` is equivalent to
news_recent(urgency='high') but named explicitly so the model can
treat "what's breaking" / "anything urgent" / "any major news" as a
single dedicated call. Urgency is computed deterministically by the
node's scorer at fetch time (heuristic-only, no LLM).

Keyword vs entity search: the prompt steers Gemini between
``news_search`` and ``news_search_by_entity`` based on whether the
user named a *proper noun* (a person, place, or organization —
entity search) or a *topic / theme* (a common noun phrase — keyword
search). "Tim Cook" / "Apple" / "Ukraine" → entity. "wildfires" /
"elections" / "AI safety" → keyword. The two surfaces overlap on
some prompts; preferring entity search for proper nouns gives higher
precision (LOWER(name) = LOWER(?) against entities extracted at
fetch time, instead of porter-stemmed bm25 over title + summary +
feed).

Search scope: news_search and news_search_by_entity both hit the
user's curated feed pool only — NOT the open web. The system prompt
makes that scope explicit so Gemini doesn't promise the user a
google-style search.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "news_recent",
    "news_search",
    "news_breaking",
    "news_search_by_entity",
]

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

# Mirrors nodes/news_feeds/src/types.ts URGENCIES — ascending intensity
# (low → medium → high). Same ordering used by the JSON Schema enum and
# the system prompt; keep them in sync.
URGENCIES: tuple[str, ...] = ("low", "medium", "high")
_URGENCY_SET = frozenset(URGENCIES)

# news_breaking spoken-bandwidth ceiling. The node default is 10, but
# Gemini reads aloud — five high-urgency items is ~30s of speech, the
# practical ceiling for a single voice turn.
BREAKING_DEFAULT_LIMIT = 5
BREAKING_MAX_LIMIT = 10

# Mirrors nodes/news_feeds/src/types.ts ENTITY_KINDS. Three-way split
# narrower than the full OntoNotes set but matches compromise's
# .people / .places / .organizations matchers. Order is preserved
# across this tuple, the JSON Schema enum, the SQL CHECK constraint,
# and the system prompt enumeration.
ENTITY_KINDS: tuple[str, ...] = ("person", "place", "organization")
_ENTITY_KIND_SET = frozenset(ENTITY_KINDS)
ENTITY_MAX_LEN = 100


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


def _normalise_urgency(value: Any) -> str | None:
    """Mirror of _normalise_category for the urgency enum. Unknown
    values silently fall back to None ("no urgency filter") rather
    than raising — same anti-blowup posture as category."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    if cleaned in _URGENCY_SET:
        return cleaned
    return None


def _normalise_entity_kind(value: Any) -> str | None:
    """Mirror of _normalise_category for the entity-kind enum. Unknown
    values silently fall back to None ("no kind filter") so the mesh
    call still runs without the filter rather than rejecting outright."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    if cleaned in _ENTITY_KIND_SET:
        return cleaned
    return None


def _strip_article(raw: Any) -> dict[str, Any] | None:
    """Reduce a stored article to the spoken-readable fields.

    Drops url / id / fetched_at / published_at — Gemini doesn't need
    them to speak headlines aloud, and dropping them keeps the model's
    output focused on the readable fields rather than reciting URLs.
    Category, urgency, and urgency_reason are included so the model can
    answer follow-up questions about scope ("which were the urgent
    ones?"), speak the *why* of urgency for the news_breaking response
    ("breaking from Reuters, fresh under an hour"), and so the response
    payload carries enough context for any future renderer that consumes
    the same shape.
    """
    if not isinstance(raw, dict):
        return None
    return {
        "title": raw.get("title", ""),
        "source": raw.get("feed", ""),
        "category": raw.get("category", ""),
        "urgency": raw.get("urgency", ""),
        "urgency_reason": raw.get("urgency_reason", ""),
        "summary": raw.get("summary", ""),
    }


async def _news_recent(
    limit: int, category: str | None, urgency: str | None
) -> dict[str, Any]:
    payload: dict[str, Any] = {"limit": limit}
    if category is not None:
        payload["category"] = category
    if urgency is not None:
        payload["urgency"] = urgency
    try:
        response = await mesh_invoke("news_feeds.recent", payload)
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    articles = [a for a in (_strip_article(r) for r in raw_articles) if a is not None]
    return {
        "articles": articles,
        "count": len(articles),
        "filtered_category": category,
        "filtered_urgency": urgency,
    }


async def _news_search(
    query: str, limit: int, category: str | None, urgency: str | None
) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": query, "limit": limit}
    if category is not None:
        payload["category"] = category
    if urgency is not None:
        payload["urgency"] = urgency
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
        "filtered_urgency": urgency,
    }


async def _news_breaking(limit: int) -> dict[str, Any]:
    """Thin wrapper over news_feeds.breaking — returns high-urgency
    items only, ordered newest-first. Empty articles list is the honest
    answer when nothing currently clears the high threshold; the
    prompt tells Gemini to say so plainly rather than substitute
    remembered headlines."""
    payload: dict[str, Any] = {"limit": limit}
    try:
        response = await mesh_invoke("news_feeds.breaking", payload)
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    articles = [a for a in (_strip_article(r) for r in raw_articles) if a is not None]
    return {"articles": articles, "count": len(articles)}


async def _news_search_by_entity(entity: str, kind: str | None) -> dict[str, Any]:
    """Entity-aware search — exact case-insensitive name match.

    No limit param exposed to Gemini for now: the spoken-bandwidth
    ceiling (SEARCH_MAX_LIMIT = 10) is what we'd cap to anyway, and
    Gemini doesn't add value tuning the number. The mesh schema allows
    1–50; we always send the default-equivalent SEARCH_DEFAULT_LIMIT (5)
    here so a single voice query returns a digestible handful.
    """
    payload: dict[str, Any] = {"entity": entity, "limit": SEARCH_DEFAULT_LIMIT}
    if kind is not None:
        payload["kind"] = kind
    try:
        response = await mesh_invoke("news_feeds.search_by_entity", payload)
    except MeshUnavailable as e:
        # news_feeds_bad_entity is the empty/oversize-string MeshDeny
        # from the node; news_feeds_bad_entity_kind is the (already
        # client-side filtered) catch for an unknown kind value. Both
        # surface as structured `bad entity` errors so Gemini speaks a
        # clean "didn't catch the entity, sir" line rather than reading
        # an error stack.
        if e.reason in ("news_feeds_bad_entity", "news_feeds_bad_entity_kind"):
            return {"error": "bad entity", "detail": str(e)}
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_articles = response.get("articles") if isinstance(response, dict) else None
    if not isinstance(raw_articles, list):
        return {"error": "malformed response", "detail": "missing articles list"}

    articles = [a for a in (_strip_article(r) for r in raw_articles) if a is not None]
    return {
        "articles": articles,
        "count": len(articles),
        "entity": entity,
        "filtered_kind": kind,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for news_recent + news_search
    + news_breaking + news_search_by_entity."""
    recent_func = types.FunctionDeclaration(
        name="news_recent",
        description=(
            "Get recent news headlines. Use when the user asks broadly "
            "about news, headlines, current events, or what's happening "
            "WITHOUT naming a specific topic. Returns a list of recent "
            "articles with title, source, category, urgency, and a "
            "brief summary. Read the titles and sources aloud; use the "
            "summary for context if the user asks for more detail on a "
            "specific story. For topic-specific questions naming a "
            "PROPER NOUN (a person, place, or organization) prefer "
            "news_search_by_entity. For topic-specific questions naming "
            "a COMMON-NOUN TOPIC ('wildfires', 'elections') prefer "
            "news_search. For 'what's breaking', 'anything urgent', "
            "'any major news' without a specific topic prefer "
            "news_breaking. To narrow recent results to high-urgency "
            "items within a category ('what's important in tech'), pass "
            "urgency='high' alongside the category."
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
                "urgency": types.Schema(
                    type=types.Type.STRING,
                    enum=list(URGENCIES),
                    description=(
                        "Optional filter to a single urgency bucket. "
                        "Valid values: low, medium, high. 'high' is the "
                        "breaking-news bucket — pass it when the user "
                        "asks for important / urgent / major items "
                        "within a category ('what's important in tech', "
                        "'any urgent business news'). For bare 'what's "
                        "breaking' without a category prefer the "
                        "dedicated news_breaking tool. Omit to return "
                        "across all urgency buckets."
                    ),
                ),
            },
        ),
    )
    search_func = types.FunctionDeclaration(
        name="news_search",
        description=(
            "Keyword-search the user's curated news feeds for a "
            "COMMON-NOUN TOPIC or theme — wildfires, elections, AI "
            "safety, earnings reports, climate. Porter-stemmed bm25 "
            "over title + summary + feed (so 'wildfire' matches "
            "'wildfires'). For PROPER-NOUN subjects (a specific named "
            "person, place, or organization) prefer "
            "news_search_by_entity — it's higher precision. Search "
            "scope is the polled feed pool ONLY — this is not an "
            "open-web search; topics outside the curated feeds return "
            "an empty list. An empty result means no matching coverage "
            "in the current feed pool, not 'nothing is happening' — "
            "say so plainly. To narrow further to high-urgency items "
            "only ('any urgent news on wildfires'), pass urgency='high'."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Keyword query — the topic the user named. "
                        "Plain words; the node tokenises and AND-"
                        "combines them. Example: user asks 'any news "
                        "on wildfires' → pass 'wildfires'. User asks "
                        "'what's happening with AI safety' → pass "
                        "'AI safety'."
                    ),
                ),
                "category": types.Schema(
                    type=types.Type.STRING,
                    enum=list(CATEGORIES),
                    description=(
                        "Optional. Same seven-category enum as "
                        "news_recent. Pass when the user's phrasing "
                        "narrows the search to one category — 'tech "
                        "news about earnings' → tech. Omit for cross-"
                        "category search."
                    ),
                ),
                "urgency": types.Schema(
                    type=types.Type.STRING,
                    enum=list(URGENCIES),
                    description=(
                        "Optional. Same three-bucket urgency enum as "
                        "news_recent. Pass 'high' to filter the search "
                        "to breaking-bucket matches only."
                    ),
                ),
            },
            required=["query"],
        ),
    )
    breaking_func = types.FunctionDeclaration(
        name="news_breaking",
        description=(
            "Get only high-urgency ('breaking') news items from the "
            "user's curated feed pool, ordered newest-first. Use for "
            "bare 'what's breaking', 'anything urgent', 'any major "
            "news' style questions WITHOUT a specific topic or "
            "category — that's the dedicated breaking call. Equivalent "
            "to news_recent with urgency='high' but named explicitly so "
            "the model can treat the 'breaking' phrasing as a single "
            "shortcut. Returns the same article shape as news_recent "
            "(title, source, category, urgency, urgency_reason, summary). "
            "Each item's urgency_reason names which scoring signals "
            "made it breaking — e.g. 'breaking prefix + <1h fresh', "
            "'wire source + war topic'. Weave the reason into the "
            "spoken reading rather than quoting verbatim: 'Fed signals "
            "rate cut — Reuters, breaking prefix and fresh.' An empty "
            "list means nothing in the curated feed pool currently "
            "clears the high-urgency threshold — say so plainly "
            "('nothing breaking in the feed pool right now, sir'), do "
            "NOT substitute remembered headlines."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        f"Optional. How many high-urgency items to "
                        f"return. Default {BREAKING_DEFAULT_LIMIT}, max "
                        f"{BREAKING_MAX_LIMIT}. Prefer the default "
                        "unless the user asks for more or fewer."
                    ),
                ),
            },
        ),
    )
    search_by_entity_func = types.FunctionDeclaration(
        name="news_search_by_entity",
        description=(
            "Entity-aware search over the user's curated news feeds. "
            "Use whenever the user names a SPECIFIC PROPER NOUN — a "
            "person ('Tim Cook', 'Sam Altman'), a place ('Ukraine', "
            "'Cupertino'), or an organization ('Apple', 'OpenAI', "
            "'the Lakers'). Returns articles where that entity was "
            "recognised in the title or summary at fetch time, sorted "
            "by how central the mention is. Case-insensitive — pass "
            "the most natural phrasing. Prefer this over news_search "
            "for proper-noun queries; news_search remains the right "
            "tool for topical phrases ('wildfires', 'elections', "
            "'AI safety', 'earnings'). Scope is the polled feed pool "
            "ONLY — not open-web search. An empty result means no "
            "current coverage of that entity in the curated feeds, "
            "NOT 'nothing is happening'. Articles polled before the "
            "entity-extraction migration may not appear yet; coverage "
            "backfills automatically on the next poll cycle of each "
            "feed."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "entity": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Surface form of the entity — e.g. 'Tim Cook', "
                        "'Apple', 'Ukraine'. Pass the proper noun the "
                        "user named, not a paraphrase. User asks "
                        "'what's the latest on Tim Cook' → pass 'Tim "
                        "Cook'. User asks 'any news about Apple' → "
                        "pass 'Apple'. User asks 'what's happening in "
                        "Ukraine' → pass 'Ukraine'."
                    ),
                ),
                "kind": types.Schema(
                    type=types.Type.STRING,
                    enum=list(ENTITY_KINDS),
                    description=(
                        "Optional entity-kind filter. Pass when the "
                        "user's phrasing makes the kind explicit "
                        "('the CEO Tim Cook' → person, 'the company "
                        "Apple' → organization, 'the country Ukraine' "
                        "→ place). Omit when the kind is ambiguous or "
                        "obvious from the entity itself — kind filter "
                        "is a precision knob, not a requirement. Valid "
                        "values: person, place, organization."
                    ),
                ),
            },
            required=["entity"],
        ),
    )
    return [
        types.Tool(
            function_declarations=[
                recent_func,
                search_func,
                breaking_func,
                search_by_entity_func,
            ]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "news_recent":
        return await _news_recent(
            limit=_clamp_limit(args.get("limit", DEFAULT_LIMIT)),
            category=_normalise_category(args.get("category")),
            urgency=_normalise_urgency(args.get("urgency")),
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
            urgency=_normalise_urgency(args.get("urgency")),
        )
    if name == "news_breaking":
        return await _news_breaking(
            limit=_clamp_limit(
                args.get("limit", BREAKING_DEFAULT_LIMIT),
                default=BREAKING_DEFAULT_LIMIT,
                ceiling=BREAKING_MAX_LIMIT,
            ),
        )
    if name == "news_search_by_entity":
        raw_entity = args.get("entity", "")
        if not isinstance(raw_entity, str):
            return {"error": "bad entity", "detail": "entity must be a string"}
        entity = raw_entity.strip()[:ENTITY_MAX_LEN]
        if not entity:
            return {"error": "bad entity", "detail": "entity is empty"}
        return await _news_search_by_entity(
            entity=entity,
            kind=_normalise_entity_kind(args.get("kind")),
        )
    return None

"""Research Tool — synthesize a cited literature brief and recall past ones
via the mesh.

Two voice tools, both routed through ``mesh_invoke`` to the research node
(Aether's first Mixer — it searches Semantic Scholar and synthesizes with
Claude):

  - ``research_brief(query)``    → ``research.brief``   (search + ONE Claude
                                    synthesis; persisted for recall)
  - ``research_recent(query?)``  → ``research.recent``  (recall stored briefs)

Same pattern as news_tool / finance_tool: declare the function for Gemini,
implement as a thin ``await mesh_invoke(...)``, add the edge in manifest.yaml.
The renderer-side Research app drives the same surfaces.

The brief surface runs a real LLM call, so research_brief is the slow tool in
the set (a brief takes a handful of seconds — search throttled + one Claude
synthesis, bounded by the 30s mesh invoke budget). The system prompt tells
Gemini to acknowledge the pause and read the section bodies aloud.

"What did I find on X" maps to research_recent: the node returns recent
briefs (it does not query-filter), so the tool does an optional client-side
substring match on the stored query and hands Gemini the matching brief.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = [
    "research_brief",
    "research_recent",
]

# How many recent briefs to pull for recall, and how many top papers to name
# per brief in the spoken payload. The node stores the full paper list; Gemini
# only needs a few titles to name what's worth opening.
RECENT_LIMIT = 10
TOP_PAPERS = 5
QUERY_MAX_LEN = 300


def _first_author(authors: Any) -> str:
    """Lead author display name, '' if none. Used to attribute a paper in the
    spoken readback ('Vaswani et al.')."""
    if isinstance(authors, list) and authors and isinstance(authors[0], str):
        return authors[0].strip()
    return ""


def _strip_paper(raw: Any) -> dict[str, Any] | None:
    """Reduce a ResearchPaper to the fields Gemini speaks: title, lead
    author, year. Drops abstract / ids / urls / citation counts — the model
    names papers aloud, it doesn't recite metadata."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    authors = raw.get("authors")
    lead = _first_author(authors)
    more = isinstance(authors, list) and len(authors) > 1
    return {
        "title": title.strip(),
        "authors": f"{lead} et al." if (lead and more) else lead,
        "year": raw.get("year"),
    }


def _strip_brief(raw: Any) -> dict[str, Any] | None:
    """Reduce a ResearchBrief to the spoken-readable shape: the query, each
    section's heading + body (the prose Gemini reads aloud), a paper count,
    and the top few paper titles. Citations (paperIds) are dropped — they're
    for the renderer's inline chips, not speech."""
    if not isinstance(raw, dict):
        return None
    sections = []
    for s in raw.get("sections", []) or []:
        if not isinstance(s, dict):
            continue
        heading = s.get("heading")
        body = s.get("body")
        if isinstance(heading, str) and isinstance(body, str) and heading.strip() and body.strip():
            sections.append({"heading": heading.strip(), "body": body.strip()})
    papers_raw = raw.get("papers", []) or []
    papers = [p for p in (_strip_paper(r) for r in papers_raw[:TOP_PAPERS]) if p is not None]
    return {
        "query": raw.get("query", ""),
        "generated_at": raw.get("generatedAt", ""),
        "sections": sections,
        "paper_count": len(papers_raw) if isinstance(papers_raw, list) else 0,
        "top_papers": papers,
    }


async def _research_brief(query: str) -> dict[str, Any]:
    try:
        response = await mesh_invoke("research.brief", {"query": query})
    except MeshUnavailable as e:
        # Map the node's clean denials onto structured errors so Gemini speaks
        # a useful line rather than reading "mesh unavailable" for what is
        # really user input or a missing key.
        reason = e.reason or ""
        if reason == "research_bad_query":
            return {"error": "bad query", "detail": str(e)}
        if reason == "research_no_papers":
            return {"error": "no papers", "detail": str(e)}
        if reason == "research_search_failed":
            return {"error": "search failed", "detail": str(e)}
        if reason == "research_synthesis_failed":
            # Includes the no-key case — Gemini can tell the user research
            # isn't configured rather than implying nothing was found.
            return {"error": "synthesis failed", "detail": str(e)}
        return {"error": "mesh unavailable", "detail": str(e)}

    brief = _strip_brief(response)
    if brief is None:
        return {"error": "malformed response", "detail": "missing brief"}
    return brief


async def _research_recent(query: str | None) -> dict[str, Any]:
    try:
        response = await mesh_invoke("research.recent", {"limit": RECENT_LIMIT})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_briefs = response.get("briefs") if isinstance(response, dict) else None
    if not isinstance(raw_briefs, list):
        return {"error": "malformed response", "detail": "missing briefs list"}

    briefs = [b for b in (_strip_brief(r) for r in raw_briefs) if b is not None]
    # Optional client-side recall filter — the node returns recent briefs
    # unfiltered, so "what did I find on X" narrows here by substring match on
    # the stored query. No match falls back to the full recent list so Gemini
    # can still say what's there.
    if query:
        needle = query.strip().lower()
        matched = [b for b in briefs if needle in str(b.get("query", "")).lower()]
        if matched:
            briefs = matched
    return {"briefs": briefs, "count": len(briefs), "query": query}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for research_brief + research_recent."""
    brief_func = types.FunctionDeclaration(
        name="research_brief",
        description=(
            "Research a topic in the academic literature and return a "
            "synthesized, cited brief. Use when the user asks to 'research X', "
            "'what does the literature say on Y', 'find papers on Z', or wants "
            "an academic / scientific summary of a field. This searches "
            "Semantic Scholar and synthesizes the findings with an LLM, so it "
            "takes a few seconds — briefly acknowledge that you're pulling it "
            "together, then read the section headings and bodies aloud and name "
            "a couple of the top papers worth opening. The brief is saved, so "
            "later you can recall it with research_recent. If the result "
            "carries an error: 'no papers' means nothing matched the query "
            "(say so plainly); 'synthesis failed' usually means the research "
            "key isn't configured (tell the user research synthesis isn't set "
            "up rather than implying nothing was found)."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "The research topic, technique, question, or field to "
                        "review. Pass what the user named. Example: 'what does "
                        "the literature say on retrieval-augmented generation' "
                        "→ pass 'retrieval-augmented generation'."
                    ),
                ),
            },
            required=["query"],
        ),
    )
    recent_func = types.FunctionDeclaration(
        name="research_recent",
        description=(
            "Recall research briefs you generated earlier. Use for 'what did I "
            "find on X', 'what was that research brief', 'remind me what the "
            "papers said about Y'. Returns recent briefs newest-first, each "
            "with its query, section headings + bodies, and the top papers. "
            "Pass the topic in `query` to narrow to the matching brief; omit it "
            "to list what's there. This is recall only — it does NOT call the "
            "LLM or hit the network, so it's instant. If the user wants a NEW "
            "brief on a topic, use research_brief instead."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "Optional topic to narrow the recall to a matching "
                        "stored brief (substring match on the original query). "
                        "Omit to list recent briefs across all topics."
                    ),
                ),
            },
        ),
    )
    return [types.Tool(function_declarations=[brief_func, recent_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "research_brief":
        raw_query = args.get("query", "")
        if not isinstance(raw_query, str):
            return {"error": "bad query", "detail": "query must be a string"}
        query = raw_query.strip()[:QUERY_MAX_LEN]
        if not query:
            return {"error": "bad query", "detail": "query is empty"}
        return await _research_brief(query)
    if name == "research_recent":
        raw_query = args.get("query")
        query = raw_query.strip()[:QUERY_MAX_LEN] if isinstance(raw_query, str) else None
        return await _research_recent(query or None)
    return None

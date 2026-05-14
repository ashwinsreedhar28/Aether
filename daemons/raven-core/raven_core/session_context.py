"""Session Context — short-term in-session memory for the voice loop.

Gemini Live maintains its own conversation history within a session
(see ``context_window_compression`` in ``client.create_live_config``),
so plain follow-ups like "tell me more about that" can in principle
resolve from the model's own history. In practice the
gemini-2.5-flash-native-audio-preview model is unreliable about
ordinal references ("the second one", "the third article") and about
re-grounding on a previously-mentioned subject ("how about last week"
after "what's AAPL at"). This module gives Gemini an explicit, curated
recap of the last few turns so it has something deterministic to
resolve against.

Scope of this module:

  * Track the last N user utterances (text, from
    ``input_audio_transcription``) and the last N tool calls in deques.
  * Track topical state — last article list, last quote list, last
    ticker, last category, last entity — so ordinal/anaphora references
    can be resolved without a re-call.
  * Render a compact summary dict that the orchestrator injects into
    every FunctionResponse via the ``_session_context`` field.

Why injection into FunctionResponse and not into ``system_instruction``:
Gemini Live's ``LiveConnectConfig.system_instruction`` is set once at
``client.aio.live.connect(...)`` and cannot be swapped mid-session
without reconnecting — and a reconnect would interrupt the live audio
stream. The closest feasible equivalent to "re-format the system
prompt at each turn" is to attach the context recap to every tool
result, which lands in Gemini's input stream alongside the result
data on every round trip. Static reference-resolution rules live in
the system prompt itself (set once at connect, then unchanged).

Why in-memory and not persisted: this is short-term conversational
context, scoped to one Gemini Live session (one raven-core process).
Long-term user memory already exists via the memory tool's
``remember_note``; that is a different mechanism with a different
shape (user-authored notes), and the two should stay separate.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Optional

# Tunables. Five entries gives Gemini "the third one" / "the second
# one" / "tell me more about that" coverage without bloating the
# prefix on every tool round-trip. Voice cadence rarely sees a user
# stack more than ~3-4 distinct topics before drifting, so five is
# the comfortable ceiling. Bumping these is cheap if a downstream
# scenario needs more; capping them is what keeps the per-turn
# latency overhead near-zero.
MAX_UTTERANCES = 5
MAX_TOOL_CALLS = 5

# Voice tools already cap their returns at 10 (news_recent /
# news_search MAX_LIMIT, finance market_summary tracks 10 tickers).
# Mirroring those caps here means "the seventh article" still
# resolves if Gemini requested limit=10; bigger ranges would never
# fit in a single spoken turn anyway.
MAX_ARTICLES = 10
MAX_QUOTES = 10

# Per-utterance and per-tool-summary text caps. Prefix bloat is the
# main cost — these caps are deliberate. Long utterances get
# truncated with an ellipsis; tool summaries are already one-liners.
_UTTERANCE_MAX_LEN = 240
_SUMMARY_MAX_LEN = 200


@dataclass
class ToolCallRecord:
    """One past tool invocation, condensed for prompt injection.

    ``result_summary`` is a one-line human-readable string, NOT the
    raw tool response — dumping raw JSON for five tool calls into
    every subsequent FunctionResponse would balloon the prefix. Each
    tool's per-tool updater in ``tools/__init__.py`` is responsible
    for shaping this line.
    """

    name: str
    args: dict
    result_summary: str
    timestamp: float


@dataclass
class ArticleRef:
    """Spoken-readable subset of a news article, for ordinal lookups."""

    title: str
    source: str
    category: str
    summary: str


@dataclass
class QuoteRef:
    """Spoken-readable subset of a finance quote."""

    symbol: str
    price: Any
    change_percent: Any


@dataclass
class SessionContext:
    """In-session conversational state.

    Lives for the lifetime of one raven-core process / one Gemini
    Live session. Reset on process restart.
    """

    utterances: Deque[str] = field(
        default_factory=lambda: deque(maxlen=MAX_UTTERANCES)
    )
    tool_calls: Deque[ToolCallRecord] = field(
        default_factory=lambda: deque(maxlen=MAX_TOOL_CALLS)
    )
    last_entity: Optional[str] = None
    last_ticker: Optional[str] = None
    last_category: Optional[str] = None
    last_article_list: list[ArticleRef] = field(default_factory=list)
    last_quote_list: list[QuoteRef] = field(default_factory=list)

    def add_utterance(self, text: str) -> None:
        """Append a transcribed user utterance.

        Empty / whitespace-only strings are dropped — Gemini Live
        emits incremental input_transcription chunks and the trailing
        chunks can be empty when the user stops speaking. Long
        utterances are truncated to keep the prefix bounded.
        """
        if not isinstance(text, str):
            return
        cleaned = text.strip()
        if not cleaned:
            return
        if len(cleaned) > _UTTERANCE_MAX_LEN:
            cleaned = cleaned[: _UTTERANCE_MAX_LEN - 1].rstrip() + "…"
        self.utterances.append(cleaned)

    def add_tool_call(
        self,
        name: str,
        args: dict[str, Any],
        result_summary: str,
    ) -> None:
        """Append a tool call. ``result_summary`` is the one-line recap."""
        summary = (result_summary or "").strip()
        if len(summary) > _SUMMARY_MAX_LEN:
            summary = summary[: _SUMMARY_MAX_LEN - 1].rstrip() + "…"
        self.tool_calls.append(
            ToolCallRecord(
                name=name,
                args=dict(args or {}),
                result_summary=summary,
                timestamp=time.time(),
            )
        )

    def set_articles(
        self,
        articles: list[dict[str, Any]],
        category: Optional[str] = None,
        entity: Optional[str] = None,
    ) -> None:
        """Replace the cached article list.

        ``category`` and ``entity`` are stored alongside so that
        "what was the second one" / "go back to that news" resolves
        with the right scope. Capped at MAX_ARTICLES — the voice
        tools already clamp at 10, but the cap here is defence in
        depth in case a future tool ignores the limit.
        """
        refs: list[ArticleRef] = []
        for raw in (articles or [])[:MAX_ARTICLES]:
            if not isinstance(raw, dict):
                continue
            refs.append(
                ArticleRef(
                    title=str(raw.get("title", "")),
                    source=str(raw.get("source", "")),
                    category=str(raw.get("category", "")),
                    summary=str(raw.get("summary", "")),
                )
            )
        self.last_article_list = refs
        if category:
            self.last_category = category
        if entity:
            self.last_entity = entity

    def set_quotes(self, quotes: list[dict[str, Any]]) -> None:
        """Replace the cached quote list from finance_market_summary."""
        refs: list[QuoteRef] = []
        for raw in (quotes or [])[:MAX_QUOTES]:
            if not isinstance(raw, dict):
                continue
            symbol = str(raw.get("symbol", ""))
            if not symbol:
                continue
            refs.append(
                QuoteRef(
                    symbol=symbol,
                    price=raw.get("price"),
                    change_percent=raw.get("change_percent"),
                )
            )
        self.last_quote_list = refs
        if refs:
            # Market summary doesn't focus on a single ticker, so
            # last_ticker stays as-is. A targeted finance_quote /
            # finance_history call below WILL pin last_ticker.
            pass

    def set_ticker(self, symbol: str) -> None:
        """Pin the last-referenced ticker for follow-up routing."""
        cleaned = (symbol or "").strip().upper()
        if cleaned:
            self.last_ticker = cleaned

    def reset(self) -> None:
        """Clear everything — used by tests; not currently called at
        runtime. raven-core is one-process-per-session, so process
        restart is the canonical reset."""
        self.utterances.clear()
        self.tool_calls.clear()
        self.last_entity = None
        self.last_ticker = None
        self.last_category = None
        self.last_article_list = []
        self.last_quote_list = []

    def summarize(self) -> dict[str, Any]:
        """Render a compact summary for injection into FunctionResponse.

        Shape:

          {
            "recent_utterances": [str, ...],   # newest last
            "recent_tool_calls": [
              {"name": ..., "args": ..., "result": ...}, ...
            ],                                 # newest last
            "last_ticker": str | null,
            "last_category": str | null,
            "last_entity": str | null,
            "last_article_list": [
              {"index": 1, "title": ..., "source": ...,
               "category": ..., "summary": ...},
              ...
            ],
            "last_quote_list": [
              {"symbol": ..., "price": ...,
               "change_percent": ...}, ...
            ],
          }

        Indices on ``last_article_list`` are 1-based so the prompt's
        "the second one" / "the third one" maps directly onto
        ``index == 2`` / ``index == 3``. Empty / null fields stay in
        the shape — Gemini handles null gracefully and consistent
        shape makes the system-prompt few-shots simpler to read.
        """
        articles = [
            {
                "index": i + 1,
                "title": a.title,
                "source": a.source,
                "category": a.category,
                "summary": a.summary,
            }
            for i, a in enumerate(self.last_article_list)
        ]
        quotes = [
            {
                "symbol": q.symbol,
                "price": q.price,
                "change_percent": q.change_percent,
            }
            for q in self.last_quote_list
        ]
        tool_calls = [
            {
                "name": tc.name,
                "args": tc.args,
                "result": tc.result_summary,
            }
            for tc in self.tool_calls
        ]
        return {
            "recent_utterances": list(self.utterances),
            "recent_tool_calls": tool_calls,
            "last_ticker": self.last_ticker,
            "last_category": self.last_category,
            "last_entity": self.last_entity,
            "last_article_list": articles,
            "last_quote_list": quotes,
        }


# Module-level singleton. raven-core is one Python process per Gemini
# Live session (the daemon-manager spawns a fresh process on each voice
# start), so a single SessionContext for the lifetime of the module is
# the right scope. Exposed via ``get_session_context()`` so callers
# don't depend on the module attribute name.
_SESSION_CONTEXT = SessionContext()


def get_session_context() -> SessionContext:
    """Return the per-process SessionContext singleton."""
    return _SESSION_CONTEXT

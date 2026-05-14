"""Finance Tool - Stock quote readbacks via the mesh.

Three tools, all routed through ``mesh_invoke`` to the finance node:

  - ``finance_quote(symbol)``           → ``finance.quote(symbol)``
  - ``finance_market_summary()``        → ``finance.market_summary()``
  - ``finance_history(symbol, period?)`` → ``finance.history(...)``

The pattern matches news_tool / notify_tool: declare the function for
Gemini, implement as a thin ``await mesh_invoke(...)``, add edges in
manifest.yaml. Same anti-hallucination guardrail as news: training data
contains historical stock prices and the model will happily quote them
if not blocked. The system prompt + this docstring exist to make sure
Gemini calls the tool rather than recalling a 2024 close.

Rate-limit responses (``finance_rate_limited``) are returned with a
``spoken`` hint so Gemini reads a natural "throttled, try again in a
minute" line rather than the generic mesh-unavailable copy. All other
errors share the generic shape.

``finance_history`` SUMMARISES rather than dumping points. Gemini
doesn't need the full time series — it needs spoken-ready numbers
(range low/high, week-over-week change, sample count). The summary is
computed locally from the points the mesh returns; the ``spoken`` field
carries a pre-shaped line so Gemini reads it verbatim, the structured
fields are there for follow-ups ("what was the low again").
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["finance_quote", "finance_market_summary", "finance_history"]

# Valid period values for finance_history. Mirrors VALID_PERIODS in
# nodes/finance/src/index.ts and the history.json enum. Same order
# (shortest → longest) so the schema, this list, and the prompt examples
# read in one sequence.
HISTORY_PERIODS: tuple[str, ...] = ("1d", "1w", "1m", "all")
DEFAULT_HISTORY_PERIOD = "1w"

# Spoken labels per period. Kept in this module rather than the prompt
# so the model gets fully-formed lines and doesn't have to compose
# them from a label dictionary. "today" reads better than "1d" aloud
# but maps to the same underlying window.
_PERIOD_LABELS: dict[str, str] = {
    "1d": "today",
    "1w": "this past week",
    "1m": "this past month",
    "all": "over the retained window",
}

# Minimum sample count to summarise. Below this we read
# "insufficient history" — two points are the absolute floor needed to
# express a range AND a change; three would be safer but a fresh
# install will hit 2 within ~10 min of first launch and the user
# expects an answer sooner than ~30 min.
_MIN_HISTORY_POINTS = 2


def _strip_quote(raw: Any) -> dict[str, Any] | None:
    """Reduce a Quote envelope to the spoken-readable fields. Drops
    latest_trading_day + fetched_at — Gemini doesn't need them to say
    the price aloud, and keeping the response narrow stops the model
    from reciting "fetched at 2026-05-13T17:23:01Z" by accident."""
    if not isinstance(raw, dict):
        return None
    symbol = raw.get("symbol", "")
    if not symbol:
        return None
    return {
        "symbol": symbol,
        "price": raw.get("price"),
        "change": raw.get("change"),
        "change_percent": raw.get("change_percent"),
    }


def _throttled_response() -> dict[str, Any]:
    """Spoken-hint response for the rate_limited case. Architect spec
    Q3: the throttle is a temporary, expected state with a clear
    remediation — collapsing it into "unavailable" misleads the user
    into thinking finance is broken. Gemini reads ``spoken`` aloud
    verbatim when present."""
    return {
        "error": "rate_limited",
        "spoken": "Stock quotes are temporarily throttled, sir; try again in a minute.",
    }


async def _finance_quote(symbol: str) -> dict[str, Any]:
    upper = symbol.strip().upper()
    if not upper:
        return {"error": "bad symbol", "detail": "symbol is required"}
    try:
        response = await mesh_invoke("finance.quote", {"symbol": upper})
    except MeshUnavailable as e:
        # MeshUnavailable.reason carries the MeshDeny reason from the
        # remote node (set by mesh_client when the response envelope's
        # kind is "error"). None when the failure is setup-time
        # (env unset / SDK import failed / register failed).
        if e.reason == "finance_rate_limited":
            return _throttled_response()
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_quote = response.get("quote") if isinstance(response, dict) else None
    quote = _strip_quote(raw_quote)
    if quote is None:
        return {"error": "malformed response", "detail": "missing quote", "symbol": upper}
    return {"quote": quote}


def _normalise_period(value: Any) -> str:
    """Pin to the enum or fall back to default. Same shape as
    news_tool._normalise_category — Gemini occasionally emits trailing
    whitespace or a slightly-wrong value; coerce to default rather than
    handing the mesh something it'll reject."""
    if not isinstance(value, str):
        return DEFAULT_HISTORY_PERIOD
    cleaned = value.strip().lower()
    if cleaned in HISTORY_PERIODS:
        return cleaned
    return DEFAULT_HISTORY_PERIOD


def _summarise_history(
    symbol: str, period: str, points: list[Any]
) -> dict[str, Any]:
    """Reduce a points list into a spoken-ready summary.

    Insufficient-history responses ship a structured shape too so a
    "low/high" follow-up doesn't blow up — the fields just stay None.
    """
    label = _PERIOD_LABELS.get(period, "over that period")
    prices: list[float] = []
    for p in points:
        if not isinstance(p, dict):
            continue
        price = p.get("price")
        if isinstance(price, (int, float)) and price > 0:
            prices.append(float(price))

    if len(prices) < _MIN_HISTORY_POINTS:
        return {
            "symbol": symbol,
            "period": period,
            "samples": len(prices),
            "spoken": (
                f"I don't have enough history for {symbol} yet, sir — "
                "the finance node has been collecting since launch; "
                "check back in a few hours."
            ),
        }

    low = min(prices)
    high = max(prices)
    first = prices[0]
    last = prices[-1]
    # Pct change first → last, signed. first > 0 guard above means the
    # divisor is always positive.
    pct = ((last - first) / first) * 100.0
    direction = "up" if pct >= 0 else "down"
    spoken = (
        f"{symbol} {label}: ranged ${low:.2f} to ${high:.2f}, "
        f"currently {direction} {abs(pct):.1f} percent."
    )
    return {
        "symbol": symbol,
        "period": period,
        "samples": len(prices),
        "low": round(low, 2),
        "high": round(high, 2),
        "first": round(first, 2),
        "last": round(last, 2),
        "change_percent": round(pct, 2),
        "spoken": spoken,
    }


async def _finance_history(symbol: str, period: str) -> dict[str, Any]:
    upper = symbol.strip().upper()
    if not upper:
        return {"error": "bad symbol", "detail": "symbol is required"}
    norm_period = _normalise_period(period)
    try:
        response = await mesh_invoke(
            "finance.history", {"symbol": upper, "period": norm_period}
        )
    except MeshUnavailable as e:
        # Post-PR-#21 the upstream finance node has no rate-limit path
        # (Yahoo + Stooq are anonymous), so finance_rate_limited is
        # unreachable for history reads too — they hit local SQLite
        # only. The sibling tools keep their rate_limited check as
        # defined-but-unreachable parity; this newer function doesn't
        # need to inherit that dead branch.
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_points = response.get("points") if isinstance(response, dict) else None
    if not isinstance(raw_points, list):
        return {"error": "malformed response", "detail": "missing points list"}
    return _summarise_history(upper, norm_period, raw_points)


async def _finance_market_summary() -> dict[str, Any]:
    try:
        response = await mesh_invoke("finance.market_summary", {})
    except MeshUnavailable as e:
        if e.reason == "finance_rate_limited":
            return _throttled_response()
        return {"error": "mesh unavailable", "detail": str(e)}

    raw_quotes = response.get("quotes") if isinstance(response, dict) else None
    if not isinstance(raw_quotes, list):
        return {"error": "malformed response", "detail": "missing quotes list"}

    quotes: list[dict[str, Any]] = []
    for raw in raw_quotes:
        q = _strip_quote(raw)
        if q is not None:
            quotes.append(q)
    return {"quotes": quotes, "count": len(quotes)}


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all finance tools."""
    quote_func = types.FunctionDeclaration(
        name="finance_quote",
        description=(
            "Get the current price and day change for a single stock "
            "symbol. Use when the user asks about a specific stock, "
            "ticker, or company (e.g. 'what's AAPL at', 'how is Tesla "
            "doing today', 'price of Microsoft'). Returns the latest "
            "cached quote — price, dollar change, and percent change. "
            "Symbol must be a US ticker in the node's tracked list "
            "(AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, SPY, QQQ, "
            "DIA); untracked symbols return an error rather than a "
            "hallucinated price. Never read out historical prices from "
            "your training data — always call this tool."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "symbol": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "US ticker symbol (e.g. AAPL for Apple, MSFT for "
                        "Microsoft). Case-insensitive."
                    ),
                ),
            },
            required=["symbol"],
        ),
    )
    summary_func = types.FunctionDeclaration(
        name="finance_market_summary",
        description=(
            "Get current prices for every tracked stock. Use when the "
            "user asks about 'the market', 'my stocks', 'how's the "
            "market today', 'give me a market update'. Returns a list "
            "of quotes (symbol, price, change, change_percent) for the "
            "full tracked set. Read aloud as a short summary — broad "
            "ETFs (SPY/QQQ/DIA) first if asked about 'the market', "
            "individual names if the user wants their stocks. Never "
            "read out historical prices from your training data — "
            "always call this tool."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )
    history_func = types.FunctionDeclaration(
        name="finance_history",
        description=(
            "Get a SUMMARISED historical view for a single tracked stock "
            "symbol over a recent window. Use when the user asks how a "
            "stock has done over a period ('AAPL last week', 'how's "
            "Tesla doing this month', 'AAPL today'). The finance node "
            "passively accumulates polled samples — there is no upstream "
            "historical fetch, and on a fresh install the node has "
            "little to no history yet. The tool already SUMMARISES "
            "(low / high / change-over-window) and returns a spoken "
            "field; read that verbatim. If the spoken field says "
            "'insufficient history', say so plainly — do NOT substitute "
            "prices from your training data. Symbol must be in the "
            "tracked list (AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, "
            "SPY, QQQ, DIA)."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "symbol": types.Schema(
                    type=types.Type.STRING,
                    description=(
                        "US ticker symbol (e.g. AAPL for Apple). "
                        "Case-insensitive."
                    ),
                ),
                "period": types.Schema(
                    type=types.Type.STRING,
                    enum=list(HISTORY_PERIODS),
                    description=(
                        "Optional lookback window. Valid values: 1d "
                        "(today / past 24 hours), 1w (past week), 1m "
                        "(past 30 days), all (full retained window, up "
                        "to 90 days). Default 1w. Map natural phrasing: "
                        "'today' → 1d, 'this week' / 'past week' → 1w, "
                        "'this month' / 'past month' → 1m, 'all' / "
                        "'everything' → all."
                    ),
                ),
            },
            required=["symbol"],
        ),
    )
    return [
        types.Tool(
            function_declarations=[quote_func, summary_func, history_func]
        )
    ]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "finance_quote":
        return await _finance_quote(symbol=str(args.get("symbol", "")))
    if name == "finance_market_summary":
        return await _finance_market_summary()
    if name == "finance_history":
        return await _finance_history(
            symbol=str(args.get("symbol", "")),
            period=str(args.get("period", DEFAULT_HISTORY_PERIOD)),
        )
    return None

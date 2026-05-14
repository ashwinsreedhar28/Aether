"""Finance Tool - Stock quote readbacks via the mesh.

Two tools, both routed through ``mesh_invoke`` to the finance node:

  - ``finance_quote(symbol)``           → ``finance.quote(symbol)``
  - ``finance_market_summary()``        → ``finance.market_summary()``

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
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["finance_quote", "finance_market_summary"]


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
    """Return Gemini function declarations for both finance tools."""
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
    return [types.Tool(function_declarations=[quote_func, summary_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "finance_quote":
        return await _finance_quote(symbol=str(args.get("symbol", "")))
    if name == "finance_market_summary":
        return await _finance_market_summary()
    return None

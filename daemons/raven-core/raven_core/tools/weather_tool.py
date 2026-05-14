"""Weather Tool - Current conditions and forecasts via the mesh.

Two tools, both routed through ``mesh_invoke`` to the weather node:

  - ``weather_current()``        → ``weather.current()``
  - ``weather_forecast(days=3)`` → ``weather.forecast(days)``

The pattern matches news_tool / finance_tool: declare the function for
Gemini, implement as a thin ``await mesh_invoke(...)``, add edges in
manifest.yaml. The weather node polls Open-Meteo every 15 minutes and
returns cached data.

When ``available: false``, the tools return a spoken hint so Gemini
reads a natural "Weather isn't configured yet" line rather than trying
to hallucinate weather data from training.

``weather_forecast`` FORMATS the forecast into a spoken-ready string.
Gemini needs 1-2 bullet-point lines (Today: high 68°F, partly cloudy.
Tomorrow: high 71°F, sunny.), not a JSON dump. The formatting is done
here so Gemini gets pre-shaped output.
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from ..mesh_client import MeshUnavailable, mesh_invoke

FUNCTIONS = ["weather_current", "weather_forecast"]

DEFAULT_FORECAST_DAYS = 3


async def _weather_current() -> dict[str, Any]:
    try:
        response = await mesh_invoke("weather.current", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response", "detail": "expected dict"}

    if not response.get("available"):
        reason = response.get("reason", "unknown")
        if reason == "no_config":
            return {
                "available": False,
                "spoken": "Weather isn't configured yet, sir.",
            }
        return {
            "available": False,
            "spoken": "Weather fetch failed — I'll try again shortly.",
        }

    location = response.get("location_label", "Unknown")
    temp_f = response.get("temperature_f")
    feels_like_f = response.get("feels_like_f")
    conditions = response.get("conditions", "unknown")

    spoken = (
        f"Currently {temp_f}°F and {conditions.lower()} in {location}"
        + (f", feels like {feels_like_f}°F." if feels_like_f != temp_f else ".")
    )

    return {
        "available": True,
        "location": location,
        "temperature_f": temp_f,
        "temperature_c": response.get("temperature_c"),
        "conditions": conditions,
        "humidity_pct": response.get("humidity_pct"),
        "wind_mph": response.get("wind_mph"),
        "feels_like_f": feels_like_f,
        "spoken": spoken,
    }


async def _weather_forecast(days: int) -> dict[str, Any]:
    clamped_days = max(1, min(7, days))
    try:
        response = await mesh_invoke("weather.forecast", {"days": clamped_days})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response", "detail": "expected dict"}

    if not response.get("available"):
        reason = response.get("reason", "unknown")
        if reason == "no_config":
            return {
                "available": False,
                "spoken": "Weather isn't configured yet, sir.",
            }
        return {
            "available": False,
            "spoken": "Weather fetch failed — I'll try again shortly.",
        }

    location = response.get("location_label", "Unknown")
    forecast_days = response.get("days", [])

    if not isinstance(forecast_days, list) or len(forecast_days) == 0:
        return {
            "available": False,
            "spoken": "No forecast data available.",
        }

    # Day labels: "Today", "Tomorrow", then dates
    lines: list[str] = []
    for idx, day in enumerate(forecast_days):
        if not isinstance(day, dict):
            continue
        high_f = day.get("high_f")
        low_f = day.get("low_f")
        conditions = day.get("conditions", "unknown")
        precip_pct = day.get("precipitation_chance_pct", 0)

        if idx == 0:
            label = "Today"
        elif idx == 1:
            label = "Tomorrow"
        else:
            # Use date string as-is (YYYY-MM-DD from Open-Meteo)
            date_str = day.get("date", "")
            label = date_str if date_str else f"Day {idx + 1}"

        line = f"{label}: high {high_f}°F, low {low_f}°F, {conditions.lower()}"
        if precip_pct > 0:
            line += f", {precip_pct}% chance of rain"
        lines.append(line + ".")

    spoken = " ".join(lines)

    return {
        "available": True,
        "location": location,
        "days": clamped_days,
        "forecast": forecast_days,
        "spoken": spoken,
    }


def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all weather tools."""
    current_func = types.FunctionDeclaration(
        name="weather_current",
        description=(
            "Get current weather conditions (temperature, conditions, "
            "humidity, wind, feels-like). Use when the user asks 'what's "
            "the weather', 'how's the weather', 'is it raining', 'current "
            "conditions', or any present-tense weather question. Returns "
            "a spoken-ready line with temp and conditions; read it "
            "verbatim. If the spoken field says 'Weather isn't configured "
            "yet', say so plainly — do NOT substitute weather from your "
            "training data."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    )
    forecast_func = types.FunctionDeclaration(
        name="weather_forecast",
        description=(
            "Get the weather forecast for upcoming days. Use when the user "
            "asks about future weather ('tomorrow', 'this weekend', 'next "
            "few days', 'forecast'). Returns a spoken-ready summary of "
            "highs, lows, conditions, and precipitation chance for each "
            "day; read it verbatim. If the spoken field says 'Weather "
            "isn't configured yet', say so plainly — do NOT substitute "
            "weather from your training data."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "days": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Number of forecast days to fetch (1-7). Default 3. "
                        "Map natural phrasing: 'tomorrow' → 1, 'next few "
                        "days' / 'this week' → 3, 'the week' / 'seven "
                        "days' → 7."
                    ),
                ),
            },
            required=[],
        ),
    )
    return [types.Tool(function_declarations=[current_func, forecast_func])]


async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "weather_current":
        return await _weather_current()
    if name == "weather_forecast":
        return await _weather_forecast(days=int(args.get("days", DEFAULT_FORECAST_DAYS)))
    return None

# Weather Node

Mesh node that polls [Open-Meteo](https://open-meteo.com/) for current weather conditions and 7-day forecasts.

## Surfaces

- **`weather.current`** — current conditions (temp, humidity, wind, feels-like, WMO weather code)
- **`weather.forecast`** — up to 7 days of highs, lows, conditions, precipitation chance

Both surfaces return `{ available: false, reason: "no_config" | "fetch_failed" }` when weather config is missing or when fetch errors.

## Environment Variables

Required:
- `MESH_WEATHER_SECRET` — HMAC secret for mesh authentication
- `AETHER_DATA_DIR` — parent directory for node runtime state

Optional (graceful degradation if unset):
- `AETHER_WEATHER_LAT` — latitude (e.g., `37.7749`)
- `AETHER_WEATHER_LON` — longitude (e.g., `-122.4194`)
- `AETHER_WEATHER_LABEL` — location label for responses (e.g., `San Francisco`)

## Polling Cadence

15 minutes. First poll runs at startup.

## API

Open-Meteo public API. No API key required. No rate limits documented for the public tier at current usage.

## Future-Arc Candidates (§11.6)

- **Multi-location support** — track multiple lat/lon pairs, disambiguate by label or default
- **Severe weather alerts** — integrate NOAA/NWS alerts for US locations
- **Radar imagery** — fetch and serve radar tiles for voice or shell UI
- **Historical comparison** — "warmer than usual for May" style insights

None of these are in scope for the initial implementation.

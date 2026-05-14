import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

const NODE_ID = 'weather'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'
const POLL_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

// WMO weather code → human-readable string
const WMO_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Partly cloudy',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Light snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with light hail',
  99: 'Thunderstorm with hail',
}

function getConditionsString(code: number): string {
  return WMO_CODES[code] ?? 'Unknown'
}

interface CurrentWeather {
  available: true
  location_label: string
  temperature_f: number
  temperature_c: number
  conditions: string
  conditions_code: number
  humidity_pct: number
  wind_mph: number
  feels_like_f: number
  timestamp: number
  [key: string]: unknown
}

interface ForecastDay {
  date: string
  high_f: number
  low_f: number
  conditions: string
  precipitation_chance_pct: number
}

interface ForecastWeather {
  available: true
  location_label: string
  days: ForecastDay[]
  timestamp: number
  [key: string]: unknown
}

interface UnavailableResponse {
  available: false
  reason: string
  [key: string]: unknown
}

type CurrentResponse = CurrentWeather | UnavailableResponse
type ForecastResponse = ForecastWeather | UnavailableResponse

interface WeatherCache {
  current: CurrentWeather | null
  forecast: ForecastWeather | null
}

interface ForecastArgs {
  days?: unknown
}

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

function makeCurrentHandler(cache: WeatherCache) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return async (_: Envelope): Promise<CurrentResponse> => {
    if (!cache.current) {
      return { available: false, reason: 'no_config' }
    }
    return cache.current
  }
}

function makeForecastHandler(cache: WeatherCache) {
  return async (env: Envelope): Promise<ForecastResponse> => {
    if (!cache.forecast) {
      return { available: false, reason: 'no_config' }
    }

    const payload = env.payload as ForecastArgs
    const requestedDays =
      typeof payload?.days === 'number' ? payload.days : 3

    if (requestedDays < 1 || requestedDays > 7) {
      throw new MeshDeny('weather_invalid_days', {
        requested: requestedDays,
        valid_range: '1-7',
      })
    }

    const days = cache.forecast.days.slice(0, requestedDays)

    return {
      available: true,
      location_label: cache.forecast.location_label,
      days,
      timestamp: cache.forecast.timestamp,
    }
  }
}

async function fetchCurrent(
  lat: number,
  lon: number,
  label: string,
): Promise<CurrentWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Open-Meteo current fetch failed: ${res.status}`)
  }
  const data = (await res.json()) as {
    current: {
      temperature_2m: number
      relative_humidity_2m: number
      apparent_temperature: number
      weather_code: number
      wind_speed_10m: number
    }
  }

  const current = data.current
  const tempC = Math.round((current.temperature_2m - 32) * (5 / 9))

  return {
    available: true,
    location_label: label,
    temperature_f: Math.round(current.temperature_2m),
    temperature_c: tempC,
    conditions: getConditionsString(current.weather_code),
    conditions_code: current.weather_code,
    humidity_pct: Math.round(current.relative_humidity_2m),
    wind_mph: Math.round(current.wind_speed_10m),
    feels_like_f: Math.round(current.apparent_temperature),
    timestamp: Date.now(),
  }
}

async function fetchForecast(
  lat: number,
  lon: number,
  label: string,
): Promise<ForecastWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&forecast_days=7`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast fetch failed: ${res.status}`)
  }
  const data = (await res.json()) as {
    daily: {
      time: string[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
      weather_code: number[]
      precipitation_probability_max: number[]
    }
  }

  const daily = data.daily
  const days: ForecastDay[] = daily.time.map((date, i) => ({
    date,
    high_f: Math.round(daily.temperature_2m_max[i] ?? 0),
    low_f: Math.round(daily.temperature_2m_min[i] ?? 0),
    conditions: getConditionsString(daily.weather_code[i] ?? 0),
    precipitation_chance_pct: Math.round(
      daily.precipitation_probability_max[i] ?? 0,
    ),
  }))

  return {
    available: true,
    location_label: label,
    days,
    timestamp: Date.now(),
  }
}

async function poll(
  cache: WeatherCache,
  lat: number,
  lon: number,
  label: string,
): Promise<void> {
  try {
    const [current, forecast] = await Promise.all([
      fetchCurrent(lat, lon, label),
      fetchForecast(lat, lon, label),
    ])
    cache.current = current
    cache.forecast = forecast
    log(
      `polled ${label}: ${current.temperature_f}°F, ${current.conditions}; forecast ${forecast.days.length} days`,
    )
  } catch (e) {
    log(`poll error: ${(e as Error).message}`)
    // Leave cache as-is; stale data is better than no data
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_WEATHER_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_WEATHER_SECRET is required; refusing to start.\n`,
    )
    process.exit(2)
  }

  const dataDir = process.env.AETHER_DATA_DIR
  if (!dataDir) {
    process.stderr.write(
      `[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.\n`,
    )
    process.exit(2)
  }

  const latStr = process.env.AETHER_WEATHER_LAT
  const lonStr = process.env.AETHER_WEATHER_LON
  const label = process.env.AETHER_WEATHER_LABEL

  // Allow the node to start even without config, but cache stays null (graceful degradation)
  const hasConfig = latStr && lonStr && label
  const lat = hasConfig ? parseFloat(latStr) : NaN
  const lon = hasConfig ? parseFloat(lonStr) : NaN

  if (hasConfig && (isNaN(lat) || isNaN(lon))) {
    process.stderr.write(
      `[${NODE_ID}] AETHER_WEATHER_LAT/LON are set but invalid; refusing to start.\n`,
    )
    process.exit(2)
  }

  const nodeDir = join(dataDir, 'weather')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const cache: WeatherCache = { current: null, forecast: null }

  if (hasConfig) {
    log(`configured for ${label} (${lat}, ${lon})`)
    await poll(cache, lat, lon, label)
  } else {
    log(
      `no config (AETHER_WEATHER_LAT/LON/LABEL unset); starting in degraded mode`,
    )
  }

  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  node.on('current', makeCurrentHandler(cache))
  node.on('forecast', makeForecastHandler(cache))

  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)

  let pollTimer: NodeJS.Timeout | null = null
  if (hasConfig) {
    pollTimer = setInterval(() => {
      void poll(cache, lat, lon, label)
    }, POLL_INTERVAL_MS)
    log(`poller started — 15min interval`)
  }

  let shuttingDown = false
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log(`received ${sig}, stopping`)
    try {
      unlinkSync(markerPath)
    } catch {
      /* already gone */
    }
    if (pollTimer) {
      clearInterval(pollTimer)
    }
    try {
      await node.stop()
    } catch {
      /* best-effort */
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  process.stderr.write(`[${NODE_ID}] fatal: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})

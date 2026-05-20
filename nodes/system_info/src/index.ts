import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshNode, MeshDeny, type Envelope } from '@aether/mesh-node-sdk'

const execFileAsync = promisify(execFile)
const NODE_ID = 'system_info'
const CORE_URL = process.env.MESH_CORE_URL ?? 'http://127.0.0.1:8000'

// Cache TTLs in milliseconds
const BATTERY_CACHE_MS = 10_000 // 10s
const DISK_CACHE_MS = 15_000 // 15s
const NETWORK_CACHE_MS = 10_000 // 10s
const ACTIVE_APP_CACHE_MS = 5_000 // 5s
const PROCESSES_CACHE_MS = 5_000 // 5s

// Processes surface bounds
const PROCESSES_DEFAULT_LIMIT = 50
const PROCESSES_MAX_LIMIT = 200
const PROCESSES_SORT_OPTIONS = ['cpu', 'memory', 'pid'] as const
type ProcessesSortBy = (typeof PROCESSES_SORT_OPTIONS)[number]

// Surface return types — MUST include [key: string]: unknown for mesh SDK
interface BatteryResult {
  available: true
  percent: number
  is_charging: boolean
  time_remaining_minutes: number | null
  cycle_count: number | null
  [key: string]: unknown
}

interface DiskResult {
  available: true
  root_disk: {
    total_gb: number
    free_gb: number
    used_pct: number
  }
  [key: string]: unknown
}

interface NetworkResult {
  available: true
  wifi: {
    ssid: string | null
    signal_dbm: number | null
    link_rate_mbps: number | null
  }
  active_interface: string | null
  ip: string | null
  [key: string]: unknown
}

interface ActiveAppResult {
  available: true
  app_name: string
  window_title: string | null
  [key: string]: unknown
}

interface ProcessRecord {
  pid: number
  command: string
  cpu_pct: number
  mem_pct: number
  elapsed: string
  [key: string]: unknown
}

interface ProcessesResult {
  available: true
  processes: ProcessRecord[]
  total_count: number
  [key: string]: unknown
}

interface UnavailableResponse {
  available: false
  reason: string
  [key: string]: unknown
}

type BatteryResponse = BatteryResult | UnavailableResponse
type DiskResponse = DiskResult | UnavailableResponse
type NetworkResponse = NetworkResult | UnavailableResponse
type ActiveAppResponse = ActiveAppResult | UnavailableResponse
type ProcessesResponse = ProcessesResult | UnavailableResponse

// Cache entries
interface CacheEntry<T> {
  data: T
  timestamp: number
}

let batteryCache: CacheEntry<BatteryResponse> | null = null
let diskCache: CacheEntry<DiskResponse> | null = null
let networkCache: CacheEntry<NetworkResponse> | null = null
let activeAppCache: CacheEntry<ActiveAppResponse> | null = null
let processesCache: CacheEntry<ProcessesResponse> | null = null

function log(msg: string): void {
  process.stdout.write(`[${NODE_ID}] ${msg}\n`)
}

// Battery handler using pmset -g batt
async function fetchBattery(): Promise<BatteryResponse> {
  try {
    const { stdout } = await execFileAsync('pmset', ['-g', 'batt'])

    // Parse output like:
    // Now drawing from 'Battery Power'
    // -InternalBattery-0 (id=12345)	95%; discharging; 4:23 remaining present: true

    const lines = stdout.split('\n')
    const batteryLine = lines.find(line => line.includes('InternalBattery'))

    if (!batteryLine) {
      return { available: false, reason: 'no_battery_found' }
    }

    // Extract percentage
    const percentMatch = batteryLine.match(/(\d+)%/)
    const percent = percentMatch ? parseInt(percentMatch[1]!, 10) : 0

    // Check if charging
    const is_charging = batteryLine.includes('charging') && !batteryLine.includes('discharging')

    // Extract time remaining
    let time_remaining_minutes: number | null = null
    const timeMatch = batteryLine.match(/(\d+):(\d+) remaining/)
    if (timeMatch) {
      const hours = parseInt(timeMatch[1]!, 10)
      const minutes = parseInt(timeMatch[2]!, 10)
      time_remaining_minutes = hours * 60 + minutes
    }

    // Extract cycle count (requires separate command)
    let cycle_count: number | null = null
    try {
      const { stdout: ioreg } = await execFileAsync('ioreg', [
        '-r',
        '-c',
        'AppleSmartBattery',
      ])
      const cycleMatch = ioreg.match(/"CycleCount"\s*=\s*(\d+)/)
      if (cycleMatch) {
        cycle_count = parseInt(cycleMatch[1]!, 10)
      }
    } catch {
      // Cycle count is optional; continue without it
    }

    return {
      available: true,
      percent,
      is_charging,
      time_remaining_minutes,
      cycle_count,
    }
  } catch (err) {
    return {
      available: false,
      reason: `command_failed: ${(err as Error).message}`,
    }
  }
}

// Disk handler using df -k /
async function fetchDisk(): Promise<DiskResponse> {
  try {
    const { stdout } = await execFileAsync('df', ['-k', '/'])

    // Parse output like:
    // Filesystem    1024-blocks      Used Available Capacity  iused    ifree %iused  Mounted on
    // /dev/disk3s1s1  976490560 472329856 486876880    50% 2473799 4868845041    0%   /

    const lines = stdout.split('\n')
    const dataLine = lines[1]

    if (!dataLine) {
      return { available: false, reason: 'df_parse_failed' }
    }

    const parts = dataLine.split(/\s+/)
    if (parts.length < 5) {
      return { available: false, reason: 'df_unexpected_format' }
    }

    const total_kb = parseInt(parts[1] ?? '0', 10)
    const used_kb = parseInt(parts[2] ?? '0', 10)
    const free_kb = parseInt(parts[3] ?? '0', 10)

    const total_gb = Math.round((total_kb / 1024 / 1024) * 10) / 10
    const free_gb = Math.round((free_kb / 1024 / 1024) * 10) / 10
    const used_pct = total_kb > 0 ? Math.round((used_kb / total_kb) * 100) : 0

    return {
      available: true,
      root_disk: {
        total_gb,
        free_gb,
        used_pct,
      },
    }
  } catch (err) {
    return {
      available: false,
      reason: `command_failed: ${(err as Error).message}`,
    }
  }
}

// Network handler using networksetup and wdutil
async function fetchNetwork(): Promise<NetworkResponse> {
  try {
    let ssid: string | null = null
    let signal_dbm: number | null = null
    let link_rate_mbps: number | null = null

    // Get SSID via networksetup
    try {
      const { stdout: ssidOut } = await execFileAsync('networksetup', [
        '-getairportnetwork',
        'en0',
      ])
      const ssidMatch = ssidOut.match(/Current Wi-Fi Network: (.+)/)
      if (ssidMatch && ssidMatch[1]) {
        ssid = ssidMatch[1].trim()
      }
    } catch {
      // WiFi might be off or en0 doesn't exist
    }

    // Get signal strength — wdutil may require sudo, so we try but don't fail
    try {
      const { stdout: wdutilOut } = await execFileAsync('wdutil', ['info'])
      const rssiMatch = wdutilOut.match(/RSSI:\s*(-?\d+)/)
      if (rssiMatch) {
        signal_dbm = parseInt(rssiMatch[1]!, 10)
      }
      const rateMatch = wdutilOut.match(/Tx Rate:\s*(\d+)/)
      if (rateMatch) {
        link_rate_mbps = parseInt(rateMatch[1]!, 10)
      }
    } catch {
      // wdutil might not be available or need sudo
      signal_dbm = null
    }

    // Get active interface and IP
    let active_interface: string | null = null
    let ip: string | null = null

    try {
      const { stdout: routeOut } = await execFileAsync('route', ['-n', 'get', 'default'])
      const ifMatch = routeOut.match(/interface:\s*(\w+)/)
      if (ifMatch) {
        active_interface = ifMatch[1] ?? null
      }

      // Get IP for the active interface
      if (active_interface) {
        try {
          const { stdout: ifconfigOut } = await execFileAsync('ifconfig', [
            active_interface,
          ])
          const ipMatch = ifconfigOut.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/)
          if (ipMatch) {
            ip = ipMatch[1] ?? null
          }
        } catch {
          // Interface might not have IP
        }
      }
    } catch {
      // Route command might fail
    }

    return {
      available: true,
      wifi: {
        ssid,
        signal_dbm,
        link_rate_mbps,
      },
      active_interface,
      ip,
    }
  } catch (err) {
    return {
      available: false,
      reason: `command_failed: ${(err as Error).message}`,
    }
  }
}

// Active app handler using osascript
async function fetchActiveApp(): Promise<ActiveAppResponse> {
  try {
    const { stdout: appName } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ])

    const app_name = appName.trim()

    // Try to get window title
    let window_title: string | null = null
    try {
      const { stdout: titleOut } = await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to get name of front window of application process "${app_name}"`,
      ])
      window_title = titleOut.trim() || null
    } catch {
      // Window title might not be accessible
    }

    return {
      available: true,
      app_name,
      window_title,
    }
  } catch (err) {
    return {
      available: false,
      reason: `command_failed: ${(err as Error).message}`,
    }
  }
}

// Processes handler using ps -axwwo pid,ucomm,%cpu,%mem,etime
async function fetchProcesses(): Promise<ProcessesResponse> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-axwwo', 'pid,ucomm,%cpu,%mem,etime'],
      { maxBuffer: 10 * 1024 * 1024 },
    )

    // Parse output. ps emits a header row, then columnar lines like:
    //   PID UCOMM             %CPU %MEM      ELAPSED
    //     1 launchd            0.3  0.1 112-02:36:27
    // `ucomm` is the kernel's user command name (exec name with no path,
    // capped at ~15 chars on macOS). Switched from `comm` because comm on
    // macOS returns the path truncated to the column width — e.g.
    // `/Applications/Arc.app/...` rendered as `/Applications/Ar`, so any
    // path-leaf extraction downstream produced fragments like "Ar"
    // instead of the real binary name. Some ucomm values still contain
    // spaces (e.g., "Google Chrome H"); parse from the right to tolerate
    // any embedded whitespace.
    const lines = stdout.split('\n').slice(1)
    const processes: ProcessRecord[] = []
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const parts = line.split(/\s+/)
      if (parts.length < 5) continue
      const pid = parseInt(parts[0]!, 10)
      const cpu_pct = parseFloat(parts[parts.length - 3]!)
      const mem_pct = parseFloat(parts[parts.length - 2]!)
      const elapsed = parts[parts.length - 1]!
      if (Number.isNaN(pid) || Number.isNaN(cpu_pct) || Number.isNaN(mem_pct)) {
        continue
      }
      const command = parts.slice(1, parts.length - 3).join(' ')
      processes.push({ pid, command, cpu_pct, mem_pct, elapsed })
    }

    return {
      available: true,
      processes,
      total_count: processes.length,
    }
  } catch (err) {
    return {
      available: false,
      reason: `command_failed: ${(err as Error).message}`,
    }
  }
}

// Cached handlers with TTL
function makeBatteryHandler() {
  return async (): Promise<Record<string, unknown>> => {
    const now = Date.now()
    if (batteryCache && now - batteryCache.timestamp < BATTERY_CACHE_MS) {
      return batteryCache.data
    }
    const data = await fetchBattery()
    batteryCache = { data, timestamp: now }
    return data
  }
}

function makeDiskHandler() {
  return async (): Promise<Record<string, unknown>> => {
    const now = Date.now()
    if (diskCache && now - diskCache.timestamp < DISK_CACHE_MS) {
      return diskCache.data
    }
    const data = await fetchDisk()
    diskCache = { data, timestamp: now }
    return data
  }
}

function makeNetworkHandler() {
  return async (): Promise<Record<string, unknown>> => {
    const now = Date.now()
    if (networkCache && now - networkCache.timestamp < NETWORK_CACHE_MS) {
      return networkCache.data
    }
    const data = await fetchNetwork()
    networkCache = { data, timestamp: now }
    return data
  }
}

function makeActiveAppHandler() {
  return async (): Promise<Record<string, unknown>> => {
    const now = Date.now()
    if (activeAppCache && now - activeAppCache.timestamp < ACTIVE_APP_CACHE_MS) {
      return activeAppCache.data
    }
    const data = await fetchActiveApp()
    activeAppCache = { data, timestamp: now }
    return data
  }
}

function makeProcessesHandler() {
  return async (env: Envelope): Promise<Record<string, unknown>> => {
    const payload = (env.payload ?? {}) as Record<string, unknown>

    // Validate `limit`: optional, integer in [1, PROCESSES_MAX_LIMIT].
    let limit = PROCESSES_DEFAULT_LIMIT
    if (payload.limit !== undefined) {
      const candidate = payload.limit
      if (typeof candidate !== 'number' || !Number.isInteger(candidate)) {
        throw new MeshDeny('invalid_argument', {
          field: 'limit',
          detail: 'must be an integer',
        })
      }
      if (candidate < 1 || candidate > PROCESSES_MAX_LIMIT) {
        throw new MeshDeny('invalid_argument', {
          field: 'limit',
          detail: `must be between 1 and ${PROCESSES_MAX_LIMIT}`,
        })
      }
      limit = candidate
    }

    // Validate `sort_by`: optional, one of PROCESSES_SORT_OPTIONS.
    let sortBy: ProcessesSortBy = 'cpu'
    if (payload.sort_by !== undefined) {
      const candidate = payload.sort_by
      if (
        typeof candidate !== 'string' ||
        !(PROCESSES_SORT_OPTIONS as readonly string[]).includes(candidate)
      ) {
        throw new MeshDeny('invalid_argument', {
          field: 'sort_by',
          detail: `must be one of: ${PROCESSES_SORT_OPTIONS.join(', ')}`,
        })
      }
      sortBy = candidate as ProcessesSortBy
    }

    // Refresh cache if stale; cache the raw (unsorted, unsliced) result so
    // varied (limit, sort_by) inputs share a single ps invocation per window.
    const now = Date.now()
    if (!processesCache || now - processesCache.timestamp >= PROCESSES_CACHE_MS) {
      const data = await fetchProcesses()
      processesCache = { data, timestamp: now }
    }
    const cached = processesCache.data
    if (!cached.available) {
      return cached
    }

    const sorted = [...cached.processes].sort((a, b) => {
      if (sortBy === 'cpu') return b.cpu_pct - a.cpu_pct
      if (sortBy === 'memory') return b.mem_pct - a.mem_pct
      return a.pid - b.pid
    })

    return {
      available: true,
      processes: sorted.slice(0, limit),
      total_count: cached.total_count,
    }
  }
}

async function main(): Promise<void> {
  const secret = process.env.MESH_SYSTEM_INFO_SECRET
  if (!secret) {
    process.stderr.write(
      `[${NODE_ID}] MESH_SYSTEM_INFO_SECRET is required; refusing to start.\n`,
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

  const nodeDir = join(dataDir, 'system_info')
  mkdirSync(nodeDir, { recursive: true })
  const markerPath = join(nodeDir, 'running')

  const node = new MeshNode(NODE_ID, secret, CORE_URL)

  node.on('battery', makeBatteryHandler())
  node.on('disk', makeDiskHandler())
  node.on('network', makeNetworkHandler())
  node.on('active_app', makeActiveAppHandler())
  node.on('processes', makeProcessesHandler())

  await node.start()
  log(`registered with core at ${CORE_URL}`)

  writeFileSync(markerPath, `${process.pid}\n${new Date().toISOString()}\n`)
  log(`liveness marker written to ${markerPath}`)

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

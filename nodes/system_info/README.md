# system_info — macOS System Information Mesh Node

TypeScript mesh node exposing macOS system status via native shell commands.

## Surfaces

- **system.battery** — Battery charge, charging state, time remaining, cycle count
- **system.disk** — Root filesystem capacity and usage
- **system.network** — WiFi SSID, signal strength, active interface, IP address
- **system.active_app** — Currently focused application and window title
- **system.processes** — Running process snapshot (PID, command, CPU%, mem%, elapsed); accepts `{ limit?: 1-200 (default 50), sort_by?: 'cpu' | 'memory' | 'pid' (default 'cpu') }`

All surfaces return `{ available: true, ... }` or `{ available: false, reason }` for graceful degradation.

## Data sources

- **Battery**: `pmset -g batt` + `ioreg -r -c AppleSmartBattery`
- **Disk**: `df -k /`
- **Network**: `networksetup -getairportnetwork en0`, `wdutil info` (optional), `route -n get default`, `ifconfig`
- **Active app**: AppleScript via `osascript`
- **Processes**: `ps -axo pid,comm,%cpu,%mem,etime`

## Caching

- Battery: 10s
- Disk: 15s
- Network: 10s
- Active app: 5s
- Processes: 5s (raw ps output cached; sort/slice applied per-request)

## Permissions

- **Battery/Disk**: No special permissions required
- **Network**: `wdutil info` may require elevated permissions for signal strength; node gracefully degrades to null if unavailable
- **Active app**: Requires Accessibility permissions for the Terminal/app running the node

## Build and run

```bash
pnpm --filter @aether/system-info build
MESH_SYSTEM_INFO_SECRET=<hex32> AETHER_DATA_DIR=/tmp/aether pnpm --filter @aether/system-info start
```

Managed by `shell/electron/main/services/nodeManager.ts` in production.

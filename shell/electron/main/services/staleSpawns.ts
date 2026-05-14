import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CORE_PID_FILE, NODE_PID_FILE } from './paths'

// Belt-and-braces for shutdown paths that bypass before-quit. Common
// failure mode: dev-mode HMR restart (electron-vite SIGKILLs the old
// Electron main on file change to respawn fresh — the old process never
// gets to run before-quit, so its spawned Core + node orphan to PID 1).
// On the next startMesh() we read the PID files, verify each refers to
// an actual Core / host_notifications process (don't kill an unrelated
// PID reused by the OS), and SIGTERM → wait → SIGKILL them.

const CORE_CMD_PATTERN = /\bcore\.core\b/
const HOST_NOTIFICATIONS_CMD_PATTERN = /host_notifications[\\/]dist[\\/]index\.js$/
const NEWS_FEEDS_CMD_PATTERN = /news_feeds[\\/]dist[\\/]index\.js$/
const FINANCE_CMD_PATTERN = /finance[\\/]dist[\\/]index\.js$/
const DIGEST_CMD_PATTERN = /digest[\\/]dist[\\/]index\.js$/

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPidFile(path: string): number | null {
  if (!existsSync(path)) return null
  try {
    const pid = parseInt(readFileSync(path, 'utf8').trim(), 10)
    return Number.isFinite(pid) && pid > 1 ? pid : null
  } catch {
    return null
  }
}

function matchesCommand(pid: number, pattern: RegExp): boolean {
  try {
    const ps = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return ps.length > 0 && pattern.test(ps)
  } catch {
    return false
  }
}

async function killOne(pid: number, label: string): Promise<void> {
  console.log(`[staleSpawns] killing ${label} pid=${pid} (stale from previous run)`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  // Poll up to 3s for graceful exit.
  for (let i = 0; i < 30; i++) {
    if (!processIsAlive(pid)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* ignore */
  }
  // One more 500ms wait to give the kernel time to reap.
  for (let i = 0; i < 5; i++) {
    if (!processIsAlive(pid)) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function cleanupOne(pidFile: string, pattern: RegExp, label: string): Promise<void> {
  const pid = readPidFile(pidFile)
  if (pid === null) return
  if (!processIsAlive(pid)) {
    // PID file lying around from a clean prior run — just unlink.
    try {
      unlinkSync(pidFile)
    } catch {
      /* ignore */
    }
    return
  }
  if (!matchesCommand(pid, pattern)) {
    // PID was reused by the OS for an unrelated process. Don't touch it.
    try {
      unlinkSync(pidFile)
    } catch {
      /* ignore */
    }
    return
  }
  await killOne(pid, label)
  try {
    unlinkSync(pidFile)
  } catch {
    /* ignore */
  }
}

export async function cleanupStaleSpawns(): Promise<void> {
  await Promise.all([
    cleanupOne(CORE_PID_FILE(), CORE_CMD_PATTERN, 'core'),
    cleanupOne(NODE_PID_FILE('host_notifications'), HOST_NOTIFICATIONS_CMD_PATTERN, 'host_notifications'),
    cleanupOne(NODE_PID_FILE('news_feeds'), NEWS_FEEDS_CMD_PATTERN, 'news_feeds'),
    cleanupOne(NODE_PID_FILE('finance'), FINANCE_CMD_PATTERN, 'finance'),
    cleanupOne(NODE_PID_FILE('digest'), DIGEST_CMD_PATTERN, 'digest'),
  ])
}

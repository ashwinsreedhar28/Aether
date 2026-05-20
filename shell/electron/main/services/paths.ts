import { resolve, join } from 'node:path'
import { app } from 'electron'

// In dev (electron-vite dev), all main sources are bundled into a single
// shell/out/main/index.js. __dirname therefore is shell/out/main; the repo
// root is exactly three levels up (out/main → out → shell → repo).
// Packaged builds will need a separate code path (electron-builder is a
// follow-up PR); we flag that explicitly here.
function resolveRepoRoot(): string {
  // shell/out/main → shell/out → shell → repo
  return resolve(__dirname, '..', '..', '..')
}

export const REPO_ROOT: string = resolveRepoRoot()
export const CORE_VENDOR_DIR: string = join(REPO_ROOT, 'core')
export const MANIFEST_PATH: string = join(REPO_ROOT, 'manifest.yaml')
export const HOST_NOTIFICATIONS_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'host_notifications',
  'dist',
  'index.js',
)
export const NEWS_FEEDS_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'news_feeds',
  'dist',
  'index.js',
)
export const FINANCE_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'finance',
  'dist',
  'index.js',
)
export const WEATHER_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'weather',
  'dist',
  'index.js',
)
export const DIGEST_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'digest',
  'dist',
  'index.js',
)
export const SYSTEM_INFO_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'system_info',
  'dist',
  'index.js',
)
export const CLIPBOARD_HISTORY_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'clipboard_history',
  'dist',
  'index.js',
)
export const MACOS_MESSAGES_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'macos_messages',
  'dist',
  'index.js',
)
export const MACOS_MAIL_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'macos_mail',
  'dist',
  'index.js',
)
export const TIME_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'time',
  'dist',
  'index.js',
)

export function meshRuntimeDir(): string {
  return join(app.getPath('userData'), 'mesh')
}

// Per-node data directory passed to spawned nodes as AETHER_DATA_DIR.
// Standalone Node child processes can't reach Electron's app.getPath
// themselves; the shell hands them a writable root and they namespace
// under it (e.g. news_feeds → $userData/data/news_feeds/news.db). Kept
// separate from meshRuntimeDir() so log/pid runtime files stay
// separable from durable node state.
export function nodeDataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export const CORE_PID_FILE = (): string => join(meshRuntimeDir(), 'core.pid')
export const CORE_LOG_FILE = (): string => join(meshRuntimeDir(), 'core.log')
export const CORE_AUDIT_FILE = (): string => join(meshRuntimeDir(), 'audit.log')
export const NODE_LOG_FILE = (id: string): string => join(meshRuntimeDir(), `${id}.log`)
export const NODE_PID_FILE = (id: string): string => join(meshRuntimeDir(), `${id}.pid`)

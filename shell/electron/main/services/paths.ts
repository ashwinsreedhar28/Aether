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

export function meshRuntimeDir(): string {
  return join(app.getPath('userData'), 'mesh')
}

export const CORE_PID_FILE = (): string => join(meshRuntimeDir(), 'core.pid')
export const CORE_LOG_FILE = (): string => join(meshRuntimeDir(), 'core.log')
export const CORE_AUDIT_FILE = (): string => join(meshRuntimeDir(), 'audit.log')
export const NODE_LOG_FILE = (id: string): string => join(meshRuntimeDir(), `${id}.log`)
export const NODE_PID_FILE = (id: string): string => join(meshRuntimeDir(), `${id}.pid`)

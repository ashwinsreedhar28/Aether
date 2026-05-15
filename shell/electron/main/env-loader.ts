import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Load .env.local from the repo root into process.env at the earliest
// point in main-process boot, before any service that spreads
// `...process.env` into a spawned child (coreManager, nodeManager,
// ravenDaemonManager, visionDaemonManager). Mirrors raven-core's
// .env loader (daemons/raven-core/raven_core/config.py:_load_dotenv) so
// the same .env.local file feeds both halves of the substrate.
//
// dotenv's default behavior is "don't override existing env vars" — a
// var the user already exported in their shell rc wins over .env.local,
// matching the precedence raven-core picked.
//
// Repo root is found by walking up from __dirname looking for
// `pnpm-workspace.yaml`. In dev (`pnpm dev`), __dirname resolves to
// `<repo>/shell/out/main`; the walk hits the marker three levels up.
// Using a marker rather than a hard-coded relative path keeps the
// loader correct if the build output layout shifts.

function findRepoRoot(start: string): string | null {
  let current = start
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function loadEnvLocal(): void {
  const repoRoot = findRepoRoot(__dirname)
  if (!repoRoot) {
    console.log('[env] no repo root found from', __dirname, '— skipping .env.local')
    return
  }
  const envPath = join(repoRoot, '.env.local')
  if (!existsSync(envPath)) {
    console.log('[env] no .env.local at', envPath, '— skipping')
    return
  }
  const result = loadDotenv({ path: envPath })
  if (result.error) {
    console.warn('[env] failed to load .env.local:', result.error.message)
    return
  }
  const count = Object.keys(result.parsed ?? {}).length
  console.log(`[env] loaded .env.local from ${envPath} (${count} vars)`)
}

// Top-level side effect: runs the moment this module is evaluated, which
// (by module-evaluation order — imports are evaluated depth-first in
// textual order before the importing module's body) is before any
// service module that captures or spreads process.env. Consumers should
// `import './env-loader'` as their FIRST import in main.
loadEnvLocal()

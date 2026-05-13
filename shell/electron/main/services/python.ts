import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// GUI-launched Electron on macOS receives a stripped PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that misses Homebrew, pyenv, and
// python.org install locations. Spawning `python3` then fails ENOENT even
// though the user has Python installed. Resolve to an absolute path at
// boot so the spawn doesn't rely on PATH inheritance.
//
// Resolution order:
//   1. $MESH_PYTHON (escape hatch — point at any python3 you want)
//   2. login-shell `which python3` (matches what the user gets in Terminal)
//   3. known install locations on macOS (Homebrew Apple/Intel, python.org,
//      Apple's stub)
//   4. bare "python3" (fall back; will ENOENT if PATH lacks it)
//
// The Apple-shipped /usr/bin/python3 ranks last because Core's deps
// (aiohttp, pyyaml, jsonschema) almost never live there.

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/usr/bin/python3',
]

function fromLoginShell(): string | null {
  // `-l` loads the user's login profile, which puts Homebrew / pyenv /
  // python.org bin dirs on PATH the same way a fresh Terminal session does.
  try {
    const out = execFileSync('/bin/zsh', ['-l', '-c', 'command -v python3'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .trim()
    if (out && existsSync(out)) return out
  } catch {
    /* shell not zsh, or python3 not found — fall through */
  }
  try {
    const out = execFileSync('/bin/bash', ['-lc', 'command -v python3'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .trim()
    if (out && existsSync(out)) return out
  } catch {
    /* bash not available either — fall through */
  }
  return null
}

let cached: string | null = null

export function resolvePython3(): string {
  if (cached) return cached
  const override = process.env.MESH_PYTHON
  if (override && existsSync(override)) {
    cached = override
    return cached
  }
  const fromShell = fromLoginShell()
  if (fromShell) {
    cached = fromShell
    return cached
  }
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) {
      cached = p
      return cached
    }
  }
  cached = 'python3'
  return cached
}

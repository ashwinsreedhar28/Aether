import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PullRequest } from './types'

// PR resolution is the ONE place this sensor touches the network, so it is fully
// async (promisified execFile) and lives on its own slow cadence (see index.ts).
// execFileSync here would block the event loop for the duration of a GitHub round
// trip and could stall the 10s git poll; execFile keeps both decoupled. Every
// failure mode — gh missing, unauthenticated, not a gh-tracked repo, network
// error, malformed JSON — collapses to `{ available: false }`, so the surface
// degrades to `pr: null` + `gh_available: false` and never throws.
const execFileAsync = promisify(execFile)

const GH_TIMEOUT_MS = 15_000
const GH_MAX_BUFFER = 4 * 1024 * 1024
// `gh pr list` defaults to 30; this repo already has 130+ PRs and we pass
// --state all, so raise the cap to keep older branches resolvable.
const GH_LIMIT = 300

// The snapshot the slow poll caches and the status handler merges by branch.
export interface PRSnapshot {
  // false whenever gh could not be consulted (any failure mode above). Surfaces
  // as the payload's top-level gh_available flag.
  available: boolean
  // headRefName → chosen PR. At most one entry per branch (see pickPR).
  byBranch: Map<string, PullRequest>
}

interface GhPr {
  number: number
  state: string
  url: string
  headRefName: string
}

// --state all can return several PRs for one branch (e.g. a closed attempt plus
// a later open one). Prefer an OPEN PR; otherwise the highest number (most
// recent). Deterministic so the same branch resolves to the same PR each poll.
function pickPR(a: PullRequest, b: PullRequest): PullRequest {
  const aOpen = a.state === 'OPEN'
  const bOpen = b.state === 'OPEN'
  if (aOpen !== bOpen) return aOpen ? a : b
  return a.number >= b.number ? a : b
}

export async function collectPRs(repoRoot: string): Promise<PRSnapshot> {
  let stdout: string
  try {
    const res = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        String(GH_LIMIT),
        '--json',
        'number,state,url,headRefName',
      ],
      { cwd: repoRoot, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER, encoding: 'utf8' },
    )
    stdout = res.stdout
  } catch {
    // gh missing / unauthenticated / no remote / network error.
    return { available: false, byBranch: new Map() }
  }

  let parsed: GhPr[]
  try {
    parsed = JSON.parse(stdout) as GhPr[]
    if (!Array.isArray(parsed)) return { available: false, byBranch: new Map() }
  } catch {
    return { available: false, byBranch: new Map() }
  }

  const byBranch = new Map<string, PullRequest>()
  for (const pr of parsed) {
    if (typeof pr?.headRefName !== 'string' || typeof pr.number !== 'number') continue
    const candidate: PullRequest = { number: pr.number, state: pr.state, url: pr.url }
    const existing = byBranch.get(pr.headRefName)
    byBranch.set(pr.headRefName, existing ? pickPR(candidate, existing) : candidate)
  }
  return { available: true, byBranch }
}

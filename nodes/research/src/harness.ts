// Mesh smoke harness for the research node (#366).
//
// One command boots a real Python Core on ephemeral credentials, spawns the
// built research node hermetically (temp AETHER_DATA_DIR, no
// ANTHROPIC_API_KEY), drives its three surfaces through a probe MeshNode,
// and emits a grep-stable transcript with a PASS/FAIL verdict.
//
//   pnpm --filter @aether/research harness                        # 5 checks
//   pnpm --filter @aether/research harness -- --deliberate-failure
//
// Core-boot machinery follows core/node_sdk_ts/test/round-trip.test.ts:
// temp dir, generated manifest, free loopback port, `python3 -m core.core`,
// /v0/healthz poll, SIGTERM-then-SIGKILL teardown. Workspace deps must be
// built first (`pnpm --filter @aether/mesh-node-sdk build`); the harness
// script recompiles only this package.
//
// Transcript contract (see decisions/2026-07-06-harness-transcript-contract-
// ephemeral-credentials.md): every stdout line is `HARNESS <VERB> k=v ...`
// where VERB is BOOT | CHECK | OK | SKIP | FAIL | RESULT; values never
// contain whitespace; no timestamps, no prose. Child-process output goes to
// stderr under `[core] ` / `[research] ` prefixes so stdout stays pure.
//
// Exit codes: 0 = verdict PASS, 1 = verdict FAIL (or boot abort), 2 = usage.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MeshError, MeshNode, type Envelope } from '@aether/mesh-node-sdk'

// dist/harness.js → nodes/research → repo root.
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const CORE_CWD = join(REPO_ROOT, 'core')
const SCHEMA_DIR = resolve(__dirname, '..', 'schemas')
const NODE_ENTRY = join(__dirname, 'index.js')

const PROBE_ID = 'harness_probe'
const HEALTH_TIMEOUT_MS = 30_000
const NODE_READY_TIMEOUT_MS = 15_000
const CHILD_EXIT_GRACE_MS = 3_000
const VALUE_MAX_LEN = 120

// ---------- transcript ----------

type Verb = 'BOOT' | 'CHECK' | 'OK' | 'SKIP' | 'FAIL' | 'RESULT'
type Fields = Record<string, string | number>

// Grep-stable values: no whitespace ever; bounded length so a deny message
// cannot smear a line.
function sanitize(v: string | number): string {
  const s = String(v).replace(/\s+/g, '_')
  return (s.length > VALUE_MAX_LEN ? s.slice(0, VALUE_MAX_LEN) : s) || '-'
}

function out(verb: Verb, fields: Fields): void {
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${sanitize(v)}`)
    .join(' ')
  process.stdout.write(`HARNESS ${verb} ${kv}\n`)
}

const tally = { ok: 0, skip: 0, fail: 0 }

function record(status: 'OK' | 'SKIP' | 'FAIL', name: string, fields: Fields): void {
  tally[status === 'OK' ? 'ok' : status === 'SKIP' ? 'skip' : 'fail'] += 1
  out(status, { name, ...fields })
}

function result(): number {
  const verdict = tally.fail === 0 ? 'PASS' : 'FAIL'
  out('RESULT', { verdict, ok: tally.ok, skip: tally.skip, fail: tally.fail })
  return tally.fail === 0 ? 0 : 1
}

// ---------- child-process plumbing ----------

// Forward a child's stdout+stderr to OUR stderr, line-buffered and prefixed,
// so the harness's stdout stays pure transcript.
function forward(proc: ChildProcess, tag: string): void {
  for (const stream of [proc.stdout, proc.stderr]) {
    if (!stream) continue
    let buf = ''
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
        process.stderr.write(`[${tag}] ${buf.slice(0, nl)}\n`)
        buf = buf.slice(nl + 1)
      }
    })
    stream.on('end', () => {
      if (buf) process.stderr.write(`[${tag}] ${buf}\n`)
    })
  }
}

async function stopChild(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  proc.kill('SIGTERM')
  await new Promise<void>((r) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      r()
    }, CHILD_EXIT_GRACE_MS)
    proc.on('exit', () => {
      clearTimeout(timer)
      r()
    })
  })
}

function freePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const server = createServer()
    server.unref()
    server.on('error', rejectP)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolveP(port))
    })
  })
}

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

// ---------- check helpers ----------

type InvokeResult = Envelope | { id: string; status: 'accepted' }

function isEnvelope(r: InvokeResult): r is Envelope {
  return 'kind' in r
}

// One grep-stable token describing what actually came back, for FAIL lines.
function describe(r: InvokeResult | unknown): string {
  if (r instanceof MeshError) {
    const err = (r.data as Record<string, unknown> | undefined)?.error
    return `http:${r.status},error:${String(err ?? 'unknown')}`
  }
  if (r instanceof Error) return `exception:${r.message}`
  const res = r as InvokeResult
  if (!isEnvelope(res)) return 'status:accepted'
  const reason = res.payload?.reason
  return `kind:${res.kind}${reason !== undefined ? `,reason:${String(reason)}` : ''}`
}

async function checkResponse(
  probe: MeshNode,
  name: string,
  target: string,
  payload: Record<string, unknown>,
  arrayField: string,
): Promise<void> {
  out('CHECK', { name, target })
  const expected = `kind:response,${arrayField}:array`
  try {
    const res = await probe.invoke(target, payload)
    const field = isEnvelope(res) ? res.payload[arrayField] : undefined
    if (isEnvelope(res) && res.kind === 'response' && Array.isArray(field)) {
      record('OK', name, { kind: 'response', [arrayField]: field.length })
    } else {
      record('FAIL', name, { expected, observed: describe(res) })
    }
  } catch (e) {
    record('FAIL', name, { expected, observed: describe(e) })
  }
}

async function checkDeny(
  probe: MeshNode,
  name: string,
  target: string,
  payload: Record<string, unknown>,
  reason: string,
): Promise<void> {
  out('CHECK', { name, target })
  const expected = `kind:error,reason:${reason}`
  try {
    const res = await probe.invoke(target, payload)
    if (isEnvelope(res) && res.kind === 'error' && res.payload?.reason === reason) {
      record('OK', name, { kind: 'error', reason })
    } else {
      record('FAIL', name, { expected, observed: describe(res) })
    }
  } catch (e) {
    record('FAIL', name, { expected, observed: describe(e) })
  }
}

// ---------- main ----------

async function main(): Promise<number> {
  // pnpm forwards the conventional `--` separator into argv — drop it.
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const deliberateFailure = args.includes('--deliberate-failure')
  const unknown = args.filter((a) => a !== '--deliberate-failure')
  if (unknown.length > 0) {
    process.stderr.write(`usage: harness [--deliberate-failure] (unknown: ${unknown.join(' ')})\n`)
    return 2
  }

  // Pre-flight: Core's Python deps, same probe as the round-trip vitest.
  const py = spawnSync('python3', ['-c', 'import aiohttp, yaml, jsonschema'], { stdio: 'ignore' })
  if (py.status !== 0) {
    record('FAIL', 'preflight', { detail: 'python3-with-aiohttp/pyyaml/jsonschema-not-found' })
    return result()
  }

  // Ephemeral credentials — generated per run, nothing hardcoded, nothing
  // persisted. Core refuses an unset or legacy ADMIN_TOKEN at boot.
  const adminToken = randomBytes(32).toString('hex')
  const coreSecret = randomBytes(32).toString('hex')
  const researchSecret = randomBytes(32).toString('hex')
  const probeSecret = randomBytes(32).toString('hex')

  const tmpDir = mkdtempSync(join(tmpdir(), 'aether-research-harness-'))
  const dataDir = join(tmpDir, 'data')

  // The manifest points at the repo's REAL surface schemas (absolute paths),
  // so the harness gates the schemas as shipped — no drift via copies.
  const surface = (name: string): string =>
    [
      `      - name: ${name}`,
      '        type: tool',
      '        invocation_mode: request_response',
      `        schema: '${join(SCHEMA_DIR, `${name}.json`)}'`,
    ].join('\n')
  const manifest = [
    'nodes:',
    '  - id: research',
    '    runtime: local-process',
    '    identity_secret: env:MESH_RESEARCH_SECRET',
    '    surfaces:',
    surface('search'),
    surface('brief'),
    surface('recent'),
    `  - id: ${PROBE_ID}`,
    '    runtime: local-process',
    '    identity_secret: env:MESH_PROBE_SECRET',
    'relationships:',
    `  - from: ${PROBE_ID}`,
    '    to: research.search',
    `  - from: ${PROBE_ID}`,
    '    to: research.brief',
    `  - from: ${PROBE_ID}`,
    '    to: research.recent',
    '',
  ].join('\n')
  writeFileSync(join(tmpDir, 'manifest.yaml'), manifest)

  let coreProc: ChildProcess | null = null
  let nodeProc: ChildProcess | null = null
  let probe: MeshNode | null = null

  try {
    // Boot Core (round-trip.test.ts pattern).
    const port = await freePort()
    const coreUrl = `http://127.0.0.1:${port}`
    coreProc = spawn(
      'python3',
      [
        '-m',
        'core.core',
        '--manifest',
        join(tmpDir, 'manifest.yaml'),
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--audit-log',
        join(tmpDir, 'audit.log'),
      ],
      {
        cwd: CORE_CWD,
        env: {
          ...process.env,
          ADMIN_TOKEN: adminToken,
          MESH_CORE_SECRET: coreSecret,
          MESH_RESEARCH_SECRET: researchSecret,
          MESH_PROBE_SECRET: probeSecret,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    forward(coreProc, 'core')

    const healthy = await waitFor(async () => {
      try {
        return (await fetch(`${coreUrl}/v0/healthz`)).status === 200
      } catch {
        return false
      }
    }, HEALTH_TIMEOUT_MS)
    if (!healthy) {
      record('FAIL', 'core-boot', { port, detail: 'healthz-timeout' })
      return result()
    }
    out('BOOT', { component: 'core', port, status: 'healthy' })

    // Exercise the ephemeral admin token: correct token accepted, missing
    // token refused — proves the metrics surface is gated, not open.
    const authed = await fetch(`${coreUrl}/v0/admin/metrics`, {
      headers: { 'X-Admin-Token': adminToken },
    })
    const unauthed = await fetch(`${coreUrl}/v0/admin/metrics`)
    if (authed.status !== 200 || unauthed.status !== 401) {
      record('FAIL', 'admin-token', {
        expected: 'authorized:200,unauthorized:401',
        observed: `authorized:${authed.status},unauthorized:${unauthed.status}`,
      })
      return result()
    }
    out('BOOT', {
      component: 'admin_token',
      endpoint: '/v0/admin/metrics',
      authorized: 200,
      unauthorized: 401,
      status: 'ok',
    })

    // Spawn the built research node hermetically. ANTHROPIC_API_KEY is
    // stripped: the harness must never spend; research.brief's validation
    // deny precedes any S2/LLM call, so check 4 stays deterministic.
    const nodeEnv = { ...process.env }
    delete nodeEnv.ANTHROPIC_API_KEY
    nodeProc = spawn('node', [NODE_ENTRY], {
      env: {
        ...nodeEnv,
        MESH_RESEARCH_SECRET: researchSecret,
        AETHER_DATA_DIR: dataDir,
        MESH_CORE_URL: coreUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    forward(nodeProc, 'research')
    let nodeExited = false
    nodeProc.on('exit', () => {
      nodeExited = true
    })

    // The node writes its liveness marker only after a successful register,
    // so the marker doubles as registration proof (data-node convention).
    const marker = join(dataDir, 'research', 'running')
    const ready = await waitFor(() => nodeExited || existsSync(marker), NODE_READY_TIMEOUT_MS)
    if (!ready || nodeExited) {
      record('FAIL', 'research-boot', {
        detail: nodeExited ? `exited-code-${nodeProc.exitCode}` : 'register-marker-timeout',
      })
      return result()
    }
    out('BOOT', { component: 'research', status: 'registered' })

    // Probe MeshNode — the invoking side of every check. Its logger goes to
    // stderr: the SDK default logs via console.log and would poison stdout.
    probe = new MeshNode(PROBE_ID, probeSecret, coreUrl, {
      logger: (level, msg) => process.stderr.write(`[probe] ${level}: ${msg}\n`),
    })
    await probe.start()
    out('BOOT', { component: 'probe', node: PROBE_ID, status: 'registered' })

    // 1. Full SSE round-trip on local SQLite only — no network, no LLM.
    await checkResponse(probe, 'recent-happy-path', 'research.recent', { limit: 3 }, 'briefs')

    // 2. Core's schema gate rejects before the node ever sees the envelope.
    const name2 = 'core-schema-gate'
    out('CHECK', { name: name2, target: 'research.search' })
    try {
      const res = await probe.invoke('research.search', {})
      record('FAIL', name2, { expected: 'http:400,error:denied_schema_invalid', observed: describe(res) })
    } catch (e) {
      const errName = e instanceof MeshError ? (e.data as Record<string, unknown>)?.error : undefined
      if (e instanceof MeshError && e.status === 400 && errName === 'denied_schema_invalid') {
        record('OK', name2, { http: 400, error: 'denied_schema_invalid' })
      } else {
        record('FAIL', name2, { expected: 'http:400,error:denied_schema_invalid', observed: describe(e) })
      }
    }

    // 3–4. A one-space query passes Core's minLength-1 schema; the node
    // trims and denies — the node-side MeshDeny path, on both surfaces.
    await checkDeny(probe, 'node-deny-search', 'research.search', { query: ' ' }, 'research_bad_query')
    await checkDeny(probe, 'node-deny-brief', 'research.brief', { query: ' ' }, 'research_bad_query')

    // 5. Live Semantic Scholar. Upstream weather (rate-limit / 5xx) is not a
    // mesh failure: research_search_failed + rate_limited/upstream → SKIP.
    const name5 = 'live-search'
    out('CHECK', { name: name5, target: 'research.search' })
    try {
      const res = await probe.invoke('research.search', { query: 'retrieval augmented generation' })
      const papers = isEnvelope(res) ? res.payload.papers : undefined
      if (isEnvelope(res) && res.kind === 'response' && Array.isArray(papers) && papers.length > 0) {
        record('OK', name5, { kind: 'response', papers: papers.length })
      } else if (
        isEnvelope(res) &&
        res.kind === 'error' &&
        res.payload?.reason === 'research_search_failed' &&
        (res.payload?.code === 'rate_limited' || res.payload?.code === 'upstream')
      ) {
        record('SKIP', name5, { reason: 'research_search_failed', code: String(res.payload.code) })
      } else {
        record('FAIL', name5, { expected: 'kind:response,papers>=1', observed: describe(res) })
      }
    } catch (e) {
      record('FAIL', name5, { expected: 'kind:response,papers>=1', observed: describe(e) })
    }

    // 6. Deliberate failure: expect a deny the node will never send. The
    // real kind=response mismatches and FAILs through the normal machinery —
    // proof the instrument can report failure, not just success.
    if (deliberateFailure) {
      await checkDeny(
        probe,
        'deliberate-failure',
        'research.recent',
        { limit: 1 },
        'harness_deliberate_failure',
      )
    }

    return result()
  } finally {
    try {
      await probe?.stop()
    } catch {
      /* best-effort */
    }
    await stopChild(nodeProc)
    await stopChild(coreProc)
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    record('FAIL', 'harness-internal', { detail: err instanceof Error ? err.message : String(err) })
    process.exit(result())
  },
)

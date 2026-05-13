import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { MeshNode, type Envelope } from '../src'

// Resolves to <repo>/core, where `python3 -m core.core` finds the package.
const CORE_CWD = resolve(__dirname, '..', '..')

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

function pythonAvailable(): boolean {
  const probe = spawnSync('python3', ['-c', 'import aiohttp, yaml, jsonschema'], {
    stdio: 'ignore',
  })
  return probe.status === 0
}

async function waitForHealth(port: number, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v0/healthz`)
      if (res.status === 200) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

interface Fixture {
  tmpDir: string
  port: number
  coreProc: ChildProcess
  nodeASecret: string
  nodeBSecret: string
}

const haveDeps = pythonAvailable()
const describeIfDeps = haveDeps ? describe : describe.skip

describeIfDeps('mesh round-trip', () => {
  let fixture: Fixture | null = null

  beforeAll(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mesh-sdk-rt-'))
    mkdirSync(join(tmpDir, 'schemas'), { recursive: true })
    const schemaBody = JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: true,
    })
    writeFileSync(join(tmpDir, 'schemas', 'echo.json'), schemaBody)
    writeFileSync(join(tmpDir, 'schemas', 'ping.json'), schemaBody)
    const manifest = [
      'nodes:',
      '  - id: node_a',
      '    runtime: local-process',
      '    identity_secret: env:NODE_A_SECRET',
      '    surfaces:',
      '      - name: ping',
      '        type: tool',
      '        invocation_mode: request_response',
      '        schema: schemas/ping.json',
      '  - id: node_b',
      '    runtime: local-process',
      '    identity_secret: env:NODE_B_SECRET',
      '    surfaces:',
      '      - name: echo',
      '        type: tool',
      '        invocation_mode: request_response',
      '        schema: schemas/echo.json',
      'relationships:',
      '  - from: node_a',
      '    to: node_b.echo',
      '',
    ].join('\n')
    writeFileSync(join(tmpDir, 'manifest.yaml'), manifest)

    const port = await freePort()
    const nodeASecret = randomBytes(32).toString('hex')
    const nodeBSecret = randomBytes(32).toString('hex')
    const env = {
      ...process.env,
      ADMIN_TOKEN: 'mesh-sdk-roundtrip-token',
      MESH_CORE_SECRET: randomBytes(32).toString('hex'),
      NODE_A_SECRET: nodeASecret,
      NODE_B_SECRET: nodeBSecret,
    }
    const coreProc = spawn(
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
      { cwd: CORE_CWD, env, stdio: 'pipe' },
    )
    let stderr = ''
    coreProc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    const healthy = await waitForHealth(port, 15_000)
    if (!healthy) {
      coreProc.kill('SIGKILL')
      throw new Error(`Core did not become healthy on port ${port}. stderr:\n${stderr}`)
    }
    fixture = { tmpDir, port, coreProc, nodeASecret, nodeBSecret }
  }, 30_000)

  afterAll(async () => {
    if (!fixture) return
    fixture.coreProc.kill('SIGTERM')
    await new Promise<void>((r) => {
      const timer = setTimeout(() => {
        try {
          fixture!.coreProc.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        r()
      }, 3000)
      fixture.coreProc.on('exit', () => {
        clearTimeout(timer)
        r()
      })
    })
    try {
      rmSync(fixture.tmpDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
    fixture = null
  })

  it('A.invoke(B.echo) returns a signed response envelope with the echoed payload', async () => {
    if (!fixture) throw new Error('fixture missing')
    const coreUrl = `http://127.0.0.1:${fixture.port}`
    const nodeA = new MeshNode('node_a', fixture.nodeASecret, coreUrl)
    const nodeB = new MeshNode('node_b', fixture.nodeBSecret, coreUrl)
    let received: Envelope | null = null
    nodeB.on('echo', async (env) => {
      received = env
      return { echo: env.payload }
    })

    try {
      await nodeB.start()
      await nodeA.start()
      const response = await nodeA.invoke('node_b.echo', { hello: 'world' })
      // request_response surfaces return a full response envelope, not the
      // { id, status: "accepted" } 202 shape.
      expect('kind' in response).toBe(true)
      const env = response as Envelope
      expect(env.kind).toBe('response')
      expect(env.from).toBe('node_b')
      expect(env.to).toBe('node_a')
      expect(env.payload).toEqual({ echo: { hello: 'world' } })
      expect(received).not.toBeNull()
      expect(received!.payload).toEqual({ hello: 'world' })
      expect(received!.from).toBe('node_a')
    } finally {
      await nodeA.stop()
      await nodeB.stop()
    }
  }, 15_000)
})

if (!haveDeps) {
  console.warn(
    '[round-trip.test] skipping — python3 with aiohttp/pyyaml/jsonschema not detected. ' +
      'See core/README.md for install instructions.',
  )
}

# @homeos/mesh-node-sdk

TypeScript port of `_ingest/RAVEN_MESH/node_sdk/__init__.py`. Used by the
homeOS Electron main process (`shell/electron/main/`) and by Node.js mesh
nodes under `nodes/*`.

This SDK is RAVEN_MESH protocol-conformant: it implements `POST /v0/register`,
`POST /v0/invoke`, `POST /v0/respond`, and a `GET /v0/stream` consumer, all
signed with HMAC-SHA256 over canonical JSON exactly as the Python SDK does.
The round-trip test in `test/round-trip.test.ts` boots Core in a subprocess
and proves the contract.

## Install (workspace local)

```bash
pnpm --filter @homeos/mesh-node-sdk build
```

The package's `main`/`exports` resolve to `dist/`; consumers must run the
build before importing.

## Usage

```ts
import { MeshNode, MeshDeny } from '@homeos/mesh-node-sdk'

const node = new MeshNode('host_notifications', process.env.MESH_HOST_NOTIFICATIONS_SECRET!, 'http://127.0.0.1:8000')

node.on('notify', async (env) => {
  const { title, body } = env.payload as { title: string; body: string }
  if (process.platform !== 'darwin') {
    throw new MeshDeny('host_notifications_unsupported', { reason: 'macOS only in v0.1.0' })
  }
  // fire the notification, return ack
  return { delivered: true, at: new Date().toISOString() }
})

await node.start()
```

## Tests

The round-trip test spawns Python Core and exercises a full invoke/respond
loop between two Node.js mesh nodes. Requires `python3` plus `aiohttp`,
`pyyaml`, `jsonschema` on `PYTHONPATH`. If they're missing, the test
self-skips with a warning.

```bash
pnpm --filter @homeos/mesh-node-sdk test
```

## What was simplified vs. the Python SDK

- No `wrapped` envelope helpers exposed in `invoke()` beyond the raw
  `wrapped` parameter — the SDK doesn't need approval-node ergonomics yet.
- No async-iterator stream API — handlers register via `.on()` and dispatch
  is automatic.
- Logging goes through an injectable `logger` option (default: console).
  Python uses the stdlib `logging` module — overkill for the surface here.
- The Python SDK's `connect()`/`serve()` split is collapsed into `start()`.
  Both paths still funnel through register → stream, just without the
  two-phase API.

Per CLAUDE.md §11 heuristic 8: aggressive simplification on pattern-lift.

# New Mesh Node Pattern Reference

Step-by-step guide for adding a new mesh node to Aether. Codified from
PR #45 (post-merge wiring gaps) and bound by the ADR in DECISIONS.md
from PR #46 (governance batch 2).

> **For Implementers:** read this end-to-end before writing any code.
> The pattern is mechanical; follow it exactly. Existing nodes (finance,
> vision, weather) provide reference, but this doc supersedes them as
> the canonical pattern. Cross-check the verification checklist at the
> end before opening a PR.

## When to use this doc

A "new mesh node" means a process that:
- Registers with Aether's mesh core
- Exposes one or more surfaces (named operations) over the mesh protocol
- Receives an identity secret for authentication
- Has its lifecycle managed by the shell

If you're adding a new surface to an existing node (e.g. `finance.movers`
on the existing finance node), this doc does NOT apply. Just edit the
existing node's `index.ts` + `schemas/` + `manifest.yaml` + voice tool.

## TS vs Python — pick first

The most important decision before writing any code. Wrong pick = expensive
mid-implementation rewrite.

**Choose TypeScript when:**
- Data comes from HTTP APIs, RSS, JSON sources (fetch + parse)
- Node.js ecosystem libraries are sufficient
- No native macOS framework needed (no AVFoundation, EventKit, CoreLocation, etc.)
- Example precedents: `nodes/finance/`, `nodes/news_feeds/`, `nodes/digest/`,
  `nodes/host_notifications/`

**Choose Python (pyobjc) when:**
- Need macOS-native framework (AVFoundation, EventKit, CoreMediaIO, etc.)
- Heavy pyobjc bindings required
- Example precedents: `nodes/vision/`, `daemons/raven-core/`

The lifecycle path differs:
- TS nodes → spawned by `shell/electron/main/services/nodeManager.ts`
- Python nodes → spawned by a dedicated `*DaemonManager.ts` (one per node)

## The 5-file pattern (CLAUDE.md §10, binding per PR #46 ADR)

Every new mesh node — regardless of language — requires touching
**at minimum** these 5 files, plus schemas/ dir. Missing any one causes
silent runtime failure with confusing symptoms (auth failure, never-spawned,
etc.) discovered only by smoke test.

| # | File | What changes |
|---|------|--------------|
| 1 | `manifest.yaml` | Register node id, identity_secret env ref, surfaces, edges |
| 2 | `shell/electron/main/services/secrets.ts` | Add `<nodeName>Secret: string` field + `hex32()` generator entry |
| 3 | `shell/electron/main/services/coreManager.ts` | Add `MESH_<NODE>_SECRET: this.secrets.<nodeName>Secret` to env block |
| 4 | TS: `nodeManager.ts` (add `spawn<Node>()` + import constant + call in `startAll`)<br>Python: new `<node>DaemonManager.ts` (lifecycle) + register in `shell/electron/main/index.ts` | Process lifecycle wiring |
| 5 | `.env.local.example` | Document any user-facing env vars |

Plus: `nodes/<node>/schemas/<surface>.json` — one JSON Schema per surface,
draft-07, describing the REQUEST args (not response shape). See
`nodes/news_feeds/schemas/breaking.json` for canonical example.

## TS node pattern — full file recipe

For a TypeScript mesh node named `example` with surfaces `example.foo` and
`example.bar`.

### 1. Directory: `nodes/example/`

```
nodes/example/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── README.md
├── src/
│   └── index.ts
└── schemas/
    ├── foo.json
    └── bar.json
```

### 2. `nodes/example/package.json`

Mirror `nodes/finance/package.json` exactly, swap names:

```json
{
  "name": "@aether/example",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@aether/mesh-node-sdk": "workspace:*"
  },
  "devDependencies": {
    "@eslint/js": "^9.18.0",
    "@types/node": "^22.10.0",
    "eslint": "^9.18.0",
    "typescript": "~5.7.0",
    "typescript-eslint": "^8.20.0"
  }
}
```

### 3. `nodes/example/tsconfig.json` and `eslint.config.mjs`

Copy verbatim from `nodes/finance/`. No changes needed.

### 4. `nodes/example/src/index.ts`

```typescript
import { MeshNode } from '@aether/mesh-node-sdk'

const NODE_ID = 'example'

// Surface return types MUST have [key: string]: unknown to satisfy
// mesh SDK's Record<string, unknown> expectation. §10 codified.
interface FooResult {
  available: true
  // ... fields ...
  timestamp: number
  [key: string]: unknown   // ← REQUIRED
}

interface UnavailableResponse {
  available: false
  reason: string
  [key: string]: unknown   // ← REQUIRED
}

type FooResponse = FooResult | UnavailableResponse

const dataDir = process.env.AETHER_DATA_DIR
if (!dataDir) {
  console.error(`[${NODE_ID}] AETHER_DATA_DIR is required; refusing to start.`)
  process.exit(2)
}

const node = new MeshNode(NODE_ID, {
  surfaces: {
    foo: async (_params: unknown): Promise<FooResponse> => {
      // ... fetch / cache / return ...
      return { available: true, /* fields */, timestamp: Date.now() }
    },
    bar: async (params: unknown): Promise<...> => {
      // ...
    },
  },
})

await node.start()
```

### 5. `nodes/example/schemas/foo.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "example.foo",
  "description": "Detailed description of what example.foo does, what it returns, where data comes from, and graceful-degradation behavior when env vars or permissions are missing.",
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "description": "Optional parameter description. Default N, clamped to max."
    }
  }
}
```

Schemas describe REQUEST args (the surface's inputs), not response shape.
Empty `properties: {}` for no-arg surfaces.

### 6. `shell/electron/main/services/paths.ts`

Add the entry constant near the others (around line 30-45):

```typescript
export const EXAMPLE_ENTRY: string = join(
  REPO_ROOT,
  'nodes',
  'example',
  'dist',
  'index.js',
)
```

### 7. `shell/electron/main/services/secrets.ts`

Add `exampleSecret: string` to `MeshSecrets` interface AND
`exampleSecret: hex32()` to `generateMeshSecrets()`:

```typescript
interface MeshSecrets {
  // ... existing fields ...
  exampleSecret: string   // ← ADD
}

function generateMeshSecrets(): MeshSecrets {
  return {
    // ... existing entries ...
    exampleSecret: hex32(),   // ← ADD
  }
}
```

### 8. `shell/electron/main/services/coreManager.ts`

Add `MESH_EXAMPLE_SECRET` to the env block (around line 90-110):

```typescript
const env: NodeJS.ProcessEnv = {
  ...process.env,
  // ... existing MESH_*_SECRET entries ...
  MESH_EXAMPLE_SECRET: this.secrets.exampleSecret,
}
```

### 9. `shell/electron/main/services/nodeManager.ts`

Three changes:

**Imports (add EXAMPLE_ENTRY):**
```typescript
import {
  // ... existing ...
  EXAMPLE_ENTRY,
  // ...
} from './paths'
```

**Add `spawnExample()` method (mirror `spawnFinance`):**
```typescript
private async spawnExample(): Promise<void> {
  const dataDir = nodeDataDir()
  mkdirSync(dataDir, { recursive: true })
  await this.spawnNode({
    id: 'example',
    entry: EXAMPLE_ENTRY,
    buildHint: '`pnpm --filter @aether/example build`',
    secretEnvName: 'MESH_EXAMPLE_SECRET',
    secretValue: this.secrets.exampleSecret,
    extraEnv: { AETHER_DATA_DIR: dataDir },
  })
}
```

**Call it in `startAll()` Promise.all:**
```typescript
await Promise.all([
  this.spawnHostNotifications(),
  this.spawnNewsFeeds(),
  this.spawnFinance(),
  this.spawnDigest(),
  this.spawnWeather(),
  this.spawnExample(),   // ← ADD
])
```

### 10. `manifest.yaml`

Add node registration (under `nodes:`):

```yaml
  - id: example
    runtime: local-process
    identity_secret: env:MESH_EXAMPLE_SECRET
    metadata:
      description: |
        One-paragraph description of what this node does, what data sources
        it uses, polling cadence if applicable, and graceful-degradation
        behavior when external env vars / permissions are missing.
    surfaces:
      - name: foo
        type: tool
        invocation_mode: request_response
        schema: nodes/example/schemas/foo.json
      - name: bar
        type: tool
        invocation_mode: request_response
        schema: nodes/example/schemas/bar.json
```

Add edges (under `edges:`):

```yaml
  # Voice consumes example
  - from: raven
    to: example.foo
  - from: raven
    to: example.bar
```

### 11. Voice tool: `daemons/raven-core/raven_core/tools/example_tool.py`

```python
"""Voice tools for example node. See nodes/example/."""

from typing import Optional

from raven_core.mesh import mesh_invoke


async def example_foo() -> str:
    """Brief description of what calling foo does, what is spoken."""
    result = await mesh_invoke("example.foo", {})
    if not result.get("available"):
        return "Example isn't configured yet, sir."
    # Format result into natural language
    return f"Example reports {result['some_field']}"


async def example_bar(limit: int = 5) -> str:
    """Brief description."""
    result = await mesh_invoke("example.bar", {"limit": limit})
    if not result.get("available"):
        return "Example isn't configured yet, sir."
    return "..."
```

### 12. Register in `daemons/raven-core/raven_core/tools/__init__.py`

Mirror existing entries. Look for where finance/weather tools register
and add the example_tool import + registration. Update tool count
comments/docstrings if any.

### 13. `.env.local.example`

```bash
# Example node (description)
AETHER_EXAMPLE_FOO_CONFIG=...
```

## Python node pattern — divergences from TS

Same 5 files, plus a `*DaemonManager.ts` instead of nodeManager entry.

### Key files (in addition to those above)

- `nodes/example/main.py` — Python entry, MeshNode class from `core/node_sdk/`
- `nodes/example/requirements.txt` — Python deps (mesh-sdk + pyobjc frameworks)
- `nodes/example/README.md`

### `shell/electron/main/services/exampleDaemonManager.ts`

Lift the pattern from `shell/electron/main/services/visionDaemonManager.ts`.
Critical sections:

```typescript
this.visionProcess = spawn(venvPython, ['main.py'], {
  cwd: this.exampleDir,
  env: {
    ...process.env,
    NODE_ID: 'example',
    MESH_EXAMPLE_SECRET: exampleSecret,   // ← env var name MUST match Python's read
    MESH_CORE_URL: 'http://127.0.0.1:8000',
    PYTHONPATH: coreDir,
    PYTHONUNBUFFERED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

**Critical:** the env var name in the spawn env MUST match what `main.py`
reads. Python should read `MESH_EXAMPLE_SECRET` (NOT `EXAMPLE_SECRET`)
to match Aether convention. §10 codified — this was a Sprint 1 bug.

### `nodes/example/main.py` skeleton

```python
#!/usr/bin/env python3
"""Example mesh node."""

import asyncio
import logging
import os
import sys

# Add core SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../core"))

from node_sdk import MeshNode

# macOS framework imports (if needed) — group in single try/except
# WARNING: any single failed import here disables ALL of them. Be precise
# about package names. CoreVideo lives in pyobjc-framework-Quartz; use
# `from Quartz.CoreVideo import ...` not `from CoreVideo import ...`. §10.
try:
    import objc
    from AVFoundation import AVCaptureDevice
    from Foundation import NSObject
    # ... etc
    AVAILABLE = True
except ImportError:
    AVAILABLE = False

log = logging.getLogger("example")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


async def main() -> int:
    node_id = os.getenv("NODE_ID", "example")
    secret = os.getenv("MESH_EXAMPLE_SECRET")   # ← Aether convention
    core_url = os.getenv("MESH_CORE_URL", "http://127.0.0.1:8000")

    if not secret:
        log.error("MESH_EXAMPLE_SECRET environment variable required")
        return 2

    log.info(f"Example node starting (node_id={node_id}, core_url={core_url})")

    node = MeshNode(
        node_id=node_id,
        secret=secret,
        core_url=core_url,
        surfaces={
            "foo": handle_foo,
            "bar": handle_bar,
        },
    )

    await node.start()
    return 0


async def handle_foo(params: dict) -> dict:
    if not AVAILABLE:
        return {"available": False, "reason": "framework_unavailable"}
    # ...
    return {"available": True, ...}


async def handle_bar(params: dict) -> dict:
    # ...
    pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

### Register the daemon manager

In `shell/electron/main/index.ts`, instantiate and start the new daemon
manager alongside the others (mirror how visionDaemonManager is wired).

## Common §10 gotchas to avoid

From PR #46's codified entries:

1. **5-file pattern missing entries.** Cross-check ALL five before commit.
2. **Mesh SDK index signatures.** `interface FooResult { ...; [key: string]: unknown }`.
3. **Python try/except multi-import.** Each failing import silently disables all peers. Use precise package names; verify each import works in isolation before trusting the block.
4. **Per-node MESH_*_SECRET wiring.** Both coreManager AND daemonManager (or nodeManager) must pass it, AND the Python/TS code must read it under the same env var name.
5. **AETHER_DATA_DIR required.** Every node spawned via nodeManager expects this. Pass via extraEnv.
6. **pnpm --frozen-lockfile fails with new packages.** Use `pnpm install --no-frozen-lockfile`, commit the updated lockfile.
7. **pnpm typecheck depends on mesh-node-sdk dist.** Run `pnpm -r build` before typecheck.
8. **Schemas describe REQUEST not response.** Mirror `nodes/news_feeds/schemas/breaking.json`.
9. **CoreVideo lives in Quartz.** `from Quartz.CoreVideo import ...` not `from CoreVideo import ...`.
10. **ESLint catch-param rule rejects underscore prefix in CI.** Omit catch param entirely: `} catch { ... }`.

## Verification checklist (run before opening PR)

```
cd <worktree-root>

# 1. Build clean (lockfile may need regen for new packages)
pnpm install --no-frozen-lockfile
pnpm -r build 2>&1 | tail -5
pnpm -r typecheck 2>&1 | tail -5
pnpm -r lint 2>&1 | tail -5

# 2. Cross-check 5-file pattern
grep -q "<node>" manifest.yaml && echo "manifest ✓"
grep -q "<node>Secret" shell/electron/main/services/secrets.ts && echo "secrets ✓"
grep -q "MESH_<NODE>_SECRET" shell/electron/main/services/coreManager.ts && echo "coreManager ✓"
grep -q "spawn<Node>\|<node>DaemonManager" shell/electron/main/services/*.ts && echo "spawn wiring ✓"
grep -q "AETHER_<NODE>" .env.local.example 2>/dev/null && echo ".env.local.example ✓"  # if applicable

# 3. Schemas valid JSON
for f in nodes/<node>/schemas/*.json; do python3 -c "import json; json.load(open('$f'))"; done

# 4. Python only: syntax check
python3 -m py_compile nodes/<node>/main.py
```

## §7 PR body template (binding per CLAUDE.md §7)

```markdown
## What changed
[file list with brief annotation]

## Why
[motivation, what user problem this solves]

## How (high level)
[architecture choice — TS vs Python, surface design, polling vs reactive, etc.]

## Risks / TODOs / Skipped
[explicit out-of-scope items, deferred work, future-arc candidates per §11.6]

## Out-of-scope work explicitly avoided
[bullet list of related concerns deliberately not addressed]

## Pre-PR heuristics
Walked §11.1–§11.9:
- §11.1 ordering: ...
- §11.2 destructive ops: ...
- §11.3 code accuracy: pnpm -r build/typecheck/lint clean
- §11.4 UI integration: ...
- §11.5 atomic git state: ...
- §11.6 reserve space: ...
- §11.7 cross-platform: ...
- §11.8 auxiliary-writes-isolation: ...
- §11.9 cross-doc consistency: ...

## Verification
[bullet list of what was tested + how]

## Open questions for Architect
[anything ambiguous you want flagged]
```

## After PR opens

- Auto-review workflow fires (claude-sonnet-4-5 mechanical checks); confirm
  all 5 boxes clear or are explainably ⊘
- CI must be green (typecheck/lint/build/tests)
- Architect reviews PER PR #46 ADR: explicitly confirms all 5 files +
  schemas/ are present in the diff before approval
- Squash merge with appropriate title
- Auto-delete branch (repo setting handles this)

---

If you read this end-to-end before writing code, you can skip 80% of the
"investigate existing nodes" phase that previously consumed most of the
session token budget.
---

## Corrections (post-calendar lane, 2026-05-14)

The calendar lane (PR #51) surfaced four pattern-doc inaccuracies. Until a full refresh of this doc lands, refer to `nodes/calendar/` as the canonical Python new-node example. Specific corrections:

1. **MeshNode API**: surfaces are registered via `node.on("name", handler)` AFTER construction, NOT as a `surfaces={}` kwarg to the constructor. The pattern doc's Python example above showing `surfaces={...}` is incorrect.

2. **Keep-alive loop required**: Python daemons must run `while True: await asyncio.sleep(1)` AFTER `await node.start()`, otherwise the process exits immediately. See `nodes/vision/main.py` and `nodes/calendar/main.py`.

3. **Python deps must include aiohttp**: every Python mesh node's `requirements.txt` must explicitly include `aiohttp>=3.9.0` (transitive dep of `core/node_sdk` used for HTTP mesh registration). Pin pyobjc framework versions with `>=` not `==` to allow pip to select wheels for the current Python version.

4. **Pyobjc class methods (those with `+` prefix in Obj-C headers) must be called on the class, not the instance.** Example: `EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)`, NOT `store.authorizationStatusForEntityType_(...)`. Instance methods (`-` prefix in Obj-C) ARE called on the instance: `store.requestAccessToEntityType_completion_(EKEntityTypeEvent, completion)`.

5. **Python 3.14 venv build environment**: pyobjc framework source builds for `==10.3.1` and earlier fail under Python 3.14 + setuptools ≥81 because `pyobjc_setup.py` imports the removed `pkg_resources` symbol. Workaround when source-building older pyobjc: `PIP_CONSTRAINT` with `setuptools<81`. Better: use `>=10.0` to let pip pick newer versions that ship Python 3.14 wheels.


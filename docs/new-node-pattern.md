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

## The 5-file pattern (TypeScript) / 6-file pattern (Python daemon-managed)

Every new mesh node requires touching **at minimum** these files, plus schemas/ dir. Missing any one causes silent runtime failure with confusing symptoms (auth failure, never-spawned, etc.) discovered only by smoke test. The file count depends on the node runtime (CLAUDE.md §10, binding per PR #46 ADR).

**TypeScript nodes (5 files):**

| # | File | What changes |
|---|------|--------------|
| 1 | `manifest.yaml` | Register node id, identity_secret env ref, surfaces, edges |
| 2 | `shell/electron/main/services/secrets.ts` | Add `<nodeName>Secret: string` field + `hex32()` generator entry |
| 3 | `shell/electron/main/services/coreManager.ts` | Add `MESH_<NODE>_SECRET: this.secrets.<nodeName>Secret` to env block |
| 4 | `shell/electron/main/services/nodeManager.ts` | Add `spawn<Node>()` + import constant + call in `startAll` |
| 5 | `.env.local.example` | Document any user-facing env vars |

**Python daemon-managed nodes (6 files):**

| # | File | What changes |
|---|------|--------------|
| 1 | `manifest.yaml` | Register node id, identity_secret env ref, surfaces, edges |
| 2 | `shell/electron/main/services/secrets.ts` | Add `<nodeName>Secret: string` field + `hex32()` generator entry |
| 3 | `shell/electron/main/services/coreManager.ts` | Add `MESH_<NODE>_SECRET: this.secrets.<nodeName>Secret` to env block |
| 4 | New `shell/electron/main/services/<node>DaemonManager.ts` | Lifecycle manager, register in `shell/electron/main/index.ts` |
| 5 | `shell/electron/main/services/mesh.ts` | Add `get<Node>MeshConfig()` getter returning `{ <node>Secret: string; coreUrl: string } \| null` |
| 6 | `.env.local.example` | Document any user-facing env vars |

Plus: `nodes/<node>/schemas/<surface>.json` — one JSON Schema per surface, draft-07, describing the REQUEST args (not response shape). See `nodes/news_feeds/schemas/breaking.json` for canonical example.

### Sixth file for Python daemon nodes — the mesh.ts getter pattern

Python daemon-managed nodes (vision, calendar, reminders) differ from TypeScript nodeManager-spawned nodes in one critical way: their `*DaemonManager.ts` files spawn the Python child process **before** the mesh reaches `ready` state — often during the mesh startup sequence itself, in parallel with Core bootstrapping.

This creates a timing hazard. If the daemon manager imports `secrets` and `coreManager` directly to read `coreUrl` at spawn time, it captures the values before they're initialized, receiving `null` or stale data. The daemon then fails to register with Core, logs "connection refused," and never surfaces.

**Solution:** The daemon manager reads its identity bundle via a **getter function** exported from `mesh.ts`, not by direct import of `secrets` / `coreManager`. The getter is called at spawn time (after `startMesh()` resolves), returning the current state.

**Canonical pattern (`shell/electron/main/services/mesh.ts`):**

```typescript
export function getRavenMeshConfig(): { ravenSecret: string; coreUrl: string } | null {
  if (meshState !== 'ready' || !secrets || !coreManager) return null
  return { ravenSecret: secrets.ravenSecret, coreUrl: coreManager.url }
}

export function getVisionMeshConfig(): { visionSecret: string; coreUrl: string } | null {
  if (meshState !== 'ready' || !secrets || !coreManager) return null
  return { visionSecret: secrets.visionSecret, coreUrl: coreManager.url }
}

export function getCalendarMeshConfig(): { calendarSecret: string; coreUrl: string } | null {
  if (meshState !== 'ready' || !secrets || !coreManager) return null
  return { calendarSecret: secrets.calendarSecret, coreUrl: coreManager.url }
}

export function getRemindersMeshConfig(): { remindersSecret: string; coreUrl: string } | null {
  if (meshState !== 'ready' || !secrets || !coreManager) return null
  return { remindersSecret: secrets.remindersSecret, coreUrl: coreManager.url }
}
```

Each function returns `null` until `meshState === 'ready'`, at which point both `secrets` and `coreManager` are guaranteed non-null. The daemon manager polls this getter (typically in `ensureRunning()`) until it returns a config object, then spawns the Python child with the captured values as env vars.

**When adding a new Python daemon node:**
1. Add the getter to `mesh.ts` (mirror the pattern above, swap the node name)
2. Call the getter in the daemon manager's spawn path
3. Pass the returned `{ <node>Secret, coreUrl }` to the child's env block as `MESH_<NODE>_SECRET` and `MESH_CORE_URL`

Skipping this step causes "mesh not available" errors in the daemon's logs despite Core being healthy — the daemon spawned before Core was ready and never retried.

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

const node = new MeshNode(NODE_ID)

// Register surface handlers using .on() — NOT via a `surfaces` constructor kwarg
node.on('foo', async (_params: unknown): Promise<FooResponse> => {
  // ... fetch / cache / return ...
  return { available: true, /* fields */, timestamp: Date.now() }
})

node.on('bar', async (params: unknown): Promise<...> => {
  // ...
})

await node.start()

// Keep-alive loop (process exits without this)
while (true) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
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

    node = MeshNode(node_id=node_id, secret=secret, core_url=core_url)

    # Register surface handlers using .on() — NOT via a `surfaces` kwarg
    node.on("foo", handle_foo)
    node.on("bar", handle_bar)

    await node.start()

    # Keep-alive loop — process exits without this
    while True:
        await asyncio.sleep(1)


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

## Voice tool Gemini declaration pattern

Voice tools in `daemons/raven-core/raven_core/tools/` must follow a **strict four-part pattern** to register with Gemini Live. Simply defining async functions is **not sufficient** — the raven daemon's tool loader expects the FunctionDeclaration / Tool / get_tools() / handle_call_async() structure.

**The four required components:**

1. **`FUNCTIONS` list** — string list of all function names this tool file exports
2. **`get_tools()` function** — returns `list[types.Tool]`, each Tool containing one or more `types.FunctionDeclaration` objects
3. **`handle_call_async(name: str, args: dict)` function** — async dispatcher that routes Gemini's function-call requests to your implementation
4. **Private implementation functions** — the actual logic, conventionally prefixed with `_` (e.g. `_calendar_today()`)

**Canonical skeleton (`calendar_tool.py` reference):**

```python
"""Voice tools for example node. See nodes/example/."""
from __future__ import annotations

from typing import Any

from google.genai import types

# CRITICAL: relative import. Path is `..mesh_client` NOT `raven_core.mesh_client`
from ..mesh_client import MeshUnavailable, mesh_invoke

# 1. Function name list (used by tool loader)
FUNCTIONS = ["example_foo", "example_bar"]

# 4. Private implementations — async, return dict with `spoken` field
async def _example_foo() -> dict[str, Any]:
    """Fetch example.foo surface and format for voice."""
    try:
        response = await mesh_invoke("example.foo", {})
    except MeshUnavailable as e:
        return {"error": "mesh unavailable", "detail": str(e)}

    if not isinstance(response, dict):
        return {"error": "malformed response"}

    available = response.get("available", False)
    if not available:
        reason = response.get("reason", "unknown")
        # Handle known graceful-degradation reasons
        if reason == "permission_denied":
            return {
                "error": "permission_denied",
                "spoken": "Example isn't authorized yet, sir."
            }
        return {"error": "unavailable", "detail": reason}

    # Format mesh response into natural language
    value = response.get("value", "unknown")
    return {"value": value, "spoken": f"Example reports {value}, sir."}

async def _example_bar(limit: int) -> dict[str, Any]:
    """Fetch example.bar surface with params."""
    # ... similar pattern ...
    pass

# 2. Gemini function declarations — what the LLM sees
def get_tools() -> list[types.Tool]:
    """Return Gemini function declarations for all example tools."""
    foo_func = types.FunctionDeclaration(
        name="example_foo",
        description=(
            "Get current example data. Use when the user asks "
            "'what's the example status', 'check example', etc. "
            "Returns a natural-language summary. Read the spoken "
            "field verbatim."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},  # No params for this tool
        ),
    )

    bar_func = types.FunctionDeclaration(
        name="example_bar",
        description=(
            "Get top N example items. Use when the user asks "
            "'give me five example things', 'list example items'. "
            "Default limit is 5, max 20."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "limit": types.Schema(
                    type=types.Type.INTEGER,
                    description=(
                        "Optional number of items to return. "
                        "Default 5, clamped to 1-20."
                    ),
                ),
            },
            required=[],  # All params optional
        ),
    )

    # Return as a single Tool wrapping all declarations
    return [types.Tool(function_declarations=[foo_func, bar_func])]

# 3. Async handler — routes Gemini's calls to implementations
async def handle_call_async(name: str, args: dict) -> dict[str, Any] | None:
    """Async tool handler — awaited by the tool registry."""
    if name == "example_foo":
        return await _example_foo()
    if name == "example_bar":
        limit = args.get("limit", 5)
        if not isinstance(limit, int):
            limit = 5
        return await _example_bar(limit)
    return None  # Unknown function name
```

**Critical details:**

- **Import path:** `from ..mesh_client import mesh_invoke` (relative), NOT `from raven_core.mesh_client`. The raven daemon's directory structure makes the relative import canonical.
- **Return shape:** Every voice tool implementation should return a dict with a `spoken` field containing natural-language text. Gemini reads this verbatim to the user.
- **Error handling:** Wrap `mesh_invoke` in try/except for `MeshUnavailable`. Check `response.get("available")` for graceful degradation (permission_denied, no_data, etc.).
- **Function declarations map to user intent:** The `description` field tells Gemini when to call this tool. Be specific about trigger phrases.

**Registration (`daemons/raven-core/raven_core/tools/__init__.py`):**

After writing the tool file, register it in `__init__.py`:

```python
from . import example_tool

# Add to the module-level tool list
__all__ = [
    # ... existing ...
    "example_tool",
]

# Tool loader automatically discovers all modules with FUNCTIONS, get_tools(), handle_call_async()
```

**Verification:** After adding a voice tool, check raven's startup logs for:

```
Created LiveConnectConfig with N function(s) across M tool group(s)
```

The count `N` should increase by the number of functions you added. If it doesn't change, the tool file is missing one of the four required components.

## Environment requirements

Aether's mesh substrate requires specific runtime versions. These are validated at build time (package.json `engines` field for Node/pnpm) and enforced by daemon managers at spawn time (Python version checks before venv creation).

**Node.js:**
- **Minimum:** Node 22.0.0
- **Rationale:** The `yahoo-finance2` library (finance node dependency) requires Node 22+. Node 20 causes silent performance degradation (4.5+ minute poll cycles for 10 tickers, ~10 minutes for 21).
- **Enforcement:** `shell/package.json` declares `"engines": { "node": ">=22.0.0" }`. pnpm blocks install on older Node.

**Python:**
- **Minimum:** Python 3.10
- **Maximum tested:** Python 3.14 (supported with caveats — see below)
- **Recommended:** Python 3.12 or 3.13 for wheel availability
- **Enforcement:** Each `*DaemonManager.ts` checks Python version via `python3 --version` before venv creation. Versions below 3.10 are rejected with a clear error message.

**Python 3.14 compatibility caveats:**

Python 3.14 is supported but has two known friction points when building pyobjc from source:

1. **setuptools ≥81 breaks pyobjc <10.3.2:** The `pyobjc_setup.py` helper imports `pkg_resources`, removed in setuptools 81. Workaround: constrain setuptools to `<81` when creating the venv (`PIP_CONSTRAINT` env var pointing to a `setuptools<81` constraint file).
2. **Prefer pyobjc >=10.0 for wheel availability:** Pinning to exact versions like `pyobjc-framework-EventKit==10.3.1` forces pip to build from source (wheels may not exist for Python 3.14). Using `>=10.0` lets pip select the highest version with a prebuilt wheel, avoiding the setuptools issue entirely.

**pyobjc framework versions:**
- **Pattern:** Use `>=` constraints, not `==` pins
- **Example:** `pyobjc-framework-EventKit>=10.0`, NOT `pyobjc-framework-EventKit==10.3.1`
- **Rationale:** Exact pins force source builds when wheels don't exist. Loose constraints let pip pick prebuilt wheels, which are faster and sidestep the setuptools 81 issue.

**pnpm:**
- **Minimum:** 9.0.0
- **Rationale:** Workspace protocol handling (`workspace:*`) and peer-dep resolution improvements in 9.x

**Verification commands:**

```bash
node --version    # Should print v22.x.x or higher
python3 --version # Should print 3.10.x through 3.14.x
pnpm --version    # Should print 9.x.x or higher
```

If any version is too old, the relevant spawn step will fail with a clear error citing the requirement and the installed version.

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

```bash
cd <worktree-root>

# 1. Build clean (lockfile may need regen for new packages)
pnpm install --no-frozen-lockfile
pnpm -r build 2>&1 | tail -5
pnpm -r typecheck 2>&1 | tail -5
pnpm -r lint 2>&1 | tail -5

# 2. Cross-check file pattern (5-file for TS, 6-file for Python daemons)
grep -q "<node>" manifest.yaml && echo "manifest ✓"
grep -q "<node>Secret" shell/electron/main/services/secrets.ts && echo "secrets ✓"
grep -q "MESH_<NODE>_SECRET" shell/electron/main/services/coreManager.ts && echo "coreManager ✓"
grep -q "spawn<Node>\|<node>DaemonManager" shell/electron/main/services/*.ts && echo "spawn wiring ✓"
# Python daemons only: check for mesh.ts getter
grep -q "get<Node>MeshConfig" shell/electron/main/services/mesh.ts 2>/dev/null && echo "mesh.ts getter ✓"
grep -q "AETHER_<NODE>" .env.local.example 2>/dev/null && echo ".env.local.example ✓"  # if applicable

# 3. Schemas valid JSON
for f in nodes/<node>/schemas/*.json; do python3 -c "import json; json.load(open('$f'))"; done

# 4. Python only: syntax check
python3 -m py_compile nodes/<node>/main.py

# 5. Voice tool registration check (run shell in dev mode, watch raven logs)
# Expected log line on raven daemon startup:
#   "Created LiveConnectConfig with N function(s) across M tool group(s)"
# Verify N increased by the number of functions your voice tool added.
# Missing increase = tool file missing FUNCTIONS / get_tools() / handle_call_async()
pnpm dev  # Start shell, watch terminal for raven log line, Cmd-C to exit
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

## Corrections appendix — what changed in this refresh (Sprint 2, 2026-05-15)

This doc was originally written for PR #50 (first pattern codification) and shipped with gaps discovered during Sprint 2 (PRs #51–#56). This refresh (PR #59, docs/new-node-pattern-refresh lane) corrects those gaps. The original 5-file pattern remains accurate for TypeScript nodes; the additions below reflect lessons from Python daemon nodes (calendar, reminders) and voice tool wiring (raven-core integration).

**What changed:**

1. **File count differentiation (§ "The 5-file pattern")**: Split into two tables — TypeScript nodes remain 5-file, Python daemon-managed nodes are 6-file. The sixth file is the `mesh.ts` getter pattern, previously undocumented.

2. **New section: "Sixth file for Python daemon nodes"**: Explains the `get<Node>MeshConfig()` getter pattern in `shell/electron/main/services/mesh.ts`. This was implicit in existing code (raven, vision, calendar, reminders) but never codified. Missing this causes "mesh not available" errors despite Core being healthy — the daemon spawns before the mesh is ready.

3. **New section: "Voice tool Gemini declaration pattern"**: Fully documents the four-part pattern (FUNCTIONS list, get_tools(), handle_call_async(), private implementations) required for voice tools to register with Gemini. The original doc showed simple async functions; that's insufficient. PR #56 (voice tools for reminders + system_info) hit this; `calendar_tool.py` is now the canonical reference.

4. **Corrected MeshNode API (§ "TS node pattern" and § "Python node pattern")**: Changed from `MeshNode(surfaces={...})` constructor kwarg to `node.on("name", handler)` registration after construction. The `surfaces=` kwarg doesn't exist; using it causes "unknown kwarg" errors. Both TS and Python examples now show `.on()` registration plus the keep-alive loop (process exits without it).

5. **Corrected pyobjc class method usage (§ "Common §10 gotchas")**: Added explicit note that Objective-C class methods (those with `+` prefix in headers, like `EKEventStore.authorizationStatusForEntityType_`) must be called on the **class**, not an instance. Example: `EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)`, NOT `store.authorizationStatusForEntityType_(...)`. Instance methods (`-` prefix) ARE called on the instance.

6. **New section: "Environment requirements"**: Codifies Node 22+ requirement (yahoo-finance2 dep), Python 3.10–3.14 support, Python 3.14 + pyobjc compatibility caveats (setuptools <81 constraint for old pyobjc versions; prefer `>=10.0` for wheel availability), and pnpm 9+.

7. **Updated verification checklist (§ "Verification checklist")**: Added step #5 for voice tool registration check — raven logs should show "Created LiveConnectConfig with N function(s)" where N increases by the number of functions added. Also added Python-daemon-specific check for `mesh.ts` getter presence.

**References:**
- Original pattern doc: PR #50
- Calendar node (first full Python daemon example hitting all gaps): PR #51
- Voice tool corrections (reminders + system_info): PR #56
- Node 22+ requirement: PR #54 (system_info node), discovered via finance node slowness
- MeshNode .on() API: discovered in PR #51 (calendar hotfix, commit `8d2a9c3`)

If you read the doc end-to-end after this refresh, you should no longer need to cross-reference `nodes/calendar/` or chase down "why doesn't my voice tool show up" — the canonical patterns are now in one place.


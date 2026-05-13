# core/ — vendored RAVEN_MESH

This directory is a **literal copy** of the protocol layer from
`_ingest/RAVEN_MESH` pinned at SHA
[`464ee80911739019663589d75bd2d6f58a45afee`](https://github.com/coltonkirsten/RAVEN_MESH/commit/464ee80911739019663589d75bd2d6f58a45afee).

The `_ingest` submodule is read-only reference. This vendored copy is what
ships and what Core runs from. Do not edit files under
`core/{core,node_sdk,schemas}` in this repo — diffs against upstream are
managed by re-copying from the submodule in a dedicated chore PR.

## Layout

```
core/
├── core/                  RAVEN_MESH Core (the broker). Run as a module.
│   ├── core.py            main entrypoint (python3 -m core.core)
│   ├── config.py          TOML/env/CLI config loader
│   ├── manifest_validator.py
│   └── supervisor.py      (process supervisor — not wired up in v0.1.0)
├── node_sdk/              Python SDK for nodes implemented in Python.
├── schemas/               JSON Schemas: manifest.json + core.* surfaces.
├── mesh.toml.example      sample TOML config; we run with CLI flags only.
├── node_sdk_ts/           TypeScript SDK port (see node_sdk_ts/README.md).
└── README.md              this file.
```

## Running Core

The shell's daemon manager spawns Core automatically on boot. To run it
manually for debugging:

```bash
cd core
ADMIN_TOKEN=dev-admin-token-replace-me \
MESH_CORE_SECRET=$(openssl rand -hex 32) \
MESH_SHELL_SECRET=$(openssl rand -hex 32) \
MESH_HOST_NOTIFICATIONS_SECRET=$(openssl rand -hex 32) \
python3 -m core.core --manifest ../manifest.yaml
```

Healthcheck: `curl http://127.0.0.1:8000/v0/healthz`

## Python dependencies

Core itself needs:

- `aiohttp`
- `pyyaml`
- `jsonschema`

Install once globally or via a venv:

```bash
python3 -m pip install aiohttp pyyaml jsonschema
```

The `pip` deps for the full RAVEN_MESH test suite (`pydantic`, `croniter`,
`structlog`, `pytest`, `pytest-asyncio`) are not required to run Core — they
are only needed if you `cd _ingest/RAVEN_MESH && pytest`.

## Locating python3

The shell's coreManager resolves the Python interpreter at boot in this order:

1. `$MESH_PYTHON` (absolute path — escape hatch for non-standard installs)
2. `command -v python3` in a login shell (matches what `which python3`
   would return in a fresh Terminal session)
3. Known macOS install locations: `/opt/homebrew/bin/python3`,
   `/usr/local/bin/python3`,
   `/Library/Frameworks/Python.framework/Versions/Current/bin/python3`,
   `/usr/bin/python3`
4. Bare `python3` (relies on the spawned process's PATH; will ENOENT if
   PATH doesn't include a python3 — common on GUI-launched Electron apps).

If Core fails to spawn because the wrong Python is picked (e.g. Apple's
stub at `/usr/bin/python3` lacks aiohttp), set `MESH_PYTHON` to point at
the interpreter where you installed the deps:

```bash
MESH_PYTHON=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 \
  pnpm --filter homeos-shell dev
```

## Required environment variables

Core refuses to boot without these (see SPEC §5.1, §9):

| Variable | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | bearer for `/v0/admin/{stream,metrics}`. Must NOT be the legacy `admin-dev-token`. The shell sets a per-launch random value. |
| `MESH_CORE_SECRET` | identity secret for the reserved `core` node. |

Per-node identity secrets are resolved from `env:VAR_NAME` references in
`manifest.yaml` (SPEC §8). For homeOS week-1 those are:

| Variable | Node |
| --- | --- |
| `MESH_SHELL_SECRET` | `shell` (the Electron main process) |
| `MESH_HOST_NOTIFICATIONS_SECRET` | `host_notifications` (the demo node) |

The shell generates random hex-32 values for each at boot and exports them
into the spawned Core + node processes. They are not persisted across runs.
A future PR will move these into the system keychain
(`MASTER_SYNTHESIS.md §7 Q6`).

## Updating from upstream

1. Bump the submodule pin: `git -C _ingest/RAVEN_MESH fetch && git -C _ingest/RAVEN_MESH checkout <new-sha>`.
2. Re-copy the four trees + `mesh.toml.example`:
   ```bash
   rm -rf core/core core/node_sdk core/schemas core/mesh.toml.example
   cp -R _ingest/RAVEN_MESH/core core/core
   cp -R _ingest/RAVEN_MESH/node_sdk core/node_sdk
   cp -R _ingest/RAVEN_MESH/schemas core/schemas
   cp _ingest/RAVEN_MESH/mesh.toml.example core/mesh.toml.example
   ```
3. Update the SHA at the top of this file.
4. Re-run `pnpm --filter @homeos/mesh-node-sdk test` to verify the round-trip
   still passes with the new Core.
5. Land as a dedicated `chore(core): bump vendored RAVEN_MESH to <sha>` PR
   so the diff is reviewable in isolation.

# daemons/

Long-running, detached processes the Aether shell spawns on boot and
talks to over loopback HTTP/WebSocket. Each subdirectory is its own
process, supervised by the shell's daemon-manager. Daemons survive a
shell quit only when explicitly designed to — week-1 voice does not,
because audio devices belong to the user session.

This directory is a **sibling** to `shell/` and (eventually) `core/`,
not a child of either. Lifted from VIEWER's `apps/raven-daemon` +
`apps/raven` layout, then adapted for our top-down / mesh-asleep
strategy.

## Contents

### `raven-daemon/` — Node.js HTTP+WS supervisor

Provenance: copied from
`_ingest/VIEWER/apps/raven-daemon` at VIEWER SHA
`9c58664ec652c836595ac48e9f75d2439272657e`, then trimmed.

- `src/index.ts` — HTTP + WS server on `127.0.0.1:7433`. Listens
  only on loopback (NEXUS_AUDIT lesson: never bind to `0.0.0.0`
  for an unauthenticated route surface).
- `src/ravenManager.ts` — spawns and supervises the Python
  raven-core child, parses its NDJSON output into typed events.
- `src/types.ts` — shared types.

What was cut versus VIEWER's daemon:

- `MemoryManager`, `ToolManager`, `ConfigManager` — removed. The
  Aether shell does not yet have UI for managing notes, tool
  definitions, or daemon config; raven-core writes its memory
  store directly under `RAVEN_USER_DIR/memory.json`.
- VisualMode routes and audio-device routes — always `--mode none`,
  always system-default mic/speaker.
- The `bin/raven` CLI wrapper — the shell drives the daemon
  directly, no external CLI surface.
- The `uuid` npm dep — replaced with Node's built-in
  `crypto.randomUUID()`.

Endpoints exposed:

| Method | Path             | Purpose                                  |
|--------|------------------|------------------------------------------|
| GET    | `/health`        | liveness probe used by the shell's daemon-manager |
| GET    | `/status`        | current `RavenState` + last transcript + last tool call |
| POST   | `/listen/start`  | spawn the Python child (begin listening) |
| POST   | `/listen/stop`   | terminate the Python child               |
| GET    | `/transcripts?limit=N`  | recent transcript buffer (max 200) |
| GET    | `/tool-calls?limit=N`   | recent tool-call buffer (max 200)  |
| WS     | `/`              | subscribe to `status` / `transcripts` / `tool-calls` / `all` |

### `raven-core/` — Python voice runtime

Provenance: copied from `_ingest/VIEWER/apps/raven` at VIEWER SHA
`9c58664ec652c836595ac48e9f75d2439272657e`, then trimmed.

- `main.py` — entry point invoked by `raven-daemon` as a child
  process. Always passed `--mode none --json-output`.
- `raven_core/` — orchestrator, audio I/O, tool registry.
- `raven_core/tools/time_tool.py` + `raven_core/tools/memory_tool.py`
  — the only two tools currently registered. Others
  (`cerebras_tool`, `silence_tool`, `system_tool`) remain vendored
  but are commented out in `raven_core/tools/__init__.py` until
  the mesh-rebase PR.
- `raven_core/memory/store.py` — persistent JSON memory store. Writes
  to `RAVEN_USER_DIR/memory.json` (the shell's userData dir).
- `requirements.txt` — trimmed to what's needed for voice-only
  operation; `flask`, `flask-cors`, and `cerebras-cloud-sdk` were
  removed along with the dead `cerebra.py` HTML sidecar.

LLM: **Gemini 2.5 Live (`gemini-2.5-flash-native-audio-preview-09-2025`)**,
not Cerebras. See `DECISIONS.md` ADR "Voice via daemon pattern…"
for why this differs from the task brief.

## Lifecycle

```
shell start
  └── ravenDaemonManager.ensureRunning()
        ├── if daemons/raven-daemon/dist/index.js missing:
        │     npm install + tsc inside daemons/raven-daemon/
        ├── if daemons/raven-core/.venv missing:
        │     python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
        │     (one-time, ~30s on a clean install — see UX note below)
        ├── spawn node dist/index.js  (detached + unref)
        ├── poll GET /health until 200 (10s timeout)
        └── if healthy: shell renders voice as available
            if not:     shell stays usable, voice-control shows "offline"

shell quit (app.on('before-quit'))
  └── ravenDaemonManager.stop()
        └── SIGTERM daemon → daemon SIGTERMs Python → both exit
```

### First-boot UX

The first time the daemon-manager runs, both the Node deps and the
Python venv get installed. On a clean MacBook with a fast network
this is ~30s and the splash will hold for that long. Subsequent
launches reuse the on-disk artefacts and add a couple of seconds.

### Audio permission

The Python child opens the microphone via PyAudio on first
`POST /listen/start`. macOS will surface its system mic-permission
dialog the first time this happens; permission persists across
launches once granted. Until granted, the voice will stay in
"starting" indefinitely. There is no good way to surface this from
the Python side — best signal is to look for the system dialog.

## API keys

`GEMINI_API_KEY` must be exported in the shell's environment before
`pnpm dev`. The daemon-manager checks for it on every
`ensureRunning()` call and refuses to spawn the daemon if missing
(degraded mode: shell loads, voice-control shows red "voice: missing
GEMINI_API_KEY"). The shell does not crash.

## Gitignored under daemons/

- `raven-daemon/node_modules/`
- `raven-daemon/dist/`
- `raven-core/.venv/`
- `raven-core/__pycache__/` and `**/__pycache__/`

(See repo-root `.gitignore`.)

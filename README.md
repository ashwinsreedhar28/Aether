<p align="center">
  <img src="shell/assets/aether-icon.svg" width="128" height="128" alt="Aether icon" />
</p>

# Aether

**A voice-first personal-OS substrate.** A holographic Electron shell on top of a signed mesh, where voice is a first-class participant — and where the system has begun to help build itself, one human-gated step at a time.

[![CI](https://github.com/ashwinsreedhar28/Aether/actions/workflows/ci.yml/badge.svg)](https://github.com/ashwinsreedhar28/Aether/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/ashwinsreedhar28/Aether?label=release)](https://github.com/ashwinsreedhar28/Aether/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Built under the working name **homeOS** through v0.3.x; renamed to **Aether** with the v0.4.0 line. The GitHub repository still lives at `ashwinsreedhar28/Aether`; GitHub's auto-redirect keeps older `homeOS` clone URLs working.

## What this is

Aether is a personal operating environment — a single shell where the user's data, voice, agents, and eventually physical-world peripherals all live as **nodes on a common signed mesh**. Currently pre-1.0, macOS-only, single-developer.

Four things make it what it is today:

- **A signed mesh.** Every cross-system interaction — voice asking a node for data, the shell triggering a node action, one node composing several others — travels as an HMAC-signed envelope that a single `manifest.yaml` edge graph authorizes. Edge present = permitted; edge absent = denied. One source of truth for what may talk to what.
- **Voice as a first-class participant.** `raven` is a voice brain (a Python Gemini Live orchestrator under a supervised daemon) that is itself a mesh node. It doesn't sit beside the system — it reaches into it, invoking node surfaces over the same signed envelopes everything else uses.
- **A scene cockpit.** Ask "show me the mesh" (or the lanes, the gaps, your agenda) and a `visualizer` node reads live mesh state and composes it into panels on a local scene server — an arrangeable, restart-persistent cockpit you direct by voice.
- **A self-building loop — human-gated.** Aether notices its own missing capabilities (a *gap sensor* records them to a durable ledger), proposes concrete next builds when asked ("what should we build next"), and can draft a paste-ready lane prompt to disk. It **proposes only** — it never builds, spawns, or schedules. A human reads, approves, and ships. The loop is `gaps → proposals → drafts`, and the gate is always a person.

This repo is the **workspace half** — an Electron app on the developer's laptop. The eventual **home-substrate half** (an always-on box with peripherals as mesh nodes) shares the same codebase but deploys differently.

## Current state

Latest tagged release: **v0.9.4**. This branch prepares the **v0.10.0** cut — the *Architect* arc, where the self-building loop closed end-to-end.

The build to here, by the capabilities that lit up:

- **Mesh substrate alive** (`v0.1.0`): RAVEN_MESH Core runs as a managed daemon; HMAC-signed envelopes; edge-graph authorization; nodes spawn under a lifecycle-aware supervisor with clean SIGTERM teardown.
- **Voice arrives, then meets the mesh** (`v0.2.0`–`v0.2.1`): `raven-daemon` supervises a Python Gemini Live orchestrator; raven registers as a mesh node and routes `notify(...)` through `host_notifications.notify` via `mesh.invoke` — the first end-to-end voice ↔ mesh round-trip.
- **Real data over the mesh** (`v0.3.0`): the `news_feeds` node polls RSS into SQLite (WAL); a single `news_feeds.recent` surface feeds both the News app and the voice node — the first multi-consumer surface.
- **Composers / multi-hop mesh** (`v0.4.0`): the `digest` node fans out to upstream data nodes in parallel (`Promise.allSettled`, per-upstream timeouts) to synthesize morning/evening briefings — proving the mesh-as-a-graph property (every prior node was a leaf).
- **Identity inflection** (`v0.5.0`): renamed homeOS → Aether end to end (package scope `@aether/*`, bundle id `com.aether.app`, `window.aether` preload bridge, `AETHER_*` env vars), with a one-time idempotent userData migration that preserves prior state.
- **Voice extensibility** (`v0.6.0`): the voice-tool substrate matured into a declarative five-piece pattern (declaration → mesh-routed dispatch → session context → tool-call history → persisted transcripts); the cost to add a voice tool dropped from days to hours.
- **Substrate consolidation** (`v0.7.0`–`v0.8.0`): the `registerNode` factory became the canonical declarative shell-hook for spawning mesh nodes; ad-hoc per-node managers retired.
- **Data breadth — macOS surfaces** (`v0.9.x`): TypeScript daemon nodes capture local macOS data (`clipboard_history`, `macos_messages`, `macos_mail`, `calendar`, `reminders`, `system_info`), plus a shared `@aether/macos-applescript` bridge primitive with full TCC permission-denied detection.
- **The cockpit & the self-building loop** (`v0.10.0`, this release): the `visualizer` node + scene server give the mesh an arrangeable, restart-persistent cockpit (mesh / lanes / gaps / agenda overlays, inspectable edges, drag-to-reorder panels). The `intents` node turns a *gap sensor* into a durable, event-sourced ledger with `open`/`closed` lifecycle. raven gains `review_gaps` (propose next builds from the gap log) and `draft_lane` (write a house-format lane prompt to disk) — the first bricks of the Architect era. Mail learns to *open* the latest message via LaunchServices; the calendar answers "what's on my agenda" by voice and panel.

See [CHANGELOG.md](CHANGELOG.md) for the full version history and [docs/releases/v0.10.0.md](docs/releases/v0.10.0.md) for this release's narrative.

## Quickstart

**Prerequisites:** macOS 13+, Node 22+, pnpm 9.15+, Python 3.10+. A Gemini API key is needed **only for voice** — the shell boots fine without one.

```sh
git clone --recursive https://github.com/ashwinsreedhar28/Aether.git
cd Aether

# Optional: record per-machine overrides (weather location, python path, …).
# Voice needs GEMINI_API_KEY — add it here or export it in your shell.
cp .env.local.example .env.local
#   ... then add a line:  GEMINI_API_KEY=your-key-here

pnpm install        # fetch dependencies
pnpm -r build       # build every workspace package — REQUIRED, see note below

cd shell && pnpm dev   # launch the Electron shell
```

> **`pnpm install` alone is not enough.** The shell imports built workspace
> packages (the core SDKs, the mesh nodes). `pnpm install` fetches dependencies
> but does not build those packages — run `pnpm -r build` once so they exist on
> disk. (`pnpm dev` does rebuild the workspace deps via its `predev` hook, but a
> clean `pnpm -r build` is the honest full-stack build and surfaces cross-package
> type errors up front.)

First boot takes ~30s for the Python venv bootstrap; later boots are near-instant. `.env.local` is gitignored and auto-loaded from the repo root by both the shell and `raven-core`; see [.env.local.example](.env.local.example) for every recognised variable.

## Architecture

```
                          voice ───┐
                                   ▼
   ┌─────────────┐         ┌───────────────┐        ┌──────────────────┐
   │   Electron  │  IPC    │  raven-core   │ signed │   manifest.yaml  │
   │    shell    │◄───────►│ (Gemini Live) │ mesh   │   edge graph     │
   │ (holographic│         │  voice brain  │◄──────►│  (authorization) │
   │   theme)    │         └───────────────┘ invoke └────────┬─────────┘
   └──────┬──────┘                                           │ permits
          │ window.aether bridge                             ▼
          │                                  ┌───────────────────────────┐
          ▼                                  │   RAVEN_MESH Core (broker) │
   scene cockpit ◄── HTTP POST ── visualizer │  signed envelopes, SSE     │
   (panels: mesh /                  (Mixer)  └──────────────┬─────────────┘
    lanes / gaps /                                          │ dispatch
    agenda)                                                 ▼
                              ┌──────────── mesh nodes (one process each) ──────────────┐
                              │  news_feeds  finance  weather  digest(composer)         │
                              │  clipboard_history  macos_mail  macos_messages          │
                              │  calendar  reminders  system_info  time                 │
                              │  host_notifications  mesh_introspection  vision         │
                              │  lanes (agent sensor)   intents (gap ledger)            │
                              │  visualizer (scene Mixer)                               │
                              └─────────────────────────────────────────────────────────┘
```

Repo layout:

```
shell/                    Electron shell (holographic theme, app discovery)
├─ electron/main/         Process supervision, mesh + raven daemon managers
├─ electron/preload/      window.aether bridge (mesh, files, voice)
└─ src/apps/              Content apps (welcome, news, finance, markdown, voice, mesh-devtools)

core/                     Vendored RAVEN_MESH (Python broker + SDKs)
├─ core/                  Python broker (signed envelopes, SSE delivery)
├─ macos_applescript/     AppleScript bridge primitive (used by macOS daemon nodes)
├─ node_sdk/              Python SDK (used by raven-core)
├─ node_sdk_ts/           TypeScript SDK (used by shell + nodes)
└─ schemas/               Envelope + surface JSON Schemas

nodes/                    Mesh nodes (one process each) — 17 dirs, 19 manifest nodes
daemons/                  Detached supervised processes
├─ raven-daemon/          Node HTTP+WS supervisor (port 7433, loopback-only)
├─ raven-core/            Python Gemini Live orchestrator + ~20 voice tools
└─ raven-avp-server/      Vendored scene server (submodule; the cockpit surface)

manifest.yaml             Mesh topology: 19 nodes, 69 authorized edges
_ingest/                  Reference repos (submodules, read-only — never imported at runtime)
```

The mesh is the load-bearing primitive: there is no privileged back channel. Voice, shell, and composer nodes all reach each other only through signed envelopes the edge graph authorizes — so the manifest is the single, auditable answer to "what can talk to what."

## Governance

Aether is built collaboratively with Claude Code under an explicit **four-role model**, and the merge gate is constitutional — no code reaches `main` without a human pressing the button.

- **Director** (human, project owner) — sets vision, visually verifies, authorizes every merge and tag.
- **Architect** (LLM design session) — turns vision into PR-ready lane specs; reviews PRs.
- **Implementer** (Claude Code, one session per git worktree) — writes the code, opens the PR, self-reviews against a fixed template.
- **Merge gate** (Director) — clicks merge only after Architect signs off. Architect sign-off never auto-merges; the human does.

This isn't ceremony — it's the reason a single developer can move at this speed without the codebase drifting. See [CLAUDE.md](CLAUDE.md) for the full operating manual (branching, tagging, the self-review template, decision-recording, and accumulated gotchas) and [CONTRIBUTING.md](CONTRIBUTING.md) for how to engage from outside.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/](docs/README.md) | Documentation index — roadmaps, retrospectives, patterns, governance log |
| [CLAUDE.md](CLAUDE.md) | The operating manual (roles, branching, tagging, prompt discipline) |
| [MASTER_SYNTHESIS.md](MASTER_SYNTHESIS.md) | The architecture briefing that drove the rebuild |
| [DECISIONS.md](DECISIONS.md) | Append-only architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | Per-PR change history (Keep a Changelog) |
| [docs/releases/](docs/releases/v0.10.0.md) | Per-release narrative notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contribution, security, conduct |

## Project context

This repo synthesizes patterns from four earlier projects, vendored as `_ingest/*` submodules for reference (read-only; never imported at runtime):

- **Pulse** — Electron menu-bar app with multi-service engines (news, finance, …).
- **RAVEN_MESH** — the mesh broker, now the spine of Aether.
- **NEXUS** — agent-orchestration patterns and hard-won security lessons.
- **VIEWER** — modular desktop with daemon-supervised voice.

See [MASTER_SYNTHESIS.md](MASTER_SYNTHESIS.md) for the architectural map.

## Status

Pre-1.0, macOS-only, single-developer. Tags map to capability categories lighting up:

| Tag | Meaning |
|-----------|-----------------------------------------------|
| `v0.0.x`  | Shell, content apps, governance scaffolding   |
| `v0.1.0`  | Mesh substrate alive                          |
| `v0.2.0`–`v0.2.1` | Voice arrives, then meets the mesh    |
| `v0.3.0`  | Real data over the mesh                       |
| `v0.4.0`  | Composers / multi-hop mesh                    |
| `v0.5.0`  | Identity inflection (homeOS → Aether)         |
| `v0.6.0`  | Voice extensibility (5-piece tool pattern)    |
| `v0.7.0`–`v0.8.0` | Substrate consolidation (`registerNode` factory) |
| `v0.9.x`  | Data breadth (macOS surfaces) + process discipline |
| `v0.10.0` | The cockpit & the self-building loop (this release) |

## License

MIT — see [LICENSE](LICENSE).

---

Built with [Claude Code](https://claude.com/claude-code).

<p align="center">
  <img src="assets/icon/aether-icon-1024.png" width="160" alt="Aether icon" />
</p>

# Aether

**A voice-driven personal OS for the desktop.** A real window manager, a voice
brain that reaches into it, and a signed mesh underneath — built largely by the
system's own pipeline, with a human pressing every merge.

[![CI](https://github.com/ashwinsreedhar28/Aether/actions/workflows/ci.yml/badge.svg)](https://github.com/ashwinsreedhar28/Aether/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/ashwinsreedhar28/Aether?label=release)](https://github.com/ashwinsreedhar28/Aether/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Built under the working name **homeOS** through v0.3.x; renamed to **Aether**
> with the v0.4.0 line. The GitHub repository still lives at
> `ashwinsreedhar28/Aether`; GitHub's auto-redirect keeps older `homeOS` clone
> URLs working.

## What this is

Aether is a personal operating environment — one desktop where your windows,
your data, your voice, and the agents that help build the system itself all
meet on a common signed mesh. Currently pre-1.0, macOS-only, single-developer.

Four things make it what it is today:

- **A real window manager.** The shell is the absorbed Viewer renderer:
  workspaces ▸ windows ▸ tabs, drag/resize/tiling, a dock, a file explorer —
  and **24 apps** discovered through one registry (terminal, browser,
  markdown/text/JSON/PDF/LaTeX/image viewers, kanban, knowledge graph,
  calculator, audio player, sound designer, a Spotify now-playing Music app
  with playback controls, and Aether's own surfaces —
  Mesh, Lanes, Gaps — re-homed as ordinary apps). Its workspace store is the
  sole layout authority: every window a human or an agent opens lands in the
  same tree.
- **Voice as a first-class participant.** `raven` is the system's one
  assistant — a Python Gemini Live orchestrator (native-audio model, pinned)
  under a supervised daemon. You can talk over it (**barge-in**), it survives
  server-side session kills (**session resumption** + an in-process reconnect
  loop), and it acts through **64 voice functions across 25 tool modules**:
  reading your mail, messages, calendar, news, and finances; arranging
  windows; opening apps and views; playing Spotify by name, playlist, or
  "play that last song again"; filing capability gaps on the issue
  board; spawning approved implementer lanes. It drives the desktop over
  the same signed mesh envelopes everything else uses — no private back
  channel.
- **A signed mesh.** Every cross-system interaction travels as an HMAC-signed
  envelope that a single [`manifest.yaml`](manifest.yaml) edge graph
  authorizes — currently **21 nodes and 99 authorized edges**, each node
  classed as a **Sensor / Actor / Mixer / Planner**. Edge present = permitted;
  edge absent = denied. The manifest is the single, auditable answer to "what
  can talk to what."
- **A self-building loop — human-gated.** Aether files its own missing
  capabilities as issues on the GitHub gap board (voice-confirmed, deduped —
  repeat asks accrue as +1 comments), proposes concrete next builds when
  asked, and — on approval — staffs the work itself: a spoken "work on issue
  N" becomes a git worktree, a detached implementer session, and a reviewed
  PR. The loop runs `gaps → issues → draft specs → ratification → spawned
  lanes → gate reports → reviewed PRs → voice closeout`, and a human gates
  every spawn and presses every merge. As of v0.12.0 the loop has run closed
  end to end: a gap filed by voice came back as a machine-drafted spec, was
  ratified by a human, staffed itself, reported its gate to its own issue
  thread, took a spoken "clean, proceed," earned a reviewer verdict on its
  head commit, merged on the Director's button, and was torn down by voice.

This repo is the **workspace half** — an Electron app on the developer's
laptop. The eventual **home-substrate half** (an always-on box with physical
peripherals as mesh nodes) shares the same codebase but deploys differently.

## How it's built

This is Aether's most distinctive fact: the system is substantially built by
its own pipeline. Two humans (the Director and a collaborator) work with a
**Claude Architect** (a design session that turns vision into lane specs and
reviews every PR) and up to four parallel **Claude Code implementers** (one
per git worktree, writing the code and opening the PRs).

The process is law, not vibe:

- **Issue-is-contract.** No lane spawns without an ARCHITECT SPEC comment on
  its GitHub Issue; implementers start from the issue and nothing else; every
  PR closes its issue.
- **Every merge is human-pressed.** Architect sign-off never auto-merges.
  That is not a limitation of the system — it is the system.
- **The record is the memory.** Decisions land in append-only ADRs, lessons in
  a governance log, arcs in retrospectives — and a retrieval corpus over the
  project's own documents is how implementers find precedent.

The newest chapter: the pipeline now staffs itself. A capability gap noticed
in conversation **files itself as a GitHub issue** (deduped — a repeat ask
lands as a +1 comment on the existing issue); the **issue board is the only
work rail** — machine-filed gaps and human-filed lanes are the same kind of
object, and no lane starts until its issue carries an ARCHITECT SPEC; and
once one does, a spoken **"work on issue N" spawns the implementer lane** —
one approval card, then a git worktree, a detached Claude Code session, and
a PR that closes its issue. Since the v0.12.0 cut the loop is closed end to
end: lanes post their **gate reports to their own issue threads**, the
go-ahead is a spoken "clean, proceed," a **reviewer cell** verdicts every PR
against its ratified spec (one verdict per head commit, advisory by design),
and **closeout is a voice act** behind guarded teardown. Humans still gate
every spawn and press every merge.

[CLAUDE.md](CLAUDE.md) is the full operating manual — the contributor law on
roles, branching, self-review, and decision-recording — and
[CONTRIBUTING.md](CONTRIBUTING.md) covers engaging from outside. The most
recent arc retrospective ([docs/retros/2026-06-self-building-arc.md](docs/retros/2026-06-self-building-arc.md))
shows the spawn rail's shakedown cruise — nine defects to three concurrent
lanes in one day.

## Quickstart

**Prerequisites:** macOS 13+, Node 22+, pnpm 9.15+, Python 3.10+. A Gemini API
key is needed **only for voice** — the shell boots fine without one.

```sh
git clone --recursive https://github.com/ashwinsreedhar28/Aether.git
cd Aether

pnpm install        # fetch dependencies (postinstall repairs node-pty's exec bit)
pnpm -r build       # build every workspace package — REQUIRED, see note below

cd shell && pnpm dev   # launch the shell
```

> **`pnpm install` alone is not enough.** The shell imports built workspace
> packages (the core SDKs, the mesh nodes, the View contract). Run
> `pnpm -r build` once so they exist on disk. (`pnpm dev` does rebuild
> workspace deps via its `predev` hook, but a clean `pnpm -r build` is the
> honest full-stack build and surfaces cross-package type errors up front.)

Per-machine configuration lives in a gitignored `.env.local` at the repo root,
auto-loaded by both the shell and `raven-core`. Set variables by name — see
[.env.local.example](.env.local.example) for the authoritative annotated list:

```sh
GEMINI_API_KEY=<your-gemini-api-key>   # voice only — everything else runs without it
MESH_PYTHON=<path-to-python3>          # optional: skip the login-shell python3 lookup
MESH_CORE_URL=<core-url>               # optional: only when running a node by hand
HOMEOS_DATA_DIR=<writable-dir>         # optional: only when running a node by hand
AETHER_WEATHER_LAT=<latitude>          # optional: weather location override
AETHER_WEATHER_LON=<longitude>
AETHER_WEATHER_LABEL=<place-name>
AETHER_GITHUB_TOKEN=<fine-grained-PAT> # gap board only — lets Aether file/read issues (Issues RW)
AETHER_GITHUB_REPO=<owner/repo>        # optional: gap-board target repo override
```

First boot takes ~30s for the Python venv bootstrap; later boots are
near-instant. macOS will prompt for Calendar / Reminders / Automation access
the first time the relevant nodes spawn.

## Architecture

```
                you (voice · keyboard)
                  │             │
                  ▼             ▼
  ┌─────────────────────┐  ┌────────────────────────────────────────────┐
  │ raven — voice brain │  │ Electron shell — the Viewer                │
  │ Gemini Live, native │  │ workspaces ▸ windows ▸ tabs · 24 apps      │
  │ audio · barge-in ·  │  │ (terminal, browser, editors, kanban,       │
  │ session resumption  │  │  music, mesh, lanes, gaps, …)              │
  │ 64 fns / 25 modules │  │ hosts viewer_desktop (Actor): open_app,    │
  └──────────┬──────────┘  │ open_view, apply_layout, notify, …         │
             │             └─────────────────────┬──────────────────────┘
             │ mesh.invoke                       │ signed envelopes
             ▼                                   ▼
  ┌────────────────────────────────────────────────────┐
  │        RAVEN_MESH Core — the broker                │      authorized by
  │        HMAC-signed envelopes · SSE delivery        │◄──── manifest.yaml
  └──────────────────────────┬─────────────────────────┘      21 nodes · 99 edges
                             │ dispatch
                             ▼
  mesh nodes — one process each, classed Sensor / Actor / Mixer / Planner
  news_feeds · finance · weather · digest · clipboard_history · macos_mail
  macos_messages · calendar · reminders · system_info · time · vision
  host_notifications · mesh_introspection · lanes · github · music
```

The mesh is the load-bearing primitive: there is no privileged back channel.
When raven opens an app or tiles your windows, the request travels Core-signed
to the `viewer_desktop` node hosted in the shell, which translates it into
renderer control — and human interaction flows back to the opening agent as
`view_event`s. Agents and humans drive the same desktop through the same door.

Repo layout:

```
shell/                 The Viewer — Electron window manager + app registry (24 apps)
├─ electron/main/      Process supervision: mesh Core, node spawns, raven daemon
├─ electron/preload/   window.aether bridge (mesh, files, voice)
└─ src/apps/           The apps (terminal, browser, viewers, mesh, lanes, gaps, …)

viewer-core/           @viewer/core — the shared View contract (schema + renderers),
                       written once for the desktop shell now and a spatial shell later

core/                  Vendored RAVEN_MESH (Python broker + Python/TS SDKs + schemas)
nodes/                 Mesh nodes, one process each
daemons/
├─ raven-daemon/       Voice supervisor (HTTP+WS on 127.0.0.1:7433)
├─ raven-core/         Python Gemini Live orchestrator (64 voice functions)
└─ aether-rag/         Retrieval over Aether's own written record

manifest.yaml          The mesh topology: 21 nodes, 99 authorized edges
_ingest/               Reference repos (submodules, read-only — never imported at runtime)
```

The scene-server/dashboard stack from earlier releases is retired in place for
the **AVP track** (a future visionOS shell): the `visualizer` node and the
renderer-facing wire contract ([docs/scene-protocol.md](docs/scene-protocol.md))
are kept but no longer spawn on the desktop. The desktop's one layout authority
is the Viewer workspace store.

For the full visual map — process topology, the mesh node-by-node, the voice
pipeline, the data layer — open **the Atlas**:
[docs/atlas/architecture.html](docs/atlas/architecture.html) (a self-contained
living map, re-snapshotted at each release cut).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/](docs/README.md) | Documentation index — roadmaps, retrospectives, patterns, governance log |
| [CLAUDE.md](CLAUDE.md) | The operating manual — the contributor law (roles, branching, prompt discipline) |
| [docs/retros/2026-06-self-building-arc.md](docs/retros/2026-06-self-building-arc.md) | The self-building-arc retrospective — the spawn rail's shakedown cruise, the latest arc |
| [MASTER_SYNTHESIS.md](MASTER_SYNTHESIS.md) | The architecture briefing that drove the rebuild |
| [DECISIONS.md](DECISIONS.md) | Append-only architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | Per-PR change history (Keep a Changelog) |
| [docs/atlas/](docs/atlas/README.md) | The Atlas — living visual architecture map + frozen snapshots |
| [docs/scene-protocol.md](docs/scene-protocol.md) | Scene-server wire contract (AVP track) |
| [docs/releases/](docs/releases/v0.13.0.md) | Per-release narrative notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contribution, security, conduct |

## Lineage

Aether synthesizes patterns from four earlier projects, vendored as
`_ingest/*` submodules for reference (read-only; never imported at runtime):

- **Pulse** — Electron menu-bar app with multi-service engines (news, finance, …).
- **RAVEN_MESH** — the mesh broker, now the spine of Aether.
- **NEXUS** — agent-orchestration patterns and hard-won security lessons.
- **VIEWER** — the modular desktop whose renderer is now Aether's shell.

See [MASTER_SYNTHESIS.md](MASTER_SYNTHESIS.md) for the architectural map.

## Status

Pre-1.0, macOS-only, single-developer. Built in arcs; tags map to capability
categories lighting up:

| Tag | Meaning |
|-----------|-----------------------------------------------|
| `v0.0.x`  | Shell, content apps, governance scaffolding   |
| `v0.1.0`  | Mesh substrate alive                          |
| `v0.2.x`  | Voice arrives, then meets the mesh            |
| `v0.3.0`  | Real data over the mesh                       |
| `v0.4.0`  | Composers / multi-hop mesh                    |
| `v0.5.0`  | Identity inflection (homeOS → Aether)         |
| `v0.6.0`  | Voice extensibility (5-piece tool pattern)    |
| `v0.7.0`–`v0.8.0` | Substrate consolidation               |
| `v0.9.x`  | Data breadth (macOS surfaces) + process discipline |
| `v0.10.0` | The cockpit & the self-building loop          |
| `v0.11.0` | The Viewer merge & the self-staffing loop — one window manager, one assistant; gaps file as issues; lanes spawn by voice ([notes](docs/releases/v0.11.0.md)) |
| `v0.12.0` | **The closed loop** — gate reports on the issue thread, "clean, proceed" by voice, a reviewer cell on every PR, voice closeout; the record rolls from fragments ([notes](docs/releases/v0.12.0.md)) |
| `v0.13.0` | **The house takes requests** — the music vertical end to end by the pipeline (Spotify node with PKCE, voice + the Music app, playlists + controls under the apps-interactive ADR); READY TO TEST announces the gate ([notes](docs/releases/v0.13.0.md)) |

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## License

MIT — see [LICENSE](LICENSE).

---

Built with [Claude Code](https://claude.com/claude-code).

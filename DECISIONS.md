# Decisions

Append-only Architecture Decision Records. Format and rules per CLAUDE.md §8.
Never edit a past entry — supersede with a new one.

---

## [2026-05-12] Top-down build strategy in week 1

**Status:** accepted
**Decided by:** Architect (approved by Director)
**Context:** Two viable build orders for the homeOS skeleton:
*bottom-up* (vendor RAVEN_MESH first, write the TS SDK, manifest validator,
ship Core, only then build a renderer) or *top-down* (visible Electron shell
on Day 1, fake the backend, add real services behind the fakes incrementally).
Director attention is the project's binding constraint, not Claude Code
throughput — plumbing-first work gives nothing to react to for days and kills
momentum.
**Decision:** Top-down for week 1. Build the Electron shell first, fake the
backend, wake the mesh ("the spine") on Day 5+ once there are actually
multiple things to connect. The visible surface drives direction; direction
drives architecture.
**Consequences:**
- We deviate from `MASTER_SYNTHESIS.md §6`'s phase ordering for week 1.
  That ordering remains correct for a production push and we converge once
  the shell has multiple surfaces. This ADR records the divergence.
- `core/`, `manifest.yaml`, `nodes/` (per CLAUDE.md §4 target layout) stay
  unbuilt until earned.
- Acceptable risk: the eventual mesh-everywhere refactor will touch the
  shell's IPC surface. Mitigation: keep the renderer/main contract tiny
  (currently two channels — `shell:renderer-ready`, `shell:metadata`) so the
  refactor is mechanical.
**Alternatives considered:**
- *Bottom-up* — rejected for the attention-bottleneck reason above.
- *Parallel* (shell + Core in lockstep, two PRs/week) — rejected as too
  ambitious for a solo dev in week 1.

---

## [2026-05-12] Package manager: pnpm

**Status:** accepted
**Decided by:** Architect (codified in CLAUDE.md §10)
**Context:** Three viable choices — npm, yarn, pnpm. Pulse uses npm; VIEWER
uses pnpm; NEXUS uses npm.
**Decision:** pnpm. Activated via Node 20's built-in `corepack` (no global
install required); the `packageManager` field in `shell/package.json` pins
the version (`pnpm@9.15.0`).
**Consequences:**
- Faster installs, deterministic lockfile, easier monorepo evolution when
  `nodes/` and `core/` arrive.
- Contributors need `corepack enable` once. Documented in the PR's
  "Verification" notes.
**Alternatives considered:**
- *npm* — slower for monorepos and the lockfile churn is worse. Rejected.
- *yarn* — no advantage over pnpm for our shape. Rejected.

---

## [2026-05-12] Holographic theme adopted from VIEWER

**Status:** accepted
**Decided by:** Architect (specified in CLAUDE.md §11)
**Context:** The shell needs a coherent visual identity from Day 1
(CLAUDE.md §14: "the holographic theme is not decoration — it is the thing
Director will stare at while directing"). VIEWER already ships a fully
worked-out holographic palette (`#0a0a0f` background, `#4a9eff` accent,
`rgba(100,150,255,0.2)` borders, etc.) under MIT.
**Decision:** Adopt VIEWER's CSS-variable palette verbatim:
`--holo-bg`, `--holo-text`, `--holo-muted`, `--holo-accent`, `--holo-border`,
`--holo-panel`, `--holo-glow`, `--holo-accent-rgb`. The five required by
CLAUDE.md §11 plus the three that VIEWER's idioms reference together.
File: `shell/src/theme/holographic.css` carries the attribution comment.
**Consequences:**
- Apps lifted from VIEWER (per `MASTER_SYNTHESIS.md` §3.3 — `markdown-editor`,
  `terminal`, `kanban`, `agent-manager`, etc.) drop in without re-derivation.
- Brand cohesion across surfaces (tray icon dot, splash dot, welcome window
  accent all use `--holo-accent`).
- Acceptable risk: if homeOS later diverges visually from VIEWER, this ADR
  is superseded by a new one defining the homeOS palette.
**Alternatives considered:**
- *Derive a fresh palette from scratch* — rejected as week-1 over-investment;
  VIEWER's values are already polished.
- *Use Tailwind defaults only* — rejected; reads as "dev tool", not "Jarvis."

---

## [2026-05-12] Tray click behaviour deferred until background mode

**Status:** accepted
**Decided by:** Architect
**Context:** PR #1 ships a tray icon whose click handler currently re-opens
the welcome window. Because window-all-closed quits the app in week 1, a
tray click after window close is effectively startup.
**Decision:** Leave current behaviour as-is for v0.0.x. When a future PR
introduces "background mode" (app survives all windows closed), tray click
must change to focus-or-reopen-without-restart semantics rather than full
process restart.
**Consequences:** A small tray-handler refactor when background mode lands.
Flagged here so it's not forgotten.
**Alternatives considered:** Implementing background mode in this PR —
rejected as out of scope per CLAUDE.md §11 DON'T list.

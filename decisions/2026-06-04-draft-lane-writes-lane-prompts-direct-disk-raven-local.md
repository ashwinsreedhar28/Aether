## [2026-06-04] ADR: draft_lane writes lane prompts direct to disk (raven-local artifact, no mesh hop)

**Status:** accepted
**Decided by:** both (Architect specified the direct-write v0 in the lane brief; Director directed folding in the AETHER_DATA_DIR shell wiring)
**Context:** Architect rung 1 turns an accepted build proposal into a paste-ready,
house-format lane prompt. The data being written — a lane prompt the Director will
paste into an Implementer session — is a **raven-local artifact**, not shared mesh
state: nothing else in the system reads it, it carries no identity or audit weight,
and it is regenerated on demand. The two precedents pulled in opposite directions:
`report_gap`/`review_gaps` route through the mesh (`intents.record` / `intents.list`)
because gaps are durable, queryable, cross-surface data; the memory store
(`remember_note`) writes JSON straight to the raven user dir because notes are
raven-local. The lane brief named `$AETHER_DATA_DIR/architect/drafts/`, but the
shell's `ravenDaemonManager` historically handed raven-core only `RAVEN_USER_DIR`
(= `$userData/raven`), **not** `AETHER_DATA_DIR` (= `$userData/data`, set only for
mesh nodes) — so the brief's literal path would not have resolved.
**Decision:** `draft_lane` writes the composed prompt **directly to disk** — no mesh
hop, no `intents`-style surface, and therefore **no manifest edge and no manifest
change**. Drafts land at `<root>/architect/drafts/<slug>-<ts>.md`. To make the
brief's literal `$AETHER_DATA_DIR` path resolve, `ravenDaemonManager.ts` now passes
`AETHER_DATA_DIR: nodeDataDir()` into the raven daemon env — the **same shared
`$userData/data` root every mesh node already gets** — so the live Electron flow
writes to `$userData/data/architect/drafts/`, a sibling of the per-node data dirs.
The tool resolves its root by precedence `AETHER_DATA_DIR` → `RAVEN_USER_DIR`
(raven's private dir; fallback when the var is unset) → `~/.raven` (standalone CLI),
mirroring `raven_core/memory/store.py`'s resolution shape, so it still runs outside
the shell. The tool is SIDE-EFFECT: it returns only `{ ok, path }`; raven speaks one
line and never recites the prompt.
**Consequences:** Shipping the lane needs no manifest, no new node, and no
edge-graph review — but it does now touch one shell file (`ravenDaemonManager.ts`,
a single env line + import), so the workspace build/typecheck/lint gate applies. The
artifact lands in the shared `$userData/data` tree alongside per-node state, so a
future architect node or lanes-panel reader has an obvious, mesh-consistent home to
look — not raven's private dir. Because `AETHER_DATA_DIR` and `RAVEN_USER_DIR` are
distinct roots, the precedence is load-bearing: the tool deliberately prefers the
shared root and only falls back to raven-private when the shell isn't in the loop.
**Alternatives considered:** (a) Route through a new `architect`/`lanes` mesh surface
(`*.record`-style) like `report_gap` — rejected for v0: drafts aren't durable shared
state, and a surface + manifest edge + edge-graph review is overweight for a
regenerable local file. (b) Leave drafts under `RAVEN_USER_DIR` (raven's private dir)
and skip the shell change — rejected by the Director: these are Aether-wide Architect
artifacts, not raven memory, so they belong in the shared data tree; the one-line env
wiring is worth the small scope bump into the shell. (c) Inline
`path.join(app.getPath('userData'), 'data')` in the daemon manager instead of calling
`nodeDataDir()` — rejected: duplicates the canonical helper and would drift if the
node data root ever moves. (d) Hardcode `~/.raven` — rejected: ignores the shell's
per-app data dir and would scatter drafts outside `$userData`.

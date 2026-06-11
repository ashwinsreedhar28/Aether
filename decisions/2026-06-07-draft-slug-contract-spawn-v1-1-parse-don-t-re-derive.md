## [2026-06-07] ADR: the draft is the slug contract (spawn v1.1 — parse, don't re-derive)

**Status:** accepted; item (3)'s copy-only cleanup clause superseded by
[2026-06-11] "closeout is the spawn's mirror" (#317) — the shell may now
execute the teardown behind guards; items (1), (2), (4), (5) stand
**Decided by:** both (Architect specified the five v1.1 items in the lane brief; Director set the human-gated, no-auto-run cleanup posture)
**Context:** The rung-2 spawn actor (the ADR below) derived the branch and
worktree from `slugForName(draftName)` on both the shell side and the Python
`request_spawn` side, trusting the two `_slugify` implementations to agree. They
don't always: `request_spawn` records `draftName = _slugify(<spoken name>)`,
while the draft `draft_lane` wrote bakes `feat/<slug-of-the-lane-name>` into a
header line. When the spoken name and the lane name slug differently — the
observed `smart-home-control` → `smart-home` divergence (#194's evidence) — the
recipe builds a worktree the draft never names. Worse, a worktree is not always
derivable from the branch at all: this lane spawned into `~/aether-spawn11` on
`feat/spawn-v1.1`. Two adjacent honesty gaps surfaced alongside it: a fresh
worktree has no `aether-rag` venv/index, so every spawned session opened with a
red `/mcp` (the corpus the lane prompt tells it to query was unreachable); and a
daemon could spawn into a quitting shell and orphan (the pid=91597 log line).
**Decision:**
(1) **The draft is the contract.** `spawnService` parses the draft's own
`Branch:`/`Worktree:` header lines verbatim (`parseDraftTargets` — first
whitespace-delimited token after each label; `~`→`$HOME`; sanitized to a safe
git ref and a path under `$HOME` with no traversal) and uses them for the
recipe, the approval card, and `LANE.md`. Re-derivation (`feat/<slug>`,
`~/aether-<slug>` from the recorded name) is the documented FALLBACK, used only
when the lines are absent/unsafe. `draft_lane` carries a comment binding the
emitted line to the parser so the contract can't drift silently.
(2) **RAG bootstrap is best-effort, in-recipe, with a pinned interpreter.**
After `pnpm install`, the recipe builds the worktree's `daemons/aether-rag`
venv, installs requirements, and reindexes. The venv is created from an
interpreter chosen by capability-probe (extension-capable `sqlite3`), in
priority order: the repo's own working venv interpreter (symlink-resolved),
Homebrew's python3, then bare `python3` — because macOS system python3's
`sqlite3` cannot load `sqlite-vec` and a venv inherits its creator's sqlite
build (governance-log 2026-06-07). Success → the spawned session's `/mcp` is
warm from birth. Failure (including "no extension-capable python") records
`rag_bootstrap:"failed"` (+ failing step) on the `spawned` ledger event and the
card, and the spawn STILL launches — RAG arms the session, it does not gate it.
(3) **Cleanup is ledger-driven and copy-only.** Mark-complete surfaces the exact
teardown block built from the RECORDED worktree/branch — `submodule deinit`
before `worktree remove`, then `branch -D`, then restore main's submodules (the
§13.12 global-deinit gotcha). A Copy button, no auto-run in v1.1: destroying a
worktree is the Director's keystroke.
(4) **The window is decoupled from lifecycle.** Every card can be minimized (no
ledger change) and reopened from the Spawns strip; Mark-complete is strictly a
lifecycle action, no longer the only way to dismiss the window.
(5) **Spawns abort into a quitting app.** A shared `appLifecycle.isQuitting()`
latch (set first thing on every shutdown path) makes the raven + node daemon
managers refuse to spawn once teardown has begun; at boot the raven manager
reaps a pid-file daemon that is alive but not ours (an orphan from a prior
session) before binding a fresh one — gated on a command-line identity match
(`ps`), not bare `kill -0` liveness, because pids recycle.
**Consequences:** Refines — does not supersede — the spawn-actor ADR below; the
ledger, two-gate authorisation, and §13.12 recipe shape are unchanged. The
ledger gains a `rag_bootstrap`/`rag_step` field on the `spawned` event and a
`cleanup`/RAG view field (additive; old records fold fine). Approve is now
slower (a cold `aether-rag` venv + model download + index runs inline) — a
deliberate trade for a warm `/mcp`. The pure helpers (`parseDraftTargets`,
`targetsForDraft`, `cleanupBlock`) live in `spawnLedger.ts` and are unit-tested.
Still macOS-only; still no manifest/edge/prompts changes (a raven-local
artifact, not mesh data).
**Alternatives considered:** (a) Unify the two `_slugify` rules and keep
re-deriving — rejected: the worktree is genuinely not derivable from the branch
(this lane), and any shared rule re-breaks the moment a hand-written draft sets
them independently; parsing the artifact the recipe already consumes is the
robust fix. (b) Run RAG bootstrap as a blocking, spawn-failing step — rejected:
an offline model download or pip stumble must not deny the Director a worktree;
best-effort with an honest card line is the right posture. (c) Auto-run the
cleanup on Mark-complete — rejected: irreversible filesystem mutation behind one
click violates the §11.4 capture-before-mutate posture; copy-and-run keeps the
Director in the loop. (d) Track minimize state in the ledger — rejected: window
visibility is renderer UI state, not durable lifecycle truth; it lives in a
Zustand store the card and strip share. (e) Read `app.isQuitting` from Electron
— rejected: not a stable public API and blind to the raw-signal shutdown path;
a one-way latch set explicitly on every quit path is unambiguous.

## [2026-06-07] ADR: the spawn actor — voice-armed, card-gated self-build (passphrase-in-env + append-only ledger)

**Status:** accepted
**Decided by:** both (Architect specified the rung-2 design in the lane brief; Director set the human-gate and passphrase-in-env shape)
**Context:** Rung 1 (`draft_lane`) turned an accepted proposal into a paste-ready
lane prompt on disk. Rung 2 closes the loop: Aether spawns its own Implementer —
worktree, install, a Terminal running Claude Code against the draft. The whole
point is that the system can build itself, so the gating must be *load-bearing and
explicit*, not incidental. Three sub-decisions needed records: (1) where the spawn
request lives and how it is written, (2) how the spawn is armed/authorised, and
(3) how the recipe is structured. Merge authority (CLAUDE.md §1) is the bright line
this lane must not cross — spawning an Implementer is not merging its work.
**Decision:**
(1) **Append-only ledger, raven-side write.** The `request_spawn` tool appends a
`{id, ts, draft_path, draft_name, status:"requested"}` line **directly** to
`$AETHER_DATA_DIR/spawns/requests.jsonl` (open `O_APPEND` + `fsync`), then the
shell appends lifecycle events (`spawned`/`closed`/`dismissed`/`failed`) to the
same file. State is the forward fold of the log; lines are never rewritten —
mirroring `nodes/intents/src/storage.ts`. Like `draft_lane` this is a raven-local
artifact, **not** mesh state: no mesh hop, no surface, **no manifest edge, no
manifest change** (the same rationale as the 2026-06-04 draft_lane ADR — drafts and
spawn requests are regenerable local files, not durable shared mesh data). The shell
resolves the same `$userData/data` root it hands every node, so the two halves agree
on the path.
(2) **Human-gated by construction, two gates.** Gate one: a **spoken passphrase**
checked **constant-time** (`hmac.compare_digest`) against `AETHER_SPAWN_PHRASE`,
sourced from `.env.local` → `process.env` and passed explicitly through
`ravenDaemonManager` (visible at the spawn site, like `AETHER_DATA_DIR`; empty when
unset → refuse). A wrong/absent phrase refuses with **no detail** and the phrase is
**never** spoken back. The phrase is scrubbed to `[REDACTED]` from persisted
transcripts (and the live ring) at the transcript-store chokepoint, so it cannot be
recovered from the eventual RAG corpus. Gate two: the tool only **records a
request**; the shell raises an **approval card** and nothing spawns until the
Director presses Approve. Concurrency is capped at one live spawn. Closing the
spawned Terminal is the kill switch. **Merge authority is untouched** — the actor
spawns work, it never merges it.
(3) **Codified §13.12 recipe, repo-agnostic.** Approve runs `git fetch` →
`worktree add ~/aether-<slug> -b feat/<slug> origin/main` → `submodule update` →
copy `.env.local` → `pnpm install` → write the draft as `LANE.md` → launch a
visible Terminal.app (osascript) running `claude --dangerously-skip-permissions`.
The repo root is a **parameter** (`SpawnService` config); this repo is the single
registered value for v0. Steps run through the user's login shell (`$SHELL -lic`)
so the GUI-launched Electron PATH finds `git`/`pnpm`; the Terminal session is itself
a login shell so `claude` resolves there.
**Consequences:** No manifest, node, or edge-graph review — but the lane touches
shell files (`SpawnService`, `index.ts`, `preload`, `ravenDaemonManager`,
`paths.ts`, renderer card + strip) and the raven daemon (transcript redaction), so
the workspace build/typecheck/lint gate applies. `AETHER_SPAWN_PHRASE` becomes a
required secret for the feature (absent → the tool simply refuses; the rest of the
shell is unaffected). The passphrase lives in `.env.local`/env, **not** the OS
keychain — acceptable for a single-user v0, but a future hardening lane should move
it to the secret-store tier of the three-tier auth pattern (CLAUDE.md §12.1). The
recipe leaves the worktree + branch on disk after a spawn (cleanup is the Director's
per §13.12 teardown); re-spawning the same slug fails at `worktree add` and surfaces
on the card. macOS-only (Terminal.app + osascript), guarded with a clear failure.
**Alternatives considered:** (a) Route the request through a mesh surface
(`*.record`-style) like `report_gap` — rejected for the same reason as draft_lane:
a regenerable local file doesn't warrant a surface + edge + edge-graph review. (b)
Auto-spawn on a correct passphrase without the card — rejected: the card is the
second, human gate; collapsing to one gate makes a single leaked phrase sufficient
to spawn. (c) Keep the passphrase in the macOS keychain now — deferred: correct
end-state (§12.1) but overweight for a single-user v0; the env path ships the loop
today and the ADR flags the migration. (d) Run recipe steps via `execFile` with the
bare PATH — rejected: a GUI-launched Electron PATH lacks `pnpm`; the login-shell
strategy is the proven `ravenDaemonManager` pattern. (e) Redact the passphrase only
at persist — rejected: the live in-memory ring would still serve it to a
mid-session `getTranscripts`, so redaction is applied at the single
`recordTranscript` chokepoint (and defensively at persist).

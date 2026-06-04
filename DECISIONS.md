# Decisions

Append-only Architecture Decision Records for Aether (working name
homeOS through v0.3.x). Format and rules per CLAUDE.md §8.
Never edit a past entry — supersede with a new one. Entries dated
before the rename PR refer to the project by its working name; they
are preserved verbatim as historical record.

---

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

---

## [2026-06-04] ADR: mail lane headline pivots from "read body aloud" to "pull the email up" (open_message actor)

**Status:** accepted (amends the 2026-06-03 "full-vertical" and "latency-hardened
capture" ADRs below — the body-capture machinery they describe stays, but it is
no longer the headline deliverable)
**Decided by:** both (Architect-authorized direction change, §14.1; Director relayed)
**Context:** The body-capture path is correct but unverifiable while Mail.app's
AppleScript interface is degraded (even a 6-event bulk header timed out at 30s
after a restart). Reading a full body aloud is also poor voice UX. Meanwhile,
opening a message in Mail.app via the `message://<rfc-message-id>` URL through
**LaunchServices** (`open` CLI) is a *different code path* from AppleScript and
stays responsive — measured 0.06s the same night AppleScript reads were timing
out at 30–120s. The stored `uid` is already the RFC Message-ID (Mail's `message
id` property), exactly what the `message:` scheme matches, so no new id capture
is needed.
**Decision:** Pivot the lane's headline from "read the body aloud" to "pull the
email up."
1. New **actor surface `macos_mail.open_message {id}`** opens the message via
   `open "message://%3c<id>%3e"` (LaunchServices, deliberately NOT AppleScript).
   `manifest.yaml` declares the surface and the `raven → macos_mail.open_message`
   edge (scope amendment authorized — the original lane said "NO manifest").
2. `mail_tool.mail_open_latest()` + the voice prompt route "read / show / open /
   pull up my latest email" to: speak **ONE line** (sender + subject, plus a
   short gist only if a body was captured) **and** open the message. Full bodies
   are never narrated.
3. **Body capture stays in the node, explicitly non-blocking** — it backfills
   when Mail recovers and feeds the optional one-line gist and future summaries;
   the `mail_meta` diagnostic is unchanged.
**Consequences:** The lane's primary capability is now verifiable independent of
Mail's AppleScript latency (the open path was verified live: `open` exit 0, Mail
frontmost, 0.06s). macos_mail gains an actor surface (the node is now sensor +
actor; category stays Sensor as its primary role). "Read my latest email" no
longer narrates content — it surfaces a one-liner and brings the message up,
which is also better voice UX. Body capture's value shifts from "read aloud" to
"gist + future summaries," so its current `bodies=0` (Mail degraded) no longer
blocks the headline.
**Alternatives considered:** (a) Keep waiting for Mail's AppleScript to recover to
verify read-aloud — rejected: open-via-LaunchServices is both more robust and
better UX. (b) Narrate the body on open — rejected by the Architect: one line +
pull-up, never a wall of spoken body. (c) Drop body capture entirely now that we
don't read it aloud — rejected: it's non-blocking and feeds gists/summaries; kept.

---

## [2026-06-03] ADR: macos_mail capture is latency-hardened — bulk-read headers, bounded one-per-tick bodies, DB observability

**Status:** accepted
**Decided by:** both (Director directed the debug + per-message/retry-cap/visibility shape; Architect/Director to ratify the specifics surfaced from measurement)
**Context:** The root constraint is **Mail.app's highly variable Apple-Event
latency** — measured sub-second when idle but 30–120s for a *single* property
read when Mail is busy syncing/indexing a large (~5 GB) store. (osascript itself
and other apps stay sub-second; isolated to Mail.) Two failures flowed from
mis-modelling this. (1) The first body implementation read `content of msg` for
all 20 messages inside the header poll; at ~31–45s/message it blew the 30s bridge
timeout and captured nothing, silently. I initially mis-attributed the cost to a
fixed "~28s per-invocation content overhead." (2) The redesign moved bodies out
but kept the original **per-message header loop** (~100 Apple Events: 20 messages
× 5 properties). Under a Mail-latency burst that loop itself timed out at 30s, so
the tick returned before arming and the body phase never even ran — observed live
as a silent `47|0|0` (47 stale rows, 0 bodies, 0 attempts). Both are the
graceful-degrade-masks-systemic-breakage class banked in `docs/governance-log.md`.
**Decision:** Three coupled choices.
1. **Bulk-read the header poll.** Read each property of the whole range in one
   Apple Event (`message id of messages 1 thru 20 of inbox`, then `subject of …`,
   etc.) — ~6 events instead of ~100 — so the poll survives moderate Mail latency
   rather than timing out. Properties are read directly on the range, not via an
   intermediate `set msgList to …` (which hands back message-id-keyed references
   that fail `-1728`); `«class isot»` date coercion runs in a local, event-free
   loop inside the `tell`.
2. **Bounded one-per-tick bodies.** A separate pass fetches **one** `content`
   body per tick (50s budget) for the newest message in a 3-message window
   (`BODY_WINDOW`) still lacking one — newest first, so "read me my latest email"
   fills on the first backfill tick and the window fills over ~3 ticks. A
   per-message `body_attempts` counter (SQLite v3) writes a message off after 3
   failed/empty fetches. One call per message isolates a slow/unreadable message
   from its siblings (the Director's goal), achieved across ticks.
3. **DB-visible observability.** A `mail_meta(key,value)` table records
   `last_header_status`, `last_body_status`, `body_fetch_failures`, last error,
   and timestamps each tick — because the node's stdout is invisible in the
   running shell, so the failure counter alone "a signal nobody can see isn't a
   signal." `last_header_status = timeout` now names a stalled poll at a glance.
**Consequences:** Capture is robust through moderate Mail slowness and degrades
*visibly* (not silently) during severe bursts, self-recovering when Mail responds.
Only the newest ~3 messages carry bodies — enough for "read my latest" + digest;
full-inbox body mirroring stays **foreclosed** at this latency. Five separate
range reads in the header poll admit a sub-millisecond misalignment if mail
arrives mid-poll (one row's fields paired wrong); tolerated by the per-row try and
self-corrected next poll. Establishes the rule: **any Mail AppleScript must
minimise Apple-Event count (bulk reads, never per-element loops) and treat Mail
latency as adversarial** — never batch unbounded `content` reads into a timed
bridge call, and surface poll health where it can be seen.
**Alternatives considered:** (a) Keep the per-message header loop and just raise
the timeout — rejected: 100 events × a latency spike is unbounded; bulk reads fix
the cause. (b) Batch top-3 bodies in one call (~40s when Mail is moderate) —
rejected as default: a single slow message times out the whole batch and loses
all three, the fault-coupling the per-message design avoids. (c) Read Mail's
`Envelope Index` SQLite + `.emlx` files directly (bypass AppleScript entirely,
fast) — deferred as a large redesign; banked as the real long-term fix with an
explicit trigger: **pick this up if Mail.app is still AppleScript-degraded after
~48h of normal use** (i.e. the slowness is chronic on this machine, not the
anomalous burst seen the night this lane shipped — the node captured 47 header
rows via the heavier old path earlier, so Mail normally answers AppleScript
here). (d) On-demand body fetch at the `recent` surface — deferred:
adds latency to the voice call and couples the surface to a running Mail.app.

---

## [2026-06-03] ADR: mail-body lane expanded to a full vertical (node + tool + prompt)

**Status:** accepted
**Decided by:** both (Director authorized in chat; §14.1 intentional direction change)
**Context:** The mail-body lane was scoped node-only — "`nodes/macos_mail` + its
schema + README + CHANGELOG. NO prompts.json (the richer result needs no prompt
change), NO manifest." Pre-flight reads contradicted that premise on three
points: (1) `prompts.json` hardcodes a worked example telling RAVEN that "read
me my latest email" is a capability gap → `report_gap`, and Gemini Live's
`system_instruction` is fixed at connect, so the gap would still be logged no
matter what the node returns (fails smoke #1 and #3); (2) `mail_tool.py` builds
its `spoken` field from sender + subject only, so a body added to the node
payload would never be read aloud; (3) `mail_tool.py` already sends
`unread_only`, which the surface schema (`additionalProperties: false`,
`limit`/`since` only) rejects — Core validates payloads strictly
(`core/core/core.py`), so `mail_recent` was returning `denied_schema_invalid`
for every call (smoke #2 was already broken). A node-only change therefore could
not meet the lane's own GOAL or smoke tests.
**Decision:** Expand the lane to the full mail vertical with Director approval:
node body capture (schema v2) **plus** `daemons/raven-core/raven_core/tools/mail_tool.py`
(surface the body; speak it on a single-message read) **plus**
`daemons/raven-core/raven_core/prompts/prompts.json` (rewrite the email worked
example into the now-working read-aloud flow). The freed `report_gap` worked
example is **replaced**, not deleted, with a still-true gap ("dim the lights" /
no home-control surface) so the prompt keeps a valid worked example. The
`unread_only` schema mismatch is fixed in-scope as a drive-by (own CHANGELOG
line) since the lane was already editing the schema and node. `manifest.yaml`
was left untouched per the original scope; its prose `description` now slightly
under-describes the surface (omits body) — flagged for a follow-up.
**Consequences:** "Reading the latest email aloud" works end-to-end and the gap
sensor's first capture is closed. Future mail-surface lanes touch a known
three-tier path (node → `mail_tool.py` → `prompts.json`), not just the node.
The voice prompt is now coupled to the mail tool's single-message `spoken`
contract (`limit: 1` ⇒ body in `spoken`). Establishes precedent: a lane scoped
to a node may need to reach into the raven-core tool + prompt tier to actually
land a user-visible capability; the gap-sensor → close-the-gap loop is inherently
cross-tier. `manifest.yaml` description drift is now outstanding.
**Alternatives considered:** (a) Ship node-only and defer the tool+prompt wiring
to a follow-up lane — rejected because the PR would not close the gap it claims
to, and the gap sensor would keep re-recording the same capture (smoke #3 would
fail), making the lane misleading. (b) Pause and have the Architect re-spec —
viable but slower; the Director chose to expand in-flight with the deviation
documented here. (c) Delete the email `report_gap` example outright — rejected
per Director rider (a): it would strip a worked example and risk the model
generalizing report_gap poorly; replacing it with a still-true gap preserves the
teaching value.

---

## [2026-05-20] ADR: `pnpm -r build` before typecheck for SDK-shape workspace package auto-discovery

**Status:** Accepted (enacted 2026-05-19 — `.github/workflows/ci.yml` and `shell/package.json` updated; see CHANGELOG entry)

**Decided by:** Architect + Director (Sprint 4 governance batch 4)

**Context:** Sprint 4 Wave 2 introduced `@aether/macos-applescript` as
the second SDK-shape workspace package (after `@aether/mesh-node-sdk`).
SDK-shape packages are consumed by other workspace packages for their
TypeScript types. CI's `pnpm -r typecheck` step requires consumer
packages' types to be resolvable, which requires the SDK packages'
`dist/*.d.ts` files to exist when typecheck runs.

The current `.github/workflows/ci.yml` has a hardcoded `pnpm --filter`
pre-build step listing exactly two packages (`@aether/mesh-node-sdk`,
`@aether/host-notifications`). Adding `@aether/macos-applescript` in
PR #75 missed this list; CI failed with `Cannot find module
'@aether/macos-applescript' or its corresponding type declarations`.
Fixed by adding a third `pnpm --filter` entry, but the underlying
maintenance trap remains: every new SDK-shape package adds a line to
this hardcoded list.

**Decision:** Replace the hardcoded `pnpm --filter` chain in the
ci.yml pre-build step with `pnpm -r build`. This builds every
workspace package in topological order before typecheck runs,
auto-discovering new SDK-shape packages without further workflow edits.

**Consequences:**

- All workspace packages build in CI before typecheck. Eliminates the
  "forgot to add to pre-build list" class of bugs for SDK-shape
  packages.
- Slightly slower CI (~10-20s for the additional builds of
  daemon-node packages that were previously built ad-hoc or not at all).
  Trade considered acceptable: maintenance burden is the higher cost.
- `shell/package.json`'s `prebuild` filter and
  `shell/electron/main/services/staleSpawns.ts` cleanup list remain
  hand-curated. Separate decisions pending; both have lower failure
  impact than the CI pre-build (shell prebuild only affects
  electron-vite-time package readiness; staleSpawns only affects
  hard-crash recovery hygiene).
- Future workspace packages with side-effects in their build scripts
  could affect CI timing or correctness. Audit before adopting.

**Alternatives considered:**

- **Status quo (hardcoded list, document maintenance contract).** The
  list has been forgotten three times in one sprint despite the
  contract being implicit. Cost: ongoing CI failures + reactive fixes.
- **Tag SDK-shape packages with a custom `"sdk": true` flag in
  `package.json`** and use a custom script that builds tagged packages.
  Requires custom tooling; not standard pnpm. Rejected.
- **Use TypeScript project references** (`tsconfig.json` `references`
  field) so consumer packages reference source-level types. Standard
  TS pattern for monorepos. More invasive; affects all consumer
  tsconfigs. Reconsidered in a future ADR if `pnpm -r build` proves
  insufficient.

**Implementation:** Deferred to a follow-up PR (the workflow change
itself is one line; not in scope for this governance lane).

## [2026-05-19] ADR: AppleScript bridge primitive (`core/macos_applescript`)

**Status:** Accepted

**Context:** Sprint 4 Wave 2 introduced three macOS data nodes (clipboard, messages, mail). Mail — and future Reminders / Notes / Calendar.app surfaces — need AppleScript automation to bridge between Aether's Node.js daemons and macOS apps that don't expose direct file access. Each consumer inventing its own `osascript` wrapper would yield N inconsistent implementations of the same primitive, with N variations on TCC permission-denied detection.

**Decision:** Introduce `core/macos_applescript/` as a shared workspace package (`@aether/macos-applescript`) exporting a single `runAppleScript(script, options)` function. The bridge:
- Spawns `osascript -e <script>` via `child_process.execFile`.
- Returns a discriminated union `{ ok: true, output } | { ok: false, error, message }`.
- Classifies common failure modes: `permission_denied` (matches both `(-1743)` and the macOS 13+ "not authorized to send Apple events" form), `timeout` (exec killed by SIGTERM after the timeout option fires), `syntax` (osascript syntax error), `unknown` (other non-zero exit).
- Defaults to 30s timeout per invocation.
- Never throws on script-level failure; callers branch on `result.ok`.

**Consequences:**
- Future Reminders / Notes / Calendar.app daemons import `@aether/macos-applescript` rather than respawning osascript directly.
- TCC permission handling is uniform across all consumers — debounced log on denial, daemon stays up gracefully.
- Adds `core/macos_applescript` as a workspace member. `pnpm-workspace.yaml` updated from `'core/node_sdk_ts'` to `'core/*'` to admit future sibling core packages without further edits.
- AppleScript output format stays caller-defined (TSV in Mail's case); the bridge is content-agnostic.

**Supersedes:** none.
**Superseded by:** none.

## [2026-05-19] Sprint 4 process discipline codified

**Status:** accepted
**Decided by:** Architect, approved by Director
**Context:** Sprint 4 (PRs #64–#67) surfaced recurring friction patterns: read-phase stalls during hostile-API windows, wrong-scoped lanes from missing pre-flight greps, choke-file context drag from DECISIONS.md and CHANGELOG.md, verify-clean stalls between build verification and PR opening, and fragile state preservation across time gaps. Each was diagnosed in-the-moment but the lessons lived in chat history and ad-hoc prompt edits — every new lane re-derived the discipline rather than inheriting it. With Sprint 4 closing, the cost of codification was now below the cost of re-derivation.
**Decision:** Codify the discipline into a single source of truth:
- `CLAUDE.md` §13 (Implementer Prompt Discipline) — 12-point operations contract covering lane-type tagging, mandatory pre-flight reads, large-file caution, pre-staging policy, lane scoping, parallelism, stall protocol, hoisting language, session-end checkpoints, subagent delegation, verify-then-ship sequencing, and one-issue-per-lane.
- `docs/implementer-prompt-template.md` — canonical prompt skeleton with rules of use.
- `docs/governance-log.md` — prose rationale appendix recording the friction patterns and their structural fixes.
- `.claude/agents/aether-{implementer,explorer,reviewer}.md` — subagent split. Read phase delegated to Haiku (`explorer`); build to Opus (`implementer`); pre-PR review to Sonnet (`reviewer`).
- `.claude/skills/verify-build/SKILL.md` + `.claude/skills/ship-it/SKILL.md` — two-phase ship with explicit Director confirmation gate between them.
- `.github/ISSUE_TEMPLATE/lane.yml` + `.github/PULL_REQUEST_TEMPLATE.md` — one issue per lane; PR body closes the issue and surfaces backlog in GitHub instead of chat history.
**Consequences:** All Sprint 4 Wave 2+ lanes use the new template, subagents, and skills. Architect drafts every Implementer prompt against the template; pre-flight grep is mandatory. Backlog moves out of chat history and `_session_state.md` into GitHub Issues. The new PR-body format introduced in `.github/PULL_REQUEST_TEMPLATE.md` (Summary / Changes / Verification / Notes) is structurally simpler than the §7 long-form (What changed / Why / How / Risks / Out-of-scope / Pre-PR heuristics / Verification / Open questions); a follow-up lane must reconcile §7 with the new template or formalize the difference (e.g. long form for PR description, short form for `gh pr create` body). One-time cost: this lane lands ~12 new/modified files. Recurring benefit: every subsequent lane gets faster and more reliable.
**Alternatives considered:**
- *Keep ad-hoc discipline in chat memory and on-the-fly prompt edits.* Rejected — Sprint 4 showed that the same friction patterns recurred across multiple lanes, and the cost of re-deriving the discipline each session exceeded the cost of codification.
- *Single Opus subagent for everything (read + write + review).* Rejected — read-phase context bloat is structural; isolating reads into Haiku-on-`explorer` and review into Sonnet-on-`reviewer` lets each subagent's main context stay small and lets the Implementer's context stay focused on the write plan. Also costs less per lane on routine reads.
- *Combine `verify-build` and `ship-it` into a single skill.* Rejected — the verify-clean stall pattern in Sprint 4 was caused by the absence of a Director confirmation gate between the two phases; separating them is the structural fix, not a stylistic one.
- *Use GitHub Issue Forms alone for the prompt template (no `docs/` file).* Rejected — the prompt template is consumed by the Architect during chat-side drafting too, not only by the Implementer in a worktree; a repo-checked-in `.md` is easier to grep, version, and cross-reference from CLAUDE.md.
- *Update §7 in this lane to match the new short-form PR body.* Deferred — touching §7 expands lane scope into the canonical PR-review contract and risks breaking historical PR descriptions that match the old format. Reconciliation is a focused follow-up.

---

## [2026-05-18] Splash dismiss gated on backend readiness

**Status:** accepted
**Decided by:** Architect, approved by Director
**Context:** The PR #1 reveal sequence dismisses the splash on renderer-mount alone — `revealMain()` races React's signal against a 2.5s watchdog and then destroys the splash. That worked when the shell had no real subsystems behind it, but by PR #66 the boot sequence spins up mesh (core HTTP + node secrets), the raven voice daemon (~30s on a cold checkout for the Python venv), the vision and calendar daemons (also async venv bootstraps), and the reminders node. All five subsystems are kicked off in parallel inside `app.whenReady()` AFTER `void revealMain()`, which means the main window is fully visible 0.5–2.5s into boot while mesh-dependent surfaces (Mesh dev tools, news, finance, digest) and the Voice pill spend the next 5–30s warming up — the user stares at empty cards and a red Voice pill on cold start. Cache hydration awareness from PR #65 (finance persistent on-disk cache) is the natural next gate but no `hydratedFromCache` event is surfaced today, so a follow-up PR will wire it once the finance node emits one.
**Decision:** `revealMain()` now runs three phases concurrently — renderer-ready, `waitForMeshReady(HARD_CAP_MS)` from `nodeRegistry`, and `raven.ensureRunning()` — and only proceeds to splash dismiss + main reveal once all three have settled. A `MIN_SPLASH_MS = 1800` floor prevents flash-and-vanish on warm-cache startups where every subsystem is already healthy; a `HARD_CAP_MS = 15000` ceiling enforces that the splash can never trap boot even if a subsystem hangs (the cap is realised through each phase's internal timeout — `waitForMeshReady` takes it directly, `ensureRunning` resolves either way once its own bootstrap timeout fires). The splash window gains a new `splashPreload.ts` that exposes `window.aetherSplash.onPhase(cb)` on a single `splash:phase` IPC channel; the splash HTML grows a status line + thin progress bar driven by an inline script that consumes those phase ticks. Vision, calendar, and reminders are NOT phases — they degrade gracefully and would otherwise drag boot beyond 15s on a cold first-launch venv bootstrap; their pill states still flip green when each becomes available.
**Consequences:** Splash visible for 1.8–15s on cold start vs 0.5–2.5s today; the first paint of the main window now always sees mesh and voice having either succeeded or definitively failed. The phase array is the extension point — adding a future gate (finance cache hydration, agent runtime ready, etc.) is one push and one phase-completion-event wiring away. Splash now uses a preload script, which expands its API surface from "static HTML" to "context-isolated bridge with a single named channel" — a small but real trust-boundary expansion that future splash content must respect. Voice degradation is now part of the boot path: a permanently-unavailable voice setup (no Python, missing API key) delays splash dismiss by `ensureRunning`'s internal bootstrap timeout. The 15s cap means worst-case boot is bounded regardless.
**Alternatives considered:**
- *Keep renderer-only gate and ship a separate in-shell "warming up" overlay over the main window.* Rejected — the empty-cards experience is the symptom, and an overlay on top of the surface that is itself empty just doubles the work and adds a dismissal moment. Splash is the right surface to gate on, and the holographic-theme design language is already there.
- *Sequential phase waits rather than concurrent.* Rejected — sequential boot would push worst-case splash duration toward the sum of phase timeouts (e.g. mesh-30s + voice-30s = 60s) rather than the max. Concurrent waits keep boot time bounded by the slowest single phase.
- *Drop the minimum-display floor and dismiss as soon as all phases settle.* Rejected — on warm boots where every subsystem is already running, the splash flickers for ~150ms which reads as a render glitch rather than a deliberate boot screen. The 1.8s floor is short enough that users on hot reboots don't perceive it as a hang and long enough to register as intentional.
- *Wire vision, calendar, and reminders as additional phases.* Deferred — each adds 5–30s on a cold first-launch venv bootstrap and they all degrade gracefully (the rest of the shell stays usable when they're absent). Their availability pills already tell the user when each comes up, which is the right surface for an opt-in degraded subsystem.
- *Wire finance cache-hydration as a phase now (PR #65 tie-in).* Deferred — the finance node hydrates its cache internally during its own boot and doesn't currently surface a `hydratedFromCache` event for the shell to await. A follow-up PR adds the event + adds the phase, rather than guessing at internal timing here.

---

## [2026-05-15] Node 22+ baseline for Aether macOS host

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** Discovered during Sprint 2 second-wave smoke testing (PRs #46-#56) that the `yahoo-finance2` library explicitly requires Node 22+ and warns on every spawn under older versions. Finance poll cycles on Node 20 took approximately 270 seconds for 10 tickers (~4.5 minutes), escalating to over 10 minutes for 21 tickers. The slowness was silent — no error, just extreme latency that made the finance node appear unresponsive. Node 22 is the current LTS release (LTS support window extends through April 2027) and eliminates the performance gap entirely. The baseline choice affects all contributors: Aether's shell and TypeScript mesh nodes (system_info, finance, news_feeds, weather) are executed by the same Node runtime, so setting a floor version is a repo-wide constraint, not a per-node one.
**Decision:** Aether requires Node 22+ as a baseline for macOS hosts. Enforced via `shell/package.json` `engines` field: `"node": ">=22.0.0"` and `"pnpm": ">=9.0.0"`. The constraint is documented in README.md's prerequisites section. Contributors on Node 20 (common via older homebrew installs) will encounter a pnpm install error and must upgrade before dependencies can be installed. The Windows collaborator's baseline remains independent (tracked separately as Windows bringup progresses); this ADR binds macOS only.
**Consequences:**
- New contributors must install Node 22+ before `pnpm install` succeeds; this raises the entry barrier slightly but eliminates a class of silent-slowness bugs that would otherwise require per-contributor debugging.
- Existing contributors on Node 20 will see a breaking change on their next `git pull` + `pnpm install` — the `engines` field will cause pnpm to reject the install. Mitigation: Node 22 is a single `brew upgrade node` away for homebrew users, and nvm/fnm users can `nvm install 22` or `fnm install 22`.
- Aether is now aligned with Node 22 LTS, which simplifies dependency resolution for libraries that publish multiple compatibility tiers (e.g., native modules with separate wheels/binaries per Node major version).
- The decision is forward-compatible: Node 22's LTS window extends to 2027, so there is no immediate pressure to bump the floor again. When Node 24 LTS ships (expected late 2026), a separate ADR will decide whether to stay on 22 or raise the floor.
- The `yahoo-finance2` library's requirement drove this decision, but the Node 22 floor applies to all of Aether's Node-executed code, not just the finance node. Future TypeScript mesh nodes and shell code inherit the same baseline.
**Alternatives considered:**
- *Leave the Node version unbounded and document Node 22+ as "recommended" in README.md only.* Rejected: a recommendation without enforcement means contributors on Node 20 will hit silent slowness, file issues, and require per-case debugging. The `engines` field fails fast at install time with a clear error message, which is strictly better UX than runtime slowness.
- *Pin to exactly Node 22 (`"node": "22.x"`) rather than a floor (`>=22.0.0`).* Rejected: exact-version pins prevent contributors from using Node 23+ when it ships, requiring a follow-up ADR and PR to relax the pin. A floor allows forward movement within the "current or newer" set without churn.
- *Vendor or fork `yahoo-finance2` to remove the Node 22 requirement.* Rejected: the library's Node 22 requirement is not arbitrary — it relies on features or stdlib improvements introduced in that release. Backporting would mean taking on maintenance burden for a fork, which is unwarranted when Node 22 is already LTS and widely available.
- *Replace `yahoo-finance2` with a different finance data library that supports Node 20.* Rejected: `yahoo-finance2` was chosen in PR #46 after evaluating alternatives for API stability, typing quality, and maintenance activity. Switching libraries to preserve Node 20 compat trades off library quality for a Node version that is already past LTS (Node 20 LTS ended April 2026). The right move is to upgrade the platform, not downgrade the library.

---

## [2026-05-14] New-node registration template required (CLAUDE.md §10)

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** Sprint 1 added two mesh nodes — weather (PR #42) and vision (PR #43) — and both shipped with completion gaps that required hotfix PRs (#44 for weather's missing `schemas/` directory; #45 for the cross-cutting weather + vision wiring gaps in `paths.ts`, `nodeManager.ts`, `coreManager.ts`, and `visionDaemonManager.ts`). The registration pattern is load-bearing for runtime correctness — Core fails to load surfaces whose schema files are missing, the spawner won't start a node it doesn't reference, the secret-store wiring is required in two places (`secrets.ts` for generation and `coreManager.ts` for handoff to Core), and `.env.local.example` is the surface where future Implementer + Director sees what a node can be configured with — but the pattern itself is discoverable only by reading existing node code or by failing the post-merge smoke test. Sprint 1 missed it twice with a sample size of two; the hotfix-after-merge shape is exactly what governance is meant to catch pre-merge. Codifying the registration shape as a CLAUDE.md §10 gotcha (the new "Mesh-node registration is a five-file pattern" entry) records the discipline; codifying the pre-merge gate here in DECISIONS.md is what makes it binding.
**Decision:** Future mesh-node PRs MUST include a checklist in the §7 PR body that names each of the five required files — `manifest.yaml`, `shell/electron/main/services/secrets.ts`, `shell/electron/main/services/coreManager.ts`, the appropriate spawner (`nodeManager.ts` for TypeScript nodes; `*DaemonManager.ts` for Python nodes), `.env.local.example` — plus the `schemas/` directory for TypeScript nodes, and confirms each file appears in the diff. Architect pre-merge review MUST confirm all five files plus `schemas/` (where applicable) are present in the diff before approval; absence is grounds for request-changes independent of other review quality. The checklist lives in the mesh-node PR body, not in CLAUDE.md §7's universal PR template — it is a node-class-specific gate, not a universal one. The five-file shape is bound for v1; if the pattern is later refactored into a single `registerNode()` factory (see Alternatives), the checklist updates to match the new shape.
**Consequences:**
- Small ergonomic cost per new-node PR: a fixed checklist (six lines, mechanical) added to the §7 PR body and cross-checked by the reviewer against the diff. The check is presence/absence, not judgment, so the review cost is bounded.
- Large expected reduction in hotfix-after-merge PRs of the PR #44/#45 shape. A hotfix PR (separate diff, separate review, separate merge, separate CHANGELOG line) is strictly more expensive than a six-line PR-body checklist filled out once.
- Binds going forward only. Pre-binding nodes (raven-core, news, finance, weather, vision) are not retroactively audited — the §15 velocity rule against premature governance applies in reverse here too.
- Establishes a precedent: node-class-specific checklists can live in the PR body when a universal-template entry would dilute the universal template's signal density. Future node classes — Python daemon nodes with non-standard supervision, MCP servers, future projector / sensor / actuator nodes — may add their own variants of this gate in their own ADRs.
- The checklist is a mechanical gate, not a substitute for thinking. A PR can satisfy the five-file checklist and still ship a broken node; the gate catches the recurring failure shape that Sprint 1 surfaced, not every possible failure shape.
**Alternatives considered:**
- *Refactor the registration pattern into a single `registerNode()` factory.* Deferred to a follow-up `refactor/node-registration-pattern` PR post-Sprint-2. The factory is the right long-term shape, but writing it well requires three or four nodes' worth of usage pressure to know which arguments are common and which are node-specific; Sprint 1 has two nodes, and refactoring before the third entry violates CLAUDE.md §15's "wait for the third instance before extracting a shared utility" rule. The checklist is the v1 manual discipline that a factory would later make redundant.
- *Build an automated linter that cross-checks manifest entries against the five required surfaces in code.* Deferred as future tooling. A linter is strictly better than a human checklist for a mechanical check, but building the linter before there are five or six nodes is premature optimisation; the checklist captures the discipline now, and a future PR can fold it into a script when the cost of writing one is amortised across enough nodes.
- *Hoist the checklist into CLAUDE.md §7's universal PR self-review template.* Rejected: §7 is the template *every* PR fills out, and a mesh-node-specific six-line checklist applies to a small subset. Adding it to the universal template lowers the template's signal density for documentation PRs, governance PRs, refactor PRs, etc. — which together outnumber new-node PRs by a wide margin in any given sprint.
- *Bind the discipline as a CLAUDE.md §11 self-applied heuristic instead of a DECISIONS.md ADR.* Rejected: §11 heuristics are self-applied by the Implementer before opening the PR, and a deviation is flagged in the §7 self-review under "Risks / TODOs / Skipped" — they're soft. This gate is a hard pre-merge requirement on the reviewer side: "absent in diff" is grounds for request-changes regardless of other review quality. The two have different teeth, and the difference is load-bearing for Sprint 2's hotfix-rate target.

---

## [2026-05-14] Voice extensibility arc roadmap: five-piece tool substrate

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** Aether's voice substrate today (post-v0.5.0) exposes ~13 tools to Gemini Live — time, memory, notify, news (recent + search), finance (quote + market summary + history), digest (compose + last) — with a fourteenth and fifteenth landing as the weather node fans into voice. Each tool is a hand-written Python wrapper in `daemons/raven-core/raven_core/tools/`: a `get_tools()` declaration, a `handle_call` dispatcher, an entry in `_TOOL_MODULES`, and (for stateful tools) a per-tool session-context updater. The aggregator `get_all_tool_declarations()` concatenates every `types.Tool` into the single `function_declarations` payload Gemini Live sees at session start. This works at thirteen tools and scales linearly with friction. Five tensions surfaced as the tool count grew: (1) no discoverability — Director cannot ask "what can you do?" and get a structured answer; (2) no user-level composition — voice-defined named pipelines like "startup routine, run morning briefing then check calendar then notify" are not expressible; (3) hand-written wrapper duplication — mesh surfaces already carry typed schemas that the voice-tool wrapper re-declares; (4) no modal context — the system prompt is one static string, so morning-Director and focus-mode-Director get the same defaults; (5) no primitives for richer composition — sequential, parallel, conditional invocation are general-purpose shapes that belong below Gemini's prompt-engineered compliance, not above it. Each tension is individually shippable as a piece; together they form a substrate-level arc that composes cleanly with the voice ambient arc (PR #30) and the MCP integration arc (PR #31).
**Decision:** Adopt a five-piece voice-extensibility arc captured in `docs/voice-extensibility-roadmap.md`:
- **Piece 1 — Tool registry + taxonomy** (`feat/voice-tool-registry`). Replace the flat `_TOOL_MODULES` list with a registry carrying category + description per tool. Initial categories: `time`, `memory`, `data`, `system`, `composer`, `creative` (reserved), `automation` (Piece 2 lands first entries). New tools: `tools.list(category?)`, `tools.help(name)`. Foundation — lands first.
- **Piece 2 — User automations / named sequences** (`feat/voice-automations`). Voice-created named pipelines persisted in a SQLite `automations(name PK, description, sequence_json, created_at, last_used_at)` table. Tools: `automations.create/run/list/delete`. Sequences are sequential-only in v1; Piece 5 generalises the shape.
- **Piece 3 — Mesh-surface auto-mapping** (`feat/voice-mesh-automap`). Mesh schemas declare an optional `voice_tool` metadata block; raven-core auto-generates the `types.Tool` declaration and dispatch wrapper. Eliminates per-mesh-surface hand-written Python.
- **Piece 4 — Adaptive modes / system-prompt contexts** (`feat/voice-modes`). Four v1 modes: `default`, `morning` (time-triggered 05:00–10:00), `focus` (user-toggled), `evening` (time-triggered 20:00–24:00). Tools: `modes.current/set/list`. Mode transitions happen **between** Gemini Live sessions (works around CLAUDE.md §10's set-once `system_instruction` constraint); piggy-backs on the voice-ambient arc's idle-detection / re-wake cycle when available.
- **Piece 5 — Composition primitives** (`feat/voice-composition`). A `composer` tool whose body is a pipeline of other tool calls. v1 expressiveness: **sequential + parallel only**. Pipeline shape is an array where each entry is either a single tool invocation or an inner array executed in parallel. Conditional steps, retry-on-failure, and continue-on-error are **deferred to v2** (binding deferral — see Alternatives below). Tools: `compose.run`, `compose.create` (the latter delegates to Piece 2's `automations.create`).

Dependency ordering: 1 → (2 and 3 in parallel) → 4 → 5. Recommended ship sequence matches; Pieces 2 and 3 are independent and can land in either order.
**Consequences:**
- The arc binds the **voice-tool registry shape** going forward: every new voice-callable tool carries category + description metadata, and Gemini sees a structured catalogue rather than a flat name list.
- Piece 2's `sequence_json` format binds early; Piece 5's pipeline shape must be a superset so existing automation rows continue to deserialise after Piece 5 lands. This is why Piece 5 ships last — landing it before Piece 2 would require speculating on a shape Piece 2 has not yet exercised.
- Piece 3 creates a second route into Gemini's `function_declarations` (auto-generated alongside hand-written wrappers). Tools that aren't mesh-surfaces (`time`, `memory`, `automations.*`, `tools.list`, `tools.help`, `modes.*`) remain hand-written; the auto-mapper is additive.
- Piece 4 establishes that mode text lives in `daemons/raven-core/raven_core/prompts/modes/` versioned with code. User-tunable mode thresholds (e.g. "morning starts at 6 not 5") are out of scope until a Settings app exists; the time windows above are bound for v1.
- The arc explicitly does NOT change the privacy posture established by the voice-ambient and MCP arcs. Tool declarations, mode text, and automation sequences live locally; tool *invocations* continue to flow through Gemini Live exactly as today.
- Composes with the voice-ambient arc (PR #30) via the idle-detection / re-wake cycle (mode transitions ride session restarts for free), with the MCP arc (PR #31) by direct extension of `function_declarations` (mesh tools from this arc's registry; MCP tools from connected servers; Gemini sees the union), and orthogonally with the vision arc (PR #23) which routes through raven-core's action map to the same dispatch surface.
- Several follow-on arcs are reserved but explicitly out of scope: MCP auto-tooling (Piece 3 generalised to MCP server declarations), voice-created tools (new tool *bodies* by voice, not just composing existing ones), tool versioning, cross-user / cloud sync of automations + modes, per-tool permission gates. The category names `creative` and `automation` in Piece 1's taxonomy reserve space (§11.6) for tools that don't exist yet.
**Alternatives considered:**
- *Build all five pieces as a single PR.* Rejected: each piece is individually meaningful and shippable; bundling would obscure the boundaries and make rollback hard. The five-piece shape is exactly the unit of review the §7 self-review template assumes.
- *Ship Piece 5 before Piece 2.* Rejected: Piece 2 persists `sequence_json` in SQLite; Piece 5 generalises the shape. Landing the general shape first means speculating on extensions Piece 2 has not yet exercised, which historically produces shapes that get rewritten within a release. Ship the concrete shape first (Piece 2's sequential-only sequences), then generalise.
- *Include conditional composition primitives (`if`, `unless`, retry-on-failure) in Piece 5's v1 scope.* **Rejected as a binding deferral.** The right place to bind the condition language is non-obvious — Python expressions are powerful but a security surface; a constrained DSL needs design; Gemini-mediated branching shifts the work above the substrate, which is the line this arc is trying to push the other direction. v1 ships sequential + parallel, which covers the motivating Piece 2 pipelines without committing to a condition language. v2 picks the binding once usage pressure surfaces which shape of branching matters.
- *Use YAML rather than JSON for `sequence_json`.* Rejected: SQLite TEXT columns serialise either, but JSON aligns with Gemini's native tool-args shape (it already constructs JSON for tool calls) and avoids the YAML-injection class of bug listed in CLAUDE.md §10 (NEXUS lessons). YAML is human-edited; JSON is machine-constructed. Composer pipelines are the latter.
- *Bind a flat tool list with description fields only (no category).* Rejected: discoverability is one of the five tensions the arc is solving. A flat list with descriptions answers "what does each tool do" but not "what can you do?" at a structural level. Categories let `tools.list(category)` give Director a one-sentence answer ("data, system, memory, time, composition, automation") that scales as the tool count grows.
- *Defer the whole arc until the tool count hits ~25-30 and the friction is undeniable.* Rejected: the linear-friction shape is already visible at 13 tools (per the lane-spec analysis), and Piece 1 (the registry) is load-bearing for every later piece. Landing Piece 1 early means later pieces are additive rather than restructuring. Waiting also defers the user-facing wins (named automations especially) for no architectural benefit.

---

## [2026-05-14] Codify ADR template fields as required (CLAUDE.md §8)

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** CLAUDE.md §8 has shown an ADR template since the operating manual was first written, but the template's status was descriptive rather than prescriptive — a code block under "Entry format:" that read as illustrative. Recent ADRs in DECISIONS.md (notably the MCP and voice-ambient roadmap entries dated 2026-05-14) settled on a stable six-field shape — Status / Decided by / Context / Decision / Consequences / Alternatives considered — that reviewers were already enforcing in practice. The governance-batch lane is the moment to bind the shape: turn the de-facto convention into a required template so future ADRs do not drift, and so an automated review (see PR #'s claude-auto-review workflow added in the same batch) can mechanically check the format.
**Decision:** The six fields — `Status`, `Decided by`, `Context`, `Decision`, `Consequences`, `Alternatives considered` — are now **required** in every Aether ADR and must appear in that order. The rest of an ADR entry (prose, sub-bullets, links, cross-references) remains freeform. An ADR missing any of the six fields is rejected at review and amended in the same PR; reviewers (human or auto-review) treat field-presence as a mechanical check rather than a judgment call. Ordering of ADRs in DECISIONS.md is also bound: newest at top within a date; dates descending overall. Historical entries (those dated before this ADR) are preserved verbatim per the append-only policy, including any whose shape differs from the now-required template — the binding applies forward.
**Consequences:**
- Future ADRs have a predictable shape that the claude-auto-review workflow can verify mechanically against the §7 PR self-review's pre-PR-heuristics check.
- Reviewers (Architect and the auto-review) can flag missing fields without ambiguity ("Alternatives considered is absent" beats "this ADR feels thin").
- The append-only policy continues to apply: pre-existing ADRs that diverge from the template are not retroactively rewritten; their divergence is read as a pre-binding historical artifact.
- A small ergonomic cost: ADRs that genuinely have no rejected alternatives must still include an `Alternatives considered:` field, even if the content is "None — the constraint was singular" or similar. The field's presence is what's bound; its content can honestly note when the option set was small.
**Alternatives considered:**
- *Leave the template as a non-binding example.* Rejected: status quo had already produced minor drift in field ordering and occasional missing fields in earlier ADRs, and the auto-review workflow needs a stable shape to check against.
- *Bind a smaller required set (drop `Alternatives considered`).* Rejected: the alternatives field is the most load-bearing for future readers — knowing what was rejected and why is what makes an ADR useful at re-litigation time. Cutting it would gut the document's purpose.
- *Bind a larger set (add e.g. `Stakeholders`, `Review date`, `Implementation PRs`).* Rejected for v1 of this binding: adds metadata fields that have not yet earned their weight in practice; can be added in a future amendment once the six-field core proves stable.

---

## [2026-05-14] Three-tier auth as a named architectural pattern (CLAUDE.md §12.1)

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** The MCP integration arc (DECISIONS.md "MCP integration arc roadmap" — same date) codified a specific auth-flow shape: the Electron shell handles the OAuth UX, raven-core handles the MCP protocol calls, and macOS Keychain under `com.aether.app` holds the secrets. This split is going to recur — every authenticated third-party integration Aether grows (Google Calendar, Gmail, Drive in v1; future Microsoft, GitHub, etc.) needs the same three-tier separation, and conflating any two tiers produces failure modes that are hard to debug after the fact (UX errors that leak as protocol errors; protocol errors that leak credentials into logs; secret-store errors that crash the auth flow silently). Naming the pattern now — before there is a second instance — keeps future PRs from re-deriving the boundary case-by-case, and gives task specs a vocabulary ("apply the three-tier auth pattern") that compresses the design conversation.
**Decision:** Add a new CLAUDE.md §12 "Architectural Patterns" section whose first entry §12.1 names the three-tier auth pattern: **shell-UX tier** (Electron shell — system-browser launch, redirect capture, account-state UI, re-auth prompts), **core-protocol tier** (raven-core or equivalent backend — protocol calls, token refresh, typed adapter surface), and **secret-store tier** (OS-native keychain — macOS Keychain under the bundle identifier `com.aether.app` for v1). The boundaries are load-bearing: the shell is the only tier with a window; the protocol tier never asks the user anything directly; the secret store is the only tier that persists authenticated material at rest. New authenticated integrations label which tier owns each piece of work in their task spec, and split functions that span tiers. The §12 section is intended to grow — additional architectural patterns earn entries as they get bound by ADRs.
**Consequences:**
- Future MCP integrations (Gmail, Drive, and later Microsoft 365 / GitHub) inherit a shared vocabulary and design shape — task specs reference §12.1 instead of re-stating the split.
- CLAUDE.md gains a new top-level section (§12) and existing §12-§15 renumber to §13-§16 (Communication Style, When Director seems to contradict CLAUDE.md, Velocity Notes, Glossary). No internal cross-references in CLAUDE.md point to the old §12-§15 numbers; the renumber is safe.
- Establishes a precedent that named patterns get added to §12 when they're going to recur, distinct from one-off architectural decisions which live only in DECISIONS.md. Reviewers will need to judge "is this going to recur" at ADR time — getting it wrong means either a CLAUDE.md §12 entry that never gains a second instance (low cost, can be pruned), or a recurring pattern that lives only in DECISIONS.md and gets re-derived (higher cost).
- The pattern is descriptive of v1's reality (macOS Keychain, Electron shell, raven-core). When Aether grows a second host platform (Windows substrate, web shell), the secret-store tier's concrete OS binding changes but the three-tier shape is intended to survive — that's the whole point of naming it.
**Alternatives considered:**
- *Leave the three-tier shape implicit in the MCP roadmap ADR.* Rejected: the shape is going to recur across multiple integrations, and re-deriving it case-by-case is exactly what naming patterns prevents. Implicit conventions drift; named ones can be cited.
- *Name the pattern but put it in MASTER_SYNTHESIS.md instead of CLAUDE.md.* Rejected: MASTER_SYNTHESIS.md is an architecture briefing about *what Aether is*. CLAUDE.md is the operating manual the implementer reads while writing code. Patterns that shape day-to-day implementation belong in the manual.
- *Bind a different tier split (e.g. two-tier "shell + backend" with secrets folded into the backend tier).* Rejected: collapses the secret-store boundary, which is the tier that needs the strongest invariants ("never logged, never serialized to disk outside the keychain, never transmitted except to the upstream provider"). Two-tier auth in practice loses these invariants because the backend's logging configuration grows over time.

---

## [2026-05-14] MCP integration arc roadmap: authenticated personal data via MCP

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** Aether's existing data nodes (news_feeds, finance,
weather, host_notifications, memory, digest) all ingest from sources
where we own the pipeline — public RSS, public APIs, internal state.
The next class of data is authenticated personal data: calendar
events, email inbox state, files, task lists. These do not fit the
mesh-node-with-fetcher pattern cleanly because they require OAuth
flows, per-user tokens, and provider-defined contracts that we do
not control. Building each as a bespoke mesh node would duplicate
OAuth scaffolding per provider and ship a different schema shape for
every connector. Anthropic's Model Context Protocol (MCP) is now an
open standard for exactly this shape — third-party authenticated
tool surfaces — and Aether can be an MCP client alongside its
existing mesh-client role.

**Decision:** Adopt MCP as the integration substrate for third-party
authenticated personal data. Specifically:
- **Architectural split.** Mesh nodes remain the substrate for data
  Aether owns the pipeline for (public-source ingestion, internal
  state, composer nodes). MCP becomes the substrate for third-party
  authenticated data (provider owns the contract and the auth).
- **Five-piece arc, sequenced.** (1) MCP client substrate in
  raven-core (`feat/raven-mcp-client`); (2) Google Calendar via MCP
  (`feat/mcp-calendar`, OAuth flow likely its own PR); (3) Gmail via
  MCP (`feat/mcp-gmail`); (4) Google Drive via MCP (`feat/mcp-drive`);
  (5) digest integration adding MCP-backed sections to morning /
  evening briefings (`feat/digest-mcp-sections`). Recommended order:
  1 → 2 → (3 and 4 in parallel) → 5.
- **Auth boundary.** Electron shell handles OAuth (system-browser
  launch + localhost redirect intercept). Tokens land in macOS
  Keychain under `com.aether.app`. raven-core reads tokens from
  Keychain when invoking MCP servers. Shell handles the UX;
  raven-core handles the protocol; Keychain is the secret-store
  boundary.
- **Privacy contract.** Authenticated data is fetched on demand, not
  persisted locally beyond the OAuth refresh token in Keychain.
  Aether transmits authenticated data only to Gemini Live as part of
  the existing voice-processing channel. Local LLM mediation of
  authenticated data (so Gemini sees only summaries) is documented
  as a future direction, out of scope for v1.
- **Scope-out for v1 of the arc.** Microsoft 365 / Outlook (Google
  ecosystem first), Apple HealthKit / Notes / iCloud (no MCP surface
  today), chat platforms (different interaction model), local file
  indexing (separate question), multi-account (one Google account
  for v1), MCP server hosting (Aether is a client only).

**Consequences:**
- raven-core grows an MCP-client capability alongside its existing
  mesh-client role; future authenticated integrations land as
  config-file entries rather than bespoke nodes.
- The Electron shell takes on first-party responsibility for OAuth
  UX (system-browser launch, redirect capture, Keychain write) —
  net-new surface area for the shell.
- The digest composer gains a hybrid fan-out shape: mesh upstreams
  (news, finance, weather) plus MCP upstreams (calendar, email,
  drive activity) composed into the same `BriefingSection[]` shape.
  The `Promise.allSettled` + per-upstream-timeout pattern from PR
  #27 generalizes cleanly; an MCP-side failure ships an
  `available: false` section the same way a mesh-side failure does.
- Privacy posture for the project shifts: pre-MCP, the only
  authenticated boundary was Gemini Live (voice in / voice out);
  post-MCP, Aether persists OAuth refresh tokens locally. Keychain
  scoping (`com.aether.app`) and the on-demand fetch contract are
  the user-facing guardrails.
- Commits Aether to being an MCP client; does not commit to running
  MCP servers (explicitly out of scope).

**Alternatives considered:**
- *Custom per-provider mesh nodes.* Rejected: each integration
  re-implements OAuth, token refresh, and a bespoke schema; doesn't
  scale across providers; each connector becomes its own special
  case maintained in Aether's tree rather than the provider's.
- *Cloud-mediated MCP (run MCP servers in a hosted Aether cloud,
  proxy from the local app).* Rejected: Aether is local-first; auth
  tokens and authenticated data should stay on the user's machine.
  Hosted MCP would invert the trust boundary.
- *Local-LLM mediation before Gemini in v1 (summarize locally, send
  only the summary to Gemini).* Deferred to a future arc rather than
  rejected. v1 ships the simpler shape (Gemini sees the
  authenticated payload, same channel as voice today); local
  mediation is documented in the roadmap as a future direction once
  a suitable local model and the latency budget are in hand.
- *Microsoft 365 first / Microsoft + Google in parallel.* Rejected
  for v1 of the arc — Director uses the Google ecosystem; parallel
  ecosystems double the arc's surface area for no v1 user benefit.
  A Microsoft arc can run in parallel later if Director adds it.

See `docs/mcp-integration-arc-roadmap.md` for the full design (mesh-
vs-MCP rationale, per-piece scope, auth flow, privacy posture, open
implementation-time questions).

---

## [2026-05-14] Voice ambient arc roadmap: ambient presence in five pieces

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** The voice path is moving from button-press to ambient
presence — boot greeting, always-on listening with local VAD,
wake-word activation, idle/goodbye behavior, real AEC for barge-in.
Capturing the design before any single voice-ambient PR fires so
implementation PRs reference a shared spec rather than re-deriving
the architecture.

**Decision:** Adopt a five-piece sequence, sequential within the arc,
parallel to the vision arc. Privacy posture is load-bearing: local
VAD + local wake word means no audio reaches Gemini before wake
activation. See `docs/voice-ambient-roadmap.md` for full design
including library choices (silero-vad, openWakeWord,
voiceProcessingIO), dependency ordering, and composition with the
vision arc's gesture-wake.

**Consequences:**
- Each piece (boot greeting, always-on VAD, wake word, idle behavior,
  AEC) ships as its own PR in dependency order — clean UX milestones
  rather than one mega-PR.
- raven-core's venv gains `onnxruntime`, `openwakeword`, and macOS
  Audio Unit bindings when Pieces 2/3/5 land; bundled via the existing
  `.requirements-installed-v2` marker pattern.
- A dedicated privacy-posture ADR is owed alongside the Piece 2 PR
  (always-on mic) that pins what audio lives where and what reaches
  the cloud under which conditions.
- Wake-event routing must be unified across wake word, vision gesture
  (vision arc), and keyboard shortcut. No N-path activation in the
  orchestrator.

**Alternatives considered:**
- Cloud-based wake word (rejected: defeats the privacy posture —
  every speech segment would stream to a cloud detector).
- Continuous Gemini streaming without VAD/wake word gates (rejected:
  cost-prohibitive at ambient duration + privacy-untenable).
- Single-PR implementation of the whole arc (rejected: each piece is
  independently shippable and individually valuable; sequential ship
  gives clean UX milestones and lets Director redirect the arc
  between pieces).
- pvporcupine for Piece 3 wake word (deferred: openWakeWord is fully
  open and avoids quota concerns for v1; pvporcupine remains the
  upgrade path if false-positive rate proves too aggressive).
- Whisper / local-LLM transcription replacement for Gemini Live
  (rejected: Gemini Live is the orchestrator and reasoner; local
  models stay scoped to VAD + wake word).

---

## [2026-05-14] Rename project homeOS → Aether (working name retired)

**Status:** accepted
**Decided by:** Director (Architect-recommended)
**Context:** The project was bootstrapped under the working name
"homeOS" — a descriptive placeholder while we figured out what the
thing actually was. Through v0.3.x the working name carried; by the
data-realization milestone it was clear the project had earned its
own identity. "homeOS" reads as a category (one of many "home OS"
projects) rather than a name; "Aether" — the classical luminiferous
medium connecting everything — better captures the substrate framing
(the spine the rest of the modules ride on) and is one syllable shorter
to say aloud, which matters for a voice-first product.

**Decision:** Adopt **Aether** as the project name. Specifically:
- All in-prose references in current-state docs (README, CLAUDE.md,
  MASTER_SYNTHESIS.md, manifest, sub-READMEs) become "Aether."
- npm package scope `@homeos/*` → `@aether/*`. Root packages
  `homeos-shell` → `aether-shell`, `@homeos/raven-daemon` →
  `@aether/raven-daemon`.
- Env var `HOMEOS_DATA_DIR` → `AETHER_DATA_DIR` (passed by the shell
  to data nodes; every node refuses to start without it).
- Electron `productName` "homeOS" → "Aether"; bundle identifier
  `com.homeos.app` → `com.aether.app`.
- Renderer bridge `window.homeOS` → `window.aether`; preload type
  `HomeOSApi` → `AetherApi`.
- App icon: introduce the cosmic-navy aurora-curtain icon (Concept C
  per the icon design review) — SVG + generated PNGs + .icns bundle
  committed under `shell/assets/`.
- One-time macOS data-dir migration at first boot of the renamed app:
  rename `~/Library/Application Support/homeOS/` →
  `~/Library/Application Support/Aether/` before any node spawns so
  existing news / finance / memory state carries forward.

**Consequences:**
- DECISIONS.md ADRs from earlier dates are left verbatim — they refer
  to "homeOS" as the project name at the time. Same for CHANGELOG
  entries from earlier versions. Top-of-file framing is updated to
  flag the rename.
- Bundle-id change means macOS treats the renamed app as a *new* app:
  Director's existing window state, Keychain entries, and microphone
  / notification permissions will reset. Accepted as a clean break —
  the alternative (keep the old appId) is misleading and risks future
  conflicts when Director eventually wants to deploy both halves
  (substrate + workspace).
- GitHub repository remains at `ashwinsreedhar28/homeOS` — separate
  decision, separate timeline. GitHub's auto-redirect keeps existing
  clone URLs alive when Director eventually renames the repo.
- Director's local working directory remains on the working name; the
  Director will rename it (or not) on their own schedule. Nothing in
  the code path depends on the local directory name.
- The `_ingest/*` submodules (Pulse, RAVEN_MESH, NEXUS, VIEWER) are
  out of scope — external repos with their own naming.

**Alternatives considered:**
- *Keep "homeOS" forever.* Rejected: reads as a category name, not a
  product name; future-Director will hit this same fork later with
  more cruft accumulated.
- *Rename to "Substrate" / "Mesh" / "Hearth".* Considered briefly.
  Substrate / Mesh describe pieces of the architecture, not the whole;
  Hearth was warmer but more domesticated than the always-on
  ambient-computing arc the roadmap commits to.

---


## Older decisions

Decisions dated 2026-05-13 and earlier are archived in
[docs/archive/decisions-pre-2026-05-14.md](docs/archive/decisions-pre-2026-05-14.md).


## 2026-05-25 — ADR: Substrate stays human-architected

**Status:** Accepted

**Context.** Sprint 5 closed with the mesh becoming observable end-to-end (PRs #109–#113). The roadmap doc (#114) names Aether-Architect as the eventual mesh node that converses with Director to draft and (later, gated) fire new mesh extensions. Sprint 10 ships the draft-only version; Sprint 11 extends to fire-and-watch for sensors; Sprint 14 to mixers; Sprint 17 to content apps; Sprint 19 (gated) to self-improvement of its own prompts.

Across all of those stages, one constraint is load-bearing: **the substrate itself is never delegated.**

**Decision.** The Aether-Architect node, at any maturity level (Sprint 10 through Sprint 19+), is NEVER authorized to touch:

1. `core/core/` — the mesh broker. All routing, dispatch, invocation recording, and introspection logic stays human-architected.
2. `manifest.yaml` edge-graph topology — the *structure* of allowed-edges between nodes. The Architect can propose new nodes (which gain new edges by adding to the graph); it cannot rewrite the graph between existing nodes.
3. The confirmation pattern (Sprint 7 work) — `safe | confirm | destructive` surface declarations, broker enforcement of confirmation envelopes, voice rendering of confirmation. The mechanism by which dangerous actions get principal consent stays human-architected forever.

These are the load-bearing primitives. If any of them break, the whole mesh's safety model breaks. Self-extension applies to leaves (sensors, actors, mixers, content apps) — never to the root.

**Consequences.**
- Sprint 19's gated self-improvement loop applies only to Aether-Architect's own *prompts*, not to the substrate code those prompts produce. The Architect cannot improve itself by rewriting the broker.
- If a future lane proposes loosening this rule, the discipline is to slow down, not speed up. The ADR is the wall against the seemingly-reasonable case ("it's just one small change"), not the obviously-wrong case.
- Future Architects evaluating "should we let the Architect touch X" should default to no unless X is unambiguously a leaf (Sensor/Actor/Mixer/content app) and X has zero downstream consumers in `core/core/`.

**Related.** Roadmap doc (`docs/agent-platform-roadmap.md`) Architectural Anchors section, Failure Modes section. PR #114 introduced this concept; this ADR formalizes it.

## 2026-05-25 — ADR: Manifest `description` field convention

**Status:** Accepted

**Context.** Sprint 5 substrate categorized every mesh node by `Sensor`/`Actor`/`Mixer`/`Planner`. Categorization made the mesh legible to mesh-viz. But mesh-viz hovers only show node id, category, surface count, and status — there's no human-language explanation of *what each node does*. The same gap blocks Sprint 13 voice introspection ("Hey Aether, what can you do?") and Sprint 10 Aether-Architect (which needs to read the existing surface inventory before drafting new ones).

**Decision.** Every `manifest.yaml` node entry gains an optional `description: string` field describing what the node does in user-facing language (one or two sentences, prose, no markdown).

Three downstream consumers (consumer list updated 2026-05-26 per Sprint 5.5 direction shift; original list named mesh-viz hover as first consumer, which is obsolete now that the content-app paradigm is being archived):
1. **Visualizer node** (Sprint 6.4): the visualizer reads `mesh_introspection.topology` and composes scene panels that include node descriptions. First consumer to land.
2. **Raven voice introspection** (Sprint 14): when asked "what can you do," raven reads `mesh_introspection.topology` and reads the descriptions aloud, grouped by category.
3. **Aether-Architect** (Sprint 11): consumes descriptions as context when conversing with Director about new mesh extensions.

**Amendment 2026-05-26:** The original ADR proposed Sprint 6 backfill of 17 nodes. Director's Pulse-read recon in Sprint 5.5 found all 16 user nodes already have `metadata.description` populated (universal coverage was already in place, just not threaded through the broker payload). PR #118 shipped the substrate threading (schema + broker + types); no backfill needed. The convention is now formalized and live; Sprint 7's new sensors comply when they land.

**Consequences.**
- `core/schemas/manifest.json` gains an optional `description` field with a max-length constraint (proposed: 280 characters; matches a tweet, prevents overflow in tooltips/voice).
- Description content is the node author's responsibility; reviewed during PR for accuracy and tone.
- Empty/missing descriptions are graceful: tooltips fall back to category + surface count; voice falls back to "I have a node called X" rather than describing it.

**Related.** Sprint 6 lane spec (roadmap doc), Sprint 13 voice depth (roadmap doc), #104 issue comment listing 108d as deferred lane.


## 2026-05-26 — ADR: Direction shift to dashboard + scene-driven architecture

**Status:** Accepted

**Context.** Sprint 5 closed with the mesh observable end-to-end and the content-app paradigm validated through the mesh-viz, news, finance, and voice-control apps. The roadmap doc (#114) framed Sprints 6-20 around expanding sensor breadth, then layering Planner runtime, then Aether-Architect self-extension — all rendered through additional content apps in the Electron shell.

Sprint 5.5 surfaced a different direction. Director discussed Aether with the creator of the RAVEN repos (which Pulse and the original RAVEN substrate were based on). The conversation identified two structural problems with the content-app trajectory:

1. **Janky frontend doesn't mesh together.** Each content app is its own React component with its own visual language. Adding sensors means adding apps; the shell becomes a launcher of dissimilar interfaces. The cost of "yet another app" grows with each addition.

2. **Not Jarvis-like.** The desired interaction model is voice/CLI input → summoned visualization → dismissal. Windowed content apps are persistent stateful UI; Jarvis-style is transient generated content. The shell should be a HUD with a dashboard backdrop and summoned overlays, not a Finder for content apps.

The collaborator shared `R-A-V-E-N-delegate/RAVEN_AVP` — a separate repo he'd built that solves the visualization composition problem for Apple Vision Pro. It runs a FastAPI server holding authoritative SceneDoc state (panels + entities + transforms), broadcasts deltas via WebSocket, and lets generator scripts compose visualizations of arbitrary systems (Pulse, Google Search, future Aether). The AVP client subscribes and mounts panels in immersive space.

**Decision.** Aether's presentation layer pivots from "windowed content apps" to "scene-driven dashboard + summoned overlays."

Concretely:
- The four current content apps (news, finance, voice-control, mesh-viz) are archived in Sprint 6.1 (`_archive/shell-content-apps/`). The `AppDefinition` / app-registry / nav-launcher pattern is removed.
- RAVEN_AVP is vendored at `daemons/raven-avp-server/` (git submodule) and runs as an Aether daemon (Sprint 6.2). It binds localhost:5180 for the shell on this machine; cross-machine Tailscale access is enabled for the AVP shell joining at Sprint 17.
- The macOS shell is rewritten as a scene subscriber (Sprint 6.3). It connects to the scene server's `/scene/stream` WebSocket, maintains an in-memory `RemoteSceneStore` (mirroring RAVEN_AVP's Swift client pattern), and renders panels + entities as 2D HTML/SVG instead of the AVP shell's 3D RealityKit.
- A new visualizer mesh node (Sprint 6.4) consumes mesh state and composes scene panels. One surface: `visualizer.render(intent, args?)`. Intent-routed internally to template functions.
- Voice and CLI input both route through `visualizer.render` (Sprint 6.5). Saying "show me the mesh" or typing it in the CLI triggers the same intent path.

**Three subsystems, fully decoupled:**
1. **Aether mesh** — data layer (sensors + broker + manifest). Knows nothing about presentation.
2. **RAVEN_AVP scene server** — presentation state holder. Knows nothing about Aether's mesh semantics.
3. **Shells** (macOS + AVP) — scene subscribers. Each renders the same SceneDoc differently.

The visualizer mesh node is the *only* component aware of both the mesh and the scene server. It is the bridge.

**Consequences.**

- Most content-app code (~1500-2000 lines across `shell/src/apps/`) moves to `_archive/`. Nothing deleted; archive preserves all of it for future reference or pattern-lifting.
- Bundle size drops significantly on Sprint 6.1 (similar to PR #115's deletion-lane bundle delta).
- The shell becomes substantially smaller — voice pill + CLI + scene subscriber, instead of voice pill + 4 content apps + launcher.
- Sprint numbers shift by one for Sprints 7-15 (e.g. what was Sprint 6 sensor breadth becomes Sprint 7). Sprint 17 newly added for AVP shell active dev; Sprints 18-20 cover Architect expansion + 1.0 stabilize work.
- The Sprint 5 retrospective doc gets an addendum naming the Sprint 5.5 pivot.
- This ADR makes "the shell" plural — there are now two shells (macOS Electron and AVP Swift), and Aether is built to support both without changes to the mesh.

**Why this is reversible-ish.** The mesh substrate is untouched by this shift. If the scene-driven approach proves wrong, we'd un-archive the content apps and re-wire the launcher; the mesh keeps working throughout. The visualizer node would lose its scene-server consumer and just be dead code for one sprint until a new presentation strategy lands.

**Why this is the right shift now.** Director's tested with two patterns (Pulse's windowed dashboard + Aether's content apps) and is not satisfied with either. The collaborator's RAVEN_AVP is production-ready presentation infrastructure that the AVP shell will need anyway. Adopting it as Aether's presentation layer for both shells means: one canonical presentation API, two rendering targets (2D and 3D), trivial cross-shell consistency. The cost of the shift now is one sprint of archive + reshape work; the cost of NOT shifting compounds as more content apps would be needed for each new sensor.

**Related.**
- Roadmap doc rewrite (this PR) covers the full Sprint 6-20 reshuffle.
- Manifest-description-convention ADR (above) amended to point at visualizer as the first consumer instead of mesh-viz hover.
- The HTTP-everywhere ADR (below) formalizes the inter-subsystem protocol commitment.
- The Aether-is-data-layer ADR (below) formalizes the architectural boundary.
- The substrate-stays-human-architected ADR (existing) continues to apply unchanged — none of this lets the Architect node touch substrate.

## 2026-05-26 — ADR: HTTP-everywhere for inter-subsystem communication

**Status:** Accepted

**Context.** With the Sprint 5.5 direction shift, Aether becomes a three-subsystem architecture (mesh + scene server + shells). These subsystems could communicate via many patterns: in-process function calls, shared memory, file-system state, message queues, REST, WebSocket, gRPC, custom protocols. Each pattern has tradeoffs in latency, decoupling, debugging surface area, deployability, language-portability, and replaceability.

**Decision.** Inter-subsystem communication uses HTTP/WebSocket exclusively. Specifically:

- **Mesh → scene server:** HTTP POST to `/scene/panel/{id}` and `/scene/entity/{id}`, HTTP PATCH to `/scene` for batch ops. (The visualizer mesh node initiates; the scene server accepts.)
- **Shell → scene server:** WebSocket subscription to `/scene/stream` for snapshots + deltas; HTTP GET `/scene` for full-state refetch on reconnect.
- **Shell → mesh:** existing patterns continue (shell talks to mesh broker over HTTP, broker dispatches signed envelopes). No change from Sprint 5.
- **Voice (raven) → mesh:** existing patterns continue (raven calls mesh tools through its function-calling layer; mesh edges enforced by broker).
- **Voice (raven) → scene server:** raven does NOT talk to scene server directly. Voice triggers mesh routes that hit `visualizer.render`; visualizer is the only mesh node that talks to the scene server.

**No exceptions for performance.** If a future use case feels like it needs in-process speed (e.g. "the visualizer shouldn't HTTP-POST 100 panels at 60fps"), the answer is: don't POST 100 panels at 60fps. The visualizer composes the SceneDoc state in batched mutations; the scene server's deltas-over-WebSocket handle real-time UI updates. Animation lives in the rendering layer (entity animations declared in panel/entity dicts), not in flooding HTTP.

**Consequences.**

- Every inter-subsystem interaction is debuggable from a terminal with `curl`. This is genuinely huge for development and troubleshooting.
- Subsystems are replaceable. The visualizer mesh node could be rewritten in Python, Rust, or Go with no change to the scene server. The scene server could be replaced with a Node.js implementation without touching the mesh.
- Subsystems are independently deployable. The scene server's lifecycle is decoupled from the shell's; crash and restart independently. If the scene server crashes, the shell shows a connection-lost state but doesn't itself crash.
- Cross-machine extension is trivial. Today the scene server runs localhost; tomorrow the AVP shell connects to it over Tailscale. No protocol change.
- Testing: every subsystem can be tested by mocking the HTTP endpoints of its neighbors. The mesh tests don't need a scene server; the scene server tests don't need a mesh.
- Latency cost is real (HTTP roundtrip vs in-process call). For Aether's use cases, this is acceptable — the slowest path (voice → mesh → visualizer → scene server → shell render) is bounded by voice latency (~500ms-1s), which dwarfs HTTP overhead (~5-20ms localhost).

**Constraints inherited from RAVEN_AVP.**
- Panel `style` field values MUST be strings (AVP's Swift client decodes as `[String: String]?`; non-string values silently fail SceneMessage decode). The visualizer node must coerce numeric style values to strings before POST. Banked in CLAUDE.md §10 and the visualizer node's README.
- RAVEN_AVP v1.0 has no auth on the scene server (Tailscale ACL is the trust boundary). Aether's localhost-only use is acceptable; cross-machine needs minimal auth before Sprint 17.

**Related.**
- Aether-is-data-layer ADR (below) — describes the boundary HTTP-everywhere enforces.
- Direction-shift ADR (above) — names this commitment as one of the architectural anchors.

## 2026-05-26 — ADR: Aether is the data layer; scene server is the presentation layer

**Status:** Accepted

**Context.** The Sprint 5.5 direction shift and the HTTP-everywhere commitment together imply a strict architectural boundary: mesh on one side, scene server on the other, visualizer node as the only bridge. This ADR formalizes that boundary as a permanent contract, so future lanes don't accidentally erode it.

**Decision.** Aether's mesh holds *data*. The RAVEN_AVP scene server holds *presentation state*. The boundary is enforced both in code (no mesh component except the visualizer node knows scene server URLs or panel/entity schemas) and in convention (mesh schemas never include presentation hints like colors, positions, or rendering modes).

**What's in the mesh:**
- Sensor data (calendar events, focus state, location, etc.)
- Actor capabilities (send email, create event)
- Mixer composition (briefings, voice composition)
- Planner output (proposals, daily briefings as structured data)
- Broker state (topology, recent activity, node health)
- Manifest declarations (categories, descriptions, edge graph)

**What's in the scene server:**
- Panels (text, html, image, markdown, model3d, chart, mermaid, group)
- Entities (geometry + material + transform + gestures + animations)
- Positions in world space (meters, AVP coordinate frame)
- Visual styles (fonts, colors, opacity, sizes)
- Scene structure (which panels are present, in what arrangement)

**What's in the visualizer mesh node** (the bridge):
- Intent → composition mappings (`mesh` intent reads `mesh_introspection.topology`, composes radial panel layout)
- Knowledge of the scene server's HTTP API
- Knowledge of both the mesh schemas it consumes and the scene schemas it emits
- Template functions per intent (mesh-radial, activity-stream, briefing, etc.)

**Boundary tests.** A change is creeping the boundary if:
- A mesh sensor's surface schema gains a "preferred display color" field (presentation hint in mesh; wrong)
- The scene server gains direct read access to a mesh surface (presentation layer reaching into data; wrong)
- A second mesh node (besides visualizer) starts POSTing to the scene server (the bridge becomes multi-node; wrong)
- The visualizer node grows logic that's *purely* presentation (e.g., "pick a different layout if the user's display is dark mode") with no reference to mesh data (the visualizer is supposed to be a *bridge*, not a renderer; this kind of logic belongs in the shell)

**Consequences.**

- Adding a new sensor is a mesh-only change. Adding a new visualization for that sensor is a visualizer-node-only change. The two are independently authorable.
- A new shell (web, future devices) is a scene-subscriber-only change. No mesh work needed for a new shell as long as the visualizer supports the intents the new shell wants to display.
- Sprint 17's AVP shell adoption is "easy" — the mesh is unchanged, the visualizer is unchanged, only the new shell's subscription code is new.
- Failure mode #5 (presentation-layer creep into mesh) is identified by this ADR and added to the roadmap doc.

**What this ADR does NOT forbid.**
- Mesh surfaces can include semantic categorization that the visualizer happens to use for layout decisions (e.g., `category: Sensor` is mesh-side and is used by visualizer to color radial branches). The principle: it's allowed if it's semantically meaningful in the mesh AND the visualizer happens to consume it; forbidden if it's purely a rendering hint.
- The shell can have local-only UI state that's not in the scene (e.g., CLI history, scroll position). Local-only state lives in shell React state and is fine.

**Related.**
- Direction-shift ADR — establishes the three-subsystem split this ADR formalizes.
- HTTP-everywhere ADR — protocol commitment that makes the boundary enforceable.
- Substrate-stays-human-architected ADR — orthogonal but compatible (the Architect node cannot touch broker; this ADR adds that the broker also cannot grow presentation logic).

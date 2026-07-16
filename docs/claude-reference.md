# CLAUDE.md Reference Appendix

> Relocated reference bodies from `CLAUDE.md` — long worked examples, historical
> PR lists, shape histories, templates, the glossary, and extended rationale. The
> operating law (gates, the §13 discipline, the §7 template, the §11 heuristics)
> stays in `CLAUDE.md`; each section there keeps its rule plus a one-line pointer
> to its expansion here. **Section anchors match CLAUDE.md numbering** — the block
> under `§13.10` below expands the rule that lives at `CLAUDE.md` §13.10. Nothing
> here is new law; it is the detail that was carved out of `CLAUDE.md` to bring the
> operating core under Claude Code's 40k-char performance threshold (PR
> `chore/claude-diet`). Indexed by the `aether-rag` corpus, so every relocated
> passage stays retrievable via `search_corpus`.

---

## §2 — Project Context: scope, the two halves, current reality

The original orientation paragraphs, verbatim. `CLAUDE.md` §2 keeps a one-line
summary and the rule (read once, then refer to `MASTER_SYNTHESIS.md`).

> **Eventual scope** is ambient computing: mics, speakers, projectors, cameras, sensors, and actuators distributed through a home, with a software workspace as the *first surface*. Two halves:
>
> - **Home substrate** — always-on, lives on a small machine (Pi/NUC/Mac mini) close to the hardware. Runs Core + physical-domain nodes. Survives the workspace laptop being closed. Autonomous: sensors and policies drive most decisions in the physical domain (lighting, irrigation, garden, environment).
> - **Workspace** — Electron app on the user's MacBook Pro (and, eventually, the collaborator's Windows machine). Connects to the substrate as a mesh client. Command-driven: voice, text, agents, dashboards.
>
> **Current reality** is far smaller: solo dev on a MacBook Pro, no always-on box yet, vibe-coding week one. Single-user. Collaborator on Windows building a parallel stack we'll converge with later. We design *for* the two-machine future even though we're temporarily single-machine.

### §2 — Source material

The four `_ingest/` source repos, verbatim (vendor reference — copy code freely,
never import at runtime). `CLAUDE.md` §2 keeps a one-line summary of each.

> 1. **Pulse** (`_ingest/Pulse/`) — Electron menu-bar app. Polling + IPC + SQLite. *The engine room.* ~50 domain services, ~20 schedulers. **Read its `CLAUDE.md` for gotchas — most are reproduced in `docs/governance-log.md`.**
> 2. **RAVEN_MESH** (`_ingest/RAVEN_MESH/`) — Python broker. Signed envelopes, edge-graph authorization, audit log. *The spine.* Will be vendored mostly-unchanged once we need it.
> 3. **NEXUS** (`_ingest/NEXUS/`) — Agent orchestration. Docker-per-agent cells, queues, teams, mailbox, MCP-callback. *Runtime concepts to lift.* **Read its `AUDIT.md` before lifting any route or container code — 70 findings, many CRITICAL.**
> 4. **VIEWER** (`_ingest/VIEWER/`) — Electron + React modular desktop. App-discovery pattern, daemon-manager pattern, command palette. *The surface.*

---

## §3 — Strategic Direction (Week 1): the phasing detail

The original week-1 phasing, verbatim. `CLAUDE.md` §3 keeps the "surface first,
mesh awakens late" philosophy and its rationale.

> **Week 1 phasing (informal):**
>
> - PR #1: `feat/shell-skeleton` — see §11 for the full task spec, which is your first job.
> - PR #2 onward: Architect briefs as PR #1 lands. Likely candidates in order of probability: first app on the canvas (file explorer or news), then a faked data layer to feed it, then voice exploration.
> - We *deviate* from `MASTER_SYNTHESIS.md` §6's phase ordering in week 1. That ordering is correct for a production push; we're vibe-coding for velocity right now. Once week 1 closes and we have multiple surfaces, we'll converge with the doc's plan (or update the doc — `DECISIONS.md` records the divergence).

---

## §4 — Repo Layout (target)

The full target tree. `CLAUDE.md` §4 keeps the rule ("for week 1 only `shell/`
matters; everything else gets created as we earn it") and a top-level summary.

```
aether/                        ← repo dir (GitHub repo and local dir renames are separate, later decisions; current local path is still homeOS-*)
├── CLAUDE.md                  ← this file
├── MASTER_SYNTHESIS.md        ← architecture briefing
├── DECISIONS.md               ← append-only ADRs
├── CHANGELOG.md               ← per-PR updates, Keep-a-Changelog style
├── README.md                  ← user-facing intro (write later, around v0.1.0)
│
├── _ingest/                   ← vendor reference; never imported at runtime
│   ├── Pulse/
│   ├── RAVEN_MESH/
│   ├── NEXUS/
│   └── VIEWER/
│
├── shell/                     ← Electron app (the workspace surface)
│   ├── electron/
│   │   ├── main/
│   │   └── preload/
│   ├── src/
│   │   ├── apps/              ← auto-discovered app modules (VIEWER pattern)
│   │   ├── stores/            ← Zustand stores
│   │   ├── theme/             ← holographic CSS vars + Tailwind config
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
│
├── core/                      ← (added when mesh awakens, not week 1)
│   ├── core/                  ← RAVEN_MESH core.py, supervisor.py, ...
│   ├── node_sdk/              ← Python SDK
│   ├── node_sdk_ts/           ← TS SDK port (~200 LOC)
│   ├── schemas/
│   └── mesh.toml
│
├── manifest.yaml              ← (added when mesh awakens)
│
├── nodes/                     ← (added as mesh nodes appear)
│   └── <node_name>/
│
├── agents/                    ← (per-agent ledger dirs; bind-mounted into runtimes)
│   └── {agentId}/
│
└── data/                      ← runtime state (gitignored)
    ├── aether.db
    ├── workspaces/
    └── .mesh/
        └── audit.log
```

---

## §6 — Tagging Standards: the cut-criteria table

The full tag table, verbatim. `CLAUDE.md` §6 keeps the rule (Architect cuts
tags; honest pre-1.0; annotated, signed, pushed; one tag per CHANGELOG section)
and a one-line criteria summary.

> | Tag | Cut when |
> |---|---|
> | `v0.0.x` | Pre-mesh. Shell + faked services. Patch number bumps per coherent slice of work. |
> | `v0.1.0` | First time a mesh hop runs end-to-end (shell → Core → node → response visible in shell). The spine is alive. |
> | `v0.x.0` | Each new node *category* lights up: `v0.2.0` = news; `v0.3.0` = finance; `v0.4.0` = voice; `v0.5.0` = agents. Order TBD by Director. |
> | `v1.0.0` | First version another household could deploy without Architect babysitting. Means: install docs exist, two-machine deployment is real, at least one autonomous physical loop runs reliably. **Not soon.** |

---

## §8 — Decision Records & Changelog: the templates

`CLAUDE.md` §8 keeps the binding rules (the six required ADR fields in order, the
append-only rule, the fragment/ADR-file law from #222: lanes never edit
CHANGELOG.md or DECISIONS.md — both are generated). The illustrative template
blocks, verbatim:

**ADR file (`decisions/<date>-<slug>.md` — one decision per file; regenerate the
DECISIONS.md index with `node scripts/gen-decisions-index.mjs` in the same PR):**

```markdown
## [YYYY-MM-DD] <Title>

**Status:** proposed | accepted | superseded by [link]
**Decided by:** Director / Architect / both
**Context:** <what forced this decision; what we knew at the time>
**Decision:** <what we picked>
**Consequences:** <what this commits us to, what it forecloses>
**Alternatives considered:** <what else was on the table and why we rejected each>
```

**Changelog fragment (`changelog/unreleased/<issue>-<slug>.md` — one per lane;
sections `Added` / `Changed` / `Fixed` / `Removed`; full format in
`changelog/README.md`; a release lane folds fragments with
`node scripts/roll-changelog.mjs --version X.Y.Z`):**

```markdown
### Added
- Electron shell skeleton with holographic theme (#NNN): continuation lines
  indented two spaces.
```

---

## §9 — Task Spec Format: the template

The shape Architect sends each PR's work in, verbatim. `CLAUDE.md` §9 keeps the
rules ("ask in chat before opening the PR if anything is missing or ambiguous —
don't guess" and the scope-discipline paragraph).

```markdown
# Task: <title>

## Goal
<one sentence — what success looks like.>

## Why
<two-to-three sentences — where this fits in the larger build. References to
MASTER_SYNTHESIS.md sections welcome.>

## Branch
`feat/<scope>` (or `chore/...`, `fix/...`, `exp/...`)

## Scope (DO)
- <bulleted list of what to do.>

## Out of Scope (DON'T)
- <bulleted list of adjacent work that's tempting but should land in a later PR.>

## Acceptance criteria
- <bulleted list of testable conditions. The PR is done when all of these are true.>

## Notes / hints
- <relevant code in _ingest/, gotchas from `docs/governance-log.md`, etc.>

## Open questions (for you to answer in PR or chat before assuming)
- <if any.>
```

---

## §11.9 — Cross-doc consistency: drift vectors and full detail

The original heuristic body, verbatim:

> **Cross-doc consistency.** When a literal phrase, version number, package name, or terminology choice appears in more than one of CLAUDE.md / MASTER_SYNTHESIS.md / DECISIONS.md / CHANGELOG.md / README.md / docs/*.md, treat the set as one surface during a change. Pick the canonical form, then grep for the others — every divergence is either a doc-drift bug (fix in the same PR) or an intentional historical reference (DECISIONS.md and CHANGELOG.md entries dated before the divergence are policy-preserved verbatim; flag the divergence in the §7 self-review so the reviewer doesn't read drift as inconsistency). Common drift vectors: project name (homeOS vs Aether), version-current claims ("Current state (v0.x.0)" in README), tag tables, env var names, package scopes, port numbers, env-keyed paths. A passing typecheck does not catch a 0.3.0-in-README-while-CHANGELOG-says-0.5.0 mismatch — only a literal grep does.

---

## §11.10 — Pre-decide load-bearing: the PR #113 radial example

The original heuristic body, verbatim:

> **Pre-decide load-bearing decisions; leave non-load-bearing to Implementer.** Lane prompts should pre-commit decisions that affect downstream consumers, the substrate, or the wire contract. Leave non-load-bearing local choices (layout strategy, edge rendering style, animation approach, etc.) explicitly open with "pick whichever you can implement cleanly; document choice in PR body." This produces better decisions (Implementer has fuller context at write-time than Architect did at prompt-time) AND better documentation (the choice ships with reasoning attached in code comments + PR body). PR #113 chose radial Strategy A over Strategy B this way; reasoning landed in `RadialLayout.tsx` top comment AND PR body Open Questions section. If a future lane has zero non-load-bearing choices to delegate, the lane is probably over-specified.

---

## §11.11 — Hand-written documentation lanes: PR history

The original heuristic body, verbatim:

> **Hand-written documentation lanes don't need CC.** When PR content is direct compression of recent Architect-Director conversation (retros, ADRs, roadmap edits, governance updates), CC adds overhead with no value — the Implementer would have to reverse-engineer the same content from prior PR bodies and chat logs. Architect drafts in chat, Director pastes via heredoc, commits and ships. See §13.10 shape 3. PRs that landed via this pattern: #114 (roadmap doc), this retro PR. Do NOT use this pattern for code lanes; CC's structural review of changes (`grep`, file reads, typecheck) is real value.

---

## §12.1 — Three-tier auth: full definition and rationale

The original section body, verbatim:

> For any third-party integration that requires user-bound authentication (OAuth, API keys, signed tokens), responsibility splits across three tiers that must not be collapsed:
>
> - **Shell-UX tier (Electron shell).** Owns the user-facing auth experience — launching the system browser for OAuth consent, capturing the redirect on a loopback port, presenting account-connection state, prompting for re-auth on expiry. The shell is the only tier with a window and a clipboard; it is the only tier the user ever sees during an auth flow.
> - **Core-protocol tier (raven-core or equivalent backend).** Owns the actual integration protocol — MCP client calls, REST/GraphQL invocations, token refresh logic, the typed adapter surface that the rest of the system consumes. The protocol tier reads tokens from the secret store and never asks the user anything directly.
> - **Secret-store tier (OS-native keychain).** macOS Keychain under the bundle identifier (`com.aether.app`). The only tier permitted to persist authenticated material at rest. Tokens written by the shell-UX tier, read by the core-protocol tier; no other path persists them.
>
> The boundaries are load-bearing because each tier's failure mode is different — UX failures need a user-visible affordance, protocol failures need retry/refresh logic, secret-store failures need OS-level error reporting — and conflating them produces auth flows that fail silently or leak credentials into logs. When designing a new authenticated surface, label which tier owns each piece of work in the task spec; if a single function spans two tiers, split it.
>
> **Bound by:** DECISIONS.md "MCP integration arc roadmap" (2026-05-14) — first instantiation of this pattern across the MCP client substrate.

---

## §13.3 — Large-file caution: choke-file detail and the archive note

The original choke-file list with per-file read strategy, verbatim:

>    - `shell/electron/main/services/ravenDaemonManager.ts` (~720 lines)
>    - `shell/electron/main/services/nodeRegistry.ts` (~510 lines)
>    - `manifest.yaml` (~530 lines, grows ~25 per new node). Discovered as a
>      choke during Sprint 4 Wave 2 when targeted-grep was the only viable read
>      strategy on hostile-API days.
>    - `docs/new-node-pattern.md` (~827 lines). Read in full once during the
>      initial new-node-pattern lane; subsequent lanes treat it as reference
>      via targeted grep.
>    - `shell/electron/main/services/coreManager.ts` (~250 lines, grows ~10
>      per node added via the env-secret pattern). Read once for pattern,
>      then targeted str_replace only.
>    - `.github/workflows/ci.yml` (~90 lines but high-value-density). Each
>      new SDK-shape workspace package (consumed by other packages for
>      types — e.g. `@aether/mesh-node-sdk`, `@aether/macos-applescript`)
>      requires a one-line addition to the pre-build step. Grep before
>      drafting any lane that adds a `core/*` workspace package.
>
>    **Note:** `DECISIONS.md` and `CHANGELOG.md` were removed from this
>    list in the archive lane (PR #80). Pre-2026-05-14 decisions moved to
>    `docs/archive/decisions-pre-2026-05-14.md` and pre-Sprint-4
>    `[Unreleased]` entries moved to
>    `docs/archive/changelog-unreleased-pre-sprint-4.md`. Choke status
>    returns if either top-of-tree file grows past ~800 lines again —
>    currently `DECISIONS.md` is ~455 lines and `CHANGELOG.md` is
>    ~125 lines.

---

## §13.8 — Architect Pre-flight Checklist: full checklist and rationale

`CLAUDE.md` §13.8 keeps the rule (run this before drafting any new-lane prompt;
the output shapes the prompt's LARGE-FILE CAUTION, INITIAL READ, and SHELL HOOKS
sections). The original six required reads, in order, plus the rationale, verbatim:

> 1. `ls .github/ISSUE_TEMPLATE/ .github/PULL_REQUEST_TEMPLATE/` — confirms
>    whether issue/PR templates exist before the prompt references them.
> 2. `wc -l manifest.yaml docs/new-node-pattern.md` — confirms choke-file
>    status of the two largest non-data files in the repo.
> 3. `wc -l shell/electron/main/services/*.ts | sort -rn | head -5` —
>    surfaces the five largest service files; anything over 200 lines is
>    choke-track.
> 4. `grep -n "pnpm --filter" .github/workflows/*.yml` — surfaces the CI
>    pre-build list (currently bites every new SDK-shape package, see
>    PR #75 CI failure for the canonical case).
> 5. `grep -n "pnpm --filter" shell/package.json` — surfaces the shell
>    prebuild filter; same maintenance trap as the CI workflow's pre-build.
> 6. If the lane references `_ingest/` patterns, confirm at least one
>    existing Aether node was read alongside (per §13.4 — _ingest/ patterns
>    are facts about source repos, not facts about Aether, until verified).
>
> This checklist is a tax on the Architect, not the Implementer. The output
> shapes the prompt's LARGE-FILE CAUTION section, INITIAL READ list, and
> SHELL HOOKS list (which must include any hardcoded package lists discovered).

---

## §13.9 — Manual Completion Fallback: the full pattern

The original five-step pattern and cost note, verbatim:

> 1. Director catches the stall (per §13.7 protocol).
> 2. Director cats reference files to the Architect chat (typically: a
>    reference node's source files + the relevant shell hook files).
> 3. Architect dictates the new files as `cat > path << 'EOF' ... EOF`
>    blocks and the shell hook patches as Python `str_replace` scripts.
> 4. Director pastes blocks into the worktree, runs `verify-build`,
>    commits, pushes, opens PR.
> 5. PR body's "Risks / TODOs / Skipped" section notes the lane was
>    completed manually due to CC unavailability.
>
> Cost: ~30 minutes per node. Reserved for hostile-API days when CC
> cannot land the work. NOT a default — CC remains the primary
> implementation channel. See `docs/manual-completion.md` for the
> full mechanics, including which file types convert cleanly to
> cat-heredocs and which require Python patches.

---

## §13.10 — Hand-Edit Lanes and the Manual-Completion Kit: the six shapes in full

The original six-shape descriptions and shape history, verbatim:

> §13.9 documented "manual completion" as a single fallback pattern (Director-Architect paste-and-write when CC stalls). Sprint 5 expanded this into a five-shape kit; Sprint 6 added a sixth (the hand-edit hotfix, #134). The shapes are interchangeable tools, not a hierarchy.
>
> The six shapes documented across PRs #65, #66, #110, #112, #113, #114, #115, #134:
>
> 1. **Implementer-wrote-Director-shipped.** CC drafts the code; Director runs verify-build and ships via manual commit + push. PRs #65, #66.
>
> 2. **Implementer-stalled-Director-finished.** CC drafts partial code, then stalls mid-write (read-retry storm OR network drop). Director picks up where files-on-disk left off, finishes the surgical edits, ships manually. PRs #110, #112, #113 verify phase.
>
> 3. **Hand-written documentation lane.** No CC session at all. Architect drafts prose content in chat, Director pastes to disk via `cat > path << 'EOF' ... EOF`, commits and ships. First applied to PR #114 (roadmap doc); reusable for retrospectives, ADR-heavy lanes, governance docs. Content must be direct compression of recent chat conversation — if Architect needs to reverse-engineer from PR bodies, prefer CC.
>
> 4. **Hand-edit code lane spanning calendar days.** Director starts hand-edits one session, pauses, resumes hours or days later. Uncommitted branch state on disk is valid persistent storage between sessions. Pattern works without modification — no special "resume protocol" needed beyond `git status` to remind yourself what's pending. PR #115.
>
> 5. **Architect-Director hand-completion after BOTH CC sessions stall.** Two consecutive CC sessions hit network errors mid-write; Director assembles final state across the two partial outputs, runs verify-build, ships. PR #113 across two sessions ~30 minutes apart.
>
> 6. **Architect-dictated hand-edit hotfix.** No CC session by design. When a fix is diagnosed precisely enough that spinning up a CC session would only add latency, Architect dictates the edit, Director applies it on disk and validates with an isolation smoke — the new path exercised alone and read from the daemon-side truth (e.g. the transcript endpoint), never an optimistic CLI echo — then ships. Distinct from shapes 2 and 5, which are CC-stall *recoveries*: this is a deliberate hand-edit chosen up front for an exactly-diagnosed fix. PR #134 (raven ready-gate hung on a `setup_complete` signal that never traverses the receive loop).
>
> Across all six shapes:
> - Files persist on disk between sessions; this is the load-bearing invariant.
> - Resume prompts (when used) run 30–40% the size of original prompts because they reference already-on-disk contracts as locked.
> - §7 canonical PR body discipline holds regardless of session count or shape — the PR body should explain shape in the "Risks / TODOs / Skipped" section.
> - Verify-build is the universal pre-ship gate. Hand-completion never skips it.
>
> When to use which shape (default heuristics):
> - Code work, fresh lane → CC (default; no kit needed).
> - Code work, CC stalls → shape 2 or 5.
> - Documentation, content fresh in chat → shape 3.
> - Small surgical edits (≤5 files, no architectural decisions) → shape 4 directly.
> - Mixed lane spanning multiple days → shape 4 with daily verify-builds.
> - Exactly-diagnosed fix where a CC session would only add latency → shape 6 (Architect dictates, Director applies + isolation-smokes).
>
> The kit is now stable. Future Sprint retros bank new shapes here as they emerge.

---

## §13.11 — Bundle-size reporting: the PR #115 worked example

The original worked example, verbatim:

> Example: PR #115 removed three content-app directories. Renderer JS dropped from 1,012 KB to 622 KB (~39%); renderer CSS dropped 23.54 KB to 18.66 KB (~21%). The numeric drop confirmed no orphan imports.
>
> Format in PR body: include `pnpm -r build` output's bundle size lines under "Verification," noting delta from previous build.

---

## §13.12 — Full-Stack Worktree Setup: the recipe and teardown gotcha

`CLAUDE.md` §13.12 keeps the rule (a fresh worktree initializes nothing — any
full-stack lane needs gitignored config and workspace `node_modules`;
submodule init is opt-in per spawn since #376). The canonical recipe and
teardown, verbatim:

> Canonical recipe:
>
> ```
> git worktree add <dir> -b <branch> && cd <dir> && cp ~/aether/.env.local . && pnpm install
> ```
>
> Submodule init is OPT-IN (#376, default off). The #376 audit: nothing in a
> lane's build, runtime, or RAG-bootstrap path reads `_ingest/` from the lane
> worktree — CI checks out with `submodules: false`, `pnpm-workspace.yaml`
> lists no `_ingest` package, and runtime uses the re-copied trees under
> `core/`. Pattern-lift lanes read the MAIN checkout's populated `_ingest/`
> (`~/aether/_ingest/…`; first row of `git worktree list`) — expect one
> out-of-worktree read approval per session. Opt in only when the lane needs
> worktree-local submodule state (a vendor-pin bump, a wholesale `cp -R` lift
> at the lane's own pinned SHA, a machine without a co-resident main
> checkout): put a `Submodules: on` line in the lane's ARCHITECT SPEC, or in
> a draft's text — same contract style as `Branch:`/`Worktree:`.
> work_on_issue_tool records it as `submodules: true` on the lane request
> line; both spawn recipes then run `git submodule update --init --recursive`
> in the fresh worktree. Un-inited lanes never populate the teardown guard's
> trigger (#363), so plain `git worktree remove` stays clean on every git
> version.
>
> RAG bootstrap (so the worktree's `/mcp` is green and `/doctor` stays quiet). A fresh worktree has no `daemons/aether-rag/.venv` or index, so the corpus the lane prompt tells you to query is dead until you build it. Match what the spawn actor does — but pick the interpreter EXPLICITLY: macOS system `python3`'s `sqlite3` cannot load extensions, so `sqlite-vec` won't load and `reindex.sh` dies; a venv inherits its creator interpreter's sqlite build, so never trust a bare `python3` in a spawned/sparse-PATH environment. Use an extension-capable interpreter (the one behind main's working `daemons/aether-rag/.venv/bin/python`, fully symlink-resolved, is ground truth on this machine; else Homebrew's `python3`):
>
> ```
> cd <dir>/daemons/aether-rag
> CAP_PY="$(readlink -f ~/aether/daemons/aether-rag/.venv/bin/python)"   # or /opt/homebrew/bin/python3
> "$CAP_PY" -c 'import sqlite3; sqlite3.connect(":memory:").enable_load_extension(True)'  # must exit 0
> "$CAP_PY" -m venv .venv && .venv/bin/pip install -q -r requirements.txt && bash reindex.sh
> ```
>
> Teardown gotcha: a worktree with an initialized submodule needs `git submodule deinit -f <path>` BEFORE `git worktree remove --force`, and `deinit` is GLOBAL across worktrees sharing a `.git` — re-run `git submodule update --init --recursive` in main afterward. Full rationale in `docs/governance-log.md` (2026-06-03 worktree teardown; 2026-06-07 the sqlite-extension interpreter pin).

---

## §13.13 — Precedent-First Implementers: extended rationale and caveat

The original section body, verbatim:

> The default way an Implementer discovers relevant prior art is to **query the `aether-rag` MCP (`search_corpus`) for the decisions and patterns relevant to each build step, before implementing it** — not to wait for the lane prompt to hand-list every file. The corpus is Aether's own written record (governance log, DECISIONS, CHANGELOG, CLAUDE.md, scene protocol, release notes, the node READMEs, the manifest, and `docs/rebase-playbook.md`), so "how have we solved this before?" is a retrieval, not a guess. This replaces exhaustive **hand-fed file lists** as the default: the Architect no longer has to anticipate and pre-stage every relevant file for a lane to be discoverable.
>
> What does NOT change: **hand-named precedents remain for load-bearing reads** — the specific files whose exact contract the Implementer must not get wrong (wire formats, the named source in a `_ingest/` pattern-lift, a choke-file region). §13 items 2 (pre-flight reads), 3 (large-file caution), and 4 (pre-staged context) still govern those; precedent-querying supplements them for *discovery*, it does not retire the load-bearing safety rails. Rule of thumb: if getting a file wrong breaks the build or the wire contract, name it; if it is context an Implementer would want to *find*, let `search_corpus` find it.
>
> Caveat — **the index can only retrieve law that is written.** Oral law (a convention that lives only in chat or in the Architect's head) is invisible to `search_corpus` until it is banked in a corpus file (governance-log, this file, or a `docs/` doc the corpus indexes). When you rely on an unwritten convention, write it down so the next lane can retrieve it; `docs/rebase-playbook.md` is the first deliberate write-down-to-make-retrievable (it closed the RAG eval's Q1 corpus gap). The `draft_lane` tool bakes a fixed PRECEDENT line into every machine-drafted prompt — the composer instantiation of this rule.

---

## §16 — Glossary

The full glossary, verbatim. `CLAUDE.md` §16 keeps a pointer and the term list.

> - **The mesh / the spine** — RAVEN_MESH's signed-envelope protocol. The eventual transport for inter-process communication in Aether.
> - **The substrate** — the always-on home half of Aether. Lives on a small machine in the home eventually.
> - **The workspace / the surface** — the Electron app the user interacts with. Lives on the user's laptop.
> - **A node** — a mesh participant. Has surfaces (typed entry points) and an HMAC identity.
> - **A surface** — (two meanings, both used) (1) a typed entry point on a mesh node; (2) a user-facing UI rendering (screen, projector, voice). Context disambiguates.
> - **The ledger** — per-agent on-disk directory (`identity.md`, `memory/`, `skills/`, `session_id`). Agents read and edit their own ledger.
> - **The edge graph** — the authorization model. `manifest.yaml` declares which nodes can invoke which surfaces. Edge present = permitted. Edge absent = denied.
> - **A skill** — a `SKILL.md` file plus its directory that gives an agent a capability. Loaded dynamically by the agent.
> - **`_ingest/`** — vendor reference repos. Read-only. Not imported at runtime.

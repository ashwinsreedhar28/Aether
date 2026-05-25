# Aether Agent Platform Roadmap

**Status:** living document. Updated at every Sprint retro. Banks
direction, not schedule.

**Last updated:** Sprint 5 substrate close (PRs #109–#113 landed,
mesh observability complete).

---

## Vision

Aether is a personal-OS substrate that grows toward two reinforcing
goals.

**The consumer-facing goal** is a personal-OS that knows you. Voice
is reliable enough for daily use. The system has opinions —
proposals appear when context warrants them, learned from rejected
proposals over time. Peripherals (room speakers, cameras, controlled
devices) participate as natural extensions of the mesh, not bolt-ons.
You don't think about the substrate any more than you think about
the OS kernel.

**The engineering goal** is a self-extending agent platform. Adding
a new capability is a conversation, not a code project. You describe
intent; the system drafts the spec, asks clarifying questions, fires
the build, ships the PR. The Director (you) stays on the merge gate
throughout. Substrate stays human-architected; *extensions* get
progressively automated.

The engineering goal is the path to the consumer goal. Self-extension
is the mechanism by which Aether can plausibly grow to dozens of
nodes, multiple rooms, varied hardware, and increasingly subtle
personalization — without becoming a maintenance burden that
swallows its principal. They are not alternatives. One is the means
to the other.

## The Personalization Arc

The system's most important property — the one that differentiates
it from session-based AI assistants — is that it *learns you*.

Three capabilities compose into one:

1. **Memory** (Sprint 12): a personal preferences node that
   persists across sessions. Records what you accept, reject, and
   ask about. Becomes the consultation source for the planner and
   the voice layer.

2. **Voice depth** (Sprints 13, 17): voice that remembers
   conversation context, references prior exchanges, sounds like
   it knows you. Wake word, latency, audio quality. Reads from the
   memory node to make recall natural.

3. **Architect self-improvement** (Sprint 19, gated): the
   Aether-Architect node files PRs that improve its own prompts
   based on which past lanes succeeded cleanly and which had fix-
   forwards. The platform learns how its principal prompts —
   compositional style, follow-up patterns, scope preferences —
   and adapts.

These are not three features. They are one capability — a system
that accumulates fidelity to its user over time. By Sprint 19,
"Aether" should feel meaningfully different to the user it grew
up with than to a fresh installation. That divergence is the
spine of the personalization arc and the goal-state of the
platform.

## Architectural Anchors

These constraints are load-bearing. Future Architects override
them only with explicit ADR-level reasoning.

### Substrate stays human-architected (ADR-binding)

The Aether-Architect node is NEVER authorized to touch:

- `core/core/` (broker)
- `manifest.yaml` edge-graph topology (declared safe surfaces can
  be touched; the structure of allowed-edges cannot)
- The confirmation pattern (Sprint 7's `safe | confirm |
  destructive` discrimination)

These are the load-bearing primitives. If they break, the whole
mesh's safety model breaks. Self-extension applies to leaves
(sensors, actors, mixers, content apps), never to the root.

If a future lane proposes loosening this rule, that is the moment
to slow down, not speed up.

### The gradient is the discipline

Self-extension capability rolls out in stages, never all at once:

- **Sprint 10**: draft-only. Aether-Architect proposes; Director
  fires manually.
- **Sprint 11**: fire-and-watch, narrow surface class only (new
  sensor nodes following established Pulse patterns).
- **Sprint 14**: extended to Mixers (cross-surface composers).
- **Sprint 17**: extended to content apps (renderer-side).
- **Sprint 19** (gated): self-improvement loop.

Skipping rungs is the canonical failure mode. The gradient exists
because calibration data accumulates with use — each successful
sprint adds patterns the next sprint's architect can draw on. By
Sprint 11 there's roughly 20+ lanes of pattern data; by Sprint 14
that's 40+; by Sprint 17, 60+. Architect competence at each rung
is grounded in the rung below, not in human optimism.

### The four-category vocabulary

Every mesh node carries a `category` from:

- **Sensor** — read-only, exposes world state (news, weather,
  calendar, mail, messages, mesh_introspection, ...)
- **Actor** — changes world state (host_notifications, mail.send,
  any future device control)
- **Mixer** — composes other surfaces (digest, raven, shell, core,
  daily_brief)
- **Planner** — decides what to invoke next (none yet; first
  planner ships Sprint 8)

Schema-enforced as of PR #111. Drives mesh-viz layout and Planner
routing. New categories require ADR-level reasoning.

### Sprint = 4-phase cycle

A sprint is not just feature work. It is:

1. **Roadmap** — set theme + lanes
2. **Wave 0 / x.5** — cleanup, hotfixes, debug from previous sprint
3. **New features / lanes** — substantive work
4. **Retro** — bank lessons, close the loop

Sprint size varies — Sprint 4 was 13 PRs over ~3 weeks; Sprint 5
substrate was 5 PRs over ~4 days (retro pending). This variance is
a feature, not a bug. The 4-phase shape is what matters.

## The Six-Piece Arc

Sprints 5–11 form a coherent architectural buildup. Each sprint
adds a layer the next sprint depends on. The arc:

| # | Sprint | Layer | What gets added |
|---|--------|-------|-----------------|
| 1 | 5 | Observability | Mesh is legible. The substrate can be seen. |
| 2 | 6 | Sensor expansion | The mesh knows more about the world. |
| 3 | 7 | Confirmation + actors | The mesh can change the world, with consent. |
| 4 | 8 | Planner runtime | The mesh composes surfaces toward goals. |
| 5 | 9 | Daemon-planner | The system runs unasked. |
| 6 | 10–11 | Self-extension | The system extends itself. |

Each layer is independently usable. Each becomes more powerful
when the next one lands. Sprint 11 closes the arc — at that point
Aether has the conceptual completeness of a platform that can
grow itself.

Sprints 12+ are about *deepening* this arc (personalization,
voice depth, surface class expansion) rather than adding new
architectural primitives.

## Sprint Plan

### Sprint 5 — Mesh observability ✅ Substrate complete

PRs landed: #109 (broker invocation recorder + `/__introspection__`),
#110 (payload `category` + `allowed` fields), #111 (mesh_introspection
daemon + manifest categorization + schema), #112 (broker reads
category from manifest), #113 (mesh-viz radial content app).

Substrate validated end-to-end via visual smoke. The mesh now
exposes its own topology and recent activity as signed mesh
surfaces, rendered live in a categorical radial visualization.

**Phase 4 (retro) pending.** Plus optional small lanes: #114 polish
(nav cleanup), UI revamp (scoped during design discussion), 108b
(click-to-inspect), 108c (live edge pulse).

### Sprint 6 — Sensor expansion + ambient context

**Theme:** thicken the mesh with read-only nodes that give the
future Planner real context to compose against.

**Lanes:**
- Calendar enhancement (already a node; expand surfaces if needed)
- Location sensor (passive: home / work / transit, no GPS streaming)
- Focus state (foreground app, idle, Do Not Disturb)
- Clipboard history (already exists; possibly enhance)
- **Sports node** — Pulse-matching surfaces hoisted (NBA-focus per
  Pulse). RAVEN voice tool follows in same lane or as fast-follow.
- **Research node** — needs Pulse read before scoping (academic
  arxiv-style vs broader "interesting reading" curation).
- **Manifest `description` field convention** — apply to all new
  sensors in this sprint; backfill `description` for the 17 existing
  nodes. Foundation for Sprint 13 voice introspection. ADR recorded
  in DECISIONS.md at Sprint 5 retro.
- **108d (optional this sprint)** — mesh-viz hover tooltips render
  manifest descriptions. First downstream consumer of the description
  convention.
- Sprint 5.5 cleanup (Phase 2): ECONNRESET investigation, dev-env
  audit, any other Sprint 5 loose ends
- Sprint 6 retro (Phase 4)

Each new sensor consults its Pulse analog (in `_ingest/Pulse/`)
during the lane spec. Width over depth — ship multiple small
sensors rather than one deep one. Established Pulse pattern means
each lane is a known shape.

**Lane-count discipline:** the list above is 8 lanes plus cleanup +
retro. Sprint 6 Phase 1 (roadmap-setting) will trim to 4–5 highest-
leverage and defer rest to Sprint 6.5 / Sprint 7. Highest-leverage
candidates: calendar, focus_state, sports, research — these give
Sprint 8 Planner real human-context to compose against. Location and
clipboard enhancements likely defer.

### Sprint 7 — Voice confirmation pattern + first dangerous actor

**Theme:** voice can act on the world without acting on things you
didn't authorize.

**Lanes:**
- Manifest declares surfaces as `safe | confirm | destructive`
- Broker enforces — `confirm` surfaces require explicit confirmation
  envelope before dispatch
- Voice node renders confirmation through the pill UI (audio +
  visual)
- RAVEN's confirmation patterns hoisted from `_ingest/RAVEN/`
- First dangerous actor: `macos_mail.send` (read side already exists)
- End-to-end smoke: voice → confirm → send a real email
- Sprint 6.5 cleanup
- Sprint 7 retro

Voice work in this sprint is about safety, not depth. Depth
arrives in Sprint 13.

### Sprint 8 — Planner runtime

**Theme:** the mesh composes surfaces toward goals.

**Lanes (aggressively sub-laned):**
- 8.1 `planner` node skeleton + manifest-derived surface catalog
- 8.2 Backend integration (Claude via API, surface catalog as
  tools) + trace surface visible in mesh-viz
- 8.3 First consumer: `daily_brief` mixer composes calendar +
  mail + news + focus state
- Planner cost telemetry + kill switch (do not defer to a follow-up)
- Sprint 7.5 cleanup
- Sprint 8 retro

The Planner consumes Sensors (Sprint 6) and executes through
Actors gated by the Confirmation pattern (Sprint 7). Both
dependencies paid down before Planner lands.

### Sprint 9 — Daemon-planner

**Theme:** the system runs unasked.

**Lanes:**
- Three trigger types: time-based (morning brief 7am), threshold-
  based (unread mail from $person crosses N), state-based
  (calendar event in 15min + commute → "leave now")
- Proposals app (new content app in `shell/src/apps/proposals/`)
- Accepted proposals execute through Sprint 7's confirmation pattern
- Rejected proposals write to a preference store (consumer in
  Sprint 12's memory node)
- Sprint 8.5 cleanup
- Sprint 9 retro

This is where Aether stops feeling like "a mesh with voice on it"
and starts feeling like an OS with opinions.

### Sprint 10 — Aether-Architect draft-only

**Theme:** conversational self-extension lands as a read-only
capability.

**Lanes:**
- `aether_architect` mesh node (Mixer category)
- Conversation surface: takes "I want X" prompt, returns an Issue
  draft + Implementer prompt draft (using canonical template from
  `docs/implementer-prompt-template.md`)
- Pre-flight grep findings auto-included from corpus of past PRs
- Read-only: does NOT create Issues, does NOT spawn CC sessions,
  does NOT touch worktrees
- Director fires manually (pastes draft into `gh issue create` +
  fresh CC session)
- Sprint 9.5 cleanup
- Sprint 10 retro — banks the calibration data corpus

The corpus the Architect consults is what's been accumulating
since Sprint 4: governance-log entries, PR bodies, retro docs.
By Sprint 10 there's enough pattern data for the drafts to be
useful.

### Sprint 11 — Aether-Architect fire-and-watch (narrow surface)

**Theme:** narrow self-extension goes live.

**Lanes:**
- Architect can fire CC sessions in fresh worktrees, but ONLY
  for: new sensor nodes following established Pulse pattern
- Other surface classes still require Director-fired CC sessions
- Director merge gate stays intact
- Cost telemetry on auto-fired lanes (compare against manual baseline)
- Sprint 10.5 cleanup
- Sprint 11 retro

Sprint 11 closes the six-piece arc. After this, the platform can
extend itself within a tightly bounded scope.

### Sprint 12 — Memory / personal preferences node

**Theme:** the system starts knowing you.

**Lanes:**
- `memory` mesh node (Sensor category — read-write but exposed
  to consumers as read)
- Schema for preference types: liked / rejected / asked / corrected
- Daemon-planner from Sprint 9 starts writing rejected-proposal
  data here
- Planner from Sprint 8 starts consulting it before composing
- Privacy boundaries: which surfaces can read what
- Sprint 11.5 cleanup
- Sprint 12 retro

This is the first capability whose value compounds over time. By
Sprint 15, the memory node has months of data. By Sprint 19, the
architect itself can read it.

### Sprint 13 — Voice depth pass 1

**Theme:** voice becomes daily-reliable.

**Lanes:**
- Multi-turn context for raven (conversation memory across
  exchanges)
- Wake word ("Hey Aether") via local detection
- Latency improvements on tool calls
- Reads from memory node — can reference "what you asked me
  yesterday"
- Sprint 12.5 cleanup
- Sprint 13 retro

This is when voice stops being a demo and starts being a real
input modality.

### Sprint 14 — Aether-Architect surface class: Mixers

**Theme:** the architect can draft mixers, not just sensors.

**Lanes:**
- Architect's whitelist extends from sensors to mixers
- Test case: architect builds a `morning_brief` mixer (or
  similar) composing existing surfaces
- Mixer template added to the corpus
- Sprint 13.5 cleanup
- Sprint 14 retro

Mixers are inherently more complex than sensors (they consume
multiple surfaces, produce composed output). Calibration data
from Sprints 11–13 sensor-class auto-fires is the prerequisite.

### Sprint 15 — 1.0 stabilize and ship

**Theme:** first serious tagged release.

**Lanes:**
- Polish across all content apps
- Documentation: install instructions, architecture overview,
  one-page "what is Aether"
- ADR finalization for everything pre-1.0
- README rewrite for someone-not-the-Director
- Tag `v1.0.0`
- Sprint 14.5 cleanup
- Sprint 15 retro

Doesn't add capability — promotes existing to public-facing.
Worth doing before the architecture starts diverging in
Sprints 16+.

### Sprint 16 — Voice depth pass 2 OR alternative

**Theme:** TBD at Sprint 15 retro.

If voice has shown weak spots through Sprints 13–15 (audio
quality, push-to-talk, long-form conversation), this becomes
voice depth pass 2.

If voice is solid by then, alternative candidates from the
Sprint 12+ pool fill this slot.

### Sprint 17 — Aether-Architect surface class: Content apps

**Theme:** architect can draft new renderer-side apps.

**Lanes:**
- Whitelist extends to content apps (the mesh-viz / proposals /
  news shape)
- Test case: architect builds a content app from scratch (e.g.,
  a `clipboard-viewer` or similar)
- Content app template added to corpus
- Sprint 16.5 cleanup
- Sprint 17 retro

By Sprint 17 the architect has 3 surface classes available
(sensors, mixers, content apps) and roughly 60+ lanes of
calibration data.

### Sprint 18 — Cross-surface action recording / replay

**Theme:** macros emerge.

**Lanes:**
- Record sequences of voice/mesh actions
- Replay as named macros, optionally on triggers
- "Every morning at 7am, daily-brief + summarize new mail" becomes
  a named macro you save once
- Composes with Sprint 8 planner, Sprint 9 daemon-planner,
  Sprint 12 memory
- Sprint 17.5 cleanup
- Sprint 18 retro

### Sprint 19 — Aether-Architect self-improvement (gated)

**Theme:** the platform learns how its principal prompts.

**Gating condition** (must be met before scheduling):
- Architect has filed ≥30 PRs successfully across sensors +
  mixers + content apps
- No architect-erosion incidents in preceding 90 days
- Director explicit-fire required (not auto-scheduled)

**If gated:** architect files PRs that improve its own prompts
based on lane-success patterns. Reads corpus of past lanes,
identifies prompt structures that correlate with fix-forward
incidents vs. clean lands, drafts prompt-template improvements.

**If gating condition not met:** slot becomes voice depth pass 2
or another candidate from the pool.

This is the recursive capability. Substrate-stays-human-architected
ADR is the wall against runaway.

### Sprint 20 — Open / candidate slot

Reserved. Plausible content based on Sprints 12–19 outcomes:

- Federation (Aether-on-laptop talks to Aether-on-server)
- Multi-user (second principal invited to a shared surface)
- Continued voice depth
- Continued architect surface expansion

Decision deferred to Sprint 19 retro.

## Candidate Themes Beyond Sprint 20

These are real directions; placement deferred.

- **Peripheral integration**: room-distributed speakers and
  microphones, cameras for vision, controlled devices (TV, lights,
  thermostat). Each becomes a node; auto-architect can ship them
  by then.
- **Federation**: Aether mesh spans multiple machines. Personal-OS
  on laptop, sensor-OS on home server, edge devices report into
  both.
- **Multi-user**: a second principal joins a shared surface. New
  permissions model required.
- **Mesh ecosystem**: third-party mesh nodes from outside the repo,
  loaded with permission gates.
- **Continued voice depth**: voice as a multi-modal interface
  (gesture, gaze, environment-aware).
- **Architect cross-substrate work**: architect can draft work in
  related repos, not just Aether's main.

These are not promises. They are *what we've imagined* and the
roadmap should not pretend they're scheduled.

## Failure Modes

Three patterns that have nothing to do with capability and
everything to do with how this project gets unwound.

### Substrate erosion

A future lane argues that Aether-Architect should be allowed to
touch the broker, manifest edge-graph, or confirmation pattern.
The argument might sound reasonable in isolation ("it's just one
small change," "the architect's draft for this is solid"). The
ADR exists precisely for this moment.

**Rule:** if substrate-erosion is being argued, that is the moment
to slow down, not speed up. ADR exists to defend against the
seemingly-reasonable case, not the obviously-wrong case.

### Skipping rungs

Sprints 6–8 land cleanly; impatience suggests pulling Aether-
Architect work forward. The gradient is the discipline. Each rung's
calibration data is the basis for the next rung's competence.

**Rule:** the architect's surface class expansion order is locked
(sensors → mixers → content apps) and tied to calibration data
volume, not calendar time. If Sprint 11 underperforms, slow Sprint
14, not speed it.

### Velocity confusion

Sprint 4 took ~3 weeks for 13 PRs. Sprint 5 substrate took ~4 days
for 5 PRs. A future Director or Architect interpreting "look how
fast we're moving" will under-budget every future sprint.

**Rule:** sprint variance is a feature. Some sprints are dense,
some are quiet. Use the 4-phase shape, not lane count, as the
sprint-completion signal. Retro is always Phase 4 regardless of
how few lanes shipped.

## How to Use This Document

**Read it** at the start of every Sprint Phase 1 (roadmap setting).
The current sprint's lane breakdown is the implementation of what
this doc has framed.

**Update it** at every Sprint Phase 4 (retro). The retro PR
includes any edits this doc needs. Most edits will be minor:
adjusting a Sprint description after lessons banked, moving a
candidate theme into a scheduled slot, recording an ADR that
shifts a constraint.

**Override it** only with explicit reasoning. The roadmap doc is
the long-running anchor; it loses authority if it's drifted
against without explanation. If a sprint's direction must change
mid-flight, write down why in the next retro.

**Don't extend it** past Sprint 20 without lived experience.
Sprints 21+ exist only after Sprint 19/20 have shipped and we know
what came of the recursive self-improvement loop. The candidate
themes section is for thinking about beyond — the sprint plan
section is for committing.

**Operational details live elsewhere.** Working model (4-role,
manual-completion playbook, §11 discipline, prompt template,
canonical PR body): see `CLAUDE.md`. Lessons banked from past
sprints: see `docs/governance-log.md`. Architectural decisions:
see `DECISIONS.md`. This doc owns direction; those own how.

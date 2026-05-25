# Sprint 5 Retrospective

**Status:** closing retrospective for Sprint 5 (Phase 4).

**Theme:** Mesh observability — the mesh becomes legible.

**Duration:** 4 substantive days (PR #109 → #115 merged), plus the retro lane itself.

**Outcome:** Sprint 5 Lane 1 substrate shipped end-to-end. The mesh now exposes its own topology and live activity as signed mesh surfaces, rendered in a categorical radial visualization. First sprint of the six-piece arc (Sprints 5–11) banked. Roadmap doc committed as canonical anchor. Nav cleaned, four content apps live. Foundation for Sprint 6 sensor expansion ready.

---

## What shipped

Six pull requests over four substantive days, plus retro infrastructure:

| PR | Title | Role in arc |
|----|-------|-------------|
| #109 | feat(mesh-broker): InvocationRecorder + dispatch hook + /__introspection__ endpoint | Broker exposes its own state |
| #110 | fix(mesh-broker): /__introspection__ payload — add node.category + edge.allowed | Forward-compat payload shape |
| #111 | feat(mesh-introspection): TypeScript daemon + manifest categorization + schema requirement | Substrate categorization locked |
| #112 | fix(mesh-broker): read category from manifest instead of hardcoding uncategorized | Wire closed between manifest and broker |
| #113 | feat(shell): mesh-viz content app — radial topology + activity feed (108a) | Visual smoke for the entire stack |
| #114 | docs(roadmap): bank Sprints 5-20 direction and architectural anchors | Long-horizon anchor written |
| #115 | chore(shell): nav cleanup — remove welcome/markdown/mesh-devtools, rename mesh-viz to Mesh, fix Finance icon | Phase 3 polish closure |
| #104 | (issue comment) | Umbrella updated with deferred lane candidates (108b/c/d) |

Substrate validated end-to-end via Director visual smoke (PR #113):
- 17 nodes render in radial layout (12 Sensor / 1 Actor / 4 Mixer / `core` at center, special-cased)
- Edges drawn per-surface, source-category-colored
- Live activity feed populates within ~2s
- Hover state highlights node + its edges
- "Show core" toggle hides core + its edges
- No console errors

Bundle size dropped 39% after #115's deletions (renderer JS 1,012 KB → 622 KB).

## What this sprint proved

Three substantive validations from this sprint, distinct from the lessons-banked section below:

**1. The four-category vocabulary (Sensor/Actor/Mixer/Planner) is real.** It survived contact with the manifest, the broker, and the renderer. All 16 user nodes were categorized cleanly; `core` was the only edge case (categorized as Mixer because it composes other surfaces during dispatch). The vocabulary holds.

**2. The mesh-as-extension-unit pattern works at the visual layer.** Mesh-viz renders 17 heterogeneous nodes using one consistent visual language. Adding a new node tomorrow requires zero changes to mesh-viz — it just appears in the right category sector with the right symbol. This is the substrate paying off for the first time.

**3. The substrate-stays-human-architected ADR is real, not aspirational.** Five substrate PRs landed; the human Architect (this chat) drafted every prompt, reviewed every PR body, walked §11 manually. No automated planning touched broker/manifest/confirmation work. Sprint 5 is the largest exercise of the ADR in practice and it held without strain.

## Lessons banked

Grouped by where they're persisted. Operational lessons (CLAUDE.md, governance-log) are surgical edits; roadmap/ADR-level lessons land in the canonical docs. This retro PR includes all of those edits.

### Process discipline (lands in CLAUDE.md and governance-log)

**Manual completion playbook expansion.** Hand-completion now spans seven PRs in five distinct shapes: Implementer-wrote-Director-shipped (#65, #66), Implementer-stalled-Director-finished-and-shipped (#110, #112, #113 verify), hand-written documentation lane (#114), hand-edit code lane spanning two calendar days with uncommitted state preserved (#115). The playbook is no longer a single pattern; it's a kit. Documented in CLAUDE.md §13 and `docs/manual-completion.md`.

**Two-session lane recovery is mature.** Files persist on disk between CC sessions. Resume prompts run ~30–40% the size of original prompts because they skip the explorer phase and reference already-on-disk contracts as locked. Pattern stable: #107 → #113 → #115. The signal we don't yet have a clean fix for: when *both* sessions in a two-session lane stall on the same kind of network error (ECONNRESET pattern below).

**Tight explorer briefs hold their value.** #107's seven-subtask brief drove a 6+ minute explorer phase. #113's three-subtask brief drove a 2-minute-1-second explorer phase. Half the lanes since #107 have used the tighter pattern; explorer overhead drops by ~60% with no loss of read fidelity. CLAUDE.md §13 codifies the discipline.

**§7 canonical PR body is non-negotiable.** Bot caught the §7 violation on #110. Every PR since has walked the full §7 sections (What changed / How / What did NOT change / §11 heuristics / Risks / Verification / Open questions / Process lessons). No further bot catches.

**§11 pre-PR heuristics surface real catches.** #113's §11.4 walk identified the AppDefinition `name` vs `title` discrepancy (Architect's resume prompt said `title`; Implementer caught the truth). #115's §11.6 walk identified the CHANGELOG-insertion-into-multi-subsection-`[Unreleased]` bug. Heuristics earn their cost; they're the cheapest way Architect-Director catches its own mistakes.

**Implementer-side decision authority pays off.** When prompts give the Implementer real authority to make local choices ("pick whichever you can implement cleanly; document choice in PR body") instead of pre-deciding everything: choices are good, decisions arrive with reasoning attached. #113 chose Strategy A radial layout with documented reasoning; the Architect's resume prompt left it explicitly open. Compare to lanes where every decision was pre-baked into the prompt — those produced equally good code but the decision-history was lost in the prompt rather than recoverable from the PR body.

### Operational gotchas (CLAUDE.md §10 edits)

**`pnpm install` is required after merging a PR that adds a workspace package.** Git rebase brings `package.json` + lockfile but doesn't materialize `node_modules`. Hit on the main worktree after #111 landed; hit again on the viz worktree after #113 (preemptively avoided). CLAUDE.md §10 entry: "After merging a PR that adds a new workspace package, run `pnpm install` from any worktree picking up the change."

**CHANGELOG insertion logic is broken when `[Unreleased]` has multiple subsection blocks.** The naive "insert before next `## [` heading after `[Unreleased]`" puts content at the bottom of `[Unreleased]` rather than inside the appropriate subsection. Hit on #115; fix took a two-step Python edit (delete misplaced, append to existing). Correct logic: "find the matching subsection within `[Unreleased]`; if it exists, append the bullet there; if not, create the subsection right after `### Added`." CLAUDE.md §10 entry banked.

**AppDefinition uses `name`, not `title`.** Architect resume prompts referenced `title`; Implementer caught it on #113. The actual `AppDefinition` interface lives in `shell/src/lib/app-definition.ts`. CLAUDE.md §10 entry: "AppDefinition's display label field is `name`, not `title`. If a content-app lane prompt references `title`, treat it as the prompt being wrong, not the interface."

**Hand-edit lanes can span calendar days.** #115 was started one evening, paused when Director was tired, resumed the next morning. Uncommitted branch state was preserved on disk via `git status`. The pattern works without modification. CLAUDE.md §13 entry codifies hand-edit lanes as a parallel branch of the manual-completion kit, including the multi-day variant.

**Bundle size deltas are real feedback signals for deletion lanes.** #115's three-app removal dropped renderer JS by ~39% (1,012 KB → 622 KB) and CSS by ~21%. Deletion lanes should report bundle delta in PR bodies going forward — it's the smoke gate that confirms the deletion actually took effect rather than leaving dead references behind. Light §11 update.

### Architectural decisions (DECISIONS.md ADR + roadmap doc edits)

**Substrate-stays-human-architected.** Formal ADR record in DECISIONS.md (not just described in the roadmap). The Aether-Architect node is NEVER authorized to touch `core/core/` (broker), `manifest.yaml` edge-graph topology (declared safe surfaces can be touched; the *structure* of allowed-edges cannot), or the confirmation pattern (Sprint 7 work). If a future lane proposes loosening this rule, the discipline is to slow down, not speed up. This is the load-bearing constraint of the entire self-extension arc.

**Manifest `description` field convention.** New convention introduced in Sprint 5 retro, applied in Sprint 6: every `manifest.yaml` node entry includes an optional `description: string` describing what the node does in user-facing language. Three downstream consumers: mesh-viz hover tooltips (Sprint 6 sub-lane), raven voice introspection at Sprint 13 ("Hey Aether, what can you do?"), and Aether-Architect at Sprint 10 (understanding what already exists before drafting new surfaces). DECISIONS.md ADR + roadmap doc Sprint 6 lane added.

**Voice-as-universal-consumer.** Raven's structural position as the only node with edges to every other surface is load-bearing for principal-facing introspection. Documented in the roadmap doc's Personalization Arc section — when voice depth lands at Sprint 13, "what can you do?" is answered by raven consuming `mesh_introspection.topology` and reading manifest `description` fields aloud, not by a separate Capabilities content app.

**The 4-phase sprint shape is the unit, not the calendar.** Sprint = roadmap → cleanup → features → retro. Sprint variance in lane count is a feature, not a bug. Sprint 4 was 13 PRs over ~3 weeks; Sprint 5 was 7 PRs (substrate + roadmap + polish + retro) over roughly 5 calendar days. Future Architects evaluating "are we on track?" should look at phase completion, not lane count or calendar time. Already in roadmap doc's Architectural Anchors; this retro reaffirms.

### Items deferred to follow-up lanes

**108b — Click-to-inspect detail panel.** Listed in original #104 spec as a validation-gate item; deferred. Selected node opens side panel showing surfaces with schemas, recent activity filtered to that node, edges in/out. Closes the last validation-gate item from #104's spec. No sprint slot assigned yet.

**108c — Live pulse animation on edges.** When a new activity record arrives via the 2s poll, the relevant edge pulses briefly. Requires deciding animation approach (CSS transitions vs Framer Motion vs SVG SMIL) and activity-diff strategy (compare last-poll vs current, animate diff). No sprint slot.

**108d — Manifest `description` field + mesh-viz hover descriptions.** First downstream consumer of the manifest description convention. Mesh-viz hover tooltips render the description. Backfill required for the 17 existing nodes (Sprint 6 sub-lane).

**ECONNRESET investigation.** Two consecutive sessions on #113 stalled with clean ECONNRESET at retry 10/10 after long writes (~17 minutes and ~23 minutes into the write phase). Different mechanism from retry-storm pattern. Possible causes: status.claude.com incidents during the windows, macOS network stack hiccups on long-running HTTP streams, VPN/proxy interference, request-size thresholds. Worth a Sprint 5.5 cleanup lane (Phase 2 of Sprint 6) to investigate: check status pages historically, profile network behavior during long writes, decide if there's a mitigation. Bank as a known-issue in governance-log with the investigation deferred.

**UI revamp brainstorming.** Director-flagged design discussion. Not a code lane; a scoped design conversation. Will happen separately, likely between Sprint 5 retro and Sprint 6 Phase 1.

**Voice model variant swap.** Director-flagged config change (raven currently uses a default voice variant; preference for a different one). Small lane, ~10-20 minutes when fired. No sprint slot needed — fires independently when convenient.

## Sprint 6 transition notes

Sprint 6's lane list, drawn from the roadmap doc + this retro's additions:

**Core sensor expansion lanes:**
- Calendar enhancement (existing node; check if surface expansion needed)
- Location passive sensor (home/work/transit; no GPS streaming)
- Focus state sensor (foreground app, idle, DND)
- Sports node (Pulse-matching surfaces; RAVEN voice tool follows)
- Research node (needs Pulse read for scope decision — academic vs broader)
- Clipboard history enhancement (existing; possible surface additions)

**Substrate work supporting Sprint 13's voice introspection:**
- Manifest `description` field convention applied to all new sensors
- Backfill `description` for the 17 existing nodes
- (Optional this sprint, depending on slack) 108d sub-lane: mesh-viz hover renders descriptions

**Sprint 5.5 cleanup (Phase 2):**
- ECONNRESET investigation + dev-env audit
- Any other Sprint 5 loose ends surfaced during retro

**Phase 1 deliverable:** a Sprint 6 lane spec drawing from the roadmap doc. Likely fewer than 8 lanes — we'll trim to 4-5 highest-leverage and defer rest to Sprint 6.5 / Sprint 7. Width over depth: each sensor is a known Pulse-hoist pattern, not a deep architectural change.

## Process meta-observation

Sprint 5 is the first sprint where the roadmap doc, the retro doc, and the canonical PR body discipline were *all* in place from start to finish. Sprint 4's retro existed; the roadmap doc did not. Sprint 5's documentation triumvirate is now load-bearing for Sprint 6's start — Sprint 6 Phase 1 (roadmap-setting) reads this retro + the canonical roadmap doc as its starting context.

The cost of this discipline is real (the retro lane itself is ~5 hours of writing across two messages and a verify); the value is that Sprint 6 starts with substantially less context-loss between sprints than Sprint 5 did. Future Architect chats inherit a real handoff anchor.

## Closing

Sprint 5 Lane 1 (Mesh observability) is complete. The substrate is observable, categorized, visualizable. The roadmap doc anchors the long-horizon direction. The retro banks what we learned.

Sprint 6 Phase 1 starts next.

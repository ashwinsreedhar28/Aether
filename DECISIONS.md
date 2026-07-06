# Decisions

Append-only Architecture Decision Records for Aether (working name
homeOS through v0.3.x). Format and rules per CLAUDE.md §8.

**This file is a GENERATED index — do not hand-edit.** ADRs live one per
file under [`decisions/`](decisions/), named `<date>-<slug>.md`. Never
edit a past ADR file — supersede with a new file and flip the old file's
`Status:` to `superseded by [link]`. Regenerate this index with
`node scripts/gen-decisions-index.mjs` in the same PR as any decisions/
change. Entries dated before the rename PR refer to the project by its
working name; they are preserved verbatim as historical record.

- **[2026-07-06]** [ADR: Browser tabs are shell tabs — one tab system, no in-app strip (#336)](decisions/2026-07-06-browser-tabs-are-shell-tabs.md)
- **[2026-07-06]** [ADR: Harness transcript contract + ephemeral credentials (#366)](decisions/2026-07-06-harness-transcript-contract-ephemeral-credentials.md)
- **[2026-07-06]** [ADR: The R2 revision loop — four laws for the gate's REVISING state (#339)](decisions/2026-07-06-r2-revision-loop.md)
- **[2026-07-06]** [ADR: The semantic region grammar is the canonical placement path (#337)](decisions/2026-07-06-semantic-region-grammar.md)
- **[2026-06-18]** [ADR: TS SDK canonical must match wire-roundtrip canonical (#359)](decisions/2026-06-18-ts-sdk-canonical-undefined.md)
- **[2026-06-17]** [ADR: finance.chart fetches live upstream OHLC for the detail page — the "no upstream historical fetch" posture is scoped to the history series, not the node (#354)](decisions/2026-06-17-finance-chart-upstream-fetch-detail-page.md)
- **[2026-06-17]** [ADR: the research Mixer is the first node to call an LLM directly — key from env, model is config, failure is a MeshDeny (#353)](decisions/2026-06-17-research-mixer-anthropic-caller.md)
- **[2026-06-11]** [ADR: apps are interactive MeshApps; panels stay display-only (#334)](decisions/2026-06-11-apps-interactive-panels-display-only.md)
- **[2026-06-11]** [ADR: per-lane changelog fragments + ADR-per-file split — the two shared append surfaces stop being rebase magnets (#222)](decisions/2026-06-11-changelog-fragments-adr-per-file-split.md)
- **[2026-06-11]** [ADR: closeout is the spawn's mirror — guarded teardown executed by the shell, confirm-gated, capacity freed only by closed (#317)](decisions/2026-06-11-closeout-spawn-s-mirror-guarded-teardown-executed-shell.md)
- **[2026-06-11]** [ADR: control-bridge errors ride a resolved envelope — a rejection never crosses executeJavaScript (#300)](decisions/2026-06-11-control-bridge-errors-ride-resolved-envelope-rejection-never.md)
- **[2026-06-11]** [ADR: the issue thread is the lane channel — gate-report prefixes and the ledger relay family (#310)](decisions/2026-06-11-issue-thread-lane-channel-gate-report-prefixes-ledger-relay.md)
- **[2026-06-11]** [ADR: mute is a soft gate inside the orchestrator — the session survives (#219)](decisions/2026-06-11-mute-soft-gate-inside-orchestrator-session-survives.md)
- **[2026-06-11]** [ADR: the orphan list is a pull-refreshed cache, and record-backed orphan rows are completable (#318)](decisions/2026-06-11-orphan-list-pull-refreshed-cache-record-backed-orphan-rows.md)
- **[2026-06-11]** [ADR: Rung 1.5 — machine drafts never self-certify; the composer is an out-of-mesh PAT actor; the draft model is config (#312)](decisions/2026-06-11-rung-1-5-machine-drafts-never-self-certify-composer-out-mesh.md)
- **[2026-06-11]** [ADR: terminal status writes on live-session spawn records are warn-and-force, never silent (#305, narrows #304)](decisions/2026-06-11-terminal-status-writes-live-session-spawn-records-warn-force.md)
- **[2026-06-10]** [ADR: the gap ledger is dead — intents node retired, gaps live only on the board (Lane C of #255)](decisions/2026-06-10-gap-ledger-dead-intents-node-retired-gaps-live-only-board.md)
- **[2026-06-10]** [ADR: gaps are GitHub issues — the `github` node surface contract (Lane A of #255)](decisions/2026-06-10-gaps-github-issues-github-node-surface-contract-lane-255.md)
- **[2026-06-10]** [ADR: lanes spawn from issues card-gated — batch = one card, recipes serialize, capped at spawn.max_lanes (#268)](decisions/2026-06-10-lanes-spawn-issues-card-gated-batch-one-card-recipes.md)
- **[2026-06-09]** [ADR: `raven → visualizer.render` edge removed with the Dashboard-era voice tools (Lane 3, folds #210)](decisions/2026-06-09-raven-visualizer-render-edge-removed-dashboard-era-voice.md)
- **[2026-06-09]** [ADR: trunk-branch-only merge gate — CI + auto-review cover `integration/*`, fork PRs skipped by design](decisions/2026-06-09-trunk-branch-only-merge-gate-ci-auto-review-cover.md)
- **[2026-06-09]** [ADR: Viewer × Aether merge — capability-by-capability reconciliation](decisions/2026-06-09-viewer-aether-merge-capability-capability-reconciliation.md)
- **[2026-06-09]** [ADR: visualizer node despawned on desktop — code, manifest entry, and reserved shell edge held for the AVP track (issue #220)](decisions/2026-06-09-visualizer-node-despawned-desktop-code-manifest-entry.md)
- **[2026-06-07]** [ADR: the draft is the slug contract (spawn v1.1 — parse, don't re-derive)](decisions/2026-06-07-draft-slug-contract-spawn-v1-1-parse-don-t-re-derive.md)
- **[2026-06-07]** [ADR: the spawn actor — voice-armed, card-gated self-build (passphrase-in-env + append-only ledger)](decisions/2026-06-07-spawn-actor-voice-armed-card-gated-self-build-passphrase-env.md)
- **[2026-06-04]** [ADR: draft_lane writes lane prompts direct to disk (raven-local artifact, no mesh hop)](decisions/2026-06-04-draft-lane-writes-lane-prompts-direct-disk-raven-local.md)
- **[2026-06-04]** [ADR: mail lane headline pivots from "read body aloud" to "pull the email up" (open_message actor)](decisions/2026-06-04-mail-lane-headline-pivots-read-body-aloud-pull-email-up-open.md)
- **[2026-06-03]** [ADR: macos_mail capture is latency-hardened — bulk-read headers, bounded one-per-tick bodies, DB observability](decisions/2026-06-03-macos-mail-capture-latency-hardened-bulk-read-headers.md)
- **[2026-06-03]** [ADR: mail-body lane expanded to a full vertical (node + tool + prompt)](decisions/2026-06-03-mail-body-lane-expanded-full-vertical-node-tool-prompt.md)
- **[2026-05-20]** [ADR: `pnpm -r build` before typecheck for SDK-shape workspace package auto-discovery](decisions/2026-05-20-pnpm-r-build-before-typecheck-sdk-shape-workspace-package.md)
- **[2026-05-19]** [ADR: AppleScript bridge primitive (`core/macos_applescript`)](decisions/2026-05-19-applescript-bridge-primitive-core-macos-applescript.md)
- **[2026-05-19]** [Sprint 4 process discipline codified](decisions/2026-05-19-sprint-4-process-discipline-codified.md)
- **[2026-05-18]** [Splash dismiss gated on backend readiness](decisions/2026-05-18-splash-dismiss-gated-backend-readiness.md)
- **[2026-05-15]** [Node 22+ baseline for Aether macOS host](decisions/2026-05-15-node-22-baseline-aether-macos-host.md)
- **[2026-05-14]** [Codify ADR template fields as required (CLAUDE.md §8)](decisions/2026-05-14-codify-adr-template-fields-required-claude-md-8.md)
- **[2026-05-14]** [MCP integration arc roadmap: authenticated personal data via MCP](decisions/2026-05-14-mcp-integration-arc-roadmap-authenticated-personal-data-via.md)
- **[2026-05-14]** [New-node registration template required (CLAUDE.md §10)](decisions/2026-05-14-new-node-registration-template-required-claude-md-10.md)
- **[2026-05-14]** [Rename project homeOS → Aether (working name retired)](decisions/2026-05-14-rename-project-homeos-aether-working-name-retired.md)
- **[2026-05-14]** [Three-tier auth as a named architectural pattern (CLAUDE.md §12.1)](decisions/2026-05-14-three-tier-auth-named-architectural-pattern-claude-md-12-1.md)
- **[2026-05-14]** [Voice ambient arc roadmap: ambient presence in five pieces](decisions/2026-05-14-voice-ambient-arc-roadmap-ambient-presence-five-pieces.md)
- **[2026-05-14]** [Voice extensibility arc roadmap: five-piece tool substrate](decisions/2026-05-14-voice-extensibility-arc-roadmap-five-piece-tool-substrate.md)

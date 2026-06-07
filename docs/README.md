# Aether documentation

The index for everything under `docs/`. Top-level docs that live at the repo root
— [CLAUDE.md](../CLAUDE.md) (operating manual), [MASTER_SYNTHESIS.md](../MASTER_SYNTHESIS.md)
(architecture briefing), [DECISIONS.md](../DECISIONS.md) (ADRs), and
[CHANGELOG.md](../CHANGELOG.md) — are not repeated here; start with the
[project README](../README.md) for the high-level picture.

## Roadmaps

The forward-looking plan for each architectural arc.

| Doc | Arc |
|---|---|
| [vision-roadmap.md](vision-roadmap.md) | The long-horizon vision for Aether |
| [agent-platform-roadmap.md](agent-platform-roadmap.md) | The agent platform |
| [voice-ambient-roadmap.md](voice-ambient-roadmap.md) | Ambient / always-listening voice |
| [voice-extensibility-roadmap.md](voice-extensibility-roadmap.md) | The voice-tool extensibility substrate |
| [mcp-integration-arc-roadmap.md](mcp-integration-arc-roadmap.md) | MCP client integration (three-tier auth) |

## Architecture (visual)

The living map of the running system, plus a frozen gallery of point-in-time snapshots.

| Doc | What's in it |
|---|---|
| [atlas/](atlas/README.md) | **The Atlas** — `architecture.html` is the living map (process topology, mesh, voice pipeline, data layer, cockpit, self-building loop, ports); `history/` holds dated, frozen snapshots |

## Patterns & process

How work gets built and shipped.

| Doc | What's in it |
|---|---|
| [claude-reference.md](claude-reference.md) | Reference appendix for [CLAUDE.md](../CLAUDE.md) — relocated worked examples, historical PR lists, shape histories, templates, the glossary, and extended rationale (§ anchors match CLAUDE.md; keeps the operating core ≤30k). Indexed by the `aether-rag` corpus |
| [new-node-pattern.md](new-node-pattern.md) | The canonical recipe for adding a mesh node |
| [scene-protocol.md](scene-protocol.md) | Scene-server wire contract — renderer-facing (the AVP / 3D-shell track) |
| [implementer-prompt-template.md](implementer-prompt-template.md) | The template every Implementer lane prompt is drafted against |
| [manual-completion.md](manual-completion.md) | The hand-completion fallback for hostile-API days |
| [rebase-playbook.md](rebase-playbook.md) | The rebase oral law — keep-all CHANGELOG, keep-both sections, recount shared scalars, lease the force-push |
| [BRANCH_PROTECTION.md](BRANCH_PROTECTION.md) | Branch-protection configuration and rationale |

## Governance & decisions

| Doc | What's in it |
|---|---|
| [governance-log.md](governance-log.md) | The accumulated operational lessons (the §10 gotcha log) |

## Retrospectives

Per-sprint retros. (Sprint 3 has no standalone retro; its lessons fold into the surrounding sprints.)

- [sprint-1-retrospective.md](sprint-1-retrospective.md)
- [sprint-2-retrospective.md](sprint-2-retrospective.md)
- [sprint-4-retrospective.md](sprint-4-retrospective.md)
- [sprint-5-retrospective.md](sprint-5-retrospective.md)

## Releases

Per-release narrative notes (the human-readable companion to the CHANGELOG).

- [releases/v0.10.0.md](releases/v0.10.0.md) — The Cockpit & the Self-Building Loop

## Branding

- [branding/aether-icon.svg](branding/aether-icon.svg) · [branding/aether-icon-1024.png](branding/aether-icon-1024.png) — the aurora-curtain app icon

## Archive

Material moved out of the top-of-tree files once they grew past their choke threshold
(see CLAUDE.md §13.3). Preserved verbatim as historical record.

- [archive/changelog-unreleased-pre-sprint-4.md](archive/changelog-unreleased-pre-sprint-4.md)
- [archive/decisions-pre-2026-05-14.md](archive/decisions-pre-2026-05-14.md)

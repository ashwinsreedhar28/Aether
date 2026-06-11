## [2026-06-09] ADR: Viewer × Aether merge — capability-by-capability reconciliation

**Status:** Accepted. **Supersedes** the 2026-05-26 "Aether is the data layer; scene server is the presentation layer" ADR and the presentation half of the 2026-05-26 "Direction shift to dashboard + scene-driven architecture" ADR (the scene server is retired as the layout authority; see Decision §5).

**Decided by.** Ashwin (Director/Architect) + Colton (Viewer author), ratified jointly.

**Context.** Two mature systems converged on one repo: Aether (the self-building substrate — signed mesh, raven voice, spawn/self-build loop, RAG corpus, merge gate) and viewer-desktop (a production-grade Electron window-manager frontend with a pluggable "every screen is an app" registry). PR #201 staged viewer-desktop into Aether across 11 commits (7 capability-scoped staging + 4 wiring phases), deliberately keeping overlapping implementations side-by-side for the architects to rule rather than auto-resolving. Aether is the trunk/host; Viewer is its surface. This ADR records the per-capability rulings so the reconciliation proceeds as a sequence of gated lanes rather than one unreviewable merge, and so the self-build loop retrieves these decisions as durable law.

**Decision.** Per capability:
1. **Surface/window manager** — ADOPT Viewer. Aether's holographic dashboard renderer is replaced; Viewer's workspace▸window▸tab manager is the surface.
2. **App registry** ("every screen is an app") — ADOPT Viewer, plus a runtime-registration hook (Phase-2 `onRegistryChange`) so mesh-built apps appear live, closing the build-time `import.meta.glob` gap.
3. **Mesh node SDK** — COLLAPSE onto `core/node_sdk_ts` (`@aether/mesh-node-sdk`). Viewer's vendored MeshNode is deleted; Phase-3 `viewer_desktop` already repointed to the canonical SDK and a shell→Core→`viewer_desktop.open_app` round-trip succeeded.
4. **Transport seam** (`viewer_desktop` control node) — KEEP. A schema'd Actor node with HMAC identity (`MESH_VIEWER_DESKTOP_SECRET`), eight surface schemas, and `raven→viewer_desktop` edges. Agents drive windows over the mesh; the renderer feeds `view_event` back.
5. **Scene server vs. workspace store** — ARCHIVE the AVP scene server (preserved in git history / tag for the future spatial-AVP track); Viewer's workspace store is the layout authority. This retires the data-layer/presentation-layer boundary ADR above. Consequence: the 2026-06-07 music-panel ruling (display-panel + voice, no interactive panel kind, against the scene-server protocol) is VOID; music re-homes as a Viewer app.
6. **Assistant** — RAVEN ONLY. The Claude Agent SDK command-palette is removed entirely (not kept dormant); cmd-/ is the raven-core console. The "keep both runtimes, unify at tool-dispatch" proposal is rejected.
7. **Voice/audio** — DEMOTE Viewer's Whisper dictation; KEEP the Web-Audio feedback engine.
8. **TypeScript strictness** — HOLD Aether's strict bar (`strict` + `noUncheckedIndexedAccess`) across the whole shell including `src/apps/*`. Viewer's renderer is leveled up to the bar, not the bar lowered. Rationale: `src/apps/` is the self-build loop's target directory; every Aether-built app must clear the same gate as hand-written substrate. Implemented in `b66586a` (no tsconfig loosening; ~30 files of guard/null-check insertions; verified strict flags remain on).
9. **CI fork-blindness** — the auto-review action cannot obtain an OIDC token on fork-originated PRs (`ACTIONS_ID_TOKEN_REQUEST_URL` unavailable), so it 401s before running. Fix the workflow or route external-contributor work through trunk branches now that Colton is a collaborator.

Merge proceeds as gated lanes, dependency-ordered, each its own PR through the merge gate (Director presses every button):
- **Lane 1** — remove Claude palette + Agent SDK; resolve `mcp-inspector` disposition (re-home onto Aether/mesh types or remove).
- **Lane 2** — delete Viewer's vendored mesh SDK; everything on `@aether/mesh-node-sdk`.
- **Lane 3** — archive scene server; remove from shell boot; Viewer store is layout authority.
- **Lane 4** — adopt surface + app registry with the runtime-registration hook.
- **Lane 5** — confirm the `viewer_desktop` node: review the 8 schemas + manifest edges (its own ADR; only manifest-contract change).
- **Lane 6** — CI fork-PR fix.
- **Lane 7** — prune dangling Leap-Motion imports (`App.tsx`, `index.ts`, preload).

**Consequences.**
- Aether gains a production desktop surface and a self-build target (`src/apps/`) under the strict bar; the self-build loop can scaffold apps to the `AppDefinition` contract.
- One assistant runtime (Raven), one mesh SDK, one layout authority — net simplification despite the size of the merge.
- The scene server and the music-panel ruling are retired; music becomes a Viewer app. The data-layer/presentation-layer ADR and the scene-driven direction-shift ADR are superseded; future spatial-AVP work re-derives from the archived source.
- `mcp-inspector` carries a Claude-SDK-type dependency to resolve in Lane 1.
- PR #201 is NOT merged as-is; it is the staging substrate the lanes are cut from.
- Two-architect governance: rulings here are jointly ratified; the Director retains sole merge authority.

**Alternatives considered.**
- Make Viewer the trunk and import Aether: rejected — the self-building substrate is the hard-to-reconstruct core; a frontend can be re-skinned.
- Merge #201 directly to main: rejected — bundles additive staging with irreversible renderer/manifest changes; cannot pass the gate as one PR; rules the contested middle by merging rather than deciding.
- Scope-split tsconfig (strict substrate, lax `src/apps/*`): rejected — `src/apps/` is exactly where self-build writes, so a lax bar there is self-perpetuating.
- Keep both assistant runtimes / both mesh SDKs: rejected — unnecessary duplication once the mesh path is shared.
- Keep the scene server as an optional secondary render target: rejected for now — two layout authorities is the creep this supersedes; archived rather than deleted so the AVP track can revive it.

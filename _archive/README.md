# Archived code

Code preserved for future reference or pattern-lifting. Not built, not
run, not maintained. If a file here is needed in active development,
copy it out and bring it back to its working location — don't extend
or modify in place.

## shell-content-apps/

Archived in Sprint 6.1 (PR #121 or similar). Aether's pre-direction-
shift content-app paradigm: `news`, `finance`, `voice-control`,
`mesh-viz`. Each was a React content app rendered inside the shell's
launcher nav bar. Removed as part of the direction shift to
dashboard + on-demand visualization (see
`docs/agent-platform-roadmap.md` Sprint 5.5 narrative).

These apps continue to compile if revived, but are not bundled. The
launcher infrastructure that loaded them (`app-registry.ts`,
`app-definition.ts`, `active-app` store) was deleted outright since
it has no consumers after archive. To revive any content app:

1. Copy the directory out of `_archive/shell-content-apps/<name>/`
   to `shell/src/apps/<name>/`
2. Reimplement an app-registry or mount the app directly in App.tsx
3. Add a navigation surface (the launcher is gone)

The current direction (post-Sprint-5.5) is that content apps are
the wrong shape. Use the visualizer node + scene server pattern
instead (Sprint 6.4+). (Superseded in turn by the 2026-06-09
Viewer × Aether merge ADR — the scene server is retired and
Viewer's workspace store is the layout authority; see below.)

## raven-avp-server (scene server) — retired, preserved in git history

Retired in Lane 3 of the Viewer × Aether merge (ADR 2026-06-09 §5:
ARCHIVE the AVP scene server; Viewer's workspace store is the layout
authority). Unlike `shell-content-apps/`, the scene server was a git
**submodule**, not in-repo code, so there is nothing to relocate into
this directory. It is preserved as:

- Upstream repo: <https://github.com/R-A-V-E-N-delegate/RAVEN_AVP>
- Last pinned gitlink: commit `2a7833a` of that repo, recorded at
  `daemons/raven-avp-server` up to Aether commit `ba1ca6c` (vendored
  by PR #122, removed by the Lane 3 PR).

To revive for the spatial-AVP track: re-add the submodule at the
pinned commit, restore the shell wiring (daemon manager, scene
subscriber, scene-order handlers, `scene:*` preload namespace) from
git history at `ba1ca6c`, and re-derive the layout-authority split
from the 2026-06-09 ADR.

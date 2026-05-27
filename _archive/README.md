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
instead (Sprint 6.4+).

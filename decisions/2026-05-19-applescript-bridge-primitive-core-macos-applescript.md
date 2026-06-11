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

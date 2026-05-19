# @aether/macos-applescript

Thin TypeScript bridge around `osascript`. Used by macOS daemon nodes
(Mail, and — Sprint 5+ — Reminders, Notes, Calendar.app) to invoke
AppleScript snippets with structured error categorization, without each
daemon having to re-implement the same `child_process` + stderr-parsing
dance.

The bridge does NOT parse AppleScript output. Each consumer chooses its
own on-the-wire format (the Mail daemon uses tab-separated values, one
record per line, because that's the simplest thing AppleScript can
produce). The bridge returns `output` as the raw stdout string.

## API

```ts
import { runAppleScript } from '@aether/macos-applescript'

const result = await runAppleScript(MY_SCRIPT, { timeoutMs: 15_000 })
if (result.ok) {
  // result.output is the stdout string from osascript
} else {
  switch (result.error) {
    case 'permission_denied': // user hasn't granted Automation access to the target app
    case 'timeout':           // osascript took longer than timeoutMs
    case 'syntax':            // the script itself didn't compile
    case 'unknown':           // anything else (non-zero exit we don't recognize)
  }
}
```

Default timeout is 30000ms. Daemons that poll on a tight cadence should
pass a shorter value so a single slow script can't queue ticks.

## Error categorization

The bridge inspects `stderr` and the exec error object:

- `permission_denied` — `stderr` contains `(-1743)` (Automation entitlement
  denied) or the literal `not authorized` (TCC denial). The first call
  to a TCC-gated app shows the user-facing prompt; subsequent denials
  return this category without prompting again.
- `timeout` — `child_process.execFile` killed the process after
  `timeoutMs` elapsed.
- `syntax` — `stderr` contains `syntax error` (script didn't compile).
- `unknown` — any other non-zero exit (e.g. the target app isn't running
  and refused to launch; an unexpected scripting term).

Consumers should treat `permission_denied` as a soft failure (log once,
skip the cycle, retry next tick — the daemon stays up so a user grant
takes effect without a restart). `syntax` is a code bug — log the
message and move on.

## Why a separate package

Mail is the first consumer. Reminders, Notes, and Calendar.app daemons
will follow in Sprint 5+; pulling the bridge out as `@aether/macos-applescript`
keeps each daemon's `src/` focused on its own AppleScript and dedup
logic, and gives the bridge a single home for future improvements
(JXA, persistent osascript process, structured-output mode).

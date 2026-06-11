// Defensive extraction for values parsed out of login-shell captures.
//
// Login-interactive rc files write arbitrary lines to stdout: on some boots
// macOS Terminal's /etc/zshrc_Apple_Terminal prints a restored-session
// banner ABOVE the probe's real output. Verbatim field value that poisoned
// the tmux binary path (#302 defect 6, caught on the orphan-reattach smoke;
// intermittent because the banner only prints on restored sessions):
//
//   "Restored session: Thu Jun 11 02:22:13 PDT 2026\n/opt/homebrew/bin/tmux"
//
// trim() kept both lines, spawn() ENOENT'd, session enumeration failed, and
// orphans never seeded. The law: any single value parsed from a `-l`/`-lic`
// shell capture must be extracted defensively — never trim()-trusted.

// The last absolute-path line of a capture — rc noise prints around the
// probe output, so the last line starting with '/' wins (not literally the
// last line: noise can trail the path too) — or null when no line looks
// like a path. Callers existsSync-validate the result: extraction finds the
// candidate, the filesystem confirms it.
export function pickBinaryLine(captured: string): string | null {
  const lines = captured
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line && line.startsWith('/')) return line
  }
  return null
}

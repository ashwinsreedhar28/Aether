// Restore the execute bit on node-pty's spawn-helper after install.
//
// node-pty >= 1.1.0 ships macOS prebuilds (prebuilds/darwin-*/spawn-helper)
// instead of compiling via node-gyp, and pnpm's tarball extraction does not
// preserve the file mode — the helper lands as rw-r--r--. node-pty then
// fails every pty.spawn with the opaque "posix_spawnp failed." (the helper
// is posix_spawn'd as the child bootstrap), which presents as terminals
// opening dead/blank windows. Bit the desktop on 2026-06-10 after the
// integration-merge reinstall bumped node-pty 1.0.x (node-gyp, exec bits
// set by the build) to 1.1.0 (prebuilds, bits lost).
//
// Runs as the shell package's postinstall. Idempotent, silent when there is
// nothing to fix, and never fails the install (a missing node-pty just means
// nothing to do — e.g. a CI job that only builds python).
import { globSync } from 'node:fs';
import { chmodSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const patterns = [
  // pnpm layout (the one this repo uses) and a plain-npm fallback.
  'node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper',
  'node_modules/node-pty/prebuilds/*/spawn-helper',
];

let fixed = 0;
for (const pattern of patterns) {
  for (const file of globSync(pattern, { cwd: repoRoot })) {
    const path = resolve(repoRoot, file);
    try {
      const mode = statSync(path).mode;
      if ((mode & 0o111) === 0) {
        chmodSync(path, mode | 0o755);
        fixed++;
        console.log(`[fix-node-pty-perms] +x ${file}`);
      }
    } catch {
      // Raced or unreadable — the spawn itself will surface any real problem.
    }
  }
}
if (fixed === 0) {
  // Quiet success: bits already correct (or no node-pty present).
}

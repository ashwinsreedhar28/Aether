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
// nothing to do — e.g. a CI job that only builds python). No fs.globSync /
// import.meta.dirname: CI runs Node 20.10, which has neither.
import { chmodSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** List subdirectory entries, or [] when the parent doesn't exist. */
function listDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** node-pty package roots across pnpm and plain-npm layouts. */
function nodePtyRoots() {
  const roots = [];
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
  for (const entry of listDir(pnpmStore)) {
    if (entry.startsWith('node-pty@')) {
      roots.push(join(pnpmStore, entry, 'node_modules', 'node-pty'));
    }
  }
  roots.push(join(repoRoot, 'node_modules', 'node-pty'));
  return roots;
}

for (const root of nodePtyRoots()) {
  const prebuilds = join(root, 'prebuilds');
  for (const platform of listDir(prebuilds)) {
    const helper = join(prebuilds, platform, 'spawn-helper');
    try {
      const mode = statSync(helper).mode;
      if ((mode & 0o111) === 0) {
        chmodSync(helper, mode | 0o755);
        console.log(`[fix-node-pty-perms] +x ${helper}`);
      }
    } catch {
      // No helper for this platform (Windows prebuilds), or raced —
      // the spawn itself will surface any real problem.
    }
  }
}

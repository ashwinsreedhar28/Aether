/**
 * Post-build: make the emitted dist loadable by Node's native ESM resolver.
 *
 * viewer-core source is authored for a bundler (moduleResolution: "Bundler",
 * verbatimModuleSyntax) so relative imports are extensionless — great for Vite
 * consumers, but Node's raw ESM loader requires explicit extensions. Rather than
 * churn all 110 source imports (and fight the bundler ergonomics), we rewrite the
 * EMITTED dist: every relative `from './x'` / `import('./x')` becomes `./x.js`
 * (or `./x/index.js` for a directory). This keeps source clean and lets ANY raw
 * Node consumer (e.g. viewer-desktop's `node --test`) load the dist directly.
 *
 * Idempotent: specifiers that already end in `.js`/`.json` are left alone.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** Recursively yield every .js file under a directory. */
function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* jsFiles(full);
    else if (name.endsWith('.js')) yield full;
  }
}

// Matches the specifier in `from '...'`, `import '...'`, and `import('...')`
// for RELATIVE specifiers only (./ or ../).
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"]*)\2/g;

function resolveSpecifier(fileDir, spec) {
  if (spec.endsWith('.js') || spec.endsWith('.json')) return spec; // already explicit
  const asFile = join(fileDir, spec + '.js');
  if (existsSync(asFile)) return spec + '.js';
  const asIndex = join(fileDir, spec, 'index.js');
  if (existsSync(asIndex)) return spec.replace(/\/?$/, '/') + 'index.js';
  return spec; // leave untouched if we can't resolve it (don't break anything)
}

let touched = 0;
for (const file of jsFiles(DIST)) {
  const fileDir = dirname(file);
  const src = readFileSync(file, 'utf8');
  const out = src.replace(SPECIFIER, (m, lead, q, spec) => {
    const fixed = resolveSpecifier(fileDir, spec);
    return fixed === spec ? m : `${lead}${q}${fixed}${q}`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    touched++;
  }
}
console.log(`fix-dist-extensions: rewrote relative specifiers in ${touched} file(s)`);

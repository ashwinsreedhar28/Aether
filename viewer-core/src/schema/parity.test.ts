/**
 * Cross-language validator parity (TS side).
 *
 * Runs the SHARED fixture battery (schema/fixtures.json) through the TS
 * `validateView`. The Python suite (python/test_viewer_core.py) runs the SAME
 * file through `validate_view`. Because both read one fixtures file, the two
 * validators cannot drift: if a fixture's verdict changes on one side, that
 * side's run goes red.
 *
 * The cross-language assertion is structural: each `valid` fixture must be
 * accepted and each `invalid` fixture rejected, on BOTH sides. This test owns
 * the TS half of that guarantee.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateView } from './validate';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesPath = resolve(here, '../../schema/fixtures.json');

interface Fixture {
  name: string;
  view: unknown;
}
interface Fixtures {
  valid: Fixture[];
  invalid: Fixture[];
}

const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as Fixtures;

describe('validateView parity battery (TS)', () => {
  it('has a non-trivial battery', () => {
    expect(fixtures.valid.length).toBeGreaterThan(5);
    expect(fixtures.invalid.length).toBeGreaterThan(5);
  });

  it.each(fixtures.valid.map((f) => [f.name, f.view] as const))(
    'accepts valid: %s',
    (_name, view) => {
      const r = validateView(view);
      expect(r.ok, `expected ACCEPT, got errors: ${r.errors.join('; ')}`).toBe(true);
    },
  );

  it.each(fixtures.invalid.map((f) => [f.name, f.view] as const))(
    'rejects invalid: %s',
    (_name, view) => {
      const r = validateView(view);
      expect(r.ok, 'expected REJECT, but validator accepted it').toBe(false);
    },
  );
});

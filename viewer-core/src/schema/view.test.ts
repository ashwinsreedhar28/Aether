import { describe, it, expect } from 'vitest';
import { validateView, assertView } from './validate';
import { VIEW_TYPES } from './view';
import type { View } from './view';

const valid: View = {
  id: 'v1',
  type: 'markdown',
  title: 'Notes',
  source: { kind: 'inline', value: '# hi' },
  layout: { w: 0.8, h: 0.6, hint: 'wide' },
};

describe('validateView', () => {
  it('accepts a well-formed view', () => {
    const r = validateView(valid);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts every declared view type', () => {
    for (const type of VIEW_TYPES) {
      const r = validateView({ id: 'x', type, source: { kind: 'path', value: '/a' } });
      expect(r.ok, `type ${type} should be valid`).toBe(true);
    }
  });

  it('rejects a missing id', () => {
    const r = validateView({ type: 'markdown', source: { kind: 'inline', value: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('rejects an unknown type', () => {
    const r = validateView({ id: 'a', type: 'spreadsheet', source: { kind: 'inline', value: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('rejects a bad source kind', () => {
    const r = validateView({ id: 'a', type: 'json', source: { kind: 'ftp', value: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('source.kind'))).toBe(true);
  });

  it('rejects an empty source value', () => {
    const r = validateView({ id: 'a', type: 'json', source: { kind: 'inline', value: '' } });
    expect(r.ok).toBe(false);
  });

  it('rejects a missing source', () => {
    const r = validateView({ id: 'a', type: 'json' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('source is required'))).toBe(true);
  });

  it('rejects a bad layout hint', () => {
    const r = validateView({
      id: 'a',
      type: 'json',
      source: { kind: 'inline', value: 'x' },
      layout: { hint: 'gigantic' },
    });
    expect(r.ok).toBe(false);
  });

  it('assertView returns the value when valid and throws when not', () => {
    expect(assertView(valid)).toBe(valid);
    expect(() => assertView({ id: 'a' })).toThrow(/Invalid View/);
  });
});

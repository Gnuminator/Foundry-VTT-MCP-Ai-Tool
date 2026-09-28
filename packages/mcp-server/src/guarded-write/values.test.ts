import { describe, expect, it } from 'vitest';

import {
  formatValue,
  parseDataPath,
  readDataPath,
  stableStringify,
  writeDataPath,
} from './values.js';

describe('vault data paths', () => {
  it('reads own properties only', () => {
    expect(readDataPath({ a: { b: 1 } }, 'a.b')).toEqual({ path: 'a.b', present: true, value: 1 });
    expect(readDataPath({ a: 1 }, 'a.b')).toEqual({ path: 'a.b', present: false });
    expect(readDataPath({}, 'toString')).toEqual({ path: 'toString', present: false });
    expect(readDataPath(undefined, 'a')).toEqual({ path: 'a', present: false });
  });

  it('writes a copy, creating parents, and refuses to write through a non-object', () => {
    const data = { a: { b: 1 } };
    const out = writeDataPath(data, { path: 'a.c.d', present: true, value: [1] });
    expect(out).toEqual({ a: { b: 1, c: { d: [1] } } });
    expect(data).toEqual({ a: { b: 1 } });
    expect(writeDataPath(out, { path: 'a.b', present: false })).toEqual({ a: { c: { d: [1] } } });
    expect(writeDataPath({}, { path: 'x.y', present: false })).toEqual({});
    expect(() => writeDataPath({ a: 5 }, { path: 'a.b', present: true, value: 1 })).toThrow(
      /"a" is not an object/
    );
  });

  it('rejects unsafe or malformed paths', () => {
    for (const bad of [
      '',
      'a..b',
      '.a',
      'a.',
      '__proto__',
      'a.constructor',
      'a.prototype.b',
      'a/b',
    ]) {
      expect(() => parseDataPath(bad)).toThrow();
    }
    expect(() => parseDataPath(Array(13).fill('a').join('.'))).toThrow(/too deep/);
    expect(parseDataPath('regions.old bonegrinder')).toEqual(['regions', 'old bonegrinder']);
  });
});

describe('formatting and equality', () => {
  it('compares plain data independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 1 }] })).toBe(
      stableStringify({ a: [{ c: 1, d: 2 }], b: 1 })
    );
    expect(stableStringify({ a: undefined })).toBe('{}');
  });

  it('formats values for diff lines', () => {
    expect(formatValue(undefined)).toBe('(unset)');
    expect(formatValue({ path: 'x', present: false })).toBe('(unset)');
    expect(formatValue({ path: 'x', present: true, value: 'hi' })).toBe('"hi"');
    const long = formatValue({ path: 'x', present: true, value: 'y'.repeat(200) });
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { countReport, compare } from './unused-ratchet.mjs';

test('countReport counts files, exports and types per workspace', () => {
  const counts = countReport({
    files: ['packages/mcp-server/src/a.ts', 'shared/src/b.ts'],
    issues: [
      { file: 'packages/mcp-server/src/c.ts', exports: [{}, {}], types: [{}] },
      { file: 'shared/src/d.ts', exports: [], types: [] },
    ],
  });
  assert.deepEqual(counts, {
    'packages/mcp-server: exports': 2,
    'packages/mcp-server: files': 1,
    'packages/mcp-server: types': 1,
    'shared: files': 1,
  });
});

test('countReport throws when the knip report lacks files or issues arrays', () => {
  assert.throws(() => countReport({}), /format changed/);
  assert.throws(() => countReport({ files: [] }), /format changed/);
  assert.throws(() => countReport({ files: [], issues: {} }), /format changed/);
  assert.deepEqual(countReport({ files: [], issues: [] }), {});
});

test('compare fails a rise and a new key, reports a drop', () => {
  const base = { 'shared: files': 2, 'shared: exports': 3 };
  const { increases, decreases } = compare(base, {
    'shared: files': 3,
    'shared: exports': 1,
    'packages/x: types': 1,
  });
  assert.equal(increases.length, 2);
  assert.equal(decreases.length, 1);
  assert.deepEqual(compare(base, base), { increases: [], decreases: [] });
});

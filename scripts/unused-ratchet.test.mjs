import test from 'node:test';
import assert from 'node:assert/strict';
import { countReport, compare, itemsInFiles } from './unused-ratchet.mjs';

test('itemsInFiles names the unused export, type and file of the changed files only', () => {
  const report = {
    files: ['packages/a/src/new.ts', 'packages/a/src/old.ts'],
    issues: [
      { file: 'packages/a/src/x.ts', exports: [{ name: 'fresh', line: 7 }], types: [{ name: 'T' }] },
      { file: 'packages/a/src/y.ts', exports: [{ name: 'other', line: 1 }], types: [] },
    ],
  };
  assert.deepEqual(itemsInFiles(report, ['packages/a/src/new.ts', 'packages/a/src/x.ts']), [
    '  packages/a/src/new.ts: unused file',
    '  packages/a/src/x.ts:7: unused export fresh',
    '  packages/a/src/x.ts:?: unused type T',
  ]);
  assert.deepEqual(itemsInFiles(report, []), []);
});

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

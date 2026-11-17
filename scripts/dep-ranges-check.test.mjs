import assert from 'node:assert/strict';
import test from 'node:test';
import { findDivergence } from './dep-ranges-check.mjs';

test('same range everywhere passes', () => {
  const found = findDivergence([
    { file: 'a/package.json', json: { devDependencies: { vitest: '5.1.0' } } },
    { file: 'b/package.json', json: { devDependencies: { vitest: '5.1.0' } } },
  ]);
  assert.deepEqual(found, []);
});

test('a dependency used by one package only passes', () => {
  const found = findDivergence([
    { file: 'a/package.json', json: { dependencies: { zod: '^3.0.0' } } },
    { file: 'b/package.json', json: { dependencies: { ws: '^8.0.0' } } },
  ]);
  assert.deepEqual(found, []);
});

test('different ranges for one name fail, across dependency fields', () => {
  const found = findDivergence([
    { file: 'a/package.json', json: { devDependencies: { esbuild: '^0.19.0' } } },
    { file: 'b/package.json', json: { dependencies: { esbuild: '^0.27.7' } } },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'esbuild');
  assert.deepEqual([...found[0].ranges.keys()].sort(), ['^0.19.0', '^0.27.7']);
});

test('workspace packages are ignored', () => {
  const found = findDivergence([
    { file: 'a/package.json', json: { dependencies: { '@gnuminator/shared': '*' } } },
    { file: 'b/package.json', json: { dependencies: { '@gnuminator/shared': '0.28.0' } } },
  ]);
  assert.deepEqual(found, []);
});

test('the repository itself has one range per shared dependency', async () => {
  const { manifestPaths } = await import('./dep-ranges-check.mjs');
  const fs = await import('node:fs');
  const manifests = manifestPaths().map(file => ({
    file,
    json: JSON.parse(fs.readFileSync(file, 'utf8')),
  }));
  const bad = findDivergence(manifests).map(entry => entry.name);
  assert.deepEqual(bad, []);
});

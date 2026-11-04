import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCoverage, globToRegExp, isTestFile, pathsIn } from './test-coverage-check.mjs';

test('isTestFile: test, spec and pytest names only', () => {
  assert.ok(isTestFile('scripts/a.test.mjs'));
  assert.ok(isTestFile('web/e2e/a.spec.ts'));
  assert.ok(isTestFile('tools/x/tests/test_a.py'));
  assert.ok(!isTestFile('tools/x/tests/helpers.py'));
  assert.ok(!isTestFile('scripts/a.mjs'));
});

test('globToRegExp: * stays in one folder, ** crosses folders', () => {
  assert.ok(globToRegExp('scripts/dev/*.test.mjs').test('scripts/dev/a.test.mjs'));
  assert.ok(!globToRegExp('scripts/dev/*.test.mjs').test('scripts/dev/sub/a.test.mjs'));
  assert.ok(globToRegExp('shared/src/**').test('shared/src/util/e.test.ts'));
});

test('pathsIn: finds files and globs in command text', () => {
  const text = 'run: node --test scripts/a.test.mjs "scripts/test-kit/test/*.test.mjs"';
  assert.deepEqual(pathsIn(text), ['scripts/a.test.mjs', 'scripts/test-kit/test/*.test.mjs']);
});

test('checkCoverage: written paths, written globs and runner folders count as run', () => {
  const files = [
    'scripts/a.test.mjs',
    'scripts/kit/b.test.mjs',
    'shared/src/c.test.ts',
    'scripts/orphan.test.mjs',
  ];
  const text = 'node --test scripts/a.test.mjs\nnode --test "scripts/kit/*.test.mjs"';
  const { unrun } = checkCoverage(files, text);
  assert.deepEqual(unrun, ['scripts/orphan.test.mjs']);
});

test('checkCoverage: a runner pattern with no file is stale', () => {
  const { staleRunners } = checkCoverage(['shared/src/c.test.ts'], '');
  assert.ok(staleRunners.includes('tools/*/tests/**'));
  assert.ok(!staleRunners.includes('shared/src/**'));
});

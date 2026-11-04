import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCoverage,
  expandCommands,
  globToRegExp,
  isTestFile,
  pathsIn,
  workflowCommands,
} from './test-coverage-check.mjs';

test('workflowCommands: run commands of every job; a file named only in a comment is not run', () => {
  const yaml = [
    'jobs:',
    '  one:',
    '    steps:',
    '      - name: A',
    '        # covered by scripts/only-comment.test.mjs elsewhere',
    '        run: node --test scripts/a.test.mjs',
    '  two:',
    '    steps:',
    '      - run: npm run b:test',
  ].join('\n');
  const cmds = workflowCommands(yaml);
  assert.deepEqual(cmds, ['node --test scripts/a.test.mjs', 'npm run b:test']);
  assert.ok(!pathsIn(cmds.join('\n')).includes('scripts/only-comment.test.mjs'));
});

test('expandCommands: follows npm run into scripts, only when a command invokes them', () => {
  const scripts = {
    'b:test': 'node --test scripts/b.test.mjs && npm run c:test',
    'c:test': 'node --test scripts/c.test.mjs',
    'unused:test': 'node --test scripts/unused.test.mjs',
  };
  const text = expandCommands(['npm run b:test'], scripts).join('\n');
  assert.deepEqual(pathsIn(text), ['scripts/b.test.mjs', 'scripts/c.test.mjs']);
});

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

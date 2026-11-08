import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseHeading, entryDecision, fold, isEntryModule } from './changelog-fold.mjs';

test('entryDecision: run for this file, mismatch for a same-named other file, import otherwise', () => {
  const self = fileURLToPath(new URL('./changelog-fold.mjs', import.meta.url));
  assert.equal(entryDecision(self, self), 'run');
  assert.ok(!isEntryModule(undefined, self));
  if (process.platform === 'win32') assert.equal(entryDecision(self.toUpperCase(), self), 'run');
  assert.equal(entryDecision(path.join(os.tmpdir(), 'nope', 'changelog-fold.mjs'), self), 'mismatch');
  assert.equal(entryDecision(path.join(os.tmpdir(), 'other.mjs'), self), 'import');
  assert.equal(entryDecision(undefined, self), 'import');
});

const section = (heading, bullet) => ({ heading, lines: [`- ${bullet}`] });

test('baseHeading drops one trailing tag and folds the test aliases', () => {
  assert.equal(baseHeading('### Tooling (I-138; PR #1)'), '### Tooling');
  assert.equal(baseHeading('### Tooling'), '### Tooling');
  assert.equal(baseHeading('### Testing'), '### Tests');
  assert.equal(baseHeading('### Test Kit (x)'), '### Tests');
  assert.equal(baseHeading('### Test environment'), '### Tests');
  assert.equal(baseHeading('### Pi stages'), '### Orange Pi');
  assert.equal(baseHeading('### Pi and Plan B scripts (x)'), '### Orange Pi');
  assert.equal(baseHeading('### Orange Pi (D-123)'), '### Orange Pi');
  assert.equal(baseHeading('### Pipeline'), '### Pipeline');
  assert.equal(baseHeading('### Foo (a (b))'), '### Foo (a (b))');
  assert.equal(baseHeading('### (x)'), '### (x)');
});

test('fold: repeated tagged headings land under one base heading', () => {
  const { unreleased } = fold('# Log\n\n## Unreleased\n\n## v1\n', [
    section('### Tooling (a)', 'one'),
    section('### Tooling (b)', 'two'),
    section('### Testing', 'three'),
    section('### Test kit', 'four'),
  ]);
  assert.equal(
    unreleased,
    '## Unreleased\n\n### Tooling\n\n- one\n- two\n\n### Tests\n\n- three\n- four'
  );
});

test('fold: a fragment joins an existing tagged heading in Unreleased', () => {
  const { unreleased } = fold('## Unreleased\n\n### Tests (old)\n\n- a\n\n### Fixes\n\n- f\n', [
    section('### Testing', 'b'),
  ]);
  assert.equal(unreleased, '## Unreleased\n\n### Tests (old)\n\n- a\n- b\n\n### Fixes\n\n- f');
});

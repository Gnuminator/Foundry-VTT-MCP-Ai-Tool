import assert from 'node:assert/strict';
import test from 'node:test';
import { baseHeading, fold } from './changelog-fold.mjs';

const section = (heading, bullet) => ({ heading, lines: [`- ${bullet}`] });

test('baseHeading drops one trailing tag and folds the test aliases', () => {
  assert.equal(baseHeading('### Tooling (I-138; PR #1)'), '### Tooling');
  assert.equal(baseHeading('### Tooling'), '### Tooling');
  assert.equal(baseHeading('### Testing'), '### Tests');
  assert.equal(baseHeading('### Test Kit (x)'), '### Tests');
  assert.equal(baseHeading('### Test environment'), '### Tests');
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

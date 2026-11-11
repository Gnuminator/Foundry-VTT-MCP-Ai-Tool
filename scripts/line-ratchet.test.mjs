import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addException, countLines, evaluate, isCounted, lowerBaseline } from './line-ratchet.mjs';

test('countLines: same on LF and CRLF, trailing newline adds nothing', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a\nb\nc\n'), 3);
  assert.equal(countLines('a\r\nb\r\nc'), 3);
});

test('isCounted: source yes; tests, generated, dist, test-support no', () => {
  assert.ok(isCounted('packages/x/src/a.ts'));
  assert.ok(isCounted('scripts/a.ps1'));
  assert.ok(!isCounted('packages/x/src/a.test.ts'));
  assert.ok(!isCounted('a/b.spec.mjs'));
  assert.ok(!isCounted('a/b.generated.ts'));
  assert.ok(!isCounted('packages/x/dist/a.js'));
  assert.ok(!isCounted('packages/x/test-support/a.ts'));
  assert.ok(!isCounted('a/container-test/a.sh'));
  assert.ok(!isCounted('README.md'));
});

test('evaluate: growth and a new file over the limit fail; equal and under pass', () => {
  const baseline = { limit: 1000, files: { 'a.ts': 1200 } };
  assert.equal(evaluate({ 'a.ts': 1200, 'b.ts': 999 }, baseline).failures.length, 0);
  assert.match(evaluate({ 'a.ts': 1201 }, baseline).failures[0], /a\.ts: 1200 -> 1201/);
  assert.match(evaluate({ 'a.ts': 1200, 'c.ts': 1001 }, baseline).failures[0], /c\.ts/);
  assert.equal(evaluate({ 'a.ts': 1100 }, baseline).lowered.length, 1);
});

test('--update cannot raise an entry or add a file; it lowers and drops', () => {
  const baseline = {
    limit: 1000,
    files: { 'a.ts': 1200, 'b.ts': 1100, 'gone.ts': 1500 },
    exceptions: [],
  };
  const next = lowerBaseline({ 'a.ts': 1500, 'b.ts': 900, 'new.ts': 3000 }, baseline);
  assert.deepEqual(next.files, { 'a.ts': 1200 });
});

test('--except raises one entry and records the reason', () => {
  const baseline = { limit: 1000, files: { 'a.ts': 1200 }, exceptions: [] };
  const next = addException({ 'a.ts': 1230 }, baseline, 'a.ts', 'fix needs lines', '12');
  assert.equal(next.files['a.ts'], 1230);
  assert.deepEqual(next.exceptions, [
    { file: 'a.ts', lines: 1230, reason: 'fix needs lines', pr: '12' },
  ]);
  assert.throws(() => addException({ 'a.ts': 1230 }, baseline, 'a.ts', ' '));
  assert.throws(() => addException({}, baseline, 'zz.ts', 'why'));
});

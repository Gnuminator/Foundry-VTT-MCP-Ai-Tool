import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failureOf, listTakes, parseArgs, summary } from './rehearse.mjs';

test('failureOf names the last step that started and the failure message', () => {
  const out = [
    'Take "x" at 2160p: setting up windows...',
    '    1.0s  s1: open the dashboard',
    '    4.2s  s2: press the button',
    'Take failed: button not found',
    'Take folder: C:\\x',
  ].join('\n');
  assert.deepEqual(failureOf(out), { step: 's2: press the button', message: 'button not found' });
});

test('failureOf with no step logged', () => {
  assert.deepEqual(failureOf('Take failed: boom'), { step: null, message: 'boom' });
});

test('parseArgs defaults and options', () => {
  const d = parseArgs([]);
  assert.equal(d.server, 'A');
  assert.equal(d.lock, true);
  const o = parseArgs(['--server', 'b', '--only', 'prep,preflight', '--no-lock']);
  assert.equal(o.server, 'B');
  assert.deepEqual(o.only, ['prep', 'preflight']);
  assert.equal(o.lock, false);
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--server', 'Z']));
});

test('summary prints PASS and FAIL with the step', () => {
  const text = summary([
    { name: 'a', ok: true, seconds: 3 },
    { name: 'b', ok: false, seconds: 5, step: 's2: go', reason: 'nope' },
  ]);
  assert.match(text, /PASS {2}a/);
  assert.match(text, /FAIL {2}b .*step "s2: go": nope/);
  assert.match(text, /1 of 2 takes failed/);
});

test('listTakes finds the takes on main', () => {
  const takes = listTakes();
  assert.ok(takes.includes('preflight'));
  assert.ok(takes.length >= 8);
});

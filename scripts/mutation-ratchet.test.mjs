import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineScore, countDrift, decide, scoreOf, TOLERANCE } from './mutation-ratchet.mjs';

test('baselineScore: only a numeric score counts', () => {
  assert.equal(baselineScore({ score: 77.87, mutants: 3931 }), 77.87);
  assert.equal(baselineScore({}), null);
  assert.equal(baselineScore({ score: '77' }), null);
  assert.equal(baselineScore(null), null);
});

test('countDrift: a mutant count far from the baseline is reported', () => {
  assert.equal(countDrift(3900, 3931), null);
  assert.match(countDrift(2000, 3931), /more than 10% apart/);
  assert.equal(countDrift(10, undefined), null);
});

const report = statuses => ({
  files: { 'a.ts': { mutants: statuses.map(status => ({ status })) } },
});

test('scoreOf counts killed and timeout against survived and no coverage only', () => {
  const r = scoreOf(
    report(['Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored', 'CompileError'])
  );
  assert.deepEqual(r, { score: 50, detected: 2, undetected: 2 });
  assert.throws(() => scoreOf(report(['Ignored'])), /no mutants/);
});

test('decide: a drop beyond the tolerance fails, noise within it passes', () => {
  assert.equal(decide(79, 80, false).ok, false);
  assert.equal(decide(80 - TOLERANCE, 80, false).ok, true);
  assert.equal(decide(85, 80, false).write, false);
});

test('decide: --update raises the floor and never lowers it', () => {
  assert.deepEqual(decide(85, 80, true), {
    ok: true,
    write: true,
    message: 'baseline raised from 80% to 85%',
  });
  const same = decide(79.8, 80, true);
  assert.equal(same.write, false);
  assert.equal(same.ok, true);
  assert.equal(decide(70, 80, true).ok, false);
});

test('decide: no baseline fails unless --update creates it', () => {
  assert.equal(decide(80, null, false).ok, false);
  assert.equal(decide(80, null, true).write, true);
});

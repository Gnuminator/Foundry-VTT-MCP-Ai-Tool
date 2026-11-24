import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSample, stats } from '../pi-measure.mjs';

test('stats: min, median and max', () => {
  assert.deepEqual(stats([5, 1, 3]), { n: 3, min: 1, median: 3, max: 5 });
  assert.equal(stats([1, 2, 3, 4]).median, 2.5);
});

test('parseSample: CPU per unit from tick deltas, load, memory and temperature', () => {
  const text = [
    'DT 10',
    'A',
    '1 100 100 1000 system.slice/a.service',
    '2 0 0 500 system.slice/b.service',
    'B',
    '1 600 100 1000 system.slice/a.service',
    '2 0 50 500 system.slice/b.service',
    '3 100 0 250 system.slice/b.service',
    'LOAD 1.50 1.00 0.50',
    'MEM 16384000 4096000',
    'TEMP 50000 70000',
    'NCPU 8',
  ].join('\n');
  const s = parseSample(text);
  assert.equal(s.cores, 8);
  assert.equal(s.tempC, 70);
  assert.equal(s.load.l1, 1.5);
  assert.equal(s.memUsedMb, 12000);
  // a.service: 500 ticks in 10 s = 5 s of CPU = 50 percent of one core
  assert.equal(Math.round(s.units['a.service'].cpu), 50);
  // b.service: 50 ticks for pid 2 plus 100 for the new pid 3 = 15 percent
  assert.equal(Math.round(s.units['b.service'].cpu), 15);
  assert.equal(s.units['b.service'].procs, 2);
});

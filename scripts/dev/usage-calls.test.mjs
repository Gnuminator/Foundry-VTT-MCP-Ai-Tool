import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCallLines, parsePiOutput, summarize, weekLine } from './usage-calls.mjs';

const line = (tool, ok = true, set = 'play') =>
  JSON.stringify({ t: '2026-11-09T10:00:00Z', tool, set, ms: 10, size: 5, ok });

const catalog = { play: ['a', 'b', 'c'], prep: ['d'] };

test('parseCallLines skips torn and foreign lines', () => {
  const calls = parseCallLines(
    [line('a'), '{"tool":', 'null', '{"x":1}', line('b'), ''].join('\n')
  );
  assert.deepEqual(
    calls.map(c => c.tool),
    ['a', 'b']
  );
});

test('weekLine: used of catalog, never used, error rate, worst tools', () => {
  const calls = parseCallLines(
    [line('a'), line('a', false), line('a'), line('b', false)].join('\n')
  );
  const text = weekLine(summarize(calls, catalog), 7);
  assert.equal(
    text,
    'Tool calls, last 7 days: 4 calls, 2 tools used of 4; 2 never used; 2 errors (50.0%); most errors: b 1/1, a 1/3.'
  );
});

test('weekLine without a catalog leaves out the never-used part', () => {
  const text = weekLine(summarize(parseCallLines(line('a')), null), 7);
  assert.equal(text, 'Tool calls, last 7 days: 1 calls, 1 tools used; 0 errors (0.0%).');
});

test('weekLine with no calls says so', () => {
  assert.equal(weekLine(summarize([], catalog), 7), 'Tool calls, last 7 days: none logged.');
});

test('parsePiOutput keeps only the files inside the window', () => {
  const now = new Date(2026, 10, 10, 12);
  const out = [
    '#FILE 2026-11-01.calls.jsonl',
    line('old'),
    '#FILE 2026-11-09.calls.jsonl',
    line('new'),
  ].join('\n');
  assert.deepEqual(
    parsePiOutput(out, 7, now).map(c => c.tool),
    ['new']
  );
  assert.equal(parsePiOutput(out, 0, now).length, 2);
  assert.deepEqual(parsePiOutput('', 7, now), []);
});

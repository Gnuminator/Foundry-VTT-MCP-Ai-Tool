import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCallLines, parsePiOutput, readCallsPi, summarize, weekLine } from './usage-calls.mjs';

test('readCallsPi runs one fixed read-only ssh command with a large buffer', () => {
  let seen;
  const exec = (cmd, args, opts) => {
    seen = { cmd, args, opts };
    return '\n#FILE 2026-11-09.calls.jsonl\n' + JSON.stringify({ tool: 'a', ok: true }) + '\n';
  };
  const calls = readCallsPi(7, new Date(2026, 10, 10, 12), 'foundry-pi', exec);
  assert.equal(calls.length, 1);
  assert.equal(seen.cmd, 'ssh');
  assert.deepEqual(seen.args.slice(0, 5), [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    'foundry-pi',
  ]);
  assert.ok(seen.opts.maxBuffer >= 16 * 1024 * 1024);
  assert.doesNotMatch(seen.args[5], /\brm\b|\bmv\b|\btee\b|>|\bsudo\b/);
});

test('parsePiOutput: a file without a trailing newline does not swallow the next header', () => {
  const now = new Date(2026, 10, 10, 12);
  // the remote loop echoes an empty line before each header
  const out = [
    '#FILE 2026-11-09.calls.jsonl',
    JSON.stringify({ tool: 'in', ok: true }),
    '#FILE 2026-11-01.calls.jsonl',
    JSON.stringify({ tool: 'old', ok: true }),
  ].join('\n');
  assert.deepEqual(
    parsePiOutput(out, 7, now).map(c => c.tool),
    ['in']
  );
});

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

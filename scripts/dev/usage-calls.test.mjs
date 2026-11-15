import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  connectorLogging,
  emptyLogHint,
  parseCallLines,
  parsePiOutput,
  readCallsPi,
  summarize,
  weekLine,
} from './usage-calls.mjs';

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
  // the only redirect allowed is stderr to /dev/null
  assert.doesNotMatch(seen.args[5].replace('2>/dev/null', ''), /\brm\b|\bmv\b|\btee\b|>|\bsudo\b/);
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
  assert.equal(text, 'Tool calls, last 7 days: 1 call, 1 tool used; 0 errors (0.0%).');
});

test('weekLine wording: one day, all days; ranks by error count before rate', () => {
  const calls = parseCallLines(
    [line('x', false), line('y', false), line('y', false), line('y'), line('y')].join('\n')
  );
  const text = weekLine(summarize(calls, null), 1);
  assert.match(text, /^Tool calls, last 1 day: 5 calls/);
  assert.match(text, /most errors: y 2\/4, x 1\/1\./);
  assert.match(weekLine(summarize(calls, null), 0), /^Tool calls, all days: /);
  assert.equal(weekLine(summarize([], null), 0), 'Tool calls, all days: none logged.');
});

test('connectorLogging flags a connector build without call logging', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'conn-log-'));
  try {
    const dir = path.join(root, 'Claude-Data', 'claude_pkg');
    mkdirSync(dir, { recursive: true });
    const newer = path.join(root, 'foundry-mcp-server-new.cjs');
    const older = path.join(root, 'foundry-mcp-server-old.cjs');
    writeFileSync(newer, 'x ".calls.jsonl" y');
    writeFileSync(older, 'nothing here');
    writeFileSync(
      path.join(dir, 'claude_desktop_config.json'),
      JSON.stringify({
        mcpServers: {
          'foundry-mcp': { args: [older] },
          'foundry-mcp-play': { args: [newer] },
          other: { args: ['C:\\x\\other.cjs'] },
        },
      })
    );
    const info = connectorLogging({ LOCALAPPDATA: root });
    assert.deepEqual(info.stale, ['foundry-mcp']);
    assert.match(
      emptyLogHint(info),
      /^Note: 1 Claude Desktop connector \(foundry-mcp\) runs a server build that predates call logging/
    );
    assert.equal(emptyLogHint({ config: 'c', stale: [] }), null);
    assert.equal(connectorLogging({ LOCALAPPDATA: path.join(root, 'none') }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Pi command ends a file without trailing newline before the next header (run in sh)', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pi-glue-'));
  try {
    let remote;
    readCallsPi(0, new Date(), 'h', (c, args) => {
      remote = args[5];
      return '';
    });
    writeFileSync(
      path.join(root, '2026-11-08.calls.jsonl'),
      JSON.stringify({ tool: 'p', ok: true })
    );
    writeFileSync(
      path.join(root, '2026-11-09.calls.jsonl'),
      JSON.stringify({ tool: 'q', ok: true })
    );
    const local = remote.replace(/cd \S+ /, `cd '${root.replace(/\\/g, '/')}' `);
    let out;
    try {
      out = execFileSync('sh', ['-c', local], { encoding: 'utf8' });
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
      t.skip('sh is not available');
      return;
    }
    assert.deepEqual(
      parsePiOutput(out, 0, new Date()).map(c => c.tool),
      ['p', 'q']
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

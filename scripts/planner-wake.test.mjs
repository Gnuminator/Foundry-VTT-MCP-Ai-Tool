/** scripts/planner-wake.mjs: progress parsing, change detection, cold rule, brief, args. No vault, no waiting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProgress,
  formatChanges,
  changedProgress,
  readUpstreamBacklog,
  isCold,
  freshBrief,
  parseArgs,
  DEFAULTS,
} from './planner-wake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const backlog = (progressA = '2026-11-04 PR #1 ready, head aaa') =>
  [
    '# Backlog',
    '- progress: not an item',
    '## S First',
    '- id: first',
    `- progress: ${progressA}`,
    '- claimed: L1',
    '',
    '## M Second',
    '- id: second',
    '- claimed: L2',
    '',
    '## S Third',
    '- id: third',
    '- progress: handed over at 250k',
  ].join('\r\n');

test('parseProgress reads only items with an id and a progress line', () => {
  const m = parseProgress(backlog());
  assert.deepEqual([...m.keys()], ['first', 'third']);
  assert.equal(m.get('third'), 'handed over at 250k');
});

test('parseProgress joins several progress lines of one item', () => {
  const m = parseProgress('## S X\n- id: x\n- progress: one\n- progress: two\n');
  assert.equal(m.get('x'), 'one\ntwo');
});

test('changedProgress reports new and changed lines, not removed ones', () => {
  const before = parseProgress(backlog());
  assert.deepEqual(changedProgress(before, before), []);
  const changed = parseProgress(backlog('2026-11-04 PR #1 ready, head bbb'));
  assert.deepEqual(changedProgress(before, changed), [
    { id: 'first', progress: '2026-11-04 PR #1 ready, head bbb' },
  ]);
  const added = new Map(before).set('second', 'PR #2 ready');
  assert.deepEqual(changedProgress(before, added), [{ id: 'second', progress: 'PR #2 ready' }]);
  const removed = new Map(before);
  removed.delete('first');
  assert.deepEqual(changedProgress(before, removed), []);
});

test('readUpstreamBacklog fetches, then shows the upstream file; null when unreadable', () => {
  /** @type {string[][]} */
  const calls = [];
  const ok = readUpstreamBacklog(args => {
    calls.push(args);
    return args[0] === 'show' ? { status: 0, stdout: '## S A' } : { status: 1, stdout: '' };
  });
  assert.equal(ok, '## S A');
  assert.deepEqual(calls[0], ['fetch', '-q']);
  assert.match(calls[1].join(' '), /^show @\{u\}:Dev\/Foundry AI Tool\/Backlog\.md$/);
  assert.equal(
    readUpstreamBacklog(() => ({ status: 128, stdout: '' })),
    null
  );
});

test('isCold flips at the threshold', () => {
  assert.equal(isCold(3599, 3600), false);
  assert.equal(isCold(3600, 3600), true);
});

test('freshBrief names each changed item', () => {
  const b = freshBrief([{ id: 'first', progress: 'PR #1 ready' }]);
  assert.match(b, /- first: PR #1 ready/);
  assert.match(b, /planner-wake\.mjs/);
});

test('parseArgs takes seconds and rejects junk', () => {
  assert.equal(parseArgs([]).coldAfter, DEFAULTS.coldAfter);
  assert.equal(parseArgs(['--cold-after', '10', '--vault', 'x']).coldAfter, 10);
  assert.throws(() => parseArgs(['--interval', '0']));
  assert.throws(() => parseArgs(['--nope']));
});

test('readUpstreamBacklog warns on a failed fetch and on an unreadable file', () => {
  /** @type {string[]} */
  const warns = [];
  const text = readUpstreamBacklog(
    args => (args[0] === 'fetch' ? { status: 1, stdout: '' } : { status: 0, stdout: '## S A' }),
    m => warns.push(m)
  );
  assert.equal(text, '## S A');
  assert.equal(warns.length, 1);
  assert.match(warns[0], /fetch failed/);
  warns.length = 0;
  assert.equal(
    readUpstreamBacklog(
      () => ({ status: 128, stdout: '' }),
      m => warns.push(m)
    ),
    null
  );
  assert.equal(warns.length, 2);
  assert.match(warns[1], /cannot read/);
  warns.length = 0;
  readUpstreamBacklog(
    () => ({ status: 0, stdout: '## S A' }),
    m => warns.push(m)
  );
  assert.deepEqual(warns, []);
});

test('formatChanges prefixes every line of a multi-line progress value', () => {
  assert.deepEqual(
    formatChanges([
      { id: 'x', progress: 'one\ntwo' },
      { id: 'y', progress: 'solo' },
    ]),
    ['x: one', 'x: two', 'y: solo']
  );
  assert.match(freshBrief([{ id: 'x', progress: 'one\ntwo' }]), /- x: one\n- x: two/);
});

test('exit 4 says fetches failed (upstream unreachable after start)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pwake-'));
  try {
    const vault = path.join(dir, 'vault');
    const remote = path.join(dir, 'remote.git');
    mkdirSync(path.join(vault, 'Dev', 'Foundry AI Tool'), { recursive: true });
    const git = (/** @type {string[]} */ ...a) =>
      spawnSync('git', ['-C', vault, ...a], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', '--bare', remote]);
    git('init', '-q', '-b', 'main');
    writeFileSync(
      path.join(vault, 'Dev', 'Foundry AI Tool', 'Backlog.md'),
      '## S A\n- id: a\n- progress: one\n'
    );
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
    git('remote', 'add', 'origin', remote);
    git('push', '-q', '-u', 'origin', 'main');
    // The remote vanishes after the watcher's first read; the first read uses the fetched copy.
    const script = path.join(here, 'planner-wake.mjs');
    const r = spawnSync(
      process.execPath,
      [script, '--vault', vault, '--interval', '1', '--max-wait', '1'],
      {
        encoding: 'utf8',
        timeout: 30000,
      }
    );
    assert.equal(r.status, 4);
    assert.doesNotMatch(r.stdout, /fetch or read problems/);
    rmSync(remote, { recursive: true, force: true });
    const r2 = spawnSync(
      process.execPath,
      [script, '--vault', vault, '--interval', '1', '--max-wait', '1'],
      {
        encoding: 'utf8',
        timeout: 30000,
      }
    );
    assert.equal(r2.status, 4);
    assert.match(r2.stdout, /no progress change.*fetch or read problems/);
    assert.match(r2.stderr, /git fetch failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exit 1 with a stderr line when the first read fails', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pwake-'));
  try {
    spawnSync('git', ['-C', dir, 'init', '-q']);
    const r = spawnSync(process.execPath, [path.join(here, 'planner-wake.mjs'), '--vault', dir], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

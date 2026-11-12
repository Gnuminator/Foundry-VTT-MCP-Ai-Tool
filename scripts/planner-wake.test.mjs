/** scripts/planner-wake.mjs: progress parsing, change detection, args. No vault, no waiting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProgress,
  formatChanges,
  changedProgress,
  readUpstreamBacklog,
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

test('parseArgs takes seconds and rejects junk; there is no cold rule any more (D-141)', () => {
  assert.equal(parseArgs([]).maxWait, DEFAULTS.maxWait);
  assert.equal(parseArgs(['--max-wait', '10', '--vault', 'x']).maxWait, 10);
  assert.throws(() => parseArgs(['--interval', '0']));
  assert.throws(() => parseArgs(['--cold-after', '10']), /unknown argument/);
  assert.throws(() => parseArgs(['--nope']));
});

/* D-141 stick: no standing planner. The planner skill neither starts a successor nor arms a wake
 * watcher, and the wake script has no "start a fresh planner" exit. */
test('no standing planner: the planner skill has no successor or planner-wake text; no exit 3', () => {
  const skill = readFileSync(path.join(here, '..', '.claude', 'skills', 'planner', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /start (the|a) (next|fresh) planner/i);
  assert.doesNotMatch(skill, /planner-wake/);
  assert.doesNotMatch(skill, /gh pr list/, 'the planner reads PRs through status --planner');
  assert.match(skill, /backlog\.mjs status --planner/);
  const src = readFileSync(path.join(here, 'planner-wake.mjs'), 'utf8');
  assert.doesNotMatch(src, /exitCode = 3|fresh planner|freshBrief|isCold/);
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

/* The Done list lives in vault `Backlog done.md`, not in `Backlog.md` (Backlog chain, step 1). This keeps it true: no skill,
 * hook or script may tell a writer to put a line under `## Done` of Backlog.md, and the planner skill names the new file. */
const repoRoot = path.resolve(here, '..');
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// Any mention of a "## Done" heading or "the Done section/heading" (not "## Done when it looks like this" in the GM guides),
// in any wording, case or quoting.
const DONE_MENTION = /##\s*Done\b(?!\s+when\b)|\bDone\s+(?:section|heading)\b/i;

test('Done list: no skill, hook or script (outside tests) names a `## Done` section of Backlog.md', () => {
  const files = [
    ...walk(path.join(repoRoot, '.claude', 'skills')),
    ...walk(path.join(repoRoot, '.claude', 'hooks')),
    ...readdirSync(path.join(repoRoot, 'scripts'))
      .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
      .map((f) => path.join(repoRoot, 'scripts', f)),
    path.join(repoRoot, 'CLAUDE.md'),
  ].filter((f) => /\.(md|mjs)$/.test(f) && !/\.test\.mjs$/.test(f));
  const bad = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (DONE_MENTION.test(text)) bad.push(path.relative(repoRoot, f));
  }
  assert.deepEqual(bad, [], 'a writer is told to put Done lines in Backlog.md; use vault Backlog done.md');
});

test('Done list: the planner skill says Done lines go to Backlog done.md', () => {
  const text = readFileSync(path.join(repoRoot, '.claude', 'skills', 'planner', 'SKILL.md'), 'utf8');
  assert.match(text, /Backlog done\.md/);
});

test('Done list: the matcher catches the old wording', () => {
  for (const s of ['add a line to `## Done`, and', 'x\n## Done\n- a', 'put it in the ## done list', 'under the `## Done` heading', 'the Done section of Backlog.md']) {
    assert.ok(DONE_MENTION.test(s), s);
  }
  assert.ok(!DONE_MENTION.test('## Done when it looks like this'));
});

// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { scout, formatScout, isHot, fileMatches, touchesOf, conflictRefusals } from './conflict-scout.mjs';

const at = new Date('2026-11-20T12:00:00Z');
const pr = (number, files, extra = {}) => ({ number, title: `t${number}`, createdAt: '2026-11-20T08:00:00Z', files, ...extra });

test('an open PR on a plain file means wait', () => {
  const r = scout({ files: ['scripts/a.mjs'], at, prs: [pr(1, ['scripts/a.mjs'])] });
  assert.equal(r.verdict, 'wait');
  assert.deepEqual(r.waitFor, [1]);
  assert.match(formatScout(r), /wait for #1/);
});

test('only hot files overlapping is go, with the hot file named', () => {
  const r = scout({ files: ['scripts/checks.mjs'], at, prs: [pr(2, ['scripts/checks.mjs'])] });
  assert.equal(r.verdict, 'go');
  assert.deepEqual(r.hotFiles, ['scripts/checks.mjs']);
});

test('three open PRs on the same plain file means split', () => {
  const prs = [1, 2, 3].map(n => pr(n, ['x/y.ts']));
  assert.equal(scout({ files: ['x/y.ts'], at, prs }).verdict, 'split');
});

test('recent merges inside the window count, older ones and unrelated ones do not', () => {
  const prs = [
    pr(1, ['a.ts'], { mergedAt: '2026-11-20T10:00:00Z' }),
    pr(2, ['a.ts'], { mergedAt: '2026-11-18T10:00:00Z' }),
    pr(3, ['b.ts']),
    pr(4, ['a.ts'], { createdAt: '2026-11-21T00:00:00Z' }),
  ];
  const r = scout({ files: ['a.ts'], at, prs });
  assert.deepEqual(r.colliding.map(c => c.number), [1]);
  assert.equal(r.verdict, 'go');
});

test('a PR that was already closed at that time is skipped; self is skipped', () => {
  const prs = [pr(1, ['a.ts'], { closedAt: '2026-11-20T09:00:00Z' }), pr(2, ['a.ts'])];
  assert.deepEqual(scout({ files: ['a.ts'], at, prs, self: 2 }).colliding, []);
});

test('hot patterns and folder claims', () => {
  assert.ok(isHot('docs/reference/tools-core.md'));
  assert.ok(isHot('packages/mcp-server/src/tools/modules/play.ts'));
  assert.ok(!isHot('scripts/backlog.mjs'));
  assert.ok(fileMatches('scripts/a/b.mjs', 'scripts/a/'));
  assert.ok(!fileMatches('scripts/ab.mjs', 'scripts/a/'));
});

test('touchesOf reads paths and drops prose', () => {
  const text = '## S X\n\n- id: it\n- touches: `scripts/backlog.mjs`, scripts/a/ and the docs\n- board: B\n';
  assert.deepEqual(touchesOf(text, 'it'), ['scripts/backlog.mjs', 'scripts/a/']);
  assert.deepEqual(touchesOf(text, 'nope'), []);
});

test('conflictRefusals keeps the first refusal per PR inside the window', () => {
  const log = [
    'merge-runner: 2026-11-12T22:44:18.534Z   wait-ci: #1000 has merge conflicts, so CI will not run',
    'merge-runner: 2026-11-13T01:00:00.000Z   wait-ci: #1000 has merge conflicts, so CI will not run',
    'merge-runner: 2026-11-20T01:00:00.000Z   wait-ci: #2000 has merge conflicts, so CI will not run',
  ].join('\n');
  const m = conflictRefusals(log, '2026-11-12', '2026-11-16');
  assert.deepEqual([...m.keys()], [1000]);
  assert.equal(m.get(1000), '2026-11-12T22:44:18.534Z');
});

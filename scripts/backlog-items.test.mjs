/** scripts/backlog-items.mjs: progress parsing and the upstream Backlog read. No vault, no waiting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgress, readUpstreamBacklog } from './backlog-items.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const backlog = () =>
  [
    '# Backlog',
    '- progress: not an item',
    '## S First',
    '- id: first',
    '- progress: 2026-11-04 PR #1 ready, head aaa',
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

/* D-141 stick: no standing planner. The planner skill neither starts a successor nor arms a wake
 * watcher (the watcher script is gone). */
test('no standing planner: the planner skill has no successor or planner-wake text', () => {
  const skill = readFileSync(
    path.join(here, '..', '.claude', 'skills', 'planner', 'SKILL.md'),
    'utf8'
  );
  assert.doesNotMatch(skill, /start (the|a) (next|fresh) planner/i);
  assert.doesNotMatch(skill, /planner-wake/);
  assert.doesNotMatch(skill, /gh pr list/, 'the planner reads PRs through status --planner');
  assert.match(skill, /backlog\.mjs status --planner/);
});

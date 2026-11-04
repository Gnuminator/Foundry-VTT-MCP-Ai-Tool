/** scripts/planner-wake.mjs: progress parsing, change detection, cold rule, brief, args. No vault, no waiting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, changedProgress, isCold, freshBrief, parseArgs, DEFAULTS } from './planner-wake.mjs';

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
    '- progress: handed over at 250k'
  ].join('\r\n');

test('parseProgress reads only items with an id and a progress line', () => {
  const m = parseProgress(backlog());
  assert.deepEqual([...m.keys()], ['first', 'third']);
  assert.equal(m.get('third'), 'handed over at 250k');
});

test('changedProgress reports new and changed lines, not removed ones', () => {
  const before = parseProgress(backlog());
  assert.deepEqual(changedProgress(before, before), []);
  const changed = parseProgress(backlog('2026-11-04 PR #1 ready, head bbb'));
  assert.deepEqual(changedProgress(before, changed), [{ id: 'first', progress: '2026-11-04 PR #1 ready, head bbb' }]);
  const added = new Map(before).set('second', 'PR #2 ready');
  assert.deepEqual(changedProgress(before, added), [{ id: 'second', progress: 'PR #2 ready' }]);
  const removed = new Map(before);
  removed.delete('first');
  assert.deepEqual(changedProgress(before, removed), []);
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

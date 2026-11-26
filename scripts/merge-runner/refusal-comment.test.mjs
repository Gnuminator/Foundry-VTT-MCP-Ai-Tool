import assert from 'node:assert/strict';
import test from 'node:test';
import { commentRefusal, refusalMarker } from './refusal-comment.mjs';

const HEAD = 'a'.repeat(40);

function fake(existing = []) {
  const calls = [];
  return {
    calls,
    d: {
      log: () => {},
      gh: args => {
        calls.push(args);
        if (args[1] === 'view')
          return {
            status: 0,
            stdout: JSON.stringify({ comments: existing.map(body => ({ body })) }),
          };
        return { status: 0, stdout: '' };
      },
    },
  };
}

test('writes one comment with the refusal line and a head marker', () => {
  const f = fake();
  assert.equal(commentRefusal(f.d, 'o/r', { pr: 5, head: HEAD }, 'drift: tool counts'), true);
  const c = f.calls.find(a => a[1] === 'comment');
  assert.ok(c);
  assert.match(
    c.at(-1),
    /^<!-- merge-runner-refusal a{40} -->\nMerge runner: not merged on head aaaaaaa: drift: tool counts$/
  );
});

test('no second comment for the same head, a new head gets one', () => {
  const f = fake([`${refusalMarker(HEAD)}\nold`]);
  assert.equal(commentRefusal(f.d, 'o/r', { pr: 5, head: HEAD }, 'x'), false);
  assert.equal(f.calls.filter(a => a[1] === 'comment').length, 0);
  assert.equal(commentRefusal(f.d, 'o/r', { pr: 5, head: 'b'.repeat(40) }, 'x'), true);
});

test('local absolute paths in the reason are cut to their last segment', () => {
  const f = fake();
  commentRefusal(
    f.d,
    'o/r',
    { pr: 5, head: HEAD },
    'drift: failed (log C:\\Users\\bob\\AppData\\Local\\Temp\\lane-merge-5-drift.log) see /home/x/y/z.txt'
  );
  const body = f.calls.find(a => a[1] === 'comment').at(-1);
  assert.match(body, /\(log lane-merge-5-drift\.log\) see z\.txt/);
  assert.doesNotMatch(body, /bob|AppData|home/);
});

test('a URL in the reason comes through unchanged', () => {
  const f = fake();
  const url = 'https://github.com/o/r/actions/runs/123';
  commentRefusal(f.d, 'o/r', { pr: 5, head: HEAD }, `visual: rerun it (${url})`);
  assert.ok(
    f.calls
      .find(a => a[1] === 'comment')
      .at(-1)
      .includes(`(${url})`)
  );
});

test('a failing gh never throws', () => {
  const d = { log: () => {}, gh: () => ({ status: 1, stdout: '' }) };
  assert.equal(commentRefusal(d, 'o/r', { pr: 5, head: HEAD }, 'x'), false);
});

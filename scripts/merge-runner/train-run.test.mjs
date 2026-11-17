import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESET_REFUSALS, makeTrainRun, needsSweep } from './train-run.mjs';

const TIP = 'f'.repeat(40);
const since = [1, 2, 3, 4].map(n => ({ pr: n, sha: String(n).repeat(40) }));

/**
 * @param {{ size?: number, take?: number[], worker?: number[], reset?: number[], tip?: string,
 *   changed?: string[] }} [o] `take`, `worker`, `reset`: the answers in order (the last repeats)
 */
function fixture(o = {}) {
  const calls = { lock: [], worker: [], reset: [], post: [], log: [] };
  const pick = (/** @type {number[]} */ list, /** @type {number} */ i) =>
    list[Math.min(i, list.length - 1)];
  let takes = 0;
  let workers = 0;
  let resets = 0;
  const run = makeTrainRun({
    state: () => ({
      size: o.size ?? 4,
      limit: 4,
      since: since.slice(0, o.size ?? 4),
      lastSha: 'e'.repeat(40),
    }),
    lock: cmd => {
      calls.lock.push(cmd);
      const status = cmd === 'take' ? pick(o.take ?? [0], takes++) : 0;
      return { status, stdout: '', stderr: status ? 'held by another session' : '' };
    },
    tip: () => o.tip ?? TIP,
    changedSince: () => o.changed ?? ['scripts/x.mjs'],
    worker: (tip, sweep) => {
      calls.worker.push({ tip, sweep });
      return { code: pick(o.worker ?? [0], workers++), output: 'train-worker: step' };
    },
    reset: tip => {
      calls.reset.push(tip);
      const status = pick(o.reset ?? [0], resets++);
      return { status, stdout: status ? 'not the tip' : 'reset', stderr: '' };
    },
    post: t => calls.post.push(t),
    log: l => calls.log.push(l),
  });
  return { run, calls };
}

test('nothing blocked: nothing happens', () => {
  const f = fixture();
  assert.deepEqual(f.run.step(false), {});
  assert.deepEqual(f.calls.lock, []);
});

test('queued, then a held lock does not block: the runner just goes on each round', () => {
  const f = fixture({ take: [1, 1, 0] });
  assert.deepEqual(f.run.step(true), {});
  assert.equal(f.run.phase(), 'queued');
  assert.equal(f.calls.post.length, 1);
  assert.deepEqual(f.run.step(true), {});
  assert.deepEqual(f.run.step(true), {});
  assert.deepEqual(f.calls.worker, [], 'the lock is still another session’s');
  assert.deepEqual(f.calls.lock, ['queue', 'take', 'take']);
});

test('green roundtrip: lock taken, worker on main tip, lock released, train reset, waiting PRs cleared', () => {
  const f = fixture();
  f.run.step(true);
  const r = f.run.step(true);
  assert.deepEqual(r, { cleared: true });
  assert.deepEqual(f.calls.worker, [{ tip: TIP, sweep: false }]);
  assert.deepEqual(f.calls.reset, [TIP]);
  assert.deepEqual(f.calls.lock, ['queue', 'take', 'release']);
  assert.equal(f.run.phase(), 'idle');
  assert.match(f.calls.post.at(-1), /train reset/);
});

test('a write handler change since the last roundtrip adds the sweep', () => {
  assert.equal(needsSweep(['packages/foundry-module/src/handlers/x.ts']), true);
  assert.equal(needsSweep(['packages/mcp-server/src/tools/modules/play.ts']), true);
  assert.equal(needsSweep(['packages/foundry-module/src/handlers/x.test.ts', 'docs/a.md']), false);
  const f = fixture({ changed: ['packages/foundry-module/src/write-gate.ts'] });
  f.run.step(true);
  f.run.step(true);
  assert.equal(f.calls.worker[0].sweep, true);
});

test('red roundtrip: the lock is released, one line with the bisect hint, the runner stops, no reset', () => {
  const f = fixture({ worker: [1] });
  f.run.step(true);
  const r = f.run.step(true);
  assert.equal(r.stop, 'train roundtrip red');
  assert.deepEqual(f.calls.reset, []);
  assert.deepEqual(f.calls.lock, ['queue', 'take', 'release']);
  const last = f.calls.post.at(-1);
  assert.match(last, /stopped: live:roundtrip .* failed on main/);
  assert.match(last, /#1@1111111, #2@2222222, #3@3333333, #4@4444444/);
  assert.match(last, /bisect/);
});

test('an environment that could not start is a stop with its own wording, lock released', () => {
  const f = fixture({ worker: [2] });
  f.run.step(true);
  const r = f.run.step(true);
  assert.equal(r.stop, 'train roundtrip: environment');
  assert.match(f.calls.post.at(-1), /could not be brought up/);
  assert.equal(f.calls.lock.at(-1), 'release');
});

test('a reset refused because main moved queues again; three in a row stop the runner', () => {
  const f = fixture({ reset: [1] });
  f.run.step(true);
  for (let i = 1; i < MAX_RESET_REFUSALS; i++) {
    assert.deepEqual(f.run.step(true), {});
    assert.equal(f.run.phase(), 'queued');
  }
  const r = f.run.step(true);
  assert.match(r.stop ?? '', /reset was refused 3 times/);
});

test('the train is not full any more (someone reset it): the waiting PRs are cleared, no queue', () => {
  const f = fixture({ size: 2 });
  assert.deepEqual(f.run.step(true), { cleared: true });
  assert.deepEqual(f.calls.lock, []);
});

test('leave: a runner that exits while queued gives up its place', () => {
  const f = fixture({ take: [1] });
  f.run.step(true);
  f.run.leave();
  assert.deepEqual(f.calls.lock, ['queue', 'leave']);
  assert.equal(f.run.phase(), 'idle');
});

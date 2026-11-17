import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESET_REFUSALS, makeTrainRun, needsSweep, trainTick } from './train-run.mjs';

const TIP = 'f'.repeat(40);
const since = [1, 2, 3, 4].map(n => ({ pr: n, sha: String(n).repeat(40) }));

/**
 * @param {{ size?: number, take?: number[], worker?: number[], reset?: number[], tip?: string,
 *   tips?: string[], changed?: string[], afterReset?: number, unreadable?: boolean,
 *   releaseFails?: number }} [o] `take`, `worker`, `reset`: the answers in order (the last repeats)
 */
function fixture(o = {}) {
  const calls = { lock: [], worker: [], reset: [], post: [], log: [], stop: 0 };
  let size = o.size ?? 4;
  const pick = (/** @type {number[]} */ list, /** @type {number} */ i) =>
    list[Math.min(i, list.length - 1)];
  let takes = 0;
  let tipReads = 0;
  let workers = 0;
  let resets = 0;
  const run = makeTrainRun({
    state: () => {
      if (o.unreadable) throw new Error('train file unreadable (x)');
      return { size, limit: 4, since: since.slice(0, size), lastSha: 'e'.repeat(40) };
    },
    stopServer: () => {
      calls.stop++;
    },
    lock: cmd => {
      calls.lock.push(cmd);
      const status =
        cmd === 'take'
          ? pick(o.take ?? [0], takes++)
          : cmd === 'release'
            ? (o.releaseFails ?? 0)
            : 0;
      return { status, stdout: '', stderr: status ? 'held by another session' : '' };
    },
    tip: () => (o.tips ? o.tips[Math.min(tipReads++, o.tips.length - 1)] : (o.tip ?? TIP)),
    changedSince: () => o.changed ?? ['scripts/x.mjs'],
    worker: (tip, sweep) => {
      calls.worker.push({ tip, sweep });
      return { code: pick(o.worker ?? [0], workers++), output: 'train-worker: step' };
    },
    reset: tip => {
      calls.reset.push(tip);
      const status = pick(o.reset ?? [0], resets++);
      if (!status) size = o.afterReset ?? 0;
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

test('M3: a failed roundtrip stops server A before the lock is released; start() cleans up a dead runner', () => {
  const f = fixture({ worker: [2] });
  f.run.step(true);
  f.run.step(true);
  assert.equal(f.calls.stop, 1);
  const g = fixture();
  g.run.start();
  assert.deepEqual(g.calls.lock, ['leave', 'release']);
  assert.equal(g.calls.stop, 1, 'the dead runner’s lock was released, so its server is stopped');
  const h = fixture({ releaseFails: 1 });
  h.run.start();
  assert.equal(h.calls.stop, 0, 'a lock that is not ours is left alone');
});

test('M3: a failed lock release is posted, not only logged', () => {
  const f = fixture({ releaseFails: 1 });
  f.run.step(true);
  f.run.step(true);
  assert.ok(f.calls.post.some(p => /could not release test server A's lock/.test(p)));
});

test('M4: a reset that leaves the train full is posted once and not repeated until the train changes', () => {
  const f = fixture({ afterReset: 4 });
  f.run.step(true);
  assert.deepEqual(f.run.step(true), {}, 'green, but still full: nothing cleared');
  assert.equal(f.calls.worker.length, 1);
  assert.match(f.calls.post.at(-1), /still full/);
  const posts = f.calls.post.length;
  assert.deepEqual(f.run.step(true), {});
  assert.deepEqual(f.run.step(true), {});
  assert.equal(f.run.phase(), 'idle', 'no new queue place');
  assert.equal(f.calls.worker.length, 1);
  assert.equal(f.calls.post.length, posts);
});

test('M4: main moving on lets the next round queue again', () => {
  const f = fixture({ afterReset: 4, tips: [TIP, TIP, 'a'.repeat(40)] });
  f.run.step(true);
  f.run.step(true);
  f.run.step(true);
  assert.equal(f.run.phase(), 'queued');
});

test('L5: an unreadable main tip while queued keeps the place and takes nothing', () => {
  const f = fixture({ tip: 'unreadable' });
  f.run.step(true);
  assert.deepEqual(f.run.step(true), {});
  assert.deepEqual(f.calls.lock, ['queue']);
  assert.equal(f.run.phase(), 'queued');
});

test('L5: an unreadable train file is posted once and the round is skipped', () => {
  const h = fixture({ unreadable: true });
  assert.deepEqual(h.run.step(true), {});
  assert.equal(h.calls.post.length, 1);
  h.run.step(true);
  assert.equal(h.calls.post.length, 1);
});

test('M5: trainTick before a gate runs only while queued and drops the waiting keys on cleared', () => {
  const f = fixture();
  const attempts = new Map([['train:5@x', 1]]);
  assert.deepEqual(trainTick(f.run, attempts, 'train:', true), {}, 'idle: no step in a round');
  assert.deepEqual(f.calls.lock, []);
  trainTick(f.run, attempts, 'train:');
  assert.equal(f.run.phase(), 'queued');
  assert.deepEqual(trainTick(f.run, attempts, 'train:', true), { cleared: true });
  assert.equal(attempts.size, 0);
});

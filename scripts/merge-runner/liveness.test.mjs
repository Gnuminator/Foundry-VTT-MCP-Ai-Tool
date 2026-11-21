import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  HEARTBEAT_STALE_MS,
  runnerFiles,
  runnerLivenessLine,
  startLiveness,
  writeHeartbeat,
} from './liveness.mjs';

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

/** @param {(f: ReturnType<typeof runnerFiles>) => void} setup */
function line(setup, isRunner = () => true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-liveness-'));
  try {
    const f = runnerFiles(dir);
    setup(f);
    return runnerLivenessLine({
      lockFile: f.lock,
      heartbeatFile: f.heartbeat,
      nowMs: NOW,
      isRunner,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a live lock holder with a fresh heartbeat says nothing', () => {
  const l = line(f => {
    fs.writeFileSync(f.lock, '4242\n');
    writeHeartbeat(f.heartbeat, { pid: 4242 }, NOW - 2 * 60_000);
  });
  assert.equal(l, null);
});

test('the lock pid is gone: not running, with the last exit', () => {
  const l = line(
    f => {
      fs.writeFileSync(f.lock, '4242\n');
      writeHeartbeat(f.heartbeat, { pid: 4242 }, NOW - 40 * 60_000);
    },
    () => false
  );
  assert.match(l ?? '', /Merge runner is not running \(last heartbeat 40 min ago\)/);
  assert.match(l ?? '', /Start-ScheduledTask/);
  // No lock file at all counts the same.
  const none = line(f =>
    writeHeartbeat(f.heartbeat, { pid: 1, exit: 'finished (--once)' }, NOW - 60_000)
  );
  assert.match(none ?? '', /not running .*last exit: finished/);
});

test('a live pid with a heartbeat older than 15 minutes looks stuck', () => {
  const l = line(f => {
    fs.writeFileSync(f.lock, '4242\n');
    writeHeartbeat(f.heartbeat, { pid: 4242 }, NOW - HEARTBEAT_STALE_MS - 60_000);
  });
  assert.match(l ?? '', /pid 4242\) looks stuck: heartbeat 16 min old/);
  const missing = line(f => fs.writeFileSync(f.lock, '4242\n'));
  assert.match(missing ?? '', /looks stuck: no heartbeat/);
});

test('startLiveness: the beat survives a blocked main thread; a stop that needs a person is not restarted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-start-'));
  try {
    const lock = path.join(dir, 'merge-runner.lock');
    const hb = runnerFiles(dir).heartbeat;
    const posts = [];
    const base = { post: t => posts.push(t), log: () => {} };
    const live = startLiveness(lock, base, false, 40);
    const first = JSON.parse(fs.readFileSync(hb, 'utf8')).at;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); // like a spawnSync gate
    assert.ok(JSON.parse(fs.readFileSync(hb, 'utf8')).at > first, 'worker kept beating');
    live.deps.log('exiting: gate killed at the time limit');
    live.deps.post('stopped');
    await live.stop();
    const done = JSON.parse(fs.readFileSync(hb, 'utf8'));
    assert.equal(done.exit, 'gate killed at the time limit');
    // The repeat trigger starts it again: it refuses and leaves the heartbeat file alone.
    const again = startLiveness(lock, base, false, 40);
    assert.match(again.blocked, /needs a person.*delete /);
    assert.deepEqual(JSON.parse(fs.readFileSync(hb, 'utf8')), done);
    // A red stop restarts, and the identical stop post goes once.
    fs.writeFileSync(
      hb,
      JSON.stringify({ pid: 1, at: Date.now(), exit: 'main is red at a', exitPost: 'red!' })
    );
    const red = startLiveness(lock, base, false, 40);
    assert.equal(red.blocked, '');
    red.deps.post('red!');
    red.deps.post('other');
    assert.deepEqual(posts, ['stopped', 'other']);
    await red.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the last exit was a red main: its own line', () => {
  const l = line(f =>
    writeHeartbeat(
      f.heartbeat,
      { pid: 1, exit: 'main is red at abc1234 (CI failure)' },
      NOW - 5 * 60_000
    )
  );
  assert.match(
    l ?? '',
    /stopped on a red main \(main is red at abc1234 \(CI failure\), 5 min ago\)/
  );
  assert.match(l ?? '', /starts it again once main is green/);
});

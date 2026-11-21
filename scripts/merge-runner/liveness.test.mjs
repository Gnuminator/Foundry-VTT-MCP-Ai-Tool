import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  HEARTBEAT_STALE_MS,
  runnerFiles,
  runnerLivenessLine,
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

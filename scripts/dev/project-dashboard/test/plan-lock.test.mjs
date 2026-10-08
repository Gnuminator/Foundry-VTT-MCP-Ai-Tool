import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPlan } from '../plan.mjs';
import { readLock } from '../lock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK_PS1 = path.resolve(HERE, '..', '..', '..', 'test-env', 'lock.ps1');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(dir, name, value, mtime) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

const USAGE = {
  status: 'ok',
  plan: 'Max',
  windows: [
    { label: '5-hour limit', percentUsed: 12, resetsAt: '2026-10-08T15:00:00Z' },
    { label: 'Weekly · all models', percentUsed: 40, resetsAt: '2026-10-12T00:00:00Z' },
    { label: 'Weekly · Fable', percentUsed: 7, resetsAt: '2026-10-12T00:00:00Z' },
    { label: 'Something else', percentUsed: 1, resetsAt: null },
  ],
};

// ---- readPlan ----

test('readPlan: no files', () => {
  const dir = tmp('pd-plan-');
  assert.deepEqual(readPlan(dir), { source: null, asOf: null, windows: [] });
  assert.deepEqual(readPlan(path.join(dir, 'missing')), { source: null, asOf: null, windows: [] });
});

test('readPlan: get_usage only maps labels and uses the file mtime', () => {
  const dir = tmp('pd-plan-');
  const mtime = new Date('2026-10-08T10:00:00Z');
  writeJson(dir, 'get-usage-plan.json', USAGE, mtime);
  const plan = readPlan(dir);
  assert.equal(plan.source, 'get_usage');
  assert.equal(plan.asOf, mtime.toISOString());
  assert.deepEqual(
    plan.windows.map(w => w.kind),
    ['five_hour', 'seven_day', 'weekly_model']
  );
  assert.equal(plan.windows[0].label, '5-hour');
  assert.equal(plan.windows[1].label, 'Weekly (all models)');
  assert.equal(plan.windows[2].label, 'Weekly · Fable');
  assert.equal(plan.windows[2].percentUsed, 7);
  assert.equal(plan.windows[0].resetsAt, '2026-10-08T15:00:00Z');
});

test('readPlan: plugin only', () => {
  const dir = tmp('pd-plan-');
  writeJson(dir, 'plan.json', {
    at: '2026-10-08T11:00:00Z',
    rateLimits: [
      { kind: 'five_hour', percentUsed: 33, resetsAt: '2026-10-08T16:00:00Z' },
      { kind: 'seven_day', percentUsed: 55, resetsAt: '2026-10-13T00:00:00Z' },
      { kind: 'unknown', percentUsed: 1, resetsAt: null },
    ],
  });
  const plan = readPlan(dir);
  assert.equal(plan.source, 'plugin');
  assert.equal(plan.asOf, '2026-10-08T11:00:00.000Z');
  assert.deepEqual(
    plan.windows.map(w => [w.kind, w.label, w.percentUsed]),
    [
      ['five_hour', '5-hour', 33],
      ['seven_day', 'Weekly (all models)', 55],
    ]
  );
});

test('readPlan: a newer plugin file wins the main meters, Fable still comes from get_usage', () => {
  const dir = tmp('pd-plan-');
  writeJson(dir, 'get-usage-plan.json', USAGE, new Date('2026-10-08T10:00:00Z'));
  writeJson(dir, 'plan.json', {
    at: '2026-10-08T11:00:00Z',
    rateLimits: [
      { kind: 'five_hour', percentUsed: 90, resetsAt: '2026-10-08T16:00:00Z' },
      { kind: 'seven_day', percentUsed: 60, resetsAt: '2026-10-13T00:00:00Z' },
    ],
  });
  const plan = readPlan(dir);
  assert.equal(plan.source, 'plugin');
  assert.equal(plan.windows.find(w => w.kind === 'five_hour').percentUsed, 90);
  assert.equal(plan.windows.find(w => w.kind === 'seven_day').percentUsed, 60);
  assert.equal(plan.windows.find(w => w.kind === 'weekly_model').percentUsed, 7);
});

test('readPlan: a newer get_usage file wins over an older plugin file', () => {
  const dir = tmp('pd-plan-');
  writeJson(dir, 'plan.json', {
    at: '2026-10-08T09:00:00Z',
    rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: null }],
  });
  writeJson(dir, 'get-usage-plan.json', USAGE, new Date('2026-10-08T10:00:00Z'));
  const plan = readPlan(dir);
  assert.equal(plan.source, 'get_usage');
  assert.equal(plan.windows.find(w => w.kind === 'five_hour').percentUsed, 12);
});

test('readPlan: junk values are ignored', () => {
  const dir = tmp('pd-plan-');
  fs.writeFileSync(path.join(dir, 'plan.json'), 'not json');
  writeJson(
    dir,
    'get-usage-plan.json',
    {
      windows: [
        { label: '5-hour limit', percentUsed: 'lots', resetsAt: 'x' },
        { label: { evil: true }, percentUsed: 5 },
        { label: 'Weekly · all models', percentUsed: 20, resetsAt: { a: 1 } },
      ],
    },
    new Date('2026-10-08T10:00:00Z')
  );
  const plan = readPlan(dir);
  assert.deepEqual(plan.windows, [
    { kind: 'seven_day', label: 'Weekly (all models)', percentUsed: 20, resetsAt: null },
  ]);
});

// ---- readLock ----

test('readLock: no script', () => {
  const root = tmp('pd-lock-');
  const lock = readLock(root, { scriptPath: path.join(root, 'nope.ps1') });
  assert.deepEqual(lock, {
    state: 'no-script',
    holder: null,
    session: null,
    since: null,
    purpose: null,
    queue: [],
  });
});

test('readLock: free when lock.json is missing or has no holder', () => {
  const root = tmp('pd-lock-');
  const script = path.join(root, 'lock.ps1');
  fs.writeFileSync(script, '');
  assert.deepEqual(readLock(root, { scriptPath: script }), {
    state: 'free',
    holder: null,
    session: null,
    since: null,
    purpose: null,
    queue: [],
  });
  writeJson(root, 'lock.json', {
    holder: null,
    session: null,
    since: null,
    purpose: null,
    queue: [{ holder: 'B', session: 's2', since: '2026-10-08T10:00:00Z', purpose: 'later' }],
  });
  const lock = readLock(root, { scriptPath: script });
  assert.equal(lock.state, 'free');
  assert.deepEqual(lock.queue, [
    { holder: 'B', session: 's2', since: '2026-10-08T10:00:00Z', purpose: 'later' },
  ]);
});

test('readLock: held, with long strings cut to 120 characters', () => {
  const root = tmp('pd-lock-');
  const script = path.join(root, 'lock.ps1');
  fs.writeFileSync(script, '');
  writeJson(root, 'lock.json', {
    holder: 'H'.repeat(300),
    session: 's1',
    since: '2026-10-08T10:00:00Z',
    purpose: 'P'.repeat(300),
    queue: [],
  });
  const lock = readLock(root, { scriptPath: script });
  assert.equal(lock.state, 'held');
  assert.deepEqual(Object.keys(lock), ['state', 'holder', 'session', 'since', 'purpose', 'queue']);
  assert.equal(lock.holder.length, 120);
  assert.equal(lock.purpose.length, 120);
  assert.equal(lock.session, 's1');
});

test('readLock: the repo has the lock script', () => {
  assert.ok(fs.existsSync(LOCK_PS1));
  const root = tmp('pd-lock-');
  assert.equal(readLock(root).state, 'free');
});

// ---- lock.ps1 itself (needs pwsh) ----

const havePwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

function ps(root, args) {
  const r = spawnSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', LOCK_PS1, ...args, '-Root', root],
    { encoding: 'utf8' }
  );
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test(
  'lock.ps1: take, refuse, queue, release, head-of-queue take, leave',
  { skip: !havePwsh && 'pwsh not on PATH' },
  () => {
    const root = tmp('pd-lockps-');
    const script = LOCK_PS1;

    let r = ps(root, ['status']);
    assert.equal(r.code, 0);
    assert.match(r.out, /free/);

    r = ps(root, ['take', '-Holder', 'Lane A', '-Session', 'sa', '-Purpose', 'smoke test']);
    assert.equal(r.code, 0, r.out);
    let lock = readLock(root, { scriptPath: script });
    assert.equal(lock.state, 'held');
    assert.equal(lock.holder, 'Lane A');
    assert.equal(lock.session, 'sa');
    assert.equal(lock.purpose, 'smoke test');
    const since = lock.since;
    assert.ok(since && !Number.isNaN(Date.parse(since)));

    // the holder taking again refreshes the purpose and keeps since
    r = ps(root, ['take', '-Holder', 'Lane A', '-Session', 'sa', '-Purpose', 'second test']);
    assert.equal(r.code, 0, r.out);
    lock = readLock(root, { scriptPath: script });
    assert.equal(lock.purpose, 'second test');
    assert.equal(lock.since, since);

    // another session is refused with exit 1 and told who holds it
    r = ps(root, ['take', '-Holder', 'Lane B', '-Session', 'sb', '-Purpose', 'mine']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Lane A/);
    assert.match(r.out, /queue/);
    assert.equal(readLock(root, { scriptPath: script }).holder, 'Lane A');

    // queue (no duplicates)
    assert.equal(
      ps(root, ['queue', '-Holder', 'Lane B', '-Session', 'sb', '-Purpose', 'mine']).code,
      0
    );
    assert.equal(
      ps(root, ['queue', '-Holder', 'Lane B', '-Session', 'sb', '-Purpose', 'mine']).code,
      0
    );
    assert.equal(
      ps(root, ['queue', '-Holder', 'Lane C', '-Session', 'sc', '-Purpose', 'later']).code,
      0
    );
    lock = readLock(root, { scriptPath: script });
    assert.deepEqual(
      lock.queue.map(q => q.session),
      ['sb', 'sc']
    );

    // only the holder releases
    r = ps(root, ['release', '-Session', 'sb']);
    assert.equal(r.code, 1);
    assert.equal(readLock(root, { scriptPath: script }).state, 'held');
    r = ps(root, ['release', '-Session', 'sa']);
    assert.equal(r.code, 0, r.out);
    assert.equal(readLock(root, { scriptPath: script }).state, 'free');
    assert.equal(readLock(root, { scriptPath: script }).queue.length, 2);

    // free, but the queue head goes first
    r = ps(root, ['take', '-Holder', 'Lane C', '-Session', 'sc', '-Purpose', 'jumping']);
    assert.equal(r.code, 1);
    assert.match(r.out, /Lane B/);
    r = ps(root, ['take', '-Holder', 'Lane B', '-Session', 'sb', '-Purpose', 'mine']);
    assert.equal(r.code, 0, r.out);
    lock = readLock(root, { scriptPath: script });
    assert.equal(lock.holder, 'Lane B');
    assert.deepEqual(
      lock.queue.map(q => q.session),
      ['sc']
    );

    // -Force releases somebody else's lock; leave drops out of the queue
    r = ps(root, ['release', '-Session', 'whoever', '-Force']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Lane B/);
    assert.equal(ps(root, ['leave', '-Session', 'sc']).code, 0);
    lock = readLock(root, { scriptPath: script });
    assert.equal(lock.state, 'free');
    assert.deepEqual(lock.queue, []);

    // no leftovers from the serialisation
    assert.deepEqual(fs.readdirSync(root).sort(), ['lock.json']);
  }
);

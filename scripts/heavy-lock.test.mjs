/**
 * scripts/heavy-lock.mjs: slots, waiting with a printed line, stale takeover, re-entrancy through
 * the environment, the give-up timeout, the CLI, and drift-check's lockedCommand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, HELD_ENV, acquire, pidAlive, readConfig, resetGaveUp, status, withHeavyLock } from './heavy-lock.mjs';
import { lockedCommand } from './drift-check.mjs';

const script = fileURLToPath(new URL('./heavy-lock.mjs', import.meta.url));

const GB = 2 ** 30;

/**
 * A fresh lock folder and an env pointing at it, one slot and no settings file unless `extra` says
 * otherwise. @param {Record<string, string | undefined>} [extra]
 */
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-lock-test-'));
  return {
    dir,
    env: /** @type {Record<string, string | undefined>} */ ({
      HEAVY_LOCK_DIR: dir,
      HEAVY_LOCK_CONFIG: path.join(dir, 'heavy-lock.json'),
      HEAVY_LOCK_SLOTS: '1',
      ...extra,
    }),
  };
}

/** Write a queue ticket as another waiter would. */
function ticket(dir, { priority = '1', since = Date.now() - 10_000, pid = process.pid, label = 'other' } = {}) {
  fs.mkdirSync(path.join(dir, 'queue'), { recursive: true });
  const file = path.join(dir, 'queue', `${priority}-${String(since).padStart(15, '0')}-${pid}-abc.json`);
  fs.writeFileSync(file, JSON.stringify({ pid, label, since }));
  return file;
}

test('a free lock is taken and released', () => {
  const { dir, env } = fixture();
  const lock = acquire('a', { env, log: () => {} });
  assert.equal(lock.held, true);
  assert.ok(fs.existsSync(path.join(dir, 'slot-0', 'owner.json')));
  lock.release();
  assert.ok(!fs.existsSync(path.join(dir, 'slot-0')));
});

test('a second run waits, prints one line naming the holder, and gets the lock when it is released', () => {
  const { env } = fixture();
  const first = acquire('first', { env, log: () => {} });
  const lines = [];
  let sleeps = 0;
  const second = acquire('second', {
    env,
    log: l => lines.push(l),
    sleep: () => {
      if (++sleeps === 3) first.release();
    },
  });
  assert.equal(second.held, true);
  assert.equal(lines.filter(l => l.includes('second waits for first')).length, 1);
  assert.ok(lines.some(l => l.includes('got the lock')));
  second.release();
});

test('two slots let two runs go at once and the third waits', () => {
  const { env } = fixture({ HEAVY_LOCK_SLOTS: '2' });
  const freemem = () => 64 * GB;
  const a = acquire('a', { env, log: () => {}, freemem });
  const b = acquire('b', { env, log: () => {}, freemem });
  assert.ok(a.held && b.held);
  const c = acquire('c', { env, log: () => {}, sleep: () => {}, maxWaitMs: 0, freemem });
  assert.equal(c.held, false);
  a.release();
  b.release();
});

test('a lock whose process is gone is taken over', () => {
  const { dir, env } = fixture();
  fs.mkdirSync(path.join(dir, 'slot-0'));
  fs.writeFileSync(
    path.join(dir, 'slot-0', 'owner.json'),
    JSON.stringify({ pid: 999999, label: 'dead run', start: Date.now() })
  );
  const lock = acquire('new', { env, log: () => {}, alive: () => false });
  assert.equal(lock.held, true);
  lock.release();
});

test('a lock older than an hour is stale even if its pid lives', () => {
  const { dir, env } = fixture();
  fs.mkdirSync(path.join(dir, 'slot-0'));
  fs.writeFileSync(
    path.join(dir, 'slot-0', 'owner.json'),
    JSON.stringify({ pid: process.pid, label: 'old', start: Date.now() - 2 * 3600 * 1000 })
  );
  const lock = acquire('new', { env, log: () => {}, alive: () => true });
  assert.equal(lock.held, true);
  lock.release();
});

test('the wait gives up after the maximum and goes on without the lock', () => {
  const { env } = fixture();
  const holder = acquire('holder', { env, log: () => {} });
  const lines = [];
  let t = 0;
  const lock = acquire('late', {
    env,
    log: l => lines.push(l),
    now: () => t,
    sleep: ms => {
      t += ms * 60;
    },
    maxWaitMs: 60_000,
    alive: () => true,
  });
  assert.equal(lock.held, false);
  assert.ok(lines.some(l => l.includes('going on without the lock')));
  // Having given up once, the rest of that process does not wait again.
  const again = acquire('later', { env, log: () => {}, sleep: () => assert.fail('waited'), alive: () => true });
  assert.equal(again.held, false);
  resetGaveUp();
  holder.release();
});

test('a held marker naming a dead process is ignored', () => {
  const { env } = fixture({ [HELD_ENV]: '999999' });
  const lock = acquire('x', { env, log: () => {}, alive: pid => pid !== 999999 });
  assert.equal(lock.held, true);
  lock.release();
});

test('the CLI started through a path that differs in case still runs the command (win32)', { skip: process.platform !== 'win32' }, () => {
  const { env } = fixture();
  const r = spawnSync(
    process.execPath,
    [path.join(path.dirname(script).toUpperCase(), path.basename(script)), 'run', '--', 'node', '-e', '"process.exit(5)"'],
    { env: { ...process.env, ...env, HEAVY_LOCK_HELD: '' }, encoding: 'utf8' }
  );
  assert.equal(r.status, 5);
});


test('a lock folder that cannot be made only prints a line and runs unlocked', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-lock-test-')), 'plain-file');
  fs.writeFileSync(file, 'x');
  const lines = [];
  const lock = acquire('x', { env: { HEAVY_LOCK_DIR: path.join(file, 'sub') }, log: l => lines.push(l) });
  assert.equal(lock.held, false);
  assert.ok(lines.some(l => l.includes('lock unavailable')));
});

test('withHeavyLock sets the held marker for the work and does not wait on itself', () => {
  const { env } = fixture();
  const seen = withHeavyLock(
    'outer',
    () => {
      const inner = withHeavyLock('inner', () => env[HELD_ENV], { env, log: () => {} });
      return inner;
    },
    { env, log: () => {} }
  );
  assert.equal(seen, String(process.pid));
  assert.equal(env[HELD_ENV], undefined);
});

test('status lists the settings, free and held slots, and who waits', () => {
  const { dir, env } = fixture();
  const lines = status(env, Date.now(), pidAlive, () => 8 * GB);
  assert.match(lines[0], /^settings: 1 slots \(from env\), another run needs 5 GB per running one plus 2 GB free, 8\.0 GB free now$/);
  assert.deepEqual(lines.slice(1), ['slot-0: free']);
  const lock = acquire('s', { env, log: () => {} });
  lock.beat('typecheck');
  ticket(dir, { label: 'next green', priority: '0' });
  const held = status(env);
  assert.match(held[1], /slot-0: s \(typecheck\) \(pid \d+/);
  assert.match(held[2], /^waiting 1: next green \(pid \d+, \d+ s, high priority\)$/);
  lock.release();
});

test('waiters go in arrival order: a later run waits for an earlier ticket even with a slot free', () => {
  const { dir, env } = fixture();
  const earlier = ticket(dir, { label: 'earlier' });
  const lines = [];
  let sleeps = 0;
  const lock = acquire('later', {
    env,
    log: l => lines.push(l),
    sleep: () => {
      if (++sleeps === 3) fs.rmSync(earlier);
    },
  });
  assert.equal(lock.held, true);
  assert.equal(sleeps, 3, 'waited until the earlier ticket was gone');
  assert.ok(lines.some(l => /later waits .*number 2 in line, runs ahead in line/.test(l)), lines.join('\n'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'queue')), [], 'its own ticket is gone once it holds a slot');
  lock.release();
});

test('high priority goes ahead of earlier normal waiters', () => {
  const { dir, env } = fixture();
  ticket(dir, { label: 'a green' });
  const lock = acquire('drift-check', { env, log: () => {}, priority: 'high', sleep: () => assert.fail('waited') });
  assert.equal(lock.held, true);
  lock.release();
});

test('a ticket whose process is gone is dropped', () => {
  const { dir, env } = fixture();
  const dead = ticket(dir, { pid: 999999 });
  const lock = acquire('x', { env, log: () => {}, alive: pid => pid !== 999999, sleep: () => assert.fail('waited') });
  assert.equal(lock.held, true);
  assert.ok(!fs.existsSync(dead));
  lock.release();
});

test('settings: environment, then the file, then the defaults; a bad value falls through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-lock-test-'));
  const file = path.join(dir, 'heavy-lock.json');
  const env = { HEAVY_LOCK_CONFIG: file };
  assert.deepEqual(readConfig(env), { slots: 3, slotsFrom: 'default', ...DEFAULTS });
  fs.writeFileSync(file, JSON.stringify({ slots: 4, minFreeGb: 6, peakGb: 2.5, maxWaitMin: 30 }));
  assert.deepEqual(readConfig(env), { slots: 4, slotsFrom: 'file', minFreeGb: 6, peakGb: 2.5, maxWaitMin: 30 });
  assert.equal(readConfig({ ...env, HEAVY_LOCK_SLOTS: '2' }).slots, 2);
  assert.equal(readConfig({ ...env, HEAVY_LOCK_SLOTS: '2' }).slotsFrom, 'env');
  assert.equal(readConfig({ ...env, HEAVY_LOCK_SLOTS: 'x' }).slots, 4, 'bad env value: the file');
  fs.writeFileSync(file, JSON.stringify({ slots: 0 }));
  assert.equal(readConfig(env).slots, 3, 'bad file value: the default');
  fs.writeFileSync(file, 'not json');
  assert.equal(readConfig(env).slots, 3);
});

test('a slot count raised in the file reaches a run that is already waiting', () => {
  const { dir, env } = fixture({ HEAVY_LOCK_SLOTS: undefined });
  fs.writeFileSync(env.HEAVY_LOCK_CONFIG, JSON.stringify({ slots: 1 }));
  const freemem = () => 64 * GB;
  const first = acquire('first', { env, log: () => {}, freemem });
  let sleeps = 0;
  const second = acquire('second', {
    env,
    log: () => {},
    freemem,
    sleep: () => {
      if (++sleeps === 2) fs.writeFileSync(env.HEAVY_LOCK_CONFIG, JSON.stringify({ slots: 2 }));
    },
  });
  assert.equal(second.held, true);
  assert.ok(fs.existsSync(path.join(dir, 'slot-1')));
  first.release();
  second.release();
});

test('free RAM: another slot waits until there is room for the peak of every running holder plus the reserve', () => {
  const { env } = fixture({ HEAVY_LOCK_SLOTS: '2' });
  fs.writeFileSync(env.HEAVY_LOCK_CONFIG, JSON.stringify({ peakGb: 4, minFreeGb: 3 }));
  let free = 2 * GB;
  const lines = [];
  const first = acquire('first', { env, log: () => {}, freemem: () => free });
  assert.equal(first.held, true, 'the first slot never waits for RAM');
  let sleeps = 0;
  const second = acquire('second', {
    env,
    log: l => lines.push(l),
    freemem: () => free,
    sleep: () => {
      sleeps++;
      // 6.5 GB free minus 4 GB for the running holder is under the 3 GB reserve: still waiting.
      if (sleeps === 2) free = 6.5 * GB;
      if (sleeps === 4) free = 7 * GB;
    },
  });
  assert.equal(second.held, true);
  assert.equal(sleeps, 4);
  assert.ok(lines.some(l => /2\.0 GB free, another run needs 7 GB/.test(l)), lines.join('\n'));
  assert.ok(lines.some(l => /got the lock .*slot 2 of 2, 7\.0 GB free/.test(l)), lines.join('\n'));
  first.release();
  second.release();
});

test('every slot taken is logged in admissions.jsonl', () => {
  const { dir, env } = fixture();
  acquire('logged', { env, log: () => {}, freemem: () => 12 * GB }).release();
  const entry = JSON.parse(fs.readFileSync(path.join(dir, 'admissions.jsonl'), 'utf8').trim());
  assert.equal(entry.label, 'logged');
  assert.equal(entry.freeGb, 12);
  assert.equal(entry.slots, 1);
  assert.equal(entry.slotsFrom, 'env');
});

test('a holder that beats is not stale after an hour; one that stops beating is', () => {
  const { env } = fixture();
  let t = 1_000_000_000;
  const now = () => t;
  const holder = acquire('long green', { env, log: () => {}, now, alive: () => true });
  t += 50 * 60 * 1000;
  holder.beat('e2e');
  t += 50 * 60 * 1000;
  const blocked = acquire('waiter', { env, log: () => {}, now, alive: () => true, sleep: () => {}, maxWaitMs: 0 });
  assert.equal(blocked.held, false, '100 minutes after the start but 50 after the last beat: still held');
  resetGaveUp();
  t += 20 * 60 * 1000;
  const taker = acquire('waiter', { env, log: () => {}, now, alive: () => true });
  assert.equal(taker.held, true, '70 minutes without a beat: stale');
  taker.release();
});

test('an owner written by the older lock (pid, label, start only) is respected, and a second slot is used next to it', () => {
  const { dir, env } = fixture({ HEAVY_LOCK_SLOTS: '2' });
  fs.mkdirSync(path.join(dir, 'slot-0'));
  fs.writeFileSync(
    path.join(dir, 'slot-0', 'owner.json'),
    JSON.stringify({ pid: process.pid, label: 'old green typecheck', start: Date.now() - 5 * 60 * 1000 })
  );
  const lock = acquire('new', { env, log: () => {}, freemem: () => 64 * GB });
  assert.equal(lock.held, true);
  assert.ok(fs.existsSync(path.join(dir, 'slot-1', 'owner.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'slot-0', 'owner.json'), 'utf8')).label, 'old green typecheck');
  lock.release();
});

test('a slot held above a lowered slot count still counts as in use', () => {
  const { dir, env } = fixture({ HEAVY_LOCK_SLOTS: '1' });
  fs.mkdirSync(path.join(dir, 'slot-2'));
  fs.writeFileSync(path.join(dir, 'slot-2', 'owner.json'), JSON.stringify({ pid: process.pid, label: 'high slot', start: Date.now() }));
  const lock = acquire('x', { env, log: () => {}, alive: () => true, sleep: () => {}, maxWaitMs: 0 });
  assert.equal(lock.held, false);
  resetGaveUp();
});

test('the CLI runs the command under the lock, passes its exit code, and releases', () => {
  const { dir, env } = fixture();
  // The command goes through the shell as one string, like npm run commands do: `node` from PATH.
  const r = spawnSync(
    process.execPath,
    [script, 'run', '--label', 'cli', '--', 'node', '-e', '"process.exit(7)"'],
    { env: { ...process.env, ...env, HEAVY_LOCK_HELD: '' }, encoding: 'utf8' }
  );
  assert.equal(r.status, 7);
  assert.ok(!fs.existsSync(path.join(dir, 'slot-0')));
});

test('two CLI runs started together run one after the other', async () => {
  const { dir, env } = fixture();
  const marker = path.join(dir, 'log.txt');
  const worker = path.join(dir, 'worker.cjs');
  fs.writeFileSync(
    worker,
    "const fs = require('fs');\nfs.appendFileSync(process.argv[2], 'start\\n');\nsetTimeout(() => fs.appendFileSync(process.argv[2], 'end\\n'), 700);\n"
  );
  const q = p => `"${p}"`;
  const run = () =>
    new Promise(resolve => {
      const p = spawn(process.execPath, [script, 'run', '--', 'node', q(worker), q(marker)], {
        env: { ...process.env, ...env, HEAVY_LOCK_HELD: '' },
        stdio: 'ignore',
      });
      p.on('exit', resolve);
    });
  await Promise.all([run(), run()]);
  assert.deepEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['start', 'end', 'start', 'end']);
});

test('drift-check wraps only heavy guards, and only when the merged tree has the lock script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-lock-test-'));
  const heavy = { name: 'mcp-server tests (tool counts)', command: 'npx vitest run', heavy: true };
  const light = { name: 'docs lint', command: 'npm run docs:lint' };
  assert.equal(lockedCommand(heavy, dir), heavy.command, 'no script in the tree: unchanged');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'heavy-lock.mjs'), '');
  assert.equal(lockedCommand(light, dir), light.command);
  const wrapped = lockedCommand(heavy, dir);
  assert.match(wrapped, /heavy-lock\.mjs" run --label "drift-check mcp-server tests" --priority high -- npx vitest run$/);
});

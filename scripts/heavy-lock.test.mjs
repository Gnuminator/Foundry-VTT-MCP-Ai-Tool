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
import { DEFAULTS, HELD_ENV, acquire, pendingGb, pidAlive, readConfig, resetGaveUp, status, withHeavyLock } from './heavy-lock.mjs';
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

test('a give-up on one lock folder does not switch off waiting on another (the solo e2e lock)', () => {
  const { env } = fixture();
  const holder = acquire('holder', { env, log: () => {} });
  assert.equal(acquire('late', { env, log: () => {}, sleep: () => {}, maxWaitMs: 0, alive: () => true }).held, false);
  const solo = fixture();
  const other = acquire('solo', { env: solo.env, log: () => {} });
  let sleeps = 0;
  const waiter = acquire('solo waiter', {
    env: solo.env,
    log: () => {},
    alive: () => true,
    sleep: () => {
      if (++sleeps === 2) other.release();
    },
  });
  assert.equal(waiter.held, true, 'waited for the other folder and got it');
  assert.ok(sleeps >= 2);
  waiter.release();
  resetGaveUp();
  holder.release();
});

test('a waiter whose own ticket goes missing writes it again and keeps its place behind earlier tickets', () => {
  const { dir, env } = fixture();
  const holder = acquire('holder', { env, log: () => {} });
  const earlier = ticket(dir, { since: Date.now() - 60_000, label: 'earlier' });
  let sleeps = 0;
  /** @type {string[]} */
  let seen = [];
  const waiter = acquire('waiter', {
    env,
    log: () => {},
    alive: () => true,
    sleep: () => {
      sleeps++;
      const q = path.join(dir, 'queue');
      if (sleeps === 1) {
        // Cleared by hand: our ticket only.
        for (const n of fs.readdirSync(q)) if (!n.includes('-abc.')) fs.rmSync(path.join(q, n));
      } else if (sleeps === 2) {
        seen = fs.readdirSync(q).sort();
        holder.release();
      } else if (sleeps === 3) {
        assert.ok(fs.existsSync(path.join(dir, 'slot-0')) === false, 'did not jump the earlier ticket');
        fs.rmSync(earlier);
      }
    },
  });
  assert.equal(waiter.held, true);
  assert.equal(seen.length, 2, 'the ticket was written again next to the earlier one');
  assert.ok(sleeps >= 3);
  waiter.release();
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
  assert.match(lines[0], /^settings: 1 slots \(from env\), another run needs 5 GB \(3\.5 for pre-push and lint-ratchet\) per running one, less what it uses already, plus 2 GB free, 8\.0 GB free now$/);
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
  fs.writeFileSync(file, JSON.stringify({ slots: 4, minFreeGb: 6, peakGb: 2.5, lightPeakGb: 1.5, maxWaitMin: 30 }));
  assert.deepEqual(readConfig(env), { slots: 4, slotsFrom: 'file', minFreeGb: 6, peakGb: 2.5, lightPeakGb: 1.5, maxWaitMin: 30 });
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

test('free RAM: what a holder uses already is not reserved again', () => {
  const { env } = fixture({ HEAVY_LOCK_SLOTS: '2' });
  fs.writeFileSync(env.HEAVY_LOCK_CONFIG, JSON.stringify({ peakGb: 5, minFreeGb: 2 }));
  let free = 12 * GB;
  const first = acquire('first', { env, log: () => {}, freemem: () => free });
  // The holder has grown to its peak: free fell by 5 GB to 7. 7 - 0 pending >= 2: no waiting.
  free = 7 * GB;
  const second = acquire('second', { env, log: () => {}, freemem: () => free, sleep: () => assert.fail('waited') });
  assert.equal(second.held, true);
  first.release();
  second.release();
});

test('free RAM: a holder that has used nothing yet still reserves its whole peak', () => {
  const { env } = fixture({ HEAVY_LOCK_SLOTS: '2' });
  fs.writeFileSync(env.HEAVY_LOCK_CONFIG, JSON.stringify({ peakGb: 5, minFreeGb: 2 }));
  const first = acquire('first', { env, log: () => {}, freemem: () => 6 * GB });
  const second = acquire('second', { env, log: () => {}, freemem: () => 6 * GB, sleep: () => {}, maxWaitMs: 0 });
  assert.equal(second.held, false, '6 GB free - 5 GB to come < 2 GB');
  first.release();
});

test('pendingGb: the fall in free RAM is credited once, not to every holder', () => {
  const cfg = { peakGb: 5, lightPeakGb: 3 };
  const o = (since, freeGb) => ({ state: { pid: 1, label: 'green', start: since, since, freeGb } });
  // A admitted at 12 GB free grew 3 GB; B admitted at 9 GB free. Free now 6: 6 of 10 GB is used.
  assert.equal(pendingGb([o(2, 9), o(1, 12)], cfg, 6), 4);
});

test('pendingGb: pre-push and lint-ratchet use the lower peak; an owner without freeGb counts in full', () => {
  const cfg = { peakGb: 5, lightPeakGb: 3 };
  const o = (label, freeGb) => ({ state: { pid: 1, label, start: 0, freeGb } });
  assert.equal(pendingGb([o('pre-push', 10), o('lint-ratchet', 10), o('drift-check lint baseline', 10)], cfg, 10), 9);
  assert.equal(pendingGb([o('green x', 10)], cfg, 8), 3, 'free fell 2 GB: 3 GB still to come');
  assert.equal(pendingGb([o('green x', 10)], cfg, 2), 0, 'never negative');
  assert.equal(pendingGb([o('green x', undefined)], cfg, 2), 5);
  assert.equal(pendingGb([{ state: 'unknown' }], cfg, 2), 5);
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

test('a holder that beats is not stale after an hour; one that stops beating for 20 minutes is', () => {
  const { dir, env } = fixture();
  let t = 1_000_000_000;
  const now = () => t;
  const holder = acquire('long green', { env, log: () => {}, now, alive: () => true });
  for (let i = 0; i < 6; i++) {
    t += 15 * 60 * 1000;
    holder.beat('e2e');
  }
  // Written whole through a rename: no temp file is left next to it.
  assert.deepEqual(fs.readdirSync(path.join(dir, 'slot-0')), ['owner.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'slot-0', 'owner.json'), 'utf8')).step, 'e2e');
  t += 19 * 60 * 1000;
  const blocked = acquire('waiter', { env, log: () => {}, now, alive: () => true, sleep: () => {}, maxWaitMs: 0 });
  assert.equal(blocked.held, false, '109 minutes after the start but 19 after the last beat: still held');
  resetGaveUp();
  t += 2 * 60 * 1000;
  const taker = acquire('waiter', { env, log: () => {}, now, alive: () => true });
  assert.equal(taker.held, true, '21 minutes without a beat: stale (a killed run whose pid was reused)');
  taker.release();
});

test('an owner from the older lock (no since) keeps the hour: 50 minutes without a beat is still held', () => {
  const { dir, env } = fixture();
  fs.mkdirSync(path.join(dir, 'slot-0'));
  fs.writeFileSync(
    path.join(dir, 'slot-0', 'owner.json'),
    JSON.stringify({ pid: process.pid, label: 'old green', start: Date.now() - 50 * 60 * 1000 })
  );
  const blocked = acquire('new', { env, log: () => {}, alive: () => true, sleep: () => {}, maxWaitMs: 0 });
  assert.equal(blocked.held, false);
  resetGaveUp();
});

test('the CLI beats while its command runs, so a long hold is not taken for stale', () => {
  const { dir, env } = fixture();
  const seen = path.join(dir, 'seen.json');
  const worker = path.join(dir, 'worker.cjs');
  // The command reads its own slot after a while, as a waiter would.
  fs.writeFileSync(
    worker,
    "const fs = require('fs'), path = require('path');\nsetTimeout(() => fs.copyFileSync(path.join(process.argv[2], 'slot-0', 'owner.json'), process.argv[3]), 1200);\n"
  );
  const r = spawnSync(process.execPath, [script, 'run', '--label', 'long', '--', 'node', `"${worker}"`, `"${dir}"`, `"${seen}"`], {
    env: { ...process.env, ...env, HEAVY_LOCK_HELD: '', HEAVY_LOCK_BEAT_MS: '200' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const owner = JSON.parse(fs.readFileSync(seen, 'utf8'));
  assert.equal(owner.label, 'long');
  assert.ok(owner.start - owner.since >= 600, `start moved on by the beat (${owner.start - owner.since} ms)`);
  assert.ok(!fs.existsSync(path.join(dir, 'slot-0')), 'released after the command');
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
        env: { ...process.env, ...env, HEAVY_LOCK_HELD: '', HEAVY_LOCK_SLOTS: '1' },
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

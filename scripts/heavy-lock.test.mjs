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
import { HELD_ENV, acquire, resetGaveUp, status, withHeavyLock } from './heavy-lock.mjs';
import { lockedCommand } from './drift-check.mjs';

const script = fileURLToPath(new URL('./heavy-lock.mjs', import.meta.url));

/** A fresh lock folder and an env pointing at it. @param {Record<string, string>} [extra] */
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-lock-test-'));
  return { dir, env: /** @type {Record<string, string | undefined>} */ ({ HEAVY_LOCK_DIR: dir, ...extra }) };
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
  const a = acquire('a', { env, log: () => {} });
  const b = acquire('b', { env, log: () => {} });
  assert.ok(a.held && b.held);
  const c = acquire('c', { env, log: () => {}, sleep: () => {}, maxWaitMs: 0 });
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

test('status lists free and held slots', () => {
  const { env } = fixture();
  assert.deepEqual(status(env), ['slot-0: free']);
  const lock = acquire('s', { env, log: () => {} });
  assert.match(status(env)[0], /slot-0: s \(pid \d+/);
  lock.release();
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
  assert.match(wrapped, /heavy-lock\.mjs" run --label "drift-check mcp-server tests" -- npx vitest run$/);
});

/**
 * scripts/test-env/sync-module.ps1 -Watch (module sync on save, D-102): it copies a changed module
 * build only while this session holds the test server lock, waits and says so otherwise, and never
 * takes the lock. Runs the real script against a temporary module folder and lock root (-Source,
 * -Root, -NoBuild): no test server is touched. Skipped where pwsh 7 is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(root, 'scripts', 'test-env', 'sync-module.ps1');

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();

const ME = 'local_me';

/** @param {string} dir @param {object | string} lock */
function writeLock(dir, lock) {
  const text = typeof lock === 'string' ? lock : JSON.stringify(lock);
  fs.writeFileSync(path.join(dir, 'lock.json'), text);
}

const held = (session, holder) => ({
  holder,
  session,
  since: new Date().toISOString(),
  purpose: 'a live test',
  queue: [],
});
const FREE = { holder: null, session: null, since: null, purpose: null, queue: [] };

/** Polls until check() is truthy or the time is up. @param {() => unknown} check */
async function until(check, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

test(
  'sync-module.ps1 -Watch syncs only while this session holds the lock',
  { skip: !hasPwsh && 'pwsh is missing', timeout: 120000 },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-'));
    const src = path.join(tmp, 'module');
    const lockRoot = path.join(tmp, 'root');
    fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(src, 'styles'), { recursive: true });
    fs.mkdirSync(lockRoot);
    fs.writeFileSync(
      path.join(src, 'module.json'),
      JSON.stringify({
        id: 'foundry-mcp-bridge',
        version: '9.9.9',
        manifest: 'https://x',
        download: 'https://y',
      })
    );
    fs.writeFileSync(path.join(src, 'styles', 'a.css'), 'body{}');
    const mainSrc = path.join(src, 'dist', 'main.js');
    const mainDest = path.join(lockRoot, 'modules', 'foundry-mcp-bridge', 'dist', 'main.js');
    fs.writeFileSync(mainSrc, 'v1');
    writeLock(lockRoot, held('local_other', 'Other lane'));

    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Watch',
        '-NoBuild',
        '-Session',
        ME,
        '-Root',
        lockRoot,
        '-Source',
        src,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    const said = text => () => out.includes(text);
    try {
      // Held by another lane: waits, says who, copies nothing.
      await until(said('held by Other lane (session local_other)'), 'the wait message', 30000);
      await sleep(2500);
      assert.equal(
        fs.existsSync(mainDest),
        false,
        'nothing is copied while another lane holds the lock'
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(lockRoot, 'lock.json'), 'utf8')).session,
        'local_other',
        'the watch never takes the lock'
      );

      // This session takes the lock: the pending build is copied with the test manifest.
      writeLock(lockRoot, held(ME, 'Module sync'));
      await until(
        () => fs.existsSync(mainDest) && fs.readFileSync(mainDest, 'utf8') === 'v1',
        'the first sync'
      );
      const manifest = JSON.parse(
        fs.readFileSync(path.join(lockRoot, 'modules', 'foundry-mcp-bridge', 'module.json'), 'utf8')
      );
      assert.equal(manifest.flags['foundry-mcp-bridge'].testInstall, true);
      assert.equal(manifest.manifest, undefined);
      assert.equal(manifest.download, undefined);
      assert.ok(
        fs.existsSync(path.join(lockRoot, 'modules', 'foundry-mcp-bridge', 'styles', 'a.css'))
      );

      // A save while holding the lock syncs.
      fs.writeFileSync(mainSrc, 'v2');
      await until(() => fs.readFileSync(mainDest, 'utf8') === 'v2', 'the sync of a save');

      // A save after the lock is released does not; the watch says so and does not take it.
      writeLock(lockRoot, FREE);
      fs.writeFileSync(mainSrc, 'v3 with more bytes');
      await until(
        said('the test server lock is free, but this session does not hold it'),
        'the free message'
      );
      await sleep(2500);
      assert.equal(
        fs.readFileSync(mainDest, 'utf8'),
        'v2',
        'a save without the lock is not copied'
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(lockRoot, 'lock.json'), 'utf8')).session,
        null
      );

      // A lock.json that cannot be read is not treated as free or as ours.
      writeLock(lockRoot, '{ broken');
      fs.writeFileSync(mainSrc, 'v4 with even more bytes');
      await until(said('lock.json cannot be read'), 'the unreadable message');
      await sleep(2000);
      assert.equal(fs.readFileSync(mainDest, 'utf8'), 'v2');

      // Holding the lock again syncs the waiting save.
      writeLock(lockRoot, held(ME, 'Module sync'));
      await until(
        () => fs.readFileSync(mainDest, 'utf8') === 'v4 with even more bytes',
        'the sync after waiting'
      );
    } finally {
      child.kill();
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    }
  }
);

const hasTsc = fs.existsSync(path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'));

/** @param {number} pid */
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
};

test(
  'sync-module.ps1 -Watch with the build: no stale first copy, type errors not synced, tsc dies with it',
  {
    skip: (!hasPwsh && 'pwsh is missing') || (!hasTsc && 'typescript is not installed'),
    timeout: 120000,
  },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-watch-build-'));
    const src = path.join(tmp, 'module');
    const lockRoot = path.join(tmp, 'root');
    fs.mkdirSync(path.join(src, 'src'), { recursive: true });
    fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
    fs.mkdirSync(lockRoot);
    fs.writeFileSync(
      path.join(src, 'module.json'),
      JSON.stringify({ id: 'foundry-mcp-bridge', version: '9.9.9' })
    );
    fs.writeFileSync(
      path.join(src, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          outDir: 'dist',
          rootDir: 'src',
          target: 'ES2022',
          module: 'ESNext',
          types: [],
        },
        include: ['src'],
      })
    );
    const ts = path.join(src, 'src', 'main.ts');
    const mainDest = path.join(lockRoot, 'modules', 'foundry-mcp-bridge', 'dist', 'main.js');
    // An older build on disk: it must never reach the test server.
    fs.writeFileSync(path.join(src, 'dist', 'main.js'), 'export const v = "stale";\n');
    fs.writeFileSync(ts, 'export const v: string = "built-1";\n');
    writeLock(lockRoot, held(ME, 'Module sync'));

    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Watch',
        '-Session',
        ME,
        '-Root',
        lockRoot,
        '-Source',
        src,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    let tscPid = 0;
    try {
      await until(() => /Build watch started \(pid (\d+)\)/.test(out), 'the build watch', 30000);
      tscPid = Number(/Build watch started \(pid (\d+)\)/.exec(out)[1]);

      // The first copy is tsc's first build, not the dist/ that was on disk.
      await until(() => out.includes('Synced module'), 'the first sync', 60000);
      assert.match(fs.readFileSync(mainDest, 'utf8'), /built-1/);
      assert.equal(
        out.split('Synced module').length - 1,
        1,
        'one copy: the first build, not the old dist/ first'
      );

      // A save with a type error emits nothing (--noEmitOnError), so nothing is copied.
      fs.writeFileSync(ts, 'export const v: number = "built-2";\n');
      await until(() => /error TS2322/.test(out), 'the type error', 30000);
      await sleep(3000);
      assert.match(fs.readFileSync(mainDest, 'utf8'), /built-1/);

      // Fixed: synced.
      fs.writeFileSync(ts, 'export const v: string = "built-3";\n');
      await until(
        () => fs.existsSync(mainDest) && /built-3/.test(fs.readFileSync(mainDest, 'utf8')),
        'the sync of the fix',
        30000
      );

      // A hard kill of the watch (TaskStop, a closed window) takes tsc with it.
      assert.ok(alive(tscPid), 'tsc runs while the watch runs');
      child.kill('SIGKILL');
      await until(() => !alive(tscPid), 'tsc to exit after the watch was killed', 15000);
    } finally {
      child.kill('SIGKILL');
      if (tscPid && alive(tscPid)) process.kill(tscPid);
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    }
  }
);

test(
  'sync-module.ps1 -Watch refuses to start without -Session',
  { skip: !hasPwsh && 'pwsh is missing' },
  () => {
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-Watch',
        '-NoBuild',
        '-Root',
        os.tmpdir(),
      ],
      {
        encoding: 'utf8',
      }
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /needs -Session/);
  }
);

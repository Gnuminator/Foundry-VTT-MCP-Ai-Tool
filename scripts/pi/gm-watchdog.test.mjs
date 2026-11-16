// Tests for the Assistant GM hang watchdog (Backlog item assistant-gm-hang-watchdog) and Pi stage 28:
//   node --test scripts/pi/gm-watchdog.test.mjs
// - the page ping's decision and timeout (pageVerdict, pingPage);
// - the real driver (`assistant-gm.mjs run`) against a stand-in for playwright-core whose page stops answering: it must
//   exit 1 with the restart line, keep running while the page answers, and keep running with GM_PAGE_WATCH=0;
// - stage 28 as text;
// - with PI_GM_WATCHDOG_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the frozen-page runs and the stage
//   itself in a Debian 13 ARM64 container (scripts/pi/container-test/stage28-scenarios.sh).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const driver = path.join(repo, 'scripts/pi/remote/assistant-gm.mjs');

// The driver reads FOUNDRY_URL and so on when it is imported; TOOL_APP is only read on first use of the browser.
process.env.FOUNDRY_URL ??= 'http://127.0.0.1:30000';
const { pageVerdict, pingPage } = await import(pathToFileURL(driver).href);

describe('page ping decision', () => {
  test('restarts only after the grace period of silence; an answer resets it', () => {
    const grace = 120_000;
    let v = pageVerdict(false, null, 1000, grace);
    assert.deepEqual(v, { restart: false, since: 1000 });
    v = pageVerdict(false, v.since, 1000 + grace - 1, grace);
    assert.equal(v.restart, false);
    v = pageVerdict(false, v.since, 1000 + grace, grace);
    assert.equal(v.restart, true);
    assert.deepEqual(pageVerdict(true, 1000, 9e9, grace), { restart: false, since: null });
  });

  test('pingPage resolves true for an answer, false for a page that never settles or throws', async () => {
    assert.equal(await pingPage({ evaluate: async () => 1 }, 200), true);
    assert.equal(await pingPage({ evaluate: async () => 2 }, 200), false);
    assert.equal(await pingPage({ evaluate: async () => Promise.reject(new Error('closed')) }, 200), false);
    const started = Date.now();
    assert.equal(await pingPage({ evaluate: () => new Promise(() => {}) }, 150), false);
    assert.ok(Date.now() - started < 2000);
  });
});

// A stand-in playwright-core: a page that joins at once and answers every evaluate until FAKE_FREEZE_AFTER calls have been
// made, then never answers again (a frozen renderer). context.close() hangs too when FAKE_CLOSE_HANGS=1.
const fakePlaywright = `
let calls = 0;
const freezeAfter = Number(process.env.FAKE_FREEZE_AFTER || 0);
const page = {
  on() {},
  url: () => 'http://127.0.0.1:30000/game',
  goto: async () => ({ ok: () => true }),
  locator: () => ({ count: async () => 0 }),
  waitForFunction: async () => {},
  reload: async () => {},
  evaluate(fn) {
    calls++;
    if (freezeAfter && calls > freezeAfter) return new Promise(() => {});
    const src = String(fn);
    if (src.includes('game.world.id')) return Promise.resolve({ world: 'w', user: 'Assistant GM', isGM: true, module: false, userId: 'u' });
    if (src.includes('noCanvas')) return Promise.resolve(false);
    if (src.includes('1')) return Promise.resolve(1);
    return Promise.resolve(true);
  },
};
const context = {
  pages: () => [page],
  newPage: async () => page,
  addInitScript: async () => {},
  close: () => (process.env.FAKE_CLOSE_HANGS === '1' ? new Promise(() => {}) : Promise.resolve()),
};
exports.chromium = { launchPersistentContext: async () => context };
`;

function startDriver(extraEnv) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gm-watchdog-'));
  const app = path.join(dir, 'app');
  mkdirSync(path.join(app, 'node_modules/playwright-core'), { recursive: true });
  writeFileSync(path.join(app, 'package.json'), '{}');
  writeFileSync(path.join(app, 'node_modules/playwright-core/package.json'), '{"name":"playwright-core","main":"index.js"}');
  writeFileSync(path.join(app, 'node_modules/playwright-core/index.js'), fakePlaywright);
  const profile = path.join(dir, 'profile');
  mkdirSync(profile);
  const child = spawn(process.execPath, [driver, 'run'], {
    env: {
      ...process.env,
      TOOL_APP: app,
      GM_BROWSER_PROFILE: profile,
      ASSISTANT_GM_PASSWORD: 'x',
      FOUNDRY_URL: 'http://127.0.0.1:30000',
      GM_PAGE_POLL_MS: '100',
      GM_PAGE_PING_TIMEOUT_MS: '100',
      GM_PAGE_GRACE_MS: '500',
      GM_PAGE_CLOSE_WAIT_MS: '200',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => (output += d));
  child.stderr.on('data', d => (output += d));
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, profile, output: () => output, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sleepMs = ms => new Promise(resolve => setTimeout(resolve, ms));
const within = (promise, ms) => Promise.race([promise, sleepMs(ms).then(() => 'still running')]);
// Node starts slowly under ARM64 emulation: wait for the driver's output instead of a fixed time.
async function waitForOutput(d, pattern, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleepMs(50)) {
    if (pattern.test(d.output())) return true;
  }
  return false;
}

describe('the driver with a frozen page', () => {
  test('exits 1 and says why when the page stops answering (module socket not needed)', async () => {
    const d = startDriver({ FAKE_FREEZE_AFTER: '4' });
    try {
      const result = await within(d.exited, 40_000);
      assert.deepEqual(result, { code: 1, signal: null }, d.output());
      assert.match(d.output(), /the page has not answered a ping for 0\.5 s; restarting the browser/);
      assert.deepEqual(JSON.parse(readFileSync(path.join(d.profile, 'page-restarts.json'), 'utf8')).length, 1);
    } finally {
      d.child.kill();
      d.cleanup();
    }
  });

  test('exits even when the browser will not close', async () => {
    const d = startDriver({ FAKE_FREEZE_AFTER: '4', FAKE_CLOSE_HANGS: '1' });
    try {
      assert.deepEqual(await within(d.exited, 40_000), { code: 1, signal: null }, d.output());
    } finally {
      d.child.kill();
      d.cleanup();
    }
  });

  test('keeps running while the page answers', async () => {
    const d = startDriver({});
    try {
      assert.ok(await waitForOutput(d, /joined world w/), d.output());
      assert.ok(await waitForOutput(d, /\[assistant-gm\] page watchdog armed \(ping every/), d.output());
      assert.equal(await within(d.exited, 1500), 'still running', d.output());
      assert.doesNotMatch(d.output(), /has not answered/);
    } finally {
      d.child.kill();
      d.cleanup();
    }
  });

  test('GM_PAGE_WATCH=0 turns the watchdog off', async () => {
    const d = startDriver({ FAKE_FREEZE_AFTER: '4', GM_PAGE_WATCH: '0' });
    try {
      assert.ok(await waitForOutput(d, /joined world w/), d.output());
      assert.equal(await within(d.exited, 2000), 'still running', d.output());
      assert.doesNotMatch(d.output(), /page watchdog armed/);
    } finally {
      d.child.kill();
      d.cleanup();
    }
  });

  test('stops restarting after three restarts in the window', async () => {
    const d = startDriver({ FAKE_FREEZE_AFTER: '4' });
    try {
      writeFileSync(path.join(d.profile, 'page-restarts.json'), JSON.stringify([Date.now(), Date.now(), Date.now()]));
      assert.ok(await waitForOutput(d, /not restarting again/), d.output());
      assert.equal(await within(d.exited, 300), 'still running', d.output());
    } finally {
      d.child.kill();
      d.cleanup();
    }
  });
});

const stage = readFileSync(path.join(repo, 'scripts/pi/remote/28-gm-watchdog.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

describe('stage 28 as text', () => {
  test('dry run by default, APPLY and UNDO validated, snapshot before any change, one run at a time', () => {
    assert.match(code, /APPLY must be 1 or left out/);
    assert.match(code, /UNDO must be 1 or left out/);
    assert.match(code, /flock -n 9/);
    assert.ok(code.lastIndexOf('require_recent_snapshot') > code.indexOf('dry run: nothing was changed'));
    assert.ok(code.indexOf('require_recent_snapshot') < code.indexOf('put_back "$prev"'));
    assert.match(code, /refuse_during_system_trial/);
  });

  test('checks the new driver before touching anything and keeps the old one', () => {
    assert.match(code, /page-ping/);
    assert.match(code, /node --check "\$driver_src"/);
    assert.ok(code.indexOf('node --check') < code.indexOf('cp -p -- "$driver" "$backup"'));
    assert.doesNotMatch(code, /\brm\s+-/);
  });

  test('reads back the join and puts the old driver back on failure', () => {
    assert.match(code, /browser_joined "\$GM_UNIT"/);
    assert.match(code, /put_back "\$backup"/);
  });

  test('the join only counts with the armed line from the same run; a failed put-back stops loudly', () => {
    assert.match(code, /restart_and_read_back armed/);
    assert.match(code, /page watchdog armed/);
    assert.match(code, /_SYSTEMD_INVOCATION_ID=\$id/);
    // every put_back of the old driver is checked; none is a bare statement under set -e
    for (const m of code.matchAll(/^\s*put_back "\$[a-z_]+"(.*)$/gm)) {
      assert.match(m[1], /\|\|/, `unchecked put_back: ${m[0].trim()}`);
    }
  });

  test('UNDO leaves a driver that is already deployed alone and words the result from the feature line', () => {
    assert.match(code, /hash_of "\$prev"\)" = "\$\(hash_of "\$driver"\)/);
    assert.match(code, /has_page_ping "\$driver"/);
    assert.match(code, /it has no page watchdog/);
    assert.doesNotMatch(code, /the page watchdog is off/);
  });

  test('does not restart Foundry, download anything or touch a world', () => {
    assert.doesNotMatch(code, /foundry\.service|\bwget\b|\bcurl\b|worlds\//);
  });
});

describe(
  'stage 28 and the frozen page in the ARM64 container',
  { skip: process.env.PI_GM_WATCHDOG_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const res = runStageContainer('stage28-scenarios.sh');
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.doesNotMatch(res.stdout, /FAIL/);
      assert.match(res.stdout, /PASS frozen-page/);
    });
  }
);

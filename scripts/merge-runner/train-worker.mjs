#!/usr/bin/env node
// @ts-check
/**
 * The live roundtrip of the merge train, run by the merge runner (scripts/merge-runner/train-run.mjs)
 * while it holds test server A's lock, from the gate checkout at main's tip.
 *
 *   node scripts/merge-runner/train-worker.mjs [--sweep]
 *
 * Steps (each prints one `train-worker:` line): build the checkout, stop server A, copy the module
 * in (sync-module.ps1 -NoBuild), start server A, join the world `ai-tool-test` as the passwordless
 * GM `Claude` in a headless Edge (the bridge needs a GM client for its Foundry link), run
 * make Test Arena the active scene (ensure-scene.mjs), run
 * `npm run live:roundtrip` (and `npm run live:sweep` with --sweep), close the browser, stop server A.
 * Server A only (the testA ports of shared/ports.json): never the live bridge ports.
 *
 * Exit codes: 0 every step green, 1 a roundtrip or sweep step failed (a real red), 2 the
 * environment could not be brought up (nothing was judged).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ensureTestScene } from './ensure-scene.mjs';

// The runner starts this script from its own checkout with the gate checkout (main's tip) as cwd.
const root = process.cwd();
/** Server A: Foundry, test bridge control and module ports, dashboard (shared/ports.json). */
const A = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../shared/ports.json', import.meta.url)), 'utf8')
).ports.testA;
const PORTS = [A.foundry, A.control, A.link, A.dashboard];
const FOUNDRY_URL = `http://localhost:${A.foundry}`;
const WORLD = 'ai-tool-test';
const say = (/** @type {string} */ m) => console.log(`train-worker: ${m}`);

/** @param {string} cmd @param {string[]} args @param {number} timeout */
function run(cmd, args, timeout) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    // Every script of the kit reads the server from this variable as well as from -Server.
    env: { ...process.env, FOUNDRY_TEST_SERVER: 'A' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    shell: false,
    windowsHide: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const l of out.split(/\r?\n/).filter(Boolean).slice(-40)) console.log(`  ${l}`);
  // No exit status = killed at the time limit: nothing was judged, so 2 (environment), not 1 (red).
  return r.status ?? 2;
}
/** Does something answer on this port of the local machine? @param {number} port */
const taken = port =>
  new Promise(resolve => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.setTimeout(2000, () => (s.destroy(), resolve(false)));
  });
const pwsh = (/** @type {string[]} */ a, timeout = 600_000) =>
  run('pwsh', ['-NoProfile', '-File', ...a], timeout);
const npm = (/** @type {string} */ script, timeout = 1_200_000) =>
  process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/s', '/c', `npm run ${script}`], timeout)
    : run('npm', ['run', script], timeout);

const sweep = process.argv.includes('--sweep');
/** @type {number} */
let code = 2;
let browser;
try {
  say('building the checkout');
  if (npm('build') !== 0) throw new Error('npm run build failed');
  say('stopping server A');
  if (pwsh(['scripts/test-env/stop.ps1', '-Server', 'A']) !== 0)
    throw new Error('stop.ps1 -Server A failed');
  // start.ps1 skips a port that is already taken and exits 0: a lane's dev backend on one of
  // these would then be tested instead of main's build.
  for (const port of PORTS)
    if (await taken(port)) throw new Error(`port ${port} is in use after stopping server A`);
  say('copying the module into server A');
  if (pwsh(['scripts/test-env/sync-module.ps1', '-NoBuild', '-Server', 'A']) !== 0)
    throw new Error('sync-module.ps1 failed');
  say('starting server A');
  if (pwsh(['scripts/test-env/start.ps1', '-World', WORLD, '-Server', 'A']) !== 0)
    throw new Error('start.ps1 failed');
  const { launchBrowser, joinGame, activeWorld } = await import('../test-kit/lib/gm.mjs');
  const running = await activeWorld(FOUNDRY_URL);
  if (running !== WORLD) throw new Error(`server A runs "${running}", not ${WORLD}`);
  say(`joining ${WORLD} as Claude`);
  browser = await launchBrowser({ headless: true });
  await joinGame(browser.page, { foundryUrl: FOUNDRY_URL, user: 'Claude' });
  // A scene left inactive by another lane's testing would fail the sweep for no reason of main's.
  say(await ensureTestScene(browser.page));
  say('npm run live:roundtrip');
  const rt = npm('live:roundtrip', 900_000);
  if (rt === 2) throw new Error('live:roundtrip could not reach the environment (exit 2)');
  code = rt === 0 ? 0 : 1;
  if (code === 0 && sweep) {
    say('npm run live:sweep');
    const sw = npm('live:sweep', 1_800_000);
    if (sw === 2) throw new Error('live:sweep could not reach the environment (exit 2)');
    code = sw === 0 ? 0 : 1;
  }
  say(code === 0 ? 'green' : 'RED: a live step failed');
} catch (e) {
  say(`environment problem: ${e instanceof Error ? e.message : e}`);
  code = 2;
} finally {
  try {
    await browser?.close();
  } catch {
    /* gone already */
  }
  // A server that will not stop would be left running for the next holder: not a green run.
  if (pwsh(['scripts/test-env/stop.ps1', '-Server', 'A']) !== 0 && code === 0) {
    say('environment problem: the final stop of server A failed');
    code = 2;
  }
}
process.exit(code);

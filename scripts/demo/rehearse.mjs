#!/usr/bin/env node
// Rehearse every demo take without recording (item demo-takes-rehearsal).
//
//   npm run demo:rehearse [-- options]
//
// Runs each take in scripts/demo/takes with `--no-record` on a locked test server, one after
// the other, and prints PASS or FAIL per take; a FAIL names the step that was running.
// No OBS, no ffmpeg, no GPU. Takes write their folders to <test root>\demo\takes, never to the
// FoundryDemo outputs.
//
// Options:
//   --server A|B|C      the test server (default A)
//   --only a,b          only these takes
//   --session <id>      the lock's session id (default demo-rehearse-<time>); when that session
//                       already holds the lock it is kept and not released
//   --holder <name>     the name on the lock (default "demo rehearsal")
//   --wait <minutes>    when the lock is taken: queue and wait this long (default 0: give up)
//   --world <id>        another demo world (ai-tool-demo-<name>)
//   --no-lock           the caller holds the lock already (kit run); neither take nor release
//   --keep-up           leave the test server running afterwards (default: stopped)
//   --list              print the takes and stop
//
// Exit codes: 0 every take passed, 1 a take failed, 2 usage or environment, 3 lock not free.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEMO_DIR, REPO_ROOT } from './lib/env.mjs';

const TEST_ENV = join(REPO_ROOT, 'scripts', 'test-env');
const TAKES_DIR = join(DEMO_DIR, 'takes');

export function listTakes(dir = TAKES_DIR) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .map(f => basename(f, '.mjs'))
    .sort();
}

export function parseArgs(argv) {
  const o = {
    server: 'A',
    only: null,
    session: null,
    holder: 'demo rehearsal',
    wait: 0,
    world: null,
    lock: true,
    keepUp: false,
    list: false,
  };
  const args = [...argv];
  const value = flag => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--server') o.server = value(a).toUpperCase();
    else if (a === '--only') o.only = value(a).split(',').filter(Boolean);
    else if (a === '--session') o.session = value(a);
    else if (a === '--holder') o.holder = value(a);
    else if (a === '--wait') o.wait = Number(value(a));
    else if (a === '--world') o.world = value(a);
    else if (a === '--no-lock') o.lock = false;
    else if (a === '--keep-up') o.keepUp = true;
    else if (a === '--list') o.list = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!['A', 'B', 'C'].includes(o.server)) throw new Error('--server must be A, B or C');
  if (!Number.isFinite(o.wait) || o.wait < 0) throw new Error('--wait must be minutes, 0 or more');
  return o;
}

/**
 * The failing step from a take's console output: the last "<time>s  <step>: <title>" line
 * (a step is logged when it starts, so the last one is the one that was running), plus the
 * "Take failed: ..." message.
 */
export function failureOf(output) {
  let step = null;
  let message = null;
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*\d+(?:\.\d+)?s\s+(.+?):\s(.*)$/.exec(line);
    if (m) step = `${m[1]}: ${m[2]}`;
    const f = /^Take failed:\s*(.*)$/.exec(line);
    if (f) message = f[1];
  }
  return { step, message };
}

/** Children still running, and whether a stop signal came in. */
const children = new Set();
let interrupted = false;

/** Stops a child and everything it started (demo.mjs owns the browser). */
function treeKill(child) {
  if (process.platform === 'win32' && child.pid) {
    const r = spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true });
    if (r.error || r.status !== 0) child.kill('SIGKILL');
  } else child.kill('SIGKILL');
}

/** A take that takes longer than this is hung: it fails and gives the lock back. */
const TAKE_TIMEOUT_MS = 10 * 60000;

function runProc(file, args, { env = {}, echo = false, timeoutMs = 0 } = {}) {
  return new Promise(resolve => {
    const child = spawn(file, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    children.add(child);
    let out = '';
    let stdout = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          treeKill(child);
        }, timeoutMs)
      : null;
    child.stdout.on('data', b => {
      out += b;
      stdout += b;
      if (echo) process.stdout.write(b);
    });
    child.stderr.on('data', b => {
      out += b;
      if (echo) process.stderr.write(b);
    });
    const done = result => {
      clearTimeout(timer);
      children.delete(child);
      resolve(result);
    };
    child.on('error', err =>
      done({ code: err.code === 'ENOENT' ? 127 : 1, out: `${out}${err.message}`, stdout })
    );
    child.on('close', code =>
      done({
        code: timedOut ? 1 : (code ?? 1),
        out: timedOut ? `${out}\nTake timed out after ${timeoutMs / 60000} minutes.` : out,
        stdout,
      })
    );
  });
}

const pwsh = (script, args) =>
  runProc('pwsh', ['-NoProfile', '-File', join(TEST_ENV, script), ...args]);

/** Wakes every interruptible sleep at once when a stop signal comes in. */
const wakeSleepers = new Set();
const sleepInterruptibly = ms =>
  new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      wakeSleepers.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    wakeSleepers.add(done);
  });

const lastLine = text =>
  text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .at(-1) ?? '(no output)';

/** One take: PASS or FAIL with the step. Never throws. */
export async function rehearseTake(name, o) {
  const started = Date.now();
  const args = [join(DEMO_DIR, 'demo.mjs'), 'take', name, '--no-record', '--res', '1080'];
  if (o.world) args.push('--world', o.world);
  const r = await runProc(process.execPath, args, {
    env: { FOUNDRY_TEST_SERVER: o.server, DEMO_HEADLESS: '1' },
    timeoutMs: TAKE_TIMEOUT_MS,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const folder = /^Take folder:\s*(.+)$/m.exec(r.out)?.[1]?.trim();
  let report = null;
  if (folder && existsSync(join(folder, 'take.json'))) {
    try {
      report = JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8'));
    } catch {
      /* fall through to the exit code */
    }
  }
  const ok = r.code === 0 && report !== null && !report.error;
  if (ok) return { name, ok, seconds, folder };
  const f = failureOf(r.out);
  const reason = report?.error
    ? String(report.error).split(/\r?\n/)[0]
    : (f.message ?? `exit ${r.code}, no take report: ${lastLine(r.out)}`);
  return { name, ok: false, seconds, folder, step: f.step ?? '(before the first step)', reason };
}

export function summary(results) {
  const lines = results.map(r =>
    r.ok
      ? `PASS  ${r.name} (${r.seconds}s)`
      : `FAIL  ${r.name} (${r.seconds}s): step "${r.step}": ${r.reason}${r.folder ? `\n      ${r.folder}` : ''}`
  );
  const failed = results.filter(r => !r.ok).length;
  lines.push(
    failed
      ? `\n${failed} of ${results.length} takes failed.`
      : `\nAll ${results.length} takes passed.`
  );
  return lines.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = listTakes();
  if (o.list) {
    console.log(all.join('\n'));
    return 0;
  }
  const takes = o.only ?? all;
  const unknown = takes.filter(t => !all.includes(t));
  if (unknown.length) throw new Error(`No such take: ${unknown.join(', ')} (see --list)`);

  // Ctrl+C, a closed console or a kill: stop the take (and its browser), then let the finally
  // block stop the server and release the lock. A second signal exits at once.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => {
      if (interrupted) process.exit(1);
      interrupted = true;
      console.error(`${sig}: stopping, then releasing the lock ...`);
      for (const c of children) treeKill(c);
      for (const wake of [...wakeSleepers]) wake();
    });
  }

  const onServer = ['-Server', o.server];
  const session = o.session ?? `demo-rehearse-${Date.now()}`;
  let took = false;
  if (o.lock) {
    const lockArgs = [
      'take',
      '-Holder',
      o.holder,
      '-Session',
      session,
      '-Purpose',
      'demo takes rehearsal (no recording)',
      ...onServer,
    ];
    const deadline = Date.now() + o.wait * 60000;
    let queued = false;
    for (;;) {
      const r = await pwsh('lock.ps1', lockArgs);
      if (r.code === 127)
        throw new Error('pwsh is not on PATH; the test environment scripts need it.');
      if (r.code === 0) {
        took = !/already hold/i.test(r.stdout);
        break;
      }
      if (interrupted || Date.now() >= deadline) {
        if (interrupted) console.error('Interrupted while waiting for the lock.');
        if (queued) await pwsh('lock.ps1', ['leave', '-Session', session, ...onServer]);
        if (interrupted) return 1;
        console.error(`The test server lock is not free:\n${r.out.trim()}`);
        return 3;
      }
      if (!queued) {
        await pwsh('lock.ps1', [
          'queue',
          '-Holder',
          o.holder,
          '-Session',
          session,
          '-Purpose',
          'demo takes rehearsal',
          ...onServer,
        ]);
        queued = true;
      }
      await sleepInterruptibly(60000);
      if (interrupted) {
        await pwsh('lock.ps1', ['leave', '-Session', session, ...onServer]);
        return 1;
      }
    }
    console.log(`Lock on server ${o.server} taken (${session}).`);
  }

  const results = [];
  try {
    for (const name of takes) {
      if (interrupted) break;
      console.log(`--- ${name}`);
      const r = await rehearseTake(name, o);
      results.push(r);
      console.log(
        r.ok ? `PASS  ${name} (${r.seconds}s)` : `FAIL  ${name}: step "${r.step}": ${r.reason}`
      );
    }
  } finally {
    if (!o.keepUp && o.lock) await pwsh('stop.ps1', onServer);
    if (took) await pwsh('lock.ps1', ['release', '-Session', session, ...onServer]);
  }
  console.log(`\n${summary(results)}`);
  if (interrupted) {
    console.log('Interrupted: the takes not run are not counted as passed.');
    return 1;
  }
  return results.some(r => !r.ok) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(String(err.message || err));
    process.exitCode = 2;
  }
  process.exit();
}

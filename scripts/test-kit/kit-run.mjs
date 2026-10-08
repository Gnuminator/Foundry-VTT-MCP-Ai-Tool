#!/usr/bin/env node
/**
 * The kit run command (D-102 line 5): one command takes the test server lock, runs the test kit
 * (build plus scenarios) on a fresh test environment, writes the result to the vault and releases
 * the lock. On demand or overnight.
 *
 *   npm run kit:run -- [options]      (see --help)
 *
 * The result goes to <kit home>/last-run.json (the control center's versions panel shows it) and
 * to the vault note `Dev/Foundry AI Tool/Test kit runs.md` through the vault wrapper. Only counts,
 * scenario ids and the local report path go there, never report text.
 * Exit codes: 0 all passed, 1 a scenario failed (or the run broke), 2 environment not ready,
 * 3 the lock was not free.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EnvError } from './lib/errors.mjs';
import { loadProfile } from './lib/profiles.mjs';
import { kitHome } from './lib/targets.mjs';
import { newConsoleGroups, newRunDir } from './lib/report.mjs';
import { pushPaths, vaultDirFrom } from '../dev/project-dashboard/vault.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const TEST_ENV = path.join(REPO_ROOT, 'scripts', 'test-env');
export const NOTE = 'Dev/Foundry AI Tool/Test kit runs.md';
export const MAX_ROWS = 40;
const PORTS = { foundry: 30001, bridge: 31514, dashboard: 3100 };

export const HELP = `kit:run: take the test server lock, run the test kit, record the result, release the lock.

Usage: npm run kit:run -- [options]

  --size smoke|full|long   kit size (default smoke; --nightly makes it full)
  --profile <id>           content profile (default srd); it picks the kit world
  --wait <minutes>         when the lock is taken: queue and wait this long (default 0: give up)
  --nightly                the overnight run: --size full, --wait 120, and a skipped run is recorded
  --session <id>           the lock's session id (default KIT_RUN_SESSION, else kit-run-<time>);
                           pass your own when you already hold the lock, it is then kept
  --holder <name>          the name on the lock (default "kit run")
  --no-build               skip npm run build (the module copy is still synced from the last build)
  --keep-up                leave the test environment running afterwards (default: stopped)
  --no-vault               write last-run.json only, not the vault note

Exit codes: 0 all passed, 1 failed, 2 environment not ready, 3 the lock was not free.`;

export function parseArgs(argv) {
  const o = {
    size: null,
    profile: 'srd',
    wait: null,
    nightly: false,
    session: process.env.KIT_RUN_SESSION || null,
    holder: 'kit run',
    build: true,
    keepUp: false,
    vault: true,
    help: false,
  };
  const args = [...argv];
  const value = flag => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--size') o.size = value(a);
    else if (a === '--profile') o.profile = value(a);
    else if (a === '--wait') o.wait = Number(value(a));
    else if (a === '--nightly') o.nightly = true;
    else if (a === '--session') o.session = value(a);
    else if (a === '--holder') o.holder = value(a);
    else if (a === '--no-build') o.build = false;
    else if (a === '--keep-up') o.keepUp = true;
    else if (a === '--no-vault') o.vault = false;
    else throw new Error(`unknown option ${a} (see --help)`);
  }
  o.size ??= o.nightly ? 'full' : 'smoke';
  o.wait ??= o.nightly ? 120 : 0;
  if (!['smoke', 'full', 'long'].includes(o.size))
    throw new Error('--size must be smoke, full or long');
  if (!Number.isFinite(o.wait) || o.wait < 0) throw new Error('--wait must be minutes, 0 or more');
  return o;
}

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Runs a program; resolves { code, stdout, stderr }. `echo` copies its output to ours. */
export function defaultRun(file, args, { cwd = REPO_ROOT, echo = false, shell = false } = {}) {
  return new Promise(resolve => {
    const env = { ...process.env };
    // npm and node children use the same Node as this command (the portable Node 22).
    const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
    env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`;
    const child = spawn(file, args, { cwd, env, shell, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', b => {
      stdout += b;
      if (echo) process.stdout.write(b);
    });
    child.stderr.on('data', b => {
      stderr += b;
      if (echo) process.stderr.write(b);
    });
    child.on('error', err => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const pwsh = (run, script, args, opts) =>
  run(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', path.join(TEST_ENV, script), ...args],
    opts
  );

function firstLine(text, fallback = '') {
  const line = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(Boolean);
  return (line || fallback).slice(0, 160);
}

/**
 * Takes the lock. With waitMs, a refusal joins the queue and tries again every minute.
 * @returns {Promise<{ok: boolean, already: boolean, detail: string}>}
 */
export async function takeLock({
  run,
  session,
  holder,
  purpose,
  waitMs = 0,
  sleep,
  now = Date.now,
}) {
  const lockArgs = cmd => [cmd, '-Holder', holder, '-Session', session, '-Purpose', purpose];
  const until = now() + waitMs;
  let queued = false;
  for (;;) {
    const r = await pwsh(run, 'lock.ps1', lockArgs('take'));
    if (r.code === 0)
      return { ok: true, already: /already hold/i.test(r.stdout), detail: firstLine(r.stdout) };
    if (now() >= until) {
      if (queued) await pwsh(run, 'lock.ps1', ['leave', '-Session', session]);
      return { ok: false, already: false, detail: firstLine(r.stderr, 'the lock was refused') };
    }
    if (!queued) {
      await pwsh(run, 'lock.ps1', lockArgs('queue'));
      queued = true;
    }
    await sleep(Math.min(60000, Math.max(0, until - now())));
  }
}

export function portOpen(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise(resolve => {
    const s = net.connect({ port, host });
    const done = ok => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function envState(fetchImpl = fetch) {
  const state = {};
  for (const [name, port] of Object.entries(PORTS)) state[name] = await portOpen(port);
  state.world = null;
  if (state.foundry) {
    try {
      const s = await (await fetchImpl(`http://127.0.0.1:${PORTS.foundry}/api/status`)).json();
      state.world = typeof s.world === 'string' && s.world ? s.world : null;
    } catch {
      // Foundry still loading: no world yet
    }
  }
  return state;
}

// --- the result ----------------------------------------------------------------------------

function cell(s) {
  return String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function localTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function minutes(ms) {
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** One line on what happened, for the note, the dashboard and the console. */
export function resultText(r) {
  const extra = [];
  if (r.newConsole)
    extra.push(`${r.newConsole} new console error group${r.newConsole === 1 ? '' : 's'}`);
  if (r.durationMs) extra.push(minutes(r.durationMs));
  const tail = extra.length ? ` (${extra.join(', ')})` : '';
  switch (r.state) {
    case 'passed':
      return `passed: ${r.passed} of ${r.total}${r.skipped ? `, ${r.skipped} skipped` : ''}${tail}`;
    case 'failed':
      return r.total
        ? `FAILED: ${r.failed} of ${r.total} failed, ${r.passed} passed${tail}`
        : `FAILED: ${r.detail || 'no report'}${tail}`;
    case 'env':
      return `environment not ready: ${r.detail || 'see the console'}${tail}`;
    case 'skipped':
      return `skipped: ${r.detail || 'the lock was not free'}`;
    default:
      return `error: ${r.detail || 'unknown'}${tail}`;
  }
}

export function noteRow(r) {
  const failing = r.failing || [];
  const shown =
    failing.slice(0, 5).join(', ') + (failing.length > 5 ? ` and ${failing.length - 5} more` : '');
  return `| ${[
    localTime(r.at),
    r.pc,
    `${r.size} ${r.profile}${r.nightly ? ' nightly' : ''}`,
    `${r.git}${r.branch ? ` (${r.branch})` : ''}`,
    resultText(r),
    shown,
    r.reportDir ? `\`${r.reportDir}\`` : '',
  ]
    .map(cell)
    .join(' | ')} |`;
}

const NOTE_HEAD = `---
type: log
tags: [dev/test-kit]
---

# Test kit runs

Written by the kit run command (\`npm run kit:run\`, D-102 line 5); do not edit it by hand. Newest
first, the last ${MAX_ROWS} runs of every PC. Only counts and scenario ids are here; the full report
(report.html) stays on the PC that ran it, in the folder in the last column.

| When (local) | PC | Run | Git | Result | Failing scenarios | Report folder |
| --- | --- | --- | --- | --- | --- | --- |
`;

/** The note with `row` added on top of the table (rows past MAX_ROWS drop off). */
export function updateNote(text, row) {
  const lines = String(text || '').split(/\r?\n/);
  const sep = lines.findIndex(l => /^\|\s*---/.test(l));
  const rows = [];
  if (sep !== -1) {
    for (let i = sep + 1; i < lines.length && lines[i].startsWith('|'); i += 1) rows.push(lines[i]);
  }
  return `${NOTE_HEAD}${[row, ...rows].slice(0, MAX_ROWS).join('\n')}\n`;
}

/** <kit home>/last-run.json: the last attempt, and the last run that got as far as a report. */
export function writeLastRun(home, r) {
  const file = path.join(home, 'last-run.json');
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // first run
  }
  const entry = { ...r, text: resultText(r) };
  const ran = r.state === 'passed' || r.state === 'failed';
  const doc = { version: 1, last: entry, lastRun: ran ? entry : (prev?.lastRun ?? null) };
  mkdirSync(home, { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return file;
}

/** Reads the kit's report.json into the result. */
export function readReport(dir, r) {
  const file = path.join(dir, 'report.json');
  if (!existsSync(file)) return r;
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const s = report.summary || {};
  let fresh = 0;
  try {
    fresh = newConsoleGroups(report);
  } catch {
    // an older report without console groups
  }
  return {
    ...r,
    passed: s.passed ?? 0,
    failed: s.failed ?? 0,
    skipped: s.skipped ?? 0,
    total: s.total ?? 0,
    newConsole: fresh,
    failing: (report.scenarios || [])
      .filter(x => x.status === 'fail' || x.status === 'error')
      .map(x => String(x.id).slice(0, 60)),
  };
}

// --- the run -------------------------------------------------------------------------------

async function gitInfo(run) {
  const sha = await run('git', ['rev-parse', '--short', 'HEAD']);
  const branch = await run('git', ['branch', '--show-current']);
  return {
    git: sha.code === 0 ? sha.stdout.trim() : 'unknown',
    branch: branch.code === 0 ? branch.stdout.trim() : '',
  };
}

class Stop extends Error {
  constructor(state, detail) {
    super(detail);
    this.state = state;
  }
}

/**
 * The whole run. Every outside effect goes through `deps` (the tests pass fakes).
 * @returns {Promise<{code: number, result: any}>}
 */
export async function kitRun(o, deps = {}) {
  const {
    run = defaultRun,
    fetchImpl = fetch,
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    now = () => new Date(),
    log = line => console.log(`kit:run ${line}`),
    home = kitHome(),
    state = () => envState(fetchImpl),
    writeVault = writeVaultNote,
  } = deps;
  // An unknown profile stops here, before the lock and without a record.
  const profile = loadProfile(o.profile);
  const started = now();
  const session = o.session || `kit-run-${stamp(started)}`;
  const base = {
    at: started.toISOString(),
    pc: process.env.COMPUTERNAME || os.hostname(),
    size: o.size,
    profile: o.profile,
    nightly: o.nightly,
    ...(await gitInfo(run)),
  };
  let r = { ...base, world: profile.world, state: 'error', detail: '' };
  let took = false;
  let envTouched = false;
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    log('interrupted: cleaning up (stop the environment, release the lock)');
  };
  process.on('SIGINT', onSignal);
  try {
    const lock = await takeLock({
      run,
      session,
      holder: o.holder,
      purpose: `kit run: ${o.size} ${o.profile}${o.nightly ? ' (nightly)' : ''}`,
      waitMs: o.wait * 60000,
      sleep,
      now: () => now().getTime(),
    });
    if (!lock.ok) throw new Stop('skipped', lock.detail);
    took = !lock.already;
    log(lock.detail);

    const before = await state();
    if (before.foundry)
      log(
        `the test environment was up (world ${before.world || 'unknown'}); restarting it on ${profile.world}`
      );
    if (o.build) {
      log('npm run build ...');
      const b = await run('npm', ['run', 'build'], { shell: process.platform === 'win32' });
      if (b.code !== 0)
        throw new Stop('error', `npm run build failed: ${firstLine(b.stderr, 'see the console')}`);
    }
    const sync = await pwsh(run, 'sync-module.ps1', ['-NoBuild']);
    if (sync.code !== 0)
      throw new Stop('error', `sync-module.ps1 failed: ${firstLine(sync.stderr)}`);
    const stop = await pwsh(run, 'stop.ps1', []);
    if (stop.code !== 0) throw new Stop('env', `stop.ps1 refused: ${firstLine(stop.stderr)}`);
    envTouched = true;
    const start = await pwsh(run, 'start.ps1', ['-World', profile.world], { echo: true });
    if (start.code !== 0) throw new Stop('env', `start.ps1 failed: ${firstLine(start.stderr)}`);
    const up = await state();
    const down = Object.keys(PORTS).filter(k => !up[k]);
    if (down.length) throw new Stop('env', `not listening after start.ps1: ${down.join(', ')}`);
    if (up.world !== profile.world)
      throw new Stop('env', `Foundry runs world ${up.world || 'none'}, not ${profile.world}`);
    if (interrupted) throw new Stop('error', 'interrupted');

    const dir = newRunDir(home, o.size);
    r.reportDir = dir;
    log(`running the kit (${o.size}, ${o.profile}) ...`);
    const kit = await run(
      process.execPath,
      [
        path.join(here, 'kit.mjs'),
        'all',
        '--size',
        o.size,
        '--profile',
        o.profile,
        '--report-dir',
        dir,
      ],
      { echo: true }
    );
    r = readReport(dir, r);
    const envLine = kit.stderr.split(/\r?\n/).find(l => l.startsWith('ENV '));
    if (kit.code === 2)
      r = { ...r, state: 'env', detail: (envLine || '').replace(/^ENV /, '').slice(0, 160) };
    else if (kit.code === 0) r = { ...r, state: 'passed' };
    else
      r = {
        ...r,
        state: 'failed',
        detail: r.total ? '' : firstLine(kit.stderr, 'the kit stopped'),
      };
    if (interrupted) r = { ...r, state: 'error', detail: 'interrupted' };
  } catch (err) {
    r =
      err instanceof Stop
        ? { ...r, state: err.state, detail: err.message }
        : { ...r, state: 'error', detail: firstLine(err?.message) };
  } finally {
    if (envTouched && !o.keepUp) {
      const stop = await pwsh(run, 'stop.ps1', []);
      if (stop.code !== 0) log(`stop.ps1 refused afterwards: ${firstLine(stop.stderr)}`);
    }
    if (took) {
      const rel = await pwsh(run, 'lock.ps1', ['release', '-Session', session]);
      log(rel.code === 0 ? 'lock released' : `lock release failed: ${firstLine(rel.stderr)}`);
    }
    process.off('SIGINT', onSignal);
  }
  r = { ...r, finishedAt: now().toISOString(), durationMs: now().getTime() - started.getTime() };
  if (r.state === 'skipped') r.durationMs = 0;
  log(resultText(r));

  // An on-demand run that found the lock taken leaves no record; the nightly one does.
  if (r.state !== 'skipped' || o.nightly) {
    log(`result: ${writeLastRun(home, r)}`);
    if (o.vault) {
      const v = await writeVault(r);
      log(`vault note: ${v.state} (${v.detail})`);
    }
  }
  const code = { passed: 0, failed: 1, env: 2, skipped: 3 }[r.state] ?? 1;
  return { code, result: r };
}

/** Adds the run's row to the vault note through the vault wrapper (pull, write, commit, push). */
export async function writeVaultNote(r, { dir = vaultDirFrom() } = {}) {
  return pushPaths({
    dir,
    paths: [NOTE],
    message: `Test kit run ${r.size} ${r.profile} on ${r.pc}: ${r.state}`,
    write: async vault => {
      const file = path.join(vault, ...NOTE.split('/'));
      const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, updateNote(old, noteRow(r)), 'utf8');
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`kit:run ${err.message}`);
    process.exit(2);
  }
  if (o.help) {
    console.log(HELP);
  } else {
    kitRun(o).then(
      ({ code }) => {
        process.exitCode = code;
      },
      err => {
        // An unknown profile is an environment error (exit 2), as in kit.mjs.
        const env = err instanceof EnvError;
        console.error(`kit:run ${env ? 'ENV' : 'ERROR'} ${env ? err.message : err?.stack || err}`);
        process.exitCode = env ? 2 : 1;
      }
    );
  }
}

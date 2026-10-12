import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP, main, parseArgs, selectToolsOnly } from '../kit.mjs';
import { EnvError } from '../lib/errors.mjs';

const kit = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit.mjs');

test('parseArgs reads options and the command', () => {
  const o = parseArgs([
    'run',
    '--size',
    'full',
    '--only',
    'a,b',
    '--only',
    'c',
    '--fake',
    '--world',
    'ai-tool-kit-srd',
  ]);
  assert.equal(o.command, 'run');
  assert.equal(o.size, 'full');
  assert.deepEqual(o.only, ['a', 'b', 'c']);
  assert.equal(o.fake, true);
  assert.equal(o.headed, false);
  assert.equal(parseArgs(['check']).size, 'smoke');
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs(['run', '--size', 'huge']), EnvError);
  assert.throws(() => parseArgs(['dance']), EnvError);
  assert.throws(() => parseArgs(['run', '--nope']), EnvError);
  assert.throws(() => parseArgs(['run', '--size']), EnvError);
});

test('--help prints usage and exits 0; no command exits 2', () => {
  const help = spawnSync(process.execPath, [kit, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/test-kit\/kit.mjs/);
  const none = spawnSync(process.execPath, [kit], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});

// --- --target pi ----------------------------------------------------------------------------

/**
 * Runs main() with the given environment variables and returns its exit code and what it printed.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
async function runMain(argv, env = {}) {
  const saved = { ...process.env };
  const out = [];
  const log = console.log;
  const err = console.error;
  Object.assign(process.env, env);
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    const code = await main(argv);
    return { code, text: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** A valid targets file; returns the env that points the kit at it. */
function targetsEnv(pi = { host: 'foundry-pi' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kit-cli-pi-'));
  const file = path.join(dir, 'kit-targets.json');
  writeFileSync(file, JSON.stringify({ pi }));
  return { KIT_TARGETS_FILE: file };
}

test('parseArgs reads --target and --not-game-night; local is the default', () => {
  const d = parseArgs(['run']);
  assert.equal(d.target, 'local');
  assert.equal(d.notGameNight, false);
  const o = parseArgs(['run', '--target', 'pi', '--not-game-night']);
  assert.equal(o.target, 'pi');
  assert.equal(o.notGameNight, true);
  assert.equal(parseArgs(['run', '--target', 'local']).target, 'local');
  for (const bad of [['--target', 'mars'], ['--target', 'PI'], ['--target', ''], ['--target']]) {
    assert.throws(() => parseArgs(['run', ...bad]), EnvError, bad.join(' '));
  }
  assert.match(HELP, /--target local\|pi/);
  assert.match(HELP, /--not-game-night/);
});

test('--target pi refuses everything it must, each with exit 2 and a clear message', async () => {
  const env = targetsEnv();
  const pi = ['run', '--target', 'pi', '--not-game-night'];
  const table = [
    [
      'run without --not-game-night',
      ['run', '--target', 'pi'],
      /^ENV REFUSED: pass --not-game-night to confirm today is not a game night/,
    ],
    [
      'init',
      ['init', '--target', 'pi', '--not-game-night'],
      /REFUSED: --target pi allows only "run"/,
    ],
    [
      'build',
      ['build', '--target', 'pi', '--not-game-night'],
      /REFUSED: --target pi allows only "run"/,
    ],
    [
      'all',
      ['all', '--target', 'pi', '--not-game-night'],
      /REFUSED: --target pi allows only "run"/,
    ],
    ['--fake', [...pi, '--fake'], /REFUSED: --target pi never combines with --fake/],
    [
      '--world ai-tool-kit-srd',
      [...pi, '--world', 'ai-tool-kit-srd'],
      /REFUSED: --target pi runs only in strahd-kit/,
    ],
    [
      '--world ai-tool-kit-licensed',
      [...pi, '--world', 'ai-tool-kit-licensed'],
      /REFUSED: --target pi runs only in strahd-kit/,
    ],
    ['--profile other', [...pi, '--profile', 'strahd'], /REFUSED: --target pi takes no --profile/],
    [
      'a --only id that is not tools-only',
      [...pi, '--only', 'bridge-health'],
      /REFUSED: scenario "bridge-health" is not tools-only at size smoke; the Pi run allows: canvas-tools-headless/,
    ],
    [
      'an unknown --only id',
      [...pi, '--only', 'no-such'],
      /--only: no scenario with id "no-such" \(the Pi run allows: canvas-tools-headless/,
    ],
    ['an unknown target', ['run', '--target', 'mars'], /--target must be local or pi/],
  ];
  for (const [name, argv, re] of table) {
    const r = await runMain(argv, env);
    assert.equal(r.code, 2, `${name}: exit code, output: ${r.text}`);
    assert.match(r.text, re, name);
    assert.doesNotMatch(r.text, /\n\s+at /, `${name}: no stack`);
  }
});

test('--target pi without a targets file, with a loopback host, a live port or a secret key: exit 2', async () => {
  const gone = { KIT_TARGETS_FILE: path.join(tmpdir(), 'kit-cli-pi-none', 'kit-targets.json') };
  const run = ['run', '--target', 'pi', '--not-game-night'];
  let r = await runMain(run, gone);
  assert.equal(r.code, 2);
  assert.match(
    r.text,
    /^ENV The pi target needs the targets file .*kit-targets\.json, which cannot be read\./
  );
  assert.match(r.text, /"dashboardPort": 3000/);
  r = await runMain(run, targetsEnv({ host: 'localhost' }));
  assert.equal(r.code, 2);
  assert.match(r.text, /REFUSED: the pi target must be another machine/);
  r = await runMain(run, targetsEnv({ host: 'foundry-pi', foundryPort: 31416 }));
  assert.equal(r.code, 2);
  assert.match(r.text, /REFUSED: port 31416 is the live bridge/);
  r = await runMain(run, targetsEnv({ host: 'foundry-pi', password: 'hunter2-x' }));
  assert.equal(r.code, 2);
  assert.match(r.text, /unknown key "password"/);
  assert.doesNotMatch(r.text, /hunter2-x/);
});

test('--target pi leaves check alone', async () => {
  const r = await runMain(['check', '--target', 'pi']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /scenarios valid/);
});

test('selectToolsOnly keeps tools-only scenarios of the size, and --only must name such ones', () => {
  const entry = (id, tags, sizes = ['smoke', 'full']) => ({
    scenario: { id, tags, sizes },
    file: `${id}.scenario.mjs`,
    dir: '/x',
  });
  const all = [
    entry('a-only', ['bridge', 'tools-only']),
    entry('b-plain', ['bridge']),
    entry('c-only-full', ['tools-only'], ['full']),
  ];
  const ids = list => list.map(e => e.scenario.id);
  assert.deepEqual(ids(selectToolsOnly(all, { size: 'smoke', only: [] })), ['a-only']);
  assert.deepEqual(ids(selectToolsOnly(all, { size: 'full', only: [] })), [
    'a-only',
    'c-only-full',
  ]);
  assert.deepEqual(ids(selectToolsOnly(all, { size: 'full', only: ['c-only-full'] })), [
    'c-only-full',
  ]);
  assert.throws(
    () => selectToolsOnly(all, { size: 'smoke', only: ['b-plain'] }),
    /REFUSED: scenario "b-plain" is not tools-only/
  );
  assert.throws(
    () => selectToolsOnly(all, { size: 'smoke', only: ['c-only-full'] }),
    /not tools-only at size smoke/
  );
  assert.throws(
    () => selectToolsOnly(all, { size: 'smoke', only: ['zzz'] }),
    /no scenario with id "zzz"/
  );
});

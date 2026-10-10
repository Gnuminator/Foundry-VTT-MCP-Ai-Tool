/**
 * scripts/green.mjs: parity with the CI job `build-test` (this test keeps green and CI in step),
 * the ci.yml command extraction, the flags, and the quiet output. Fake step runners stand in for
 * the real commands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STEPS,
  CI_ONLY,
  ciRunCommands,
  normalizeCommand,
  parseArgs,
  selectSteps,
  formatDuration,
  main,
} from './green.mjs';

const ciYml = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '.github',
    'workflows',
    'ci.yml'
  ),
  'utf8'
);

/** @param {{ cmd: string, args: string[] }} s */
const commandOf = s => normalizeCommand([s.cmd, ...s.args].join(' '));

/** Every part of every CI command, split on `&&`. */
const ciParts = ciRunCommands(ciYml).flatMap(c =>
  normalizeCommand(c)
    .split('&&')
    .map(p => p.trim())
    .filter(Boolean)
);

test('parity: every CI command of build-test is a green step or in CI_ONLY with a reason', () => {
  const stepCommands = new Set(STEPS.map(commandOf));
  const missing = ciParts.filter(p => !stepCommands.has(p) && !CI_ONLY[p]);
  assert.deepEqual(
    missing,
    [],
    'CI runs these but scripts/green.mjs neither runs them nor lists them in CI_ONLY'
  );
});

test('parity: every green step and CI_ONLY entry still exists in ci.yml', () => {
  const stale = STEPS.filter(s => !ciParts.includes(commandOf(s))).map(s => s.name);
  assert.deepEqual(stale, [], 'steps whose command is no longer in the build-test job');
  const staleOnly = Object.keys(CI_ONLY).filter(k => !ciParts.includes(k));
  assert.deepEqual(staleOnly, [], 'CI_ONLY entries that are no longer in the build-test job');
  for (const [cmd, reason] of Object.entries(CI_ONLY)) {
    assert.ok(reason.length > 10, `CI_ONLY needs a real reason for ${cmd}`);
  }
});

test('parity: steps keep the CI order and have unique names', () => {
  const names = STEPS.map(s => s.name);
  assert.equal(new Set(names).size, names.length);
  const positions = STEPS.map(s => ciParts.indexOf(commandOf(s)));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b)
  );
});

test('unit-test steps run with CI=true', () => {
  for (const s of STEPS.filter(x => /^(test-|pi-|kit-test|plan-b)/.test(x.name))) {
    assert.equal(s.env?.CI, 'true', s.name);
  }
});

test('ciRunCommands: single lines, blocks, comments, npm ci, other jobs', () => {
  const yaml = [
    'jobs:',
    '  build-test:',
    '    steps:',
    '      - name: Install',
    '        run: npm ci',
    '      - name: Two',
    '        # a comment',
    '        run: npm run a && npm run b',
    '      - name: Block',
    '        run: |',
    '          node --test x.mjs',
    '',
    '          # skipped',
    '          node y.mjs',
    '        env:',
    '          X: 1',
    '      - run: echo inline',
    '        if: always()',
    '  other:',
    '    steps:',
    '      - run: nope',
  ].join('\n');
  assert.deepEqual(ciRunCommands(yaml), [
    'npm run a && npm run b',
    'node --test x.mjs',
    'node y.mjs',
    'echo inline',
  ]);
  assert.deepEqual(ciRunCommands(yaml, 'missing'), []);
});

test('ciRunCommands finds the commands of the real ci.yml', () => {
  const cmds = ciRunCommands(ciYml);
  assert.ok(cmds.length > 30);
  assert.ok(cmds.includes('npm run build'));
  assert.ok(!cmds.includes('npm ci'));
  assert.ok(!cmds.some(c => c.includes('lint-baseline') || c.includes('Usage catalogue')));
});

test('parseArgs: flags, equals form, repeats and errors', () => {
  assert.deepEqual(parseArgs([]), {
    list: false,
    all: false,
    only: [],
    skip: [],
    from: null,
    error: null,
  });
  const a = parseArgs(['--only', 'a,b', '--skip=c', '--from', 'd', '--all', '--list']);
  assert.deepEqual([a.only, a.skip, a.from, a.all, a.list], [['a', 'b'], ['c'], 'd', true, true]);
  assert.deepEqual(parseArgs(['--only', 'a', '--only', 'b']).only, ['a', 'b']);
  assert.match(parseArgs(['--only']).error ?? '', /needs a value/);
  assert.match(parseArgs(['--from', '--all']).error ?? '', /needs a value/);
  assert.match(parseArgs(['--bogus']).error ?? '', /unknown argument --bogus/);
});

test('selectSteps: from, only, skip, order and unknown names', () => {
  const s = ['a', 'b', 'c', 'd'].map(name => ({ name, cmd: 'x', args: [] }));
  const names = (/** @type {string[]} */ argv) =>
    selectSteps(s, parseArgs(argv)).steps.map(x => x.name);
  assert.deepEqual(names([]), ['a', 'b', 'c', 'd']);
  assert.deepEqual(names(['--only', 'c,a']), ['a', 'c']);
  assert.deepEqual(names(['--from', 'b']), ['b', 'c', 'd']);
  assert.deepEqual(names(['--skip', 'b,d']), ['a', 'c']);
  assert.deepEqual(names(['--from', 'b', '--skip', 'c']), ['b', 'd']);
  assert.match(selectSteps(s, parseArgs(['--only', 'zzz'])).error ?? '', /unknown step zzz/);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0m0s');
  assert.equal(formatDuration(372_000), '6m12s');
});

/** Runs main() with fake steps; `behaviour` maps a step name to its exit status and log text. */
function run(argv, behaviour = {}, steps = undefined) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-test-'));
  const lines = [];
  const ran = [];
  const fakeSteps = steps ?? ['one', 'two', 'three'].map(name => ({ name, cmd: 'x', args: [] }));
  let t = 1_000_000;
  const code = main({
    argv,
    steps: fakeSteps,
    cwd: tmp,
    tmpdir: tmp,
    isTTY: false,
    now: () => (t += 62_000),
    log: l => lines.push(l),
    runStep: (step, fd) => {
      ran.push(step.name);
      const b = behaviour[step.name] ?? { status: 0 };
      if (b.log) fs.writeSync(fd, b.log);
      return b.status;
    },
  });
  return { code, lines, ran, tmp };
}

test('main: all green prints one OK line and nothing else', () => {
  const r = run([], { one: { status: 0, log: 'noise\n' } });
  assert.equal(r.code, 0);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /^green: OK, 3 steps in 1m2s$/);
  assert.deepEqual(r.ran, ['one', 'two', 'three']);
});

test('main: the log goes under green-<stamp>/<nn>-<step>.log', () => {
  const r = run([], { two: { status: 1, log: 'boom\n' } });
  const m = /FAILED at two \((.+)\)/.exec(r.lines[0]);
  assert.ok(m);
  assert.match(path.basename(m[1]), /^02-two\.log$/);
  assert.match(path.basename(path.dirname(m[1])), /^green-\d{8}-\d{6}$/);
  assert.equal(path.dirname(path.dirname(m[1])), r.tmp);
});

test('main: stops at the first failure and prints the last 30 log lines', () => {
  const log = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const r = run([], { two: { status: 1, log } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.ran, ['one', 'two']);
  assert.match(r.lines[0], /^green: FAILED at two \(/);
  const tail = r.lines[1].split('\n');
  assert.equal(tail.length, 30);
  assert.equal(tail[0], 'line 21');
  assert.equal(tail[29], 'line 50');
});

test('main --all: runs every step, names every failure, tails the first', () => {
  const r = run(['--all'], {
    one: { status: 1, log: 'first\n' },
    three: { status: 2, log: 'third\n' },
  });
  assert.equal(r.code, 1);
  assert.deepEqual(r.ran, ['one', 'two', 'three']);
  assert.match(r.lines[0], /FAILED at one/);
  assert.match(r.lines[1], /FAILED at three/);
  assert.equal(r.lines[2], 'first');
});

test('main: --list, --only, --skip, --from and bad flags', () => {
  assert.deepEqual(run(['--list']).lines, ['one', 'two', 'three']);
  assert.deepEqual(run(['--list']).ran, []);
  assert.deepEqual(run(['--only', 'two']).ran, ['two']);
  assert.deepEqual(run(['--skip', 'two']).ran, ['one', 'three']);
  assert.deepEqual(run(['--from', 'three']).ran, ['three']);
  const bad = run(['--only', 'nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.lines[0], /unknown step nope/);
  assert.equal(run(['--wat']).code, 2);
});

test('main: a TTY gets one progress line per step, cleared at the end', () => {
  const out = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-test-'));
  main({
    argv: [],
    steps: [{ name: 'only', cmd: 'x', args: [] }],
    cwd: tmp,
    tmpdir: tmp,
    isTTY: true,
    log: () => {},
    write: t => out.push(t),
    runStep: () => 0,
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /green: \[1\/1\] only/);
});

test('the real runner writes a step output into its log', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-test-'));
  const lines = [];
  const code = main({
    argv: [],
    steps: [{ name: 'echo', cmd: 'node', args: ['-e', '"console.log(42);process.exit(3)"'] }],
    cwd: tmp,
    tmpdir: tmp,
    isTTY: false,
    log: l => lines.push(l),
  });
  assert.equal(code, 1);
  assert.match(lines[0], /FAILED at echo/);
  assert.equal(lines[1], '42');
});

/**
 * scripts/green.mjs: parity with the CI job `build-test` (this test keeps green and CI in step),
 * the ci.yml command extraction, the flags, and the quiet output. Fake step runners stand in for
 * the real commands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STEPS,
  CI_ONLY,
  ciRunCommands,
  ciUnsupported,
  commandLine,
  isShellSafe,
  isEntryModule,
  normalizeCommand,
  parseArgs,
  selectSteps,
  formatDuration,
  portableNode22Dir,
  stepEnvironment,
  nodeNote,
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
function run(argv, behaviour = {}, steps = undefined, note = null) {
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
    note,
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
  fs.writeFileSync(path.join(tmp, 'probe.js'), 'console.log(42); process.exit(3);');
  const lines = [];
  const code = main({
    argv: [],
    steps: [{ name: 'echo', cmd: 'node', args: ['probe.js'] }],
    cwd: tmp,
    tmpdir: tmp,
    isTTY: false,
    note: null,
    log: l => lines.push(l),
  });
  assert.equal(code, 1);
  assert.match(lines[0], /FAILED at echo/);
  assert.equal(lines[1], '42');
});

test('ciRunCommands: a plain multi-line run scalar is folded into one command', () => {
  const yaml = [
    'jobs:',
    '  build-test:',
    '    steps:',
    '      - name: Long',
    '        run: npm run a &&',
    '          npm run b',
    '          && npm run c',
    '        env:',
    '          X: 1',
    '      - run: echo "one',
    '          two"',
    '      - run: next',
  ].join('\n');
  assert.deepEqual(ciRunCommands(yaml), [
    'npm run a && npm run b && npm run c',
    'echo "one two"',
    'next',
  ]);
});

test('ciUnsupported: working-directory is flagged, and the real ci.yml has none in build-test', () => {
  const yaml = [
    'jobs:',
    '  build-test:',
    '    steps:',
    '      - run: x',
    '        working-directory: sub',
    '  other:',
    '    steps:',
    '      - run: y',
    '        working-directory: ignored',
  ].join('\n');
  assert.deepEqual(ciUnsupported(yaml), ['working-directory: sub']);
  assert.deepEqual(ciUnsupported(ciYml), [], 'ciRunCommands would run those from the wrong folder');
});

test('commandLine joins plain words; every step is shell safe so nothing is ever quoted', () => {
  assert.equal(
    commandLine({ name: 'x', cmd: 'npm', args: ['run', 'a:b', '-w', '@x/y'] }),
    'npm run a:b -w @x/y'
  );
  for (const step of STEPS) {
    for (const word of [step.cmd, ...step.args])
      assert.ok(isShellSafe(word), `${step.name}: ${word}`);
  }
  for (const bad of ['a b', 'a"b', "a'b", 'a\\b', 'a&b', 'a|b', 'a;b', 'a(b)', 'a$b', 'a>b', '']) {
    assert.ok(!isShellSafe(bad), bad);
    assert.throws(() => commandLine({ name: 'x', cmd: 'node', args: [bad] }), /needs quoting/);
  }
});

test('the real runner starts steps without a deprecation warning (shell plus args array)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = `import { main } from ${JSON.stringify(new URL('./green.mjs', import.meta.url).href)};
process.exit(main({ argv: [], steps: [{ name: 'ok', cmd: 'node', args: ['-e', '1'] }], isTTY: false, note: null, log: l => console.log(l), tmpdir: ${JSON.stringify(os.tmpdir())}, cwd: ${JSON.stringify(here)} }));`;
  const r = spawnSync(
    process.execPath,
    ['--throw-deprecation', '--input-type=module', '-e', script],
    {
      encoding: 'utf8',
    }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^green: OK, 1 steps/);
  assert.doesNotMatch(r.stderr, /DEP0190/);
});

test('isEntryModule: real paths, so a junction or a case difference still starts the script', () => {
  const self = fileURLToPath(import.meta.url);
  assert.ok(isEntryModule(self, self));
  assert.ok(!isEntryModule(undefined, self));
  assert.ok(!isEntryModule(path.join(os.tmpdir(), 'other.mjs'), self));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-junction-'));
  const link = path.join(dir, 'link');
  fs.symlinkSync(path.dirname(self), link, 'junction');
  assert.ok(isEntryModule(path.join(link, path.basename(self)), self));
  if (process.platform === 'win32') assert.ok(isEntryModule(self.toUpperCase(), self));
});

test('started through a junction, green still runs (exit code and output, not a silent 0)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-junction-'));
  const link = path.join(dir, 'scripts-link');
  fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link, 'junction');
  const r = spawnSync(process.execPath, [path.join(link, 'green.mjs'), '--list'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^typecheck\n/);
});

test('portableNode22Dir: on Windows under Node 24 the newest portable Node 22 comes first; elsewhere nothing changes', () => {
  const localAppData = path.join('C:', 'Users', 'u', 'AppData', 'Local');
  const base = {
    platform: 'win32',
    localAppData,
    major: 24,
    readdir: () => ['node-v22.9.1-win-x64', 'node-v22.22.2-win-x64', 'node-v20.1.0-win-x64', 'x'],
    exists: () => true,
  };
  assert.equal(portableNode22Dir(base), path.join(localAppData, 'node22', 'node-v22.22.2-win-x64'));
  assert.equal(portableNode22Dir({ ...base, major: 22 }), null, 'already Node 22');
  assert.equal(portableNode22Dir({ ...base, platform: 'linux' }), null, 'not Windows');
  assert.equal(portableNode22Dir({ ...base, localAppData: '' }), null, 'no LOCALAPPDATA');
  assert.equal(portableNode22Dir({ ...base, exists: () => false }), null, 'no node.exe in it');
  assert.equal(
    portableNode22Dir({
      ...base,
      readdir: () => {
        throw new Error('ENOENT');
      },
    }),
    null,
    'no node22 folder'
  );
});

test('stepEnvironment: one PATH key with the pin first, even when the parent holds PATH and Path', () => {
  const dir = 'C:\\n22';
  const env = stepEnvironment({ PATH: 'a', Path: 'b', Other: 'x' }, dir, ';');
  const pathKeys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  assert.deepEqual(pathKeys, ['PATH']);
  assert.equal(env.PATH, 'C:\\n22;a');
  assert.equal(env.Other, 'x');
  assert.deepEqual(
    stepEnvironment({ Path: 'b' }, dir, ';'),
    { Path: 'C:\\n22;b' },
    'the real casing is kept'
  );
  assert.deepEqual(stepEnvironment({}, dir, ';'), { PATH: 'C:\\n22;' }, 'no PATH at all');
  const base = { Path: 'b', PATH: 'a' };
  assert.deepEqual(stepEnvironment(base, null), base, 'no pin: untouched');
  assert.deepEqual(base, { Path: 'b', PATH: 'a' }, 'the input is not changed');
});

test('nodeNote: Windows says which Node the steps run on, other systems say nothing', () => {
  assert.equal(
    nodeNote({ platform: 'win32', major: 24, version: '24.15.0', dir: 'C:\\n22' }),
    'green: steps on Node 22 (C:\\n22)'
  );
  assert.equal(
    nodeNote({ platform: 'win32', major: 24, version: '24.15.0', dir: null }),
    'green: no portable Node 22 found; steps run on Node 24.15.0'
  );
  assert.equal(
    nodeNote({ platform: 'win32', major: 22, version: '22.22.2', dir: null }),
    'green: steps on Node 22.22.2'
  );
  assert.equal(nodeNote({ platform: 'linux', major: 24, version: '24.1.0', dir: null }), null);
});

test('docs:lint: markdown in .gitignore folders (playwright-report, test-results) is not linted', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-mdlint-'));
  try {
    fs.copyFileSync(
      path.join(root, '.markdownlint-cli2.jsonc'),
      path.join(dir, '.markdownlint-cli2.jsonc')
    );
    fs.writeFileSync(
      path.join(dir, '.gitignore'),
      'playwright-report/\ntest-results/\nfresh-reports/\n'
    );
    fs.writeFileSync(path.join(dir, 'ok.md'), '# Fine\n\nText.\n');
    const bad = '# One\n\n# Two\n\n\n\nno final newline';
    for (const d of ['packages/web/playwright-report', 'test-results', 'fresh-reports']) {
      fs.mkdirSync(path.join(dir, d), { recursive: true });
      fs.writeFileSync(path.join(dir, d, 'bad.md'), bad);
    }
    const bin = path.join(root, 'node_modules', 'markdownlint-cli2', 'markdownlint-cli2-bin.mjs');
    const lint = () => spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8' });
    const ok = lint();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    // The check has teeth: the same bad file outside an ignored folder fails.
    fs.writeFileSync(path.join(dir, 'bad.md'), bad);
    assert.notEqual(lint().status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main: the Node note is the first line, before the steps', () => {
  const r = run([], {}, undefined, 'green: steps on Node 22 (x)');
  assert.deepEqual(r.lines, ['green: steps on Node 22 (x)', 'green: OK, 3 steps in 1m2s']);
  assert.equal(
    run(['--list'], {}, undefined, 'green: steps on Node 22 (x)').lines.includes(
      'green: steps on Node 22 (x)'
    ),
    false
  );
});

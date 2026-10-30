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
  cleanTreeHash,
  greenStampPath,
  greenPassedOnThisTree,
  worktreeTreeHash,
  runLock,
  HEAVY_STEPS,
  SOLO_STEPS,
  cloudGreen,
  repoFromUrl,
  quickSteps,
} from './green.mjs';
import { main as prePush, CHECKS, pushedCommits } from './pre-push.mjs';
import { HELD_ENV } from './heavy-lock.mjs';

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
    cloud: false,
    quick: false,
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

test('main: the log goes under green-<stamp>-<pid>/<nn>-<step>.log', () => {
  const r = run([], { two: { status: 1, log: 'boom\n' } });
  const m = /FAILED at two \((.+)\)/.exec(r.lines[0]);
  assert.ok(m);
  assert.match(path.basename(m[1]), /^02-two\.log$/);
  assert.equal(path.basename(path.dirname(m[1])), `${/^green-\d{8}-\d{6}/.exec(path.basename(path.dirname(m[1])))?.[0]}-${process.pid}`);
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

/** A temp git repository with one commit. */
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-stamp-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
  return { dir, git };
}

test('green stamp: matches only the clean tree it was recorded for', () => {
  const { dir } = tempRepo();
  const steps = [{ name: 'one', cmd: 'x', args: [] }];
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'green-stamp-logs-'));
  const base = { steps, cwd: dir, tmpdir: logs, isTTY: false, note: null, log: () => {} };
  // fake steps never stamp (only the real STEPS list does)
  assert.equal(main({ ...base, argv: [], runStep: () => 0 }), 0);
  assert.equal(greenPassedOnThisTree(dir), false);
  const tree = cleanTreeHash(dir);
  assert.match(tree, /^[0-9a-f]{40}$/);
  fs.writeFileSync(greenStampPath(dir), `${tree}\n`);
  assert.equal(greenPassedOnThisTree(dir), true);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  assert.equal(cleanTreeHash(dir), null, 'uncommitted change: not green on a commit');
  assert.equal(greenPassedOnThisTree(dir), false);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x\n');
  assert.equal(cleanTreeHash(dir), null, 'an untracked file counts');
});

test('worktreeTreeHash: uncommitted and untracked edits give the tree their commit will have, and the real index is untouched', () => {
  const { dir, git } = tempRepo();
  assert.equal(worktreeTreeHash(dir), cleanTreeHash(dir), 'clean tree: the HEAD tree');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'x\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n');
  const dirty = worktreeTreeHash(dir);
  assert.match(dirty, /^[0-9a-f]{40}$/);
  assert.equal(git('diff', '--cached', '--name-only').stdout, '', 'nothing staged in the real index');
  fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x\n');
  assert.equal(worktreeTreeHash(dir), dirty, 'an ignored file does not count');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'two');
  assert.equal(git('rev-parse', 'HEAD^{tree}').stdout.trim(), dirty);
});

test('green stamp with pushed commits: every pushed commit must have the green tree, whatever the working tree holds', () => {
  const { dir, git } = tempRepo();
  const first = git('rev-parse', 'HEAD').stdout.trim();
  fs.writeFileSync(greenStampPath(dir), `${cleanTreeHash(dir)}\n`);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'edited after the commit\n');
  assert.equal(greenPassedOnThisTree(dir), false, 'without commits: a dirty tree never matches');
  assert.equal(greenPassedOnThisTree(dir, [first]), true, 'the pushed commit has the green tree');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', 'two');
  const second = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(greenPassedOnThisTree(dir, [second]), false);
  assert.equal(greenPassedOnThisTree(dir, [first, second]), false, 'every commit must match');
  assert.equal(greenPassedOnThisTree(dir, ['0123456789012345678901234567890123456789']), false, 'unknown commit');
});

test('main: a full green run stamps a dirty tree with the tree its commit will have', () => {
  const { dir, git } = tempRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n');
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'green-stamp-logs-'));
  // The real step list (so the run stamps), every step faked as passing, no lock.
  const code = main({
    cwd: dir,
    tmpdir: logs,
    argv: [],
    isTTY: false,
    note: null,
    log: () => {},
    runStep: () => 0,
    takeLock: () => ({ held: false, waitedMs: 0, release() {}, beat() {} }),
  });
  assert.equal(code, 0);
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'dirty');
  assert.equal(fs.readFileSync(greenStampPath(dir), 'utf8').trim(), git('rev-parse', 'HEAD^{tree}').stdout.trim());
  assert.equal(greenPassedOnThisTree(dir, [git('rev-parse', 'HEAD').stdout.trim()]), true);
  const run = fs.readdirSync(logs).find(n => n.startsWith('green-'));
  const timings = JSON.parse(fs.readFileSync(path.join(logs, run, 'timings.json'), 'utf8'));
  assert.equal(timings.steps.length, STEPS.length);
  assert.equal(timings.lockWaitMs, 0);
});

test('runLock: taken once at the first heavy step, beaten before each later step, released after the last heavy one', () => {
  const steps = ['docs', 'typecheck', 'light', 'build', 'tail'].map(name => ({ name, cmd: 'x', args: [] }));
  assert.ok(HEAVY_STEPS.has('typecheck') && HEAVY_STEPS.has('build'));
  const events = [];
  const env = {};
  const take = label => {
    events.push(`take ${label}`);
    return { held: true, waitedMs: 4000, beat: s => events.push(`beat ${s}`), release: () => events.push('release') };
  };
  const lock = runLock(steps, take, 'green wt', env);
  steps.forEach((s, i) => {
    lock.before(i, s);
    events.push(`run ${s.name}${env[HELD_ENV] ? ' (held)' : ''}`);
    lock.after(i);
  });
  lock.release();
  assert.deepEqual(events, [
    'run docs',
    'take green wt',
    'beat typecheck',
    'run typecheck (held)',
    'beat light',
    'run light (held)',
    'beat build',
    'run build (held)',
    'release',
    'run tail',
  ]);
  assert.equal(lock.waitedMs, 4000);
  assert.equal(env[HELD_ENV], undefined);
});

test('runLock: a run with no heavy step never takes the lock; a failure mid-run still releases', () => {
  const take = () => assert.fail('took the lock');
  const light = runLock([{ name: 'docs', cmd: 'x', args: [] }], take, 'g', {});
  light.before(0, { name: 'docs' });
  light.after(0);
  let released = 0;
  const env = {};
  const lock = runLock(
    [{ name: 'typecheck' }, { name: 'build' }].map(s => ({ ...s, cmd: 'x', args: [] })),
    () => ({ held: true, waitedMs: 0, beat() {}, release: () => released++ }),
    'g',
    env
  );
  lock.before(0, { name: 'typecheck' });
  lock.release();
  lock.release();
  assert.equal(released, 1);
  assert.equal(env[HELD_ENV], undefined);
});

test('solo steps (never two greens at once) are real heavy steps', () => {
  assert.ok(SOLO_STEPS.has('e2e'));
  for (const name of SOLO_STEPS) {
    assert.ok(HEAVY_STEPS.has(name), `${name} is heavy`);
    assert.ok(STEPS.some(s => s.name === name), `${name} is a step`);
  }
});

test('pushedCommits: the local shas of the pushed refs, without deletes', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const zero = '0'.repeat(40);
  const text = `refs/heads/x ${a} refs/heads/x ${zero}\n(delete) ${zero} refs/heads/old ${b}\nrefs/heads/y ${b} refs/heads/y ${a}\n\n`;
  assert.deepEqual(pushedCommits(text), [a, b]);
  assert.deepEqual(pushedCommits(''), []);
});

test('pre-push: only the lock-free em dash guard runs, and the pushed commits reach the green check', () => {
  const ran = [];
  const seen = [];
  const code = prePush({
    cwd: '.',
    env: {},
    log: () => {},
    commits: ['c1'],
    passedGreen: (_cwd, commits) => {
      seen.push(...commits);
      return false;
    },
    runCheck: c => {
      ran.push(c.name);
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(seen, ['c1']);
  assert.deepEqual(ran, ['emdash:ratchet']);
});

test('pre-push: never takes the heavy lock and leaves lint and typecheck to CI', () => {
  const src = fs.readFileSync(new URL('./pre-push.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /withHeavyLock|heavy-lock\.mjs'/);
  assert.deepEqual(
    CHECKS.map(c => c.name),
    ['emdash:ratchet']
  );
});

test('pre-push: refuses a failing guard, skips after green or by hand', () => {
  const lines = [];
  const ran = [];
  const base = { cwd: '.', env: {}, log: l => lines.push(l), passedGreen: () => false };
  const failDash = c => {
    ran.push(c.name);
    return 1;
  };
  assert.equal(prePush({ ...base, runCheck: failDash }), 1);
  assert.deepEqual(ran, ['emdash:ratchet']);
  assert.match(lines.at(-1), /emdash:ratchet failed, push refused/);
  ran.length = 0;
  const fail = c => {
    ran.push(c.name);
    return 1;
  };
  assert.equal(prePush({ ...base, passedGreen: () => true, runCheck: fail }), 0);
  assert.equal(prePush({ ...base, env: { SKIP_PREPUSH: '1' }, runCheck: fail }), 0);
  assert.deepEqual(ran, []);
});

// ---- green --quick: what a branch touched, no heavy lock ----

const quickNames = files => quickSteps(files, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')).map(s => s.name);

test('quickSteps: typecheck and unit tests of each touched package only', () => {
  assert.deepEqual(quickNames(['packages/mcp-server/src/a.ts', 'packages/discord-bot/src/b.ts']), [
    'build-shared',
    'typecheck-discord-bot',
    'typecheck-mcp-server',
    'unit-discord-bot',
    'unit-mcp-server',
  ]);
  assert.deepEqual(quickNames(['docs/dev/X.md', 'changelog.d/x.md']), []);
});

test('quickSteps: a shared change typechecks every package and tests shared', () => {
  assert.deepEqual(quickNames(['shared/src/types.ts']), ['build-shared', 'typecheck-all', 'unit-shared']);
});

test('quickSteps: a changed script runs its test, a changed test runs itself, a missing test is left out', () => {
  const steps = quickSteps(
    ['scripts/green.mjs', 'scripts/pre-push.mjs', 'scripts/no-such-thing.mjs', '.claude/hooks/guard-model.test.mjs'],
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  const t = steps.find(s => s.name === 'node-tests');
  assert.ok(t);
  assert.ok(t.args.includes('scripts/green.test.mjs'));
  assert.ok(t.args.includes('.claude/hooks/guard-model.test.mjs'));
  assert.ok(!t.args.some(a => a.includes('no-such-thing')));
});

test('quickSteps: touched dashboard e2e specs build the dashboard and run only those specs', () => {
  const steps = quickSteps(['packages/cogm-dashboard/web/e2e/help.spec.ts']);
  const names = steps.map(s => s.name);
  assert.deepEqual(names, [
    'build-shared',
    'typecheck-cogm-dashboard',
    'unit-cogm-dashboard',
    'build-dashboard',
    'e2e-specs',
  ]);
  assert.deepEqual(steps.at(-1).args.slice(-2), ['--', 'e2e/help.spec.ts']);
});

test('quickSteps: no step name takes the heavy lock', () => {
  const all = quickSteps(
    ['shared/src/a.ts', 'packages/cogm-dashboard/web/e2e/help.spec.ts', 'packages/foundry-module/src/a.ts', 'scripts/green.mjs'],
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  );
  for (const s of all) {
    assert.ok(!HEAVY_STEPS.has(s.name), `${s.name} would take a heavy slot`);
    assert.doesNotThrow(() => commandLine(s));
  }
});

test('parseArgs: --quick stands alone', () => {
  assert.equal(parseArgs(['--quick']).quick, true);
  for (const bad of ['--cloud', '--all', '--only=a', '--skip=a', '--from=a']) {
    assert.match(parseArgs(['--quick', bad]).error ?? '', /--quick builds its own step list/);
  }
});

test('main --quick: runs the quick steps without the heavy lock, nothing to check is OK, no green stamp', () => {
  const ran = [];
  const lines = [];
  let locked = 0;
  const base = {
    argv: ['--quick'],
    cwd: os.tmpdir(),
    tmpdir: fs.mkdtempSync(path.join(os.tmpdir(), 'quick-')),
    isTTY: false,
    note: null,
    log: l => lines.push(l),
    takeLock: () => {
      locked++;
      return { release() {}, beat() {}, waitedMs: 0 };
    },
    runStep: s => {
      ran.push(s.name);
      return 0;
    },
  };
  assert.equal(main({ ...base, changed: ['packages/mcp-server/src/a.ts'] }), 0);
  assert.deepEqual(ran, ['build-shared', 'typecheck-mcp-server', 'unit-mcp-server']);
  assert.equal(locked, 0, 'a quick run takes no heavy slot');
  assert.match(lines.at(-1), /^green: OK, 3 steps/);
  lines.length = 0;
  assert.equal(main({ ...base, changed: ['README.md'] }), 0);
  assert.match(lines.at(-1), /OK \(quick\), nothing to check/);
  assert.equal(main({ ...base, changed: ['packages/mcp-server/src/a.ts'], runStep: () => 1 }), 1);
});

// ---- green --cloud: a fake git and a fake gh, no network ----

const SHA = 'a'.repeat(40);

/** A fake git: `over` replaces the answer for a command. */
function fakeGit(over = {}) {
  const answers = {
    'status --porcelain': '',
    'rev-parse --abbrev-ref HEAD': 'claude/topic',
    'rev-parse HEAD': SHA,
    'remote get-url aitool': 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git',
    'ls-remote aitool refs/heads/claude/topic': `${SHA}\trefs/heads/claude/topic`,
    ...over,
  };
  return args => {
    const v = answers[args.join(' ')];
    return v === undefined ? { status: 1, stdout: '', stderr: 'no' } : { status: 0, stdout: v, stderr: '' };
  };
}

/** A fake gh over scripted runs; records every call. */
function fakeGh({ existing = [], laterExisting = null, dispatched = [], views = [], dispatchStatus = 0, openPr = false, listFails = false, viewFails = false }) {
  const calls = [];
  let viewNo = 0;
  let commitLists = 0;
  const gh = args => {
    calls.push(args.join(' '));
    if (args[0] === 'pr') return { status: 0, stdout: JSON.stringify(openPr ? [{ number: 1 }] : []), stderr: '' };
    if (args[0] === 'run' && args[1] === 'list') {
      if (listFails) return { status: 1, stdout: '', stderr: 'gh: not logged in' };
      const isCommit = args.includes('--commit');
      const rows = isCommit ? (commitLists++ > 0 && laterExisting ? laterExisting : existing) : args.includes('workflow_dispatch') ? dispatched : [];
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    }
    if (args[0] === 'workflow') return { status: dispatchStatus, stdout: '', stderr: 'HTTP 403' };
    if (args[0] === 'run' && args[1] === 'view') {
      if (viewFails) return { status: 1, stdout: '', stderr: 'HTTP 401' };
      return { status: 0, stdout: JSON.stringify(views[Math.min(viewNo++, views.length - 1)]), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { gh, calls };
}

function cloud(git, gh, extra = {}) {
  const lines = [];
  let t = 0;
  const code = cloudGreen({
    cwd: '.',
    git,
    gh,
    now: () => t,
    sleep: ms => {
      t += ms;
    },
    log: l => lines.push(l),
    pollMs: 1000,
    findMs: 3000,
    timeoutMs: 60_000,
    ...extra,
  });
  return { code, lines };
}

const doneView = (conclusion, jobs = []) => ({ status: 'completed', conclusion, url: 'https://gh/run/7', jobs });

test('parseArgs: --cloud is a flag that cannot be mixed with step selection', () => {
  assert.equal(parseArgs(['--cloud']).cloud, true);
  assert.equal(parseArgs([]).cloud, false);
  assert.match(parseArgs(['--cloud', '--only', 'e2e']).error, /cannot be combined/);
  assert.match(parseArgs(['--cloud', '--from', 'build']).error, /cannot be combined/);
});

test('main --cloud with a step flag is a usage error and never touches the lock or a step', () => {
  const lines = [];
  const code = main({
    argv: ['--cloud', '--all'],
    log: l => lines.push(l),
    takeLock: () => assert.fail('no lock for --cloud'),
    runStep: () => assert.fail('no local step for --cloud'),
  });
  assert.equal(code, 2);
  assert.match(lines[0], /cannot be combined/);
});

test('main --cloud runs CI through gh: no heavy lock, no local step, no green stamp', () => {
  const lines = [];
  const { gh } = fakeGh({
    existing: [{ databaseId: 7, status: 'completed', conclusion: 'success', headSha: SHA, event: 'pull_request' }],
    views: [doneView('success')],
  });
  const code = main({
    argv: ['--cloud'],
    log: l => lines.push(l),
    takeLock: () => assert.fail('no lock for --cloud'),
    runStep: () => assert.fail('no local step for --cloud'),
    cloudOptions: { git: fakeGit(), gh, sleep: () => {}, pollMs: 1 },
  });
  assert.equal(code, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^green: OK \(cloud\)/);
});

test('repoFromUrl reads https and ssh remotes', () => {
  assert.equal(repoFromUrl('https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git'), 'Gnuminator/Foundry-VTT-MCP-Ai-Tool');
  assert.equal(repoFromUrl('git@github.com:Gnuminator/Foundry-VTT-MCP-Ai-Tool.git'), 'Gnuminator/Foundry-VTT-MCP-Ai-Tool');
  assert.equal(repoFromUrl('https://example.com/x/y'), null);
});

test('cloud: refuses a dirty tree', () => {
  const { gh, calls } = fakeGh({});
  const { code, lines } = cloud(fakeGit({ 'status --porcelain': ' M scripts/green.mjs' }), gh);
  assert.equal(code, 1);
  assert.match(lines[0], /uncommitted changes/);
  assert.deepEqual(calls, []);
});

test('cloud: refuses a HEAD that is not pushed', () => {
  const { gh, calls } = fakeGh({});
  const git = fakeGit({ 'ls-remote aitool refs/heads/claude/topic': `${'b'.repeat(40)}\trefs/heads/claude/topic` });
  const { code, lines } = cloud(git, gh);
  assert.equal(code, 1);
  assert.match(lines[0], /not pushed to aitool\/claude\/topic/);
  assert.deepEqual(calls, []);
  const none = cloud(fakeGit({ 'ls-remote aitool refs/heads/claude/topic': '' }), gh);
  assert.match(none.lines[0], /not pushed/);
});

test('cloud: reuses the CI run already started for the head and prints one OK line', () => {
  const { gh, calls } = fakeGh({
    existing: [{ databaseId: 7, status: 'in_progress', conclusion: '', headSha: SHA, event: 'pull_request' }],
    views: [{ status: 'in_progress', conclusion: '', url: 'u', jobs: [] }, doneView('success')],
  });
  const { code, lines } = cloud(fakeGit(), gh);
  assert.equal(code, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^green: OK \(cloud\), CI run https:\/\/gh\/run\/7 for aaaaaaaa in 0m1s$/);
  assert.ok(!calls.some(c => c.startsWith('workflow run')), 'no second run when one exists');
});

test('cloud: a cancelled run does not count, ci.yml is dispatched on the branch and its run is found', () => {
  const { gh, calls } = fakeGh({
    existing: [{ databaseId: 5, status: 'completed', conclusion: 'cancelled', headSha: SHA, event: 'push' }],
    dispatched: [
      { databaseId: 6, status: 'completed', conclusion: 'success', headSha: 'c'.repeat(40), event: 'workflow_dispatch' },
      { databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'workflow_dispatch' },
    ],
    views: [doneView('success')],
  });
  const { code } = cloud(fakeGit(), gh);
  assert.equal(code, 0);
  assert.ok(calls.includes('workflow run ci.yml -R Gnuminator/Foundry-VTT-MCP-Ai-Tool --ref claude/topic'));
  assert.ok(calls.some(c => c.startsWith('run view 7 ')));
});

test('cloud: a failed run names the failed job, step and URL', () => {
  const { gh } = fakeGh({
    existing: [{ databaseId: 7, status: 'completed', conclusion: 'failure', headSha: SHA, event: 'pull_request' }],
    views: [
      doneView('failure', [
        { name: 'build-test (Node 22)', conclusion: 'failure', url: 'https://gh/job/1', steps: [{ name: 'Setup', conclusion: 'success' }, { name: 'Run e2e', conclusion: 'failure' }] },
        { name: 'build-test (Node 24)', conclusion: 'success', url: 'https://gh/job/2', steps: [] },
      ]),
    ],
  });
  const { code, lines } = cloud(fakeGit(), gh);
  assert.equal(code, 1);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    'green: FAILED (cloud, failure) build-test (Node 22) at step "Run e2e" (https://gh/job/1) (an earlier run; gh run rerun 7 --failed to retry)'
  );
});

test('cloud: a branch with an open PR waits for the pull_request run instead of dispatching', () => {
  const { gh, calls } = fakeGh({
    openPr: true,
    existing: [],
    laterExisting: [{ databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'pull_request' }],
    views: [doneView('success')],
  });
  const { code } = cloud(fakeGit(), gh);
  assert.equal(code, 0);
  assert.ok(!calls.some(c => c.startsWith('workflow run')), 'no dispatch next to the PR run');
});

test('cloud: an open PR whose run never shows up still gets a dispatch with its own time to be found', () => {
  const { gh, calls } = fakeGh({
    openPr: true,
    existing: [],
    dispatched: [{ databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'workflow_dispatch' }],
    views: [doneView('success')],
  });
  const { code } = cloud(fakeGit(), gh);
  assert.equal(code, 0);
  assert.ok(calls.some(c => c.startsWith('workflow run')));
});

test('cloud: gh and git errors are reported, not turned into a dispatch or a wrong message', () => {
  const list = fakeGh({ listFails: true });
  const a = cloud(fakeGit(), list.gh);
  assert.equal(a.code, 1);
  assert.match(a.lines[0], /could not list CI runs \(gh: gh: not logged in\)/);
  assert.ok(!list.calls.some(c => c.startsWith('workflow run')));
  const view = fakeGh({ existing: [{ databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'push' }], viewFails: true });
  const b = cloud(fakeGit(), view.gh);
  assert.equal(b.code, 1);
  assert.match(b.lines[0], /gh failed 5 times in a row while waiting for run 7: HTTP 401/);
  const ls = (args) => (args[0] === 'ls-remote' ? { status: 128, stdout: '', stderr: 'fatal: unable to access' } : fakeGit()(args));
  const c = cloud(ls, fakeGh({}).gh);
  assert.match(c.lines[0], /could not reach aitool: fatal: unable to access/);
});

test('cloud: a run cancelled while waiting is called cancelled, and main is refused', () => {
  const { gh } = fakeGh({
    existing: [{ databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'push' }],
    views: [doneView('cancelled', [{ name: 'build-test', conclusion: 'cancelled', url: 'j', steps: [] }])],
  });
  const a = cloud(fakeGit(), gh);
  assert.equal(a.code, 1);
  assert.match(a.lines[0], /^green: FAILED \(cloud, cancelled\) CI run https:\/\/gh\/run\/7 was cancelled/);
  const b = cloud(fakeGit({ 'rev-parse --abbrev-ref HEAD': 'main' }), fakeGh({}).gh);
  assert.equal(b.code, 1);
  assert.match(b.lines[0], /CI on main runs on push/);
});

test('ci.yml keeps what --cloud relies on: workflow_dispatch and a per-ref concurrency group', () => {
  const yml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /^ {2}workflow_dispatch:/m);
  assert.match(yml, /^ {2}group: .*github\.ref/m);
});

test('cloud: refuses when the dispatch is rejected or no run shows up', () => {
  const rejected = cloud(fakeGit(), fakeGh({ dispatchStatus: 1 }).gh);
  assert.equal(rejected.code, 1);
  assert.match(rejected.lines[0], /could not start ci\.yml: HTTP 403/);
  const missing = cloud(fakeGit(), fakeGh({}).gh);
  assert.equal(missing.code, 1);
  assert.match(missing.lines[0], /found no run for aaaaaaaa/);
});

test('cloud: gives up when the run is still going at the timeout', () => {
  const { gh } = fakeGh({
    existing: [{ databaseId: 7, status: 'queued', conclusion: '', headSha: SHA, event: 'push' }],
    views: [{ status: 'queued', conclusion: '', url: 'u', jobs: [] }],
  });
  const { code, lines } = cloud(fakeGit(), gh, { timeoutMs: 5000 });
  assert.equal(code, 1);
  assert.match(lines[0], /still going after 0m5s/);
});

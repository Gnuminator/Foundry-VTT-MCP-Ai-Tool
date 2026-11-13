// Tests for scripts/merge-runner/self-check.mjs and its use in the runner's round loop: fake deps
// for the decision, a real temporary git repository for the git helpers. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../merge-runner.mjs';
import {
  CHILD_ENV,
  EXIT_RESTART,
  MAX_QUICK_RESTARTS,
  QUICK_RESTART_MS,
  changedFiles,
  diskShas,
  importClosure,
  makeSelfCheck,
  refShas,
  reexec,
  selfCheck,
  updateCheckout,
} from './self-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, '..');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
/** @param {string} cwd */
const git = cwd => args => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Fake dependencies for selfCheck(); `onMain` and `onDisk` map files to shas. */
function fakes(o) {
  const calls = { fetch: 0, update: 0, log: [] };
  const d = {
    loaded: new Map(Object.entries(o.loaded ?? { 'scripts/merge-runner.mjs': A })),
    fetchMain: () => {
      calls.fetch++;
      return o.fetchProblem ?? null;
    },
    mainShas: () => (o.onMain === null ? null : new Map(Object.entries(o.onMain ?? {}))),
    update: () => {
      calls.update++;
      return o.updateProblem ?? null;
    },
    diskShas: () => new Map(Object.entries(o.onDisk ?? o.onMain ?? {})),
    log: line => calls.log.push(line),
  };
  return { d, calls };
}

test('same: every runner file has main sha, so nothing happens and the checkout is not touched', () => {
  const { d, calls } = fakes({
    loaded: { 'scripts/merge-runner.mjs': A, 'scripts/backlog-items.mjs': B },
    onMain: { 'scripts/merge-runner.mjs': A, 'scripts/backlog-items.mjs': B },
  });
  assert.equal(selfCheck(d), null);
  assert.equal(calls.fetch, 1);
  assert.equal(calls.update, 0);
});

test('changed: a different sha on main updates the checkout and asks for a restart, naming the file', () => {
  const { d, calls } = fakes({
    loaded: { 'scripts/merge-runner.mjs': A, 'scripts/backlog-items.mjs': B },
    onMain: { 'scripts/merge-runner.mjs': C, 'scripts/backlog-items.mjs': B },
  });
  const r = selfCheck(d);
  assert.equal(r?.action, 'restart');
  assert.deepEqual(r?.files, ['scripts/merge-runner.mjs']);
  assert.match(r?.why ?? '', /changed on main \(scripts\/merge-runner\.mjs\)/);
  assert.equal(calls.update, 1);
});

test('changed: a runner file that main no longer has counts as changed, and only the files main still has are compared on disk', () => {
  const asked = [];
  const { d } = fakes({
    loaded: { 'scripts/merge-runner.mjs': A, 'scripts/gone.mjs': B },
    onMain: { 'scripts/merge-runner.mjs': A },
  });
  d.diskShas = files => {
    asked.push(files);
    return new Map(files.map(f => [f, A]));
  };
  const r = selfCheck(d);
  assert.equal(r?.action, 'restart');
  assert.deepEqual(r?.files, ['scripts/gone.mjs']);
  assert.deepEqual(asked, [['scripts/merge-runner.mjs']]);
});

test('update failures: the first two rounds only warn and try again, the third stops with the reason; a good round resets', () => {
  const { d, calls } = fakes({
    onMain: { 'scripts/merge-runner.mjs': C },
    updateProblem: 'git merge --ff-only aitool/main failed (index.lock)',
  });
  const state = { failures: 0 };
  assert.equal(selfCheck(d, state), null);
  assert.equal(selfCheck(d, state), null);
  assert.match(calls.log.at(-1), /update failed: .*index\.lock\); next round/);
  const r = selfCheck(d, state);
  assert.equal(r?.action, 'stop');
  assert.match(r?.why ?? '', /could not be updated: git merge --ff-only/);

  const ok = fakes({ onMain: { 'scripts/merge-runner.mjs': C } });
  const s2 = { failures: 2 };
  assert.equal(selfCheck(ok.d, s2)?.action, 'restart');
  assert.equal(s2.failures, 0);
});

test('changed and the disk still differs after the update: stop, never a restart loop', () => {
  const { d } = fakes({
    onMain: { 'scripts/merge-runner.mjs': C },
    onDisk: { 'scripts/merge-runner.mjs': A },
  });
  const r = selfCheck(d);
  assert.equal(r?.action, 'stop');
  assert.match(r?.why ?? '', /still differs from main/);
});

test('main cannot be read this round (fetch fails, or no tree): no decision, a warning, next round', () => {
  const a = fakes({ fetchProblem: 'git fetch aitool main failed' });
  assert.equal(selfCheck(a.d), null);
  assert.match(a.calls.log[0], /code check skipped/);
  const b = fakes({ onMain: null });
  assert.equal(selfCheck(b.d), null);
  assert.equal(b.calls.update, 0);
});

test('changedFiles: sha compare per file', () => {
  assert.deepEqual(
    changedFiles(
      new Map([
        ['a', A],
        ['b', B],
      ]),
      new Map([
        ['a', A],
        ['b', C],
      ])
    ),
    ['b']
  );
});

test('importClosure: follows relative imports transitively, ignores packages, node: and names that are no file, lists each once', () => {
  const dir = tmp('self-check-closure-');
  try {
    fs.mkdirSync(path.join(dir, 'scripts', 'sub'), { recursive: true });
    const w = (f, t) => fs.writeFileSync(path.join(dir, 'scripts', f), t);
    w(
      'entry.mjs',
      "import fs from 'node:fs';\nimport { a } from './a.mjs';\nimport './sub/b.mjs';\n"
    );
    w(
      'a.mjs',
      "import { b } from './sub/b.mjs';\nexport * from './c.mjs';\nconst x = await import('./d.mjs');\n"
    );
    w('sub/b.mjs', "import { a } from '../a.mjs';\nimport pkg from 'some-package';\n");
    w('c.mjs', 'export const c = 1; // from "./not-an-import.mjs"\n');
    w('d.mjs', 'export const d = 1;\n');
    assert.deepEqual(importClosure(path.join(dir, 'scripts', 'entry.mjs'), dir), [
      'scripts/a.mjs',
      'scripts/c.mjs',
      'scripts/d.mjs',
      'scripts/entry.mjs',
      'scripts/sub/b.mjs',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('importClosure: the real runner closure holds the runner, its modules and this module', () => {
  const root = path.resolve(scripts, '..');
  const files = importClosure(
    [path.join(scripts, 'merge-runner.mjs'), path.join(scripts, 'backlog.mjs')],
    root
  );
  for (const f of [
    'scripts/backlog.mjs',
    'scripts/planner-state.mjs',
    'scripts/merge-runner.mjs',
    'scripts/backlog-items.mjs',
    'scripts/heavy-lock.mjs',
    'scripts/planner-wake.mjs',
    'scripts/merge-runner/self-check.mjs',
  ]) {
    assert.ok(files.includes(f), `${f} is in the closure`);
  }
});

/** A repository with branch `main`, a fake `aitool/main` ref and a file with CRLF in the work tree. */
function repo() {
  const dir = tmp('self-check-repo-');
  const g = git(dir);
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@example.com']);
  g(['config', 'user.name', 't']);
  g(['config', 'core.autocrlf', 'true']);
  fs.writeFileSync(path.join(dir, 'run.mjs'), 'one\r\ntwo\r\n');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'one']);
  return { dir, g };
}

test('git helpers: a CRLF checkout hashes like the repository blob; a later commit changes the sha', () => {
  const { dir, g } = repo();
  try {
    const onDisk = diskShas(g, ['run.mjs']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    assert.deepEqual(refShas(g, 'aitool/main', ['run.mjs']), onDisk);
    assert.equal(refShas(g, 'aitool/main', ['gone.mjs'])?.size, 0);
    assert.equal(refShas(g, 'no/such-ref', ['run.mjs']), null);
    fs.writeFileSync(path.join(dir, 'run.mjs'), 'one\r\nthree\r\n');
    assert.notDeepEqual(diskShas(g, ['run.mjs']), onDisk);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('updateCheckout: fast-forwards a clean main; refuses another branch, a dirty tree and a diverged main', () => {
  const { dir, g } = repo();
  try {
    // aitool/main is one commit ahead.
    g(['checkout', '-q', '-b', 'ahead']);
    fs.writeFileSync(path.join(dir, 'run.mjs'), 'new\r\n');
    g(['commit', '-q', '-am', 'two']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    g(['checkout', '-q', 'main']);
    assert.equal(updateCheckout(g, 'aitool/main'), null);
    assert.equal(fs.readFileSync(path.join(dir, 'run.mjs'), 'utf8').replace(/\r/g, ''), 'new\n');

    g(['checkout', '-q', '-b', 'other']);
    assert.match(updateCheckout(g, 'aitool/main') ?? '', /on other, not main/);
    g(['checkout', '-q', 'main']);

    fs.writeFileSync(path.join(dir, 'run.mjs'), 'local edit\r\n');
    assert.match(updateCheckout(g, 'aitool/main') ?? '', /uncommitted/);
    g(['checkout', '-q', '--', 'run.mjs']);

    // main and aitool/main diverge: no fast-forward.
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    g(['add', 'x.txt']);
    g(['commit', '-q', '-m', 'local']);
    g(['checkout', '-q', '-b', 'side', 'HEAD~1']);
    fs.writeFileSync(path.join(dir, 'y.txt'), 'y');
    g(['add', 'y.txt']);
    g(['commit', '-q', '-m', 'upstream']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    g(['checkout', '-q', 'main']);
    assert.match(updateCheckout(g, 'aitool/main') ?? '', /ff-only .* failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeSelfCheck on a real repo: same is null, then a new commit on the remote ref restarts and updates the files', () => {
  const { dir, g } = repo();
  try {
    fs.writeFileSync(path.join(dir, 'entry.mjs'), "import './run.mjs';\n");
    g(['add', '.']);
    g(['commit', '-q', '-m', 'entry']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    const lines = [];
    // No remote in this repo: the fetch is faked, everything else is real git.
    const run = (args, cwd) =>
      args[0] === 'fetch' ? { status: 0, stdout: '', stderr: '' } : git(cwd)(args);
    const check = makeSelfCheck({
      entry: path.join(dir, 'entry.mjs'),
      repoRoot: dir,
      ref: 'aitool/main',
      remote: 'aitool',
      branch: 'main',
      log: l => lines.push(l),
      run,
    });
    assert.ok(check);
    assert.equal(check(), null, 'same');

    g(['checkout', '-q', '-b', 'next']);
    fs.writeFileSync(path.join(dir, 'run.mjs'), 'changed\r\n');
    g(['commit', '-q', '-am', 'change run']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    g(['checkout', '-q', 'main']);
    const r = check();
    assert.equal(r?.action, 'restart');
    assert.deepEqual(r?.files, ['run.mjs']);
    assert.equal(
      fs.readFileSync(path.join(dir, 'run.mjs'), 'utf8').replace(/\r/g, ''),
      'changed\n'
    );
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeSelfCheck on a real repo: a module main deleted restarts (not a stop), and a change only in a second entry file counts', () => {
  const { dir, g } = repo();
  try {
    fs.writeFileSync(path.join(dir, 'entry.mjs'), "import './run.mjs';\n");
    fs.writeFileSync(path.join(dir, 'writer.mjs'), "import './helper.mjs';\n");
    fs.writeFileSync(path.join(dir, 'helper.mjs'), 'export const h = 1;\n');
    g(['add', '.']);
    g(['commit', '-q', '-m', 'files']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    const run = (args, cwd) =>
      args[0] === 'fetch' ? { status: 0, stdout: '', stderr: '' } : git(cwd)(args);
    const make = () =>
      makeSelfCheck({
        entry: [path.join(dir, 'entry.mjs'), path.join(dir, 'writer.mjs')],
        repoRoot: dir,
        ref: 'aitool/main',
        remote: 'aitool',
        branch: 'main',
        log: () => {},
        run,
      });
    const check = make();
    assert.equal(check(), null);

    // main changes only the second entry's import and deletes run.mjs.
    g(['checkout', '-q', '-b', 'next']);
    fs.writeFileSync(path.join(dir, 'helper.mjs'), 'export const h = 2;\n');
    fs.rmSync(path.join(dir, 'run.mjs'));
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'change helper, delete run']);
    g(['update-ref', 'refs/remotes/aitool/main', 'HEAD']);
    g(['checkout', '-q', 'main']);
    const r = check();
    assert.equal(r?.action, 'restart');
    assert.deepEqual(r?.files, ['helper.mjs', 'run.mjs']);
    assert.equal(fs.existsSync(path.join(dir, 'run.mjs')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('makeSelfCheck: git that cannot fingerprint the files turns the check off with one warning', () => {
  const lines = [];
  const check = makeSelfCheck({
    entry: path.join(scripts, 'merge-runner.mjs'),
    repoRoot: path.resolve(scripts, '..'),
    ref: 'aitool/main',
    remote: 'aitool',
    branch: 'main',
    log: l => lines.push(l),
    run: () => ({ status: 1, stdout: '', stderr: 'no git' }),
  });
  assert.equal(check, null);
  assert.equal(lines.length, 1);
});

test('reexec: the first process runs the same script and arguments as a child and returns its exit code', () => {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 3 };
  };
  const code = reexec({
    script: '/x/merge-runner.mjs',
    argv: ['--interval', '30'],
    env: {},
    spawn,
    log: () => {},
  });
  assert.equal(code, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args, ['/x/merge-runner.mjs', '--interval', '30']);
  assert.equal(calls[0].opts.stdio, 'inherit');
  assert.equal(calls[0].opts.env[CHILD_ENV], '1');
});

test('reexec: a child that wants new code makes the parent start the next child; one parent, one child at a time', () => {
  const codes = [EXIT_RESTART, EXIT_RESTART, 0];
  let t = 0;
  const calls = [];
  const code = reexec({
    script: 'x',
    argv: [],
    env: {},
    spawn: (cmd, args, opts) => {
      calls.push(opts.env[CHILD_ENV]);
      t += QUICK_RESTART_MS * 2; // each child lived long: not a loop
      return { status: codes.shift() };
    },
    now: () => t,
    log: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, ['1', '1', '1']);
});

test('reexec: inside a child it only hands back the restart code and starts nothing', () => {
  const code = reexec({
    script: 'x',
    argv: [],
    env: { [CHILD_ENV]: '1' },
    spawn: () => assert.fail('a child must not spawn'),
    log: () => {},
  });
  assert.equal(code, EXIT_RESTART);
});

test('reexec: restarts that each end within a minute, five in a row, stop with a posted line', () => {
  let spawned = 0;
  const lines = [];
  const posts = [];
  const code = reexec({
    script: 'x',
    argv: [],
    env: {},
    spawn: () => {
      spawned++;
      return { status: EXIT_RESTART };
    },
    now: () => 0,
    log: l => lines.push(l),
    post: t => posts.push(t),
  });
  assert.equal(code, 3);
  assert.equal(spawned, MAX_QUICK_RESTARTS);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /^merge runner stopped: restarted 5 times in a row/);
  assert.match(lines[0], /exiting: restarted 5 times/);
});

test('reexec: a real child process gets the child marker and its exit code comes back', () => {
  const dir = tmp('self-check-child-');
  try {
    const script = path.join(dir, 'child.mjs');
    fs.writeFileSync(script, `process.exit(process.env.${CHILD_ENV} === '1' ? 7 : 1);\n`);
    assert.equal(reexec({ script, argv: [], env: { ...process.env }, log: () => {} }), 7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the round loop in merge-runner.mjs --------------------------------------------------------

/** Fake runner deps with a self check; nothing else may be called before the check decides. */
function loopDeps(selfResult) {
  const calls = { post: [], log: [], read: 0, self: 0 };
  const deps = {
    readBacklog: () => {
      calls.read++;
      return null;
    },
    gh: () => assert.fail('no gh call'),
    prepare: () => assert.fail('no prepare'),
    gate: () => assert.fail('no gate'),
    backlog: () => assert.fail('no backlog write'),
    post: t => calls.post.push(t),
    log: l => calls.log.push(l),
    selfCheck: () => {
      calls.self++;
      return selfResult;
    },
  };
  return { deps, calls };
}

test('main: a changed runner file ends the run with the restart code, before the round, no Discord line', async () => {
  const dir = tmp('self-check-main-');
  try {
    const { deps, calls } = loopDeps({
      action: 'restart',
      why: 'its code changed on main (x)',
      files: ['x'],
    });
    const code = await main([], {
      deps,
      lockFile: path.join(dir, 'l.lock'),
      sleep: async () => {},
    });
    assert.equal(code, EXIT_RESTART);
    assert.equal(calls.read, 0, 'the round did not start');
    assert.deepEqual(calls.post, []);
    assert.ok(calls.log.some(l => /exiting: its code changed/.test(l)));
    assert.equal(
      fs.existsSync(path.join(dir, 'l.lock')),
      false,
      'the lock is released for the child'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main: changed but not updatable exits 3 with one #pr-log line that says so', async () => {
  const dir = tmp('self-check-main-');
  try {
    const { deps, calls } = loopDeps({
      action: 'stop',
      why: 'its code changed on main (x) but the checkout could not be updated: dirty',
      files: ['x'],
    });
    const code = await main([], {
      deps,
      lockFile: path.join(dir, 'l.lock'),
      sleep: async () => {},
    });
    assert.equal(code, 3);
    assert.equal(calls.post.length, 1);
    assert.match(calls.post[0], /^merge runner stopped: its code changed on main/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main: unchanged code runs the round as before; --once never checks', async () => {
  const dir = tmp('self-check-main-');
  try {
    const a = loopDeps(null);
    assert.equal(await main(['--once'], { deps: a.deps, lockFile: path.join(dir, 'a.lock') }), 0);
    assert.equal(a.calls.self, 0);
    assert.equal(a.calls.read, 1);
    // Without --once, a null check lets the round run; stop the loop through the sleep.
    const c = loopDeps(null);
    const stop = new Error('stop');
    await assert.rejects(
      main([], {
        deps: c.deps,
        lockFile: path.join(dir, 'c.lock'),
        sleep: async () => {
          throw stop;
        },
      }),
      stop
    );
    assert.equal(c.calls.self, 1);
    assert.equal(c.calls.read, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

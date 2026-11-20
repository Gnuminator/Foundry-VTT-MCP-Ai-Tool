import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REFRESH_SUBJECT, REFRESHABLE, refreshBranch, reviewOf } from './refresh.mjs';

/** Real git, a bare remote named aitool, and a detached checkout at the lane head. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-test-'));
  const run = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const remote = path.join(dir, 'remote.git');
  const checkout = path.join(dir, 'checkout');
  fs.mkdirSync(remote);
  run(remote, 'init', '-q', '--bare', '-b', 'main');
  run(dir, 'clone', '-q', remote, 'checkout');
  run(checkout, 'remote', 'rename', 'origin', 'aitool');
  const write = (f, s) => fs.writeFileSync(path.join(checkout, f), s);
  write('a.txt', 'one\n');
  write('package-lock.json', '{"v":1}\n');
  run(checkout, 'add', '-A');
  run(checkout, 'commit', '-q', '-m', 'base');
  run(checkout, 'push', '-q', 'aitool', 'HEAD:main');
  run(checkout, 'checkout', '-q', '-b', 'lane');
  write('lane.txt', 'lane\n');
  run(checkout, 'add', '-A');
  run(checkout, 'commit', '-q', '-m', 'lane work');
  run(checkout, 'push', '-q', 'aitool', 'lane:lane');
  const head = run(checkout, 'rev-parse', 'HEAD');
  run(checkout, 'checkout', '-q', 'main');
  return {
    dir,
    checkout,
    remote,
    head,
    run,
    write,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Advance main by one commit (via the checkout), then detach at the lane head. */
function moveMain(s, file, text) {
  s.run(s.checkout, 'checkout', '-q', 'main');
  s.write(file, text);
  s.run(s.checkout, 'add', '-A');
  s.run(s.checkout, 'commit', '-q', '-m', `main ${file}`);
  s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
  s.run(s.checkout, 'fetch', '-q', 'aitool');
  s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
}

const prInfo = (o = {}) => ({
  status: 0,
  stdout: JSON.stringify({
    headRefName: 'lane',
    baseRefName: 'main',
    isCrossRepository: false,
    isDraft: false,
    state: 'OPEN',
    ...o,
  }),
  stderr: '',
});
const opts = (s, extra = {}) => ({
  checkout: s.checkout,
  pr: 7,
  head: s.head,
  reason: 'pr: mergeable is CONFLICTING; merge main into the branch and resolve conflicts',
  run: (cmd, args, o) => {
    const r = spawnSync(cmd, args, { cwd: o?.cwd, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  },
  gh: () => prInfo({ headRefOid: extra.head ?? s.head }),
  repo: 'x/y',
  ...extra,
});
const patchId = (s, cwd, a, b) => {
  const d = spawnSync('git', ['diff', `${a}...${b}`], { cwd, encoding: 'utf8' }).stdout;
  return spawnSync('git', ['patch-id', '--verbatim'], {
    cwd,
    input: d,
    encoding: 'utf8',
  }).stdout.split(' ')[0];
};

test('clean merge: main is merged in, the merge commit is pushed, the lane patch is unchanged', () => {
  const s = setup();
  try {
    moveMain(s, 'main.txt', 'main\n');
    const r = refreshBranch(opts(s));
    assert.ok(r?.head, JSON.stringify(r));
    assert.notEqual(r.head, s.head);
    // the branch on the remote is the merge commit; the checkout is back on the old head
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), r.head);
    assert.equal(s.run(s.checkout, 'rev-parse', 'HEAD'), s.head);
    assert.equal(s.run(s.checkout, 'log', '-1', '--format=%s', r.head), REFRESH_SUBJECT);
    // a real two-parent merge: the old lane head first, then main's tip
    const mainTip = s.run(s.checkout, 'rev-parse', 'aitool/main');
    assert.equal(s.run(s.checkout, 'rev-list', '--parents', '-n', '1', r.head), `${r.head} ${s.head} ${mainTip}`);
    // review carries by patch id: the diff from the merge base is the same patch
    assert.equal(
      patchId(s, s.checkout, 'aitool/main', s.head),
      patchId(s, s.checkout, 'aitool/main', r.head)
    );
  } finally {
    s.cleanup();
  }
});

test('a real conflict stays a refusal, naming the file; nothing is pushed and the checkout is clean', () => {
  const s = setup();
  try {
    s.run(s.checkout, 'checkout', '-q', 'lane');
    s.write('a.txt', 'lane edit\n');
    s.run(s.checkout, 'commit', '-qam', 'lane edits a');
    s.run(s.checkout, 'push', '-q', 'aitool', 'lane:lane');
    s.head = s.run(s.checkout, 'rev-parse', 'HEAD');
    s.run(s.checkout, 'checkout', '-q', 'main');
    moveMain(s, 'a.txt', 'main edit\n');
    const r = refreshBranch(opts(s));
    assert.equal(r?.head, undefined);
    assert.match(r?.why ?? '', /real conflict in a\.txt/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
    assert.equal(s.run(s.checkout, 'status', '--porcelain'), '');
    assert.equal(s.run(s.checkout, 'rev-parse', 'HEAD'), s.head);
  } finally {
    s.cleanup();
  }
});

test('not refreshed: a reason merging main cannot cure, a head that has main, one refresh only', () => {
  const s = setup();
  try {
    assert.equal(refreshBranch(opts(s, { reason: 'ci: failing: build-test (FAILURE)' })), null);
    s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
    assert.match(refreshBranch(opts(s))?.why ?? '', /already contains main/);
    moveMain(s, 'main.txt', 'main\n');
    const first = refreshBranch(opts(s));
    assert.ok(first?.head);
    // the lane head is now the merge commit; main moves again: the runner does not merge a second time
    s.run(s.checkout, 'fetch', '-q', 'aitool');
    s.run(s.checkout, 'checkout', '-q', '--detach', first.head);
    moveMain({ ...s, head: first.head }, 'more.txt', 'more\n');
    const second = refreshBranch(opts(s, { head: first.head }));
    assert.match(second?.why ?? '', /already merged in by the runner once/);
  } finally {
    s.cleanup();
  }
});

test('not refreshed: a head that is already part of main (merging would fast-forward)', () => {
  const s = setup();
  try {
    // main takes the lane commit by fast-forward, then moves on: the head is an ancestor of main
    s.run(s.checkout, 'checkout', '-q', 'main');
    s.run(s.checkout, 'merge', '-q', '--ff-only', s.head);
    s.write('main.txt', 'main\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'main after lane');
    s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
    s.run(s.checkout, 'fetch', '-q', 'aitool');
    s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
    const mainBefore = s.run(s.remote, 'rev-parse', 'refs/heads/main');
    assert.match(refreshBranch(opts(s))?.why ?? '', /already part of main/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/main'), mainBefore);
    assert.equal(s.run(s.checkout, 'rev-parse', 'HEAD'), s.head);
  } finally {
    s.cleanup();
  }
});

test('not refreshed: fork, draft, closed or unreadable PRs', () => {
  const s = setup();
  try {
    moveMain(s, 'main.txt', 'main\n');
    for (const gh of [
      () => prInfo({ isCrossRepository: true }),
      () => prInfo({ isDraft: true }),
      () => prInfo({ state: 'CLOSED' }),
      () => prInfo({ baseRefName: 'dev', headRefOid: s.head }),
      () => prInfo({ headRefOid: 'f'.repeat(40) }),
      () => ({ status: 1, stdout: '', stderr: 'boom' }),
    ]) {
      const r = refreshBranch(opts(s, { gh }));
      assert.match(r?.why ?? '', /^not refreshed/);
      assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
    }
  } finally {
    s.cleanup();
  }
});

test('lockfile moved on main: npm install --package-lock-only runs; an unchanged lock pushes, a changed one refuses', () => {
  const s = setup();
  try {
    moveMain(s, 'package-lock.json', '{"v":2}\n');
    const calls = [];
    const real = opts(s).run;
    const npmOk = (cmd, args, o) => {
      if (/npm/.test([cmd, ...args].join(' '))) {
        calls.push(args.join(' '));
        return { status: 0, stdout: '', stderr: '' };
      }
      return real(cmd, args, o);
    };
    const ok = refreshBranch(
      opts(s, { run: npmOk, reason: 'drift: drift-check failed (log x); last lines below' })
    );
    assert.ok(ok?.head, JSON.stringify(ok));
    assert.equal(calls.length, 1);
    assert.match(calls[0], /package-lock-only/);
    // a regeneration that changes the lock: refused, nothing more pushed
    s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
    s.run(s.remote, 'update-ref', 'refs/heads/lane', s.head);
    const npmChanges = (cmd, args, o) => {
      if (/npm/.test([cmd, ...args].join(' '))) {
        fs.writeFileSync(path.join(s.checkout, 'package-lock.json'), '{"v":3}\n');
        return { status: 0, stdout: '', stderr: '' };
      }
      return real(cmd, args, o);
    };
    const bad = refreshBranch(opts(s, { run: npmChanges }));
    assert.match(bad?.why ?? '', /package-lock\.json would still change/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
    assert.equal(s.run(s.checkout, 'status', '--porcelain'), '');
  } finally {
    s.cleanup();
  }
});

test('a drift refusal with the lockfile unmoved is not refreshed (merging cannot cure it)', () => {
  const s = setup();
  try {
    moveMain(s, 'main.txt', 'main\n');
    const r = refreshBranch(opts(s, { reason: 'drift: drift-check failed (log x)' }));
    assert.match(r?.why ?? '', /package-lock\.json did not move/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
  } finally {
    s.cleanup();
  }
});

/** A runner that fakes `npm run docs:tools` by rewriting the generated index from the tools on disk. */
function fakeGen(s, calls = []) {
  const real = opts(s).run;
  return (cmd, args, o) => {
    if (/docs:tools/.test([cmd, ...args].join(' '))) {
      calls.push(1);
      const dir = path.join(s.checkout, 'docs', 'reference');
      fs.mkdirSync(dir, { recursive: true });
      const tools = fs
        .readdirSync(s.checkout)
        .filter(f => f.startsWith('tool-'))
        .sort();
      fs.writeFileSync(path.join(dir, 'tools.md'), tools.join('\n') + '\n');
      return { status: 0, stdout: '', stderr: '' };
    }
    return real(cmd, args, o);
  };
}

const TOOL_DRIFT =
  'drift: drift-check failed (guards: mcp-server tests (tool counts, tool reference, tool sets)) (log x); last lines below';

test('generated tool pages conflict: both sides regenerated, merge commit pushed, no other file touched', () => {
  const s = setup();
  try {
    // base has the index; the lane adds tool-b and its row, main adds tool-a and its row
    s.write('tool-0', 'x\n');
    fs.mkdirSync(path.join(s.checkout, 'docs', 'reference'), { recursive: true });
    s.write('docs/reference/tools.md', 'tool-0\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'index');
    s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
    s.run(s.checkout, 'checkout', '-q', '-B', 'lane', 'aitool/main');
    s.write('tool-b', 'x\n');
    s.write('docs/reference/tools.md', 'tool-0\ntool-b\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'lane adds tool-b');
    s.run(s.checkout, 'push', '-q', '-f', 'aitool', 'lane:lane');
    s.head = s.run(s.checkout, 'rev-parse', 'HEAD');
    s.run(s.checkout, 'checkout', '-q', 'main');
    s.run(s.checkout, 'reset', '-q', '--hard', 'aitool/main');
    s.write('tool-a', 'x\n');
    s.write('docs/reference/tools.md', 'tool-0\ntool-a\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'main adds tool-a');
    s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
    s.run(s.checkout, 'fetch', '-q', 'aitool');
    s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
    const calls = [];
    const r = refreshBranch(opts(s, { run: fakeGen(s, calls) }));
    assert.ok(r?.head, JSON.stringify(r));
    assert.equal(calls.length, 1);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), r.head);
    assert.equal(
      s.run(s.checkout, 'show', `${r.head}:docs/reference/tools.md`),
      'tool-0\ntool-a\ntool-b'
    );
    assert.equal(s.run(s.checkout, 'log', '-1', '--format=%s', r.head), REFRESH_SUBJECT);
    assert.equal(s.run(s.checkout, 'status', '--porcelain'), '');
  } finally {
    s.cleanup();
  }
});

test('stale tool reference after a clean merge (tool guard drift) is regenerated into the merge commit', () => {
  const s = setup();
  try {
    s.write('tool-0', 'x\n');
    fs.mkdirSync(path.join(s.checkout, 'docs', 'reference'), { recursive: true });
    s.write('docs/reference/tools.md', 'tool-0\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'index');
    s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
    s.run(s.checkout, 'checkout', '-q', '-B', 'lane', 'aitool/main');
    s.write('tool-b', 'x\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'lane adds tool-b only');
    s.run(s.checkout, 'push', '-q', '-f', 'aitool', 'lane:lane');
    s.head = s.run(s.checkout, 'rev-parse', 'HEAD');
    s.run(s.checkout, 'checkout', '-q', 'main');
    s.run(s.checkout, 'reset', '-q', '--hard', 'aitool/main');
    s.write('tool-a', 'x\n');
    s.run(s.checkout, 'add', '-A');
    s.run(s.checkout, 'commit', '-q', '-m', 'main adds tool-a');
    s.run(s.checkout, 'push', '-q', 'aitool', 'HEAD:main');
    s.run(s.checkout, 'fetch', '-q', 'aitool');
    s.run(s.checkout, 'checkout', '-q', '--detach', s.head);
    const r = refreshBranch(opts(s, { reason: TOOL_DRIFT, run: fakeGen(s) }));
    assert.ok(r?.head, JSON.stringify(r));
    assert.equal(
      s.run(s.checkout, 'show', `${r.head}:docs/reference/tools.md`),
      'tool-0\ntool-a\ntool-b'
    );
    assert.equal(s.run(s.checkout, 'log', '-1', '--format=%s', r.head), REFRESH_SUBJECT);
    assert.equal(s.run(s.checkout, 'rev-list', '--parents', '-n1', r.head).split(' ').length, 3);
  } finally {
    s.cleanup();
  }
});

test('a failing docs:tools still refuses and pushes nothing', () => {
  const s = setup();
  try {
    moveMain(s, 'main.txt', 'main\n');
    // the generator dies after writing a new page: the untracked page must not stay in the checkout
    const bad = (cmd, args, o) => {
      if (!/docs:tools/.test([cmd, ...args].join(' '))) return opts(s).run(cmd, args, o);
      fs.mkdirSync(path.join(s.checkout, 'docs', 'reference', 'tools'), { recursive: true });
      fs.writeFileSync(path.join(s.checkout, 'docs', 'reference', 'tools', 'x.md'), 'half\n');
      return { status: 1, stdout: '', stderr: 'boom' };
    };
    const r = refreshBranch(opts(s, { reason: TOOL_DRIFT, run: bad }));
    assert.match(r?.why ?? '', /docs:tools failed/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
    assert.equal(s.run(s.checkout, 'status', '--porcelain'), '');
    assert.equal(s.run(s.checkout, 'rev-parse', 'HEAD'), s.head);
  } finally {
    s.cleanup();
  }
});

test('tool-reference drift that regeneration does not change is refused, nothing pushed', () => {
  const s = setup();
  try {
    moveMain(s, 'main.txt', 'main\n');
    const noop = (cmd, args, o) =>
      /docs:tools/.test([cmd, ...args].join(' '))
        ? { status: 0, stdout: '', stderr: '' }
        : opts(s).run(cmd, args, o);
    const r = refreshBranch(opts(s, { reason: TOOL_DRIFT, run: noop }));
    assert.match(r?.why ?? '', /changed nothing/);
    assert.equal(s.run(s.remote, 'rev-parse', 'refs/heads/lane'), s.head);
    assert.equal(s.run(s.checkout, 'rev-parse', 'HEAD'), s.head);
  } finally {
    s.cleanup();
  }
});

test('REFRESHABLE and reviewOf', () => {
  for (const t of [
    'pr: mergeable is CONFLICTING; merge main into the branch and resolve conflicts',
    'drift: drift-check failed (log x); last lines below',
    'wait-ci: #7 has merge conflicts, so CI will not run; merge main into the branch and resolve them',
  ])
    assert.match(t, REFRESHABLE);
  assert.match(TOOL_DRIFT, REFRESHABLE);
  for (const t of [
    'drift: drift-check failed (guards: mcp-server tests (some other test)) (log x); last lines below',
    'drift: drift-check failed (guards: mcp-server tests (tool counts, tool reference, tool sets), lint baseline) (log x); last lines below',
    'drift: drift-check failed (guards: mcp-server tests (tool counts, tool reference, tool sets)) [infrastructure, not the PR: vitest could not start a worker, also on a retry] (log x)',
    'drift: drift-check failed (guards: em-dash baseline) (log x); last lines below',
    'merge: gh pr merge exited 1: base branch policy prohibits the merge',
    'ci: failing: build-test',
    'review: no note names the head',
    'changelog: missing',
  ])
    assert.doesNotMatch(t, REFRESHABLE);
  assert.equal(
    reviewOf('PR #7 ready, head ' + 'a'.repeat(40) + ', review C:\\v\\n.md'),
    'C:\\v\\n.md'
  );
  assert.equal(reviewOf('PR #7 ready, head ' + 'a'.repeat(40)), '');
  assert.equal(reviewOf(undefined), '');
  // L1: the line of the named PR, not the last line.
  const two = `PR #7 ready, head ${'a'.repeat(40)}, review one.md\nPR #8 ready, head ${'b'.repeat(40)}, review two.md`;
  assert.equal(reviewOf(two, 7), 'one.md');
  assert.equal(reviewOf(two, 8), 'two.md');
});

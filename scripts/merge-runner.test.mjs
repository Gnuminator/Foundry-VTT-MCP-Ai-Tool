// Tests for scripts/merge-runner.mjs: fake gh, gate, backlog and Discord; real lock files and a
// real git checkout for prepareCheckout. No network, no vault, no merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE_FLAGS,
  TRAIN_FULL_LINE,
  gateArgs,
  gateOutcome,
  main,
  mainState,
  parseArgs,
  prepareCheckout,
  readyItems,
  round,
  takeRunnerLock,
} from './merge-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const GREEN = JSON.stringify([{ conclusion: 'success', headSha: 'c'.repeat(40) }]);
const RED = JSON.stringify([{ conclusion: 'failure', headSha: 'd'.repeat(40) }]);

/** A Backlog with the given progress lines, one item each. @param {[string, string][]} items */
const backlog = items =>
  [
    '---',
    'type: list',
    '---',
    '',
    '# Backlog',
    '',
    ...items.flatMap(([id, progress]) => [
      `## S Item ${id}`,
      '',
      `- id: ${id}`,
      `- progress: ${progress}`,
      '',
    ]),
  ].join('\n');

/**
 * Fake dependencies. `prs` maps a PR number to its gh pr view answer; `gates` maps a PR number to
 * the gate result (status and stdout).
 * `text` may be a function (read again before each PR); `afterGate` runs after each fake gate run.
 * @param {{ text: string | null | (() => string | null), prs?: Record<number, object>,
 *   gates?: Record<number, { status: number, stdout: string }>, main?: string,
 *   prepare?: string | null, afterGate?: (pr: number) => void }} o
 */
function fakes(o) {
  const calls = { gh: [], gate: [], backlog: [], post: [], log: [], prepare: [] };
  /** @type {import('./merge-runner.mjs').Deps} */
  const deps = {
    readBacklog: () => (typeof o.text === 'function' ? o.text() : o.text),
    gh: args => {
      calls.gh.push(args);
      if (args[0] === 'run') return { status: 0, stdout: o.main ?? GREEN, stderr: '' };
      const n = Number(args[2]);
      const pr = o.prs?.[n];
      return pr
        ? { status: 0, stdout: JSON.stringify(pr), stderr: '' }
        : { status: 1, stdout: '', stderr: 'no pr' };
    },
    prepare: r => {
      calls.prepare.push(r);
      return o.prepare ?? null;
    },
    gate: pr => {
      calls.gate.push(pr);
      const g = o.gates?.[pr] ?? { status: 1, stdout: 'lane:merge: refused because x' };
      o.afterGate?.(pr);
      return { status: g.status, stdout: g.stdout, stderr: '' };
    },
    backlog: args => {
      calls.backlog.push(args);
      return { status: 0, stdout: '', stderr: '' };
    },
    post: text => calls.post.push(text),
    log: line => calls.log.push(line),
  };
  return { deps, calls };
}

const open = (head = SHA) => ({ state: 'OPEN', headRefOid: head });
const merged = n => ({ status: 0, stdout: `lane:merge: merged #${n} at aaaaaaa; merge train 1/4` });

test('readyItems: only ready lines with a full sha, in Backlog order', () => {
  const text = backlog([
    ['one', `2026-11-12 PR #5 ready, head ${SHA}, review r.md`],
    ['two', '2026-11-12 PR #6 ready (move 1 of 3)'],
    ['three', `PR #7 ready, head ${SHA2}`],
  ]);
  assert.deepEqual(readyItems(text), [
    { id: 'one', pr: 5, head: SHA },
    { id: 'three', pr: 7, head: SHA2 },
  ]);
});

test('ready -> gate -> merged -> done; the gate is main copy with --wait-ci only, and the runner posts nothing on a merge', () => {
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs: { 5: open() },
    gates: { 5: merged(5) },
  });
  const r = round(f.deps, new Set());
  assert.deepEqual(r, { stop: null, merged: [5] });
  assert.deepEqual(f.calls.gate, [5]);
  assert.deepEqual(f.calls.prepare, [{ id: 'one', pr: 5, head: SHA }]);
  assert.deepEqual(f.calls.backlog, [['done', 'one', '5', '--sha', SHA, '--by', 'merge-runner']]);
  assert.deepEqual(f.calls.post, [], 'the gate posts the merge line itself');
});

test('a refusal writes the reason as a progress line and posts one line; it is not tried again', () => {
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs: { 5: open() },
    gates: {
      5: {
        status: 1,
        stdout: 'lane:merge: NOT merged #5\nlane:merge: refused because review: no note says Merge',
      },
    },
  });
  const tried = new Set();
  round(f.deps, tried);
  assert.deepEqual(f.calls.backlog, [
    [
      'progress',
      'one',
      'PR #5 refused by the merge gate: review: no note says Merge',
      '--if-ready',
      `5@${SHA}`,
    ],
  ]);
  assert.deepEqual(f.calls.post, ['merge runner: #5 not merged: review: no note says Merge']);
  // The refusal text does not read as merged (claim refuses items whose progress says merged).
  assert.doesNotMatch(f.calls.backlog[0][2], /\bmerged\b/i);
  round(f.deps, tried);
  assert.equal(f.calls.gate.length, 1, 'the same head is not gated twice in one run');
});

test('a failed CI check (exit 3) and a moved head under --wait-ci (exit 4) are refusals', () => {
  for (const [code, line] of [
    [3, 'lane:merge: wait-ci ended: exit 3, a CI check failed'],
    [4, 'lane:merge: wait-ci ended: exit 4, the PR head moved while waiting'],
  ]) {
    const f = fakes({
      text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
      prs: { 5: open() },
      gates: { 5: { status: code, stdout: line } },
    });
    round(f.deps, new Set());
    assert.equal(f.calls.backlog[0][0], 'progress');
    assert.match(f.calls.backlog[0][2], new RegExp(`exit ${code}`));
    assert.equal(f.calls.post.length, 1);
  }
});

test('train limit: one Discord line, the ready line stays, the runner stops', () => {
  const f = fakes({
    text: backlog([
      ['one', `PR #5 ready, head ${SHA}`],
      ['two', `PR #6 ready, head ${SHA2}`],
    ]),
    prs: { 5: open(), 6: open(SHA2) },
    gates: {
      5: {
        status: 1,
        stdout:
          'lane:merge: refused because train: merge train full (4/4): the planner runs npm run live:roundtrip on main',
      },
    },
  });
  const r = round(f.deps, new Set());
  assert.equal(r.stop, 'merge train full');
  assert.deepEqual(f.calls.gate, [5], 'nothing after the full train');
  assert.deepEqual(f.calls.backlog, [], 'the ready line stays for the next start');
  assert.equal(f.calls.post.length, 1);
  assert.ok(f.calls.post[0].startsWith(TRAIN_FULL_LINE));
});

test('main red: one line, no gate, no Backlog write, the runner stops', () => {
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs: { 5: open() },
    main: RED,
  });
  const r = round(f.deps, new Set());
  assert.match(r.stop ?? '', /main is red at ddddddd/);
  assert.deepEqual(f.calls.gate, []);
  assert.deepEqual(f.calls.backlog, []);
  assert.equal(f.calls.post.length, 1);
  assert.match(f.calls.post[0], /^merge runner stopped: main is red/);
});

test('main red is read before each PR: a merge that turns main red stops the next one', () => {
  const f = fakes({
    text: backlog([
      ['one', `PR #5 ready, head ${SHA}`],
      ['two', `PR #6 ready, head ${SHA2}`],
    ]),
    prs: { 5: open(), 6: open(SHA2) },
    gates: { 5: merged(5), 6: merged(6) },
  });
  let runs = 0;
  const gh = f.deps.gh;
  f.deps.gh = args =>
    args[0] === 'run' && ++runs > 1 ? { status: 0, stdout: RED, stderr: '' } : gh(args);
  const r = round(f.deps, new Set());
  assert.deepEqual(r.merged, [5]);
  assert.match(r.stop ?? '', /main is red/);
  assert.deepEqual(f.calls.gate, [5]);
});

test('mainState: cancelled runs are passed over; unreadable or no run counts as red', () => {
  const runs = [
    { conclusion: 'cancelled', headSha: 'e'.repeat(40) },
    { conclusion: 'success', headSha: 'f'.repeat(40) },
  ];
  assert.equal(mainState(JSON.stringify(runs)).red, false);
  assert.equal(mainState('[]').red, true);
  assert.equal(mainState('nope').red, true);
  assert.equal(mainState(JSON.stringify([{ conclusion: 'timed_out', headSha: SHA }])).red, true);
});

test('a head moved since the ready line is refused without running the gate', () => {
  const f = fakes({ text: backlog([['one', `PR #5 ready, head ${SHA}`]]), prs: { 5: open(SHA2) } });
  round(f.deps, new Set());
  assert.deepEqual(f.calls.gate, []);
  assert.deepEqual(f.calls.prepare, []);
  assert.match(f.calls.backlog[0][2], /head moved from aaaaaaa to bbbbbbb/);
});

test('an already merged PR is marked done; a closed one is a refusal; neither runs the gate', () => {
  const f = fakes({
    text: backlog([
      ['one', `PR #5 ready, head ${SHA}`],
      ['two', `PR #6 ready, head ${SHA2}`],
    ]),
    prs: { 5: { state: 'MERGED', headRefOid: SHA }, 6: { state: 'CLOSED', headRefOid: SHA2 } },
  });
  round(f.deps, new Set());
  assert.deepEqual(f.calls.gate, []);
  assert.deepEqual(f.calls.backlog[0], ['done', 'one', '5', '--sha', SHA, '--by', 'merge-runner']);
  assert.deepEqual(f.calls.backlog[1], [
    'progress',
    'two',
    'PR #6 refused by the merge gate: PR #6 is closed',
    '--if-ready',
    `6@${SHA2}`,
  ]);
});

test('a line rewritten while an earlier gate ran is read again: no gate and no refusal on the old head', () => {
  const SHA3 = 'c'.repeat(40);
  let second = `PR #6 ready, head ${SHA2}`;
  const f = fakes({
    text: () =>
      backlog([
        ['one', `PR #5 ready, head ${SHA}`],
        ['two', second],
      ]),
    prs: { 5: open(), 6: open(SHA3) },
    gates: { 5: merged(5) },
    // Lane two pushes a fix and writes a new ready line while #5 is being gated.
    afterGate: () => void (second = `PR #6 ready, head ${SHA3}`),
  });
  const r = round(f.deps, new Set());
  assert.deepEqual(r.merged, [5]);
  assert.deepEqual(f.calls.gate, [5], 'the new line waits for the next round');
  assert.deepEqual(f.calls.backlog, [['done', 'one', '5', '--sha', SHA, '--by', 'merge-runner']]);
  assert.deepEqual(f.calls.post, []);
  // Next round: the new head is gated.
  round(f.deps, new Set(['5@' + SHA]));
  assert.deepEqual(f.calls.gate, [5, 6]);
});

test('a gate run that ends without its merged line but the PR is merged on GitHub: done, not refused', () => {
  const prs = { 5: open() };
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs,
    gates: { 5: { status: 1, stdout: 'lane:merge: refused because unexpected error: killed' } },
    afterGate: () => void (prs[5] = { state: 'MERGED', headRefOid: SHA }),
  });
  const r = round(f.deps, new Set());
  assert.deepEqual(r.merged, [5]);
  assert.deepEqual(f.calls.backlog, [['done', 'one', '5', '--sha', SHA, '--by', 'merge-runner']]);
  assert.deepEqual(f.calls.post, []);
});

test('CI still running after the wait (exit 5): no write, tried again next round', () => {
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs: { 5: open() },
    gates: {
      5: { status: 5, stdout: 'lane:merge: wait-ci ended: exit 5, timed out waiting for CI' },
    },
  });
  const tried = new Set();
  round(f.deps, tried);
  round(f.deps, tried);
  assert.deepEqual(f.calls.gate, [5, 5]);
  assert.deepEqual(f.calls.backlog, []);
  assert.deepEqual(f.calls.post, []);
});

test('a gate checkout problem stops the runner without touching the item', () => {
  const f = fakes({
    text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
    prs: { 5: open() },
    prepare: 'x is not clean',
  });
  const r = round(f.deps, new Set());
  assert.match(r.stop ?? '', /not clean/);
  assert.deepEqual(f.calls.gate, []);
  assert.deepEqual(f.calls.backlog, []);
  assert.equal(f.calls.post.length, 1);
});

test('no ready line: nothing is asked of GitHub', () => {
  const f = fakes({ text: backlog([['one', 'PR #5 draft']]) });
  assert.deepEqual(round(f.deps, new Set()), { stop: null, merged: [] });
  assert.deepEqual(f.calls.gh, []);
  const g = fakes({ text: null });
  assert.deepEqual(round(g.deps, new Set()), { stop: null, merged: [] });
});

test('gateOutcome reads the merged line, the refusal line and the wait verdict', () => {
  assert.equal(gateOutcome(0, 'lane:merge: merged #5 at abc; merge train 1/4', 5).kind, 'merged');
  assert.equal(
    gateOutcome(0, 'lane:merge: merged #55 at abc', 5).kind,
    'refused',
    'another PR number'
  );
  assert.equal(
    gateOutcome(0, 'lane:merge: OK #5 at abc (dry run, nothing merged)', 5).kind,
    'refused'
  );
  assert.deepEqual(
    gateOutcome(
      1,
      'lane:merge: refused because (1) a (2) b\nlane:merge: wait-ci ended: exit 1, refused',
      5
    ),
    {
      kind: 'refused',
      reason: '(1) a (2) b',
    }
  );
  assert.equal(
    gateOutcome(5, 'lane:merge: wait-ci ended: exit 5, timed out waiting for CI', 5).kind,
    'wait'
  );
  assert.match(gateOutcome(9, '', 5).reason, /exit 9 and no reason line/);
});

test('the gate never gets a dry-run, force, skip, no-changelog or train flag; nothing runs live:roundtrip', () => {
  const args = gateArgs(5, 'V');
  assert.deepEqual(args, ['5', '--wait-ci', '--vault', 'V']);
  assert.deepEqual(GATE_FLAGS, ['--wait-ci']);
  const src = fs.readFileSync(path.join(here, 'merge-runner.mjs'), 'utf8');
  // Code only: the header comment names what it never does, and the Discord line asks a session for
  // the roundtrip (that one string is the only place it may appear).
  const code = src
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(`'${TRAIN_FULL_LINE}'`, '');
  for (const bad of [
    '--dry-run',
    '--force',
    '--no-changelog',
    '--train-reset',
    '--skip',
    '--admin',
    'live:roundtrip',
  ]) {
    assert.ok(!code.includes(bad), `merge-runner.mjs code names ${bad}`);
  }
});

test('lock: a second runner exits 1 while the first holds it; a dead holder is taken over', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-runner-lock-'));
  try {
    const file = path.join(dir, 'merge-runner.lock');
    // The holder is another live process (this test's parent), as a second runner would see it.
    const first = takeRunnerLock(file, process.ppid);
    assert.equal(first.ok, true);
    const f = fakes({ text: null });
    const code = await main(['--once'], { deps: f.deps, lockFile: file, isRunner: () => true });
    assert.equal(code, 1);
    assert.match(f.calls.log[0], /another merge runner runs \(pid \d+/);
    assert.match(f.calls.post[0], /^merge runner not started: another merge runner runs/);
    // A live pid that is not a merge runner (Windows reuses pids after a logoff) is taken over.
    const g0 = fakes({ text: null });
    assert.equal(
      await main(['--once'], { deps: g0.deps, lockFile: file, isRunner: () => false }),
      0
    );
    assert.equal(fs.existsSync(file), false);
    if (first.ok) first.release();
    // A pid that is gone: start a child, let it end, write its pid.
    const child = spawn(process.execPath, ['-e', '0']);
    await new Promise(res => child.on('exit', res));
    fs.writeFileSync(file, `${child.pid}\n`);
    const g = fakes({ text: null });
    assert.equal(await main(['--once'], { deps: g.deps, lockFile: file }), 0);
    assert.equal(fs.existsSync(file), false, 'released on exit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main: loops until a round stops, then exits 3 and releases the lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-runner-loop-'));
  try {
    const file = path.join(dir, 'merge-runner.lock');
    const f = fakes({
      text: backlog([['one', `PR #5 ready, head ${SHA}`]]),
      prs: { 5: open() },
      main: RED,
    });
    let slept = 0;
    const code = await main([], { deps: f.deps, lockFile: file, sleep: async () => void slept++ });
    assert.equal(code, 3);
    assert.equal(slept, 0);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArgs: the gate checkout defaults to the sibling -gate folder of the main checkout', () => {
  const o = parseArgs([]);
  assert.match(o.checkout, /-gate$/);
  assert.doesNotMatch(o.checkout, /[\\/]\.claude[\\/]worktrees[\\/]/);
  assert.equal(parseArgs(['--once', '--interval', '30']).interval, 30);
  assert.throws(() => parseArgs(['--interval', '1']), /at least 10/);
  assert.throws(() => parseArgs(['--force']), /unknown argument/);
});

test('prepareCheckout: refuses a folder that is not its own top level, and a dirty one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-runner-co-'));
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git(root, ['init', '-q']);
    const sub = path.join(root, 'empty-worktree');
    fs.mkdirSync(sub);
    assert.match(prepareCheckout(sub, { pr: 1, head: SHA }) ?? '', /not its own git checkout/);
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
    assert.match(prepareCheckout(root, { pr: 1, head: SHA }) ?? '', /not clean/);
    assert.match(
      prepareCheckout(path.join(root, 'missing'), { pr: 1, head: SHA }) ?? '',
      /does not exist/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

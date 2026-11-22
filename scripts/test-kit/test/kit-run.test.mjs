// The kit run command (kit-run.mjs): lock, environment, kit, record, release, with every outside
// effect faked. Nothing here touches the test server, the lock file or the vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_ROWS,
  NOTE,
  kitRun,
  noteRow,
  parseArgs,
  ranToday,
  resultText,
  staleKitLock,
  updateNote,
  writeLastRun,
  writeVaultNote,
} from '../kit-run.mjs';

const UP = { foundry: true, bridge: true, dashboard: true, world: 'ai-tool-kit-srd' };
const DOWN = { foundry: false, bridge: false, dashboard: false, world: null };

function report({ failed = [] } = {}) {
  const ids = ['bridge-health', 'scripted-fight', ...failed];
  return {
    summary: { passed: 2, failed: failed.length, skipped: 0, total: ids.length },
    consoleGroups: [],
    consoleErrors: [],
    scenarios: ids.map(id => ({ id, status: failed.includes(id) ? 'fail' : 'pass' })),
  };
}

/** A fake runner: answers by script name, records every call as "<script> <first arg>". */
function fakeRun(answers = {}) {
  const calls = [];
  const run = async (file, args) => {
    const script = args.find(a => /\.(ps1|mjs)$/.test(a));
    const name = script ? path.basename(script) : file;
    const after = script ? args[args.indexOf(script) + 1] : args[0];
    const key = `${name} ${after ?? ''}`.trim();
    calls.push(key);
    if (name === 'git')
      return { code: 0, stdout: after === 'rev-parse' ? 'abc1234\n' : 'main\n', stderr: '' };
    const a = answers[key] ?? answers[name];
    const res = typeof a === 'function' ? a(args) : a;
    return { code: 0, stdout: '', stderr: '', ...res };
  };
  return { run, calls };
}

function setup(answers, { states = [DOWN, UP], opts = {}, deps: extra = {} } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'kit-run-'));
  const fake = fakeRun({
    'kit.mjs all': args => {
      const dir = args[args.indexOf('--report-dir') + 1];
      writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report()));
      return { code: 0 };
    },
    ...answers,
  });
  const vault = [];
  const queue = [...states];
  let clock = new Date('2026-10-09T01:30:00Z').getTime();
  const deps = {
    run: fake.run,
    home,
    state: async () => queue.shift() ?? UP,
    sleep: async ms => {
      clock += ms;
    },
    now: () => new Date(clock),
    log: () => {},
    writeVault: async r => {
      vault.push(r);
      return { state: 'pushed', detail: 'pushed 1 file' };
    },
    signals: new EventEmitter(),
    exit: () => {},
    ...extra,
  };
  const o = { ...parseArgs([]), ...opts };
  return {
    home,
    fake,
    vault,
    deps,
    o,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

const lastRun = home => JSON.parse(readFileSync(path.join(home, 'last-run.json'), 'utf8'));

test('parseArgs: on-demand defaults and the nightly preset', () => {
  const d = parseArgs([]);
  assert.equal(d.size, 'smoke');
  assert.equal(d.wait, 0);
  assert.equal(d.profile, 'srd');
  const n = parseArgs(['--nightly']);
  assert.equal(n.size, 'full');
  assert.equal(n.wait, 120);
  assert.equal(parseArgs(['--nightly', '--size', 'smoke', '--wait', '5']).size, 'smoke');
  assert.throws(() => parseArgs(['--size', 'huge']), /smoke, full or long/);
  assert.throws(() => parseArgs(['--wait', '-1']), /minutes/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
});

test('--daily is a nightly run that does nothing when a run finished today', async () => {
  const d = parseArgs(['--daily']);
  assert.equal(d.nightly, true);
  assert.equal(d.size, 'full');
  const t = setup({}, { opts: d });
  try {
    // first logon of the day: runs and records
    const first = await kitRun(t.o, t.deps);
    assert.equal(first.code, 0);
    const calls = t.fake.calls.length;
    // a second logon the same day: nothing happens, nothing is recorded
    const again = await kitRun(t.o, t.deps);
    assert.equal(again.code, 0);
    assert.equal(again.result.state, 'already');
    assert.equal(t.fake.calls.length, calls);
    // the next day it runs again
    const next = new Date(t.deps.now().getTime() + 24 * 3600000);
    await kitRun(t.o, { ...t.deps, now: () => next, state: async () => UP });
    assert.ok(t.fake.calls.length > calls);
  } finally {
    t.cleanup();
  }
});

test('ranToday: only a finished full nightly run on the same local day counts', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ran-today-'));
  const day = new Date(2026, 10, 18, 15, 0, 0);
  const write = lastRun =>
    writeFileSync(path.join(home, 'last-run.json'), JSON.stringify({ lastRun }));
  try {
    assert.equal(ranToday(home, day), false, 'no file');
    writeFileSync(path.join(home, 'last-run.json'), '{bad');
    assert.equal(ranToday(home, day), false, 'unreadable');
    const at = new Date(2026, 10, 18, 1, 0, 0).toISOString();
    const yesterday = new Date(2026, 10, 17, 23, 0, 0).toISOString();
    const rows = [
      [{ nightly: true, size: 'full', finishedAt: at }, true],
      [{ nightly: true, size: 'full', at }, true],
      [{ nightly: true, size: 'full', finishedAt: yesterday }, false],
      [{ nightly: false, size: 'full', finishedAt: at }, false],
      [{ nightly: true, size: 'smoke', finishedAt: at }, false],
      [{ nightly: true, size: 'full' }, false],
    ];
    for (const [run, want] of rows) {
      write(run);
      assert.equal(ranToday(home, day), want, JSON.stringify(run));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('--daily: a hand-run smoke run today does not count as the daily run', async () => {
  const t = setup({}, { opts: parseArgs(['--daily']) });
  try {
    writeFileSync(
      path.join(t.home, 'last-run.json'),
      JSON.stringify({
        version: 1,
        last: {},
        lastRun: { at: t.deps.now().toISOString(), state: 'passed', size: 'smoke', nightly: false },
      })
    );
    const r = await kitRun(t.o, t.deps);
    assert.notEqual(r.result.state, 'already');
  } finally {
    t.cleanup();
  }
});

test('--daily: a skipped night does not count as a run, so the next logon tries again', async () => {
  const t = setup({}, { opts: parseArgs(['--daily']) });
  try {
    writeFileSync(
      path.join(t.home, 'last-run.json'),
      JSON.stringify({
        version: 1,
        last: { at: t.deps.now().toISOString(), state: 'skipped' },
        lastRun: null,
      })
    );
    const r = await kitRun(t.o, t.deps);
    assert.notEqual(r.result.state, 'already');
  } finally {
    t.cleanup();
  }
});

test('parseArgs: kit runs go to test server B unless --server says otherwise', () => {
  assert.equal(parseArgs([]).server, 'B');
  assert.equal(parseArgs(['--server', 'a']).server, 'A');
  assert.throws(() => parseArgs(['--server', 'D']), /--server must be one of A, B/);
});

test('every test-env script gets -Server and every child FOUNDRY_TEST_SERVER', async () => {
  const seen = [];
  const t = setup();
  const inner = t.deps.run;
  t.deps.run = async (file, args, opts = {}) => {
    seen.push({ file, args, env: opts.env });
    return inner(file, args, opts);
  };
  try {
    const { code, result } = await kitRun({ ...t.o, server: 'A' }, t.deps);
    assert.equal(code, 0);
    assert.equal(result.server, 'A');
    assert.match(noteRow(result), / on A \|/);
    for (const call of seen) {
      assert.equal(call.env?.FOUNDRY_TEST_SERVER, 'A', `${call.file} ${call.args.join(' ')}`);
      if (call.args.some(a => /\.ps1$/.test(a))) {
        assert.equal(call.args[call.args.indexOf('-Server') + 1], 'A', call.args.join(' '));
      }
    }
    assert.ok(seen.some(c => c.args.some(a => /kit\.mjs$/.test(a))));
  } finally {
    t.cleanup();
  }
});

test('a passing run: lock, build, fresh environment, kit, stop, release, then the record', async () => {
  const t = setup();
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 0);
    assert.deepEqual(t.fake.calls, [
      'git rev-parse',
      'git branch',
      'lock.ps1 take',
      'npm run',
      'sync-module.ps1 -NoBuild',
      'stop.ps1 -Server',
      'start.ps1 -World',
      'kit.mjs all',
      'stop.ps1 -Server',
      'lock.ps1 release',
    ]);
    assert.equal(result.state, 'passed');
    assert.equal(result.world, 'ai-tool-kit-srd');
    assert.equal(resultText(result), 'passed: 2 of 2');
    const doc = lastRun(t.home);
    assert.equal(doc.last.state, 'passed');
    assert.equal(doc.lastRun.text, 'passed: 2 of 2');
    assert.equal(t.vault.length, 1);
  } finally {
    t.cleanup();
  }
});

test('failing scenarios: exit 1, the ids are recorded', async () => {
  const t = setup({
    'kit.mjs all': args => {
      const dir = args[args.indexOf('--report-dir') + 1];
      writeFileSync(
        path.join(dir, 'report.json'),
        JSON.stringify(report({ failed: ['spells-deep'] }))
      );
      return { code: 1 };
    },
  });
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 1);
    assert.deepEqual(result.failing, ['spells-deep']);
    assert.match(resultText(result), /^FAILED: 1 of 3 failed, 2 passed/);
  } finally {
    t.cleanup();
  }
});

test('lock taken, on demand: exit 3, nothing touched, nothing recorded', async () => {
  const t = setup({
    'lock.ps1 take': { code: 1, stderr: 'Test server lock is held by lane X.\n' },
  });
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 3);
    assert.equal(result.detail, 'Test server lock is held by lane X.');
    assert.deepEqual(t.fake.calls, ['git rev-parse', 'git branch', 'lock.ps1 take']);
    assert.throws(() => lastRun(t.home));
    assert.equal(t.vault.length, 0);
  } finally {
    t.cleanup();
  }
});

test('lock taken, nightly: queues, waits, leaves the queue, records the skip, keeps the last result', async () => {
  const t = setup(
    { 'lock.ps1 take': { code: 1, stderr: 'Test server lock is held by lane X.' } },
    { opts: { nightly: true, wait: 3, size: 'full' } }
  );
  try {
    writeLastRun(t.home, { state: 'passed', passed: 1, total: 1, at: 'x' });
    const { code } = await kitRun(t.o, t.deps);
    assert.equal(code, 3);
    const takes = t.fake.calls.filter(c => c === 'lock.ps1 take').length;
    assert.ok(takes >= 2, `took ${takes} times`);
    assert.equal(t.fake.calls.filter(c => c === 'lock.ps1 queue').length, 1);
    assert.equal(t.fake.calls.at(-1), 'lock.ps1 leave');
    const doc = lastRun(t.home);
    assert.equal(doc.last.state, 'skipped');
    assert.equal(doc.lastRun.state, 'passed');
    // The skipped nightly is the last nightly; the earlier lane-style run is not one.
    assert.equal(doc.lastNightly.state, 'skipped');
    writeLastRun(t.home, { state: 'passed', passed: 2, total: 2, at: 'y' });
    const after = lastRun(t.home);
    assert.equal(after.last.state, 'passed');
    assert.equal(after.lastNightly.state, 'skipped');
    assert.equal(after.lastNightlyRun, null);
    assert.equal(t.vault[0].state, 'skipped');
  } finally {
    t.cleanup();
  }
});

test('a lock the caller already holds is kept afterwards', async () => {
  const t = setup({
    'lock.ps1 take': { code: 0, stdout: 'You already hold the lock (since x); purpose updated.' },
  });
  try {
    await kitRun({ ...t.o, session: 'local_me' }, t.deps);
    assert.ok(!t.fake.calls.includes('lock.ps1 release'));
  } finally {
    t.cleanup();
  }
});

test('environment not ready: exit 2, the environment is stopped and the lock released', async () => {
  const t = setup({}, { states: [DOWN, { ...UP, world: 'ai-tool-test' }] });
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 2);
    assert.match(result.detail, /runs world ai-tool-test, not ai-tool-kit-srd/);
    assert.ok(!t.fake.calls.includes('kit.mjs all'));
    assert.deepEqual(t.fake.calls.slice(-2), ['stop.ps1 -Server', 'lock.ps1 release']);
  } finally {
    t.cleanup();
  }
});

test('a failed build stops before the environment; --keep-up and --no-build skip their steps', async () => {
  const t = setup({ npm: { code: 1, stderr: 'tsc: error\n' } });
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 1);
    assert.match(result.detail, /npm run build failed: tsc: error/);
    assert.ok(!t.fake.calls.includes('start.ps1 -World'));
    assert.equal(t.fake.calls.at(-1), 'lock.ps1 release');
  } finally {
    t.cleanup();
  }
  const k = setup();
  try {
    await kitRun({ ...k.o, keepUp: true, build: false }, k.deps);
    assert.ok(!k.fake.calls.includes('npm run'));
    assert.equal(k.fake.calls.filter(c => c === 'stop.ps1 -Server').length, 1);
  } finally {
    k.cleanup();
  }
});

test('a signal during the build: the step stops, no environment change, the lock is released', async () => {
  const signals = new EventEmitter();
  const t = setup(
    {
      npm: () => {
        signals.emit('SIGTERM', 'SIGTERM');
        return { code: 1, stderr: 'killed' };
      },
    },
    { deps: { signals } }
  );
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 1);
    assert.equal(result.state, 'error');
    assert.equal(result.detail, 'interrupted');
    assert.deepEqual(t.fake.calls.slice(2), ['lock.ps1 take', 'npm run', 'lock.ps1 release']);
    assert.equal(lastRun(t.home).last.detail, 'interrupted');
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  } finally {
    t.cleanup();
  }
});

test('Ctrl+C while waiting for the lock: leaves the queue at once; a second one exits', async () => {
  const signals = new EventEmitter();
  const exits = [];
  let naps = 0;
  const t = setup(
    { 'lock.ps1 take': { code: 1, stderr: 'Test server lock is held by lane X.' } },
    {
      opts: { wait: 120 },
      deps: {
        signals,
        exit: c => exits.push(c),
        sleep: async () => {
          naps += 1;
          signals.emit('SIGINT', 'SIGINT');
          signals.emit('SIGINT', 'SIGINT');
        },
      },
    }
  );
  try {
    const { code, result } = await kitRun(t.o, t.deps);
    assert.equal(code, 3);
    assert.equal(naps, 1);
    assert.equal(result.detail, 'interrupted while waiting for the lock');
    assert.deepEqual(t.fake.calls.slice(2), ['lock.ps1 take', 'lock.ps1 queue', 'lock.ps1 leave']);
    assert.deepEqual(exits, [130]);
  } finally {
    t.cleanup();
  }
});

test('nightly: a stale lock of an earlier kit run is taken over; a fresh one or a lane is not', async () => {
  const held = (session, min) =>
    `Test server lock is held by kit run (session ${session}) since 2026-10-08T01:30:00Z (${min} min ago) for kit run.`;
  assert.equal(staleKitLock(held('kit-run-20261008-033000', 500), 420), true);
  assert.equal(staleKitLock(held('kit-run-20261008-033000', 300), 420), false);
  assert.equal(staleKitLock(held('local_abc', 900), 420), false);
  assert.equal(staleKitLock(held('kit-run-20261008-033000', 900), null), false);

  const stale = {
    'lock.ps1 take': args =>
      args.includes('-Force')
        ? { code: 0, stdout: 'Took the lock over from kit run.\nLock taken by kit run.' }
        : { code: 1, stderr: held('kit-run-20261008-033000', 500) },
  };
  const n = setup(stale, { opts: { nightly: true, wait: 120, size: 'full' } });
  try {
    const { code } = await kitRun(n.o, n.deps);
    assert.equal(code, 0);
    assert.deepEqual(n.fake.calls.slice(2, 4), ['lock.ps1 take', 'lock.ps1 take']);
    assert.equal(n.fake.calls.at(-1), 'lock.ps1 release');
  } finally {
    n.cleanup();
  }
  const d = setup(stale);
  try {
    assert.equal((await kitRun(d.o, d.deps)).code, 3);
    assert.equal(d.fake.calls.filter(c => c === 'lock.ps1 take').length, 1);
  } finally {
    d.cleanup();
  }
});

test('an unknown profile stops before the lock', async () => {
  const t = setup();
  try {
    await assert.rejects(kitRun({ ...t.o, profile: 'no-such-profile' }, t.deps));
    assert.deepEqual(t.fake.calls, []);
  } finally {
    t.cleanup();
  }
});

test('the note: new rows on top, at most MAX_ROWS, pipes cannot break the table', () => {
  const r = {
    at: '2026-10-09T01:30:00Z',
    pc: 'PC1',
    size: 'full',
    profile: 'srd',
    nightly: true,
    git: 'abc1234',
    branch: 'main',
    state: 'env',
    detail: 'a | b',
    reportDir: 'C:\\FoundryTest\\test-kit\\reports\\x',
  };
  const row = noteRow(r);
  assert.equal(row.split(' | ').length, 7);
  assert.match(row, /environment not ready: a \/ b/);
  let note = updateNote('', row);
  assert.match(note, /^---\ntype: log/);
  for (let i = 0; i < MAX_ROWS + 5; i += 1)
    note = updateNote(note, noteRow({ ...r, pc: `PC${i}` }));
  const rows = note
    .split('\n')
    .filter(l => l.startsWith('| ') && !l.startsWith('| When') && !l.startsWith('| ---'));
  assert.equal(rows.length, MAX_ROWS);
  assert.match(rows[0], /PC44/);
});

test('writeVaultNote commits and pushes only the note through the vault wrapper', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-run-vault-'));
  try {
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const remote = path.join(root, 'remote.git');
    const vault = path.join(root, 'vault');
    git(root, 'init', '--bare', '-q', remote);
    git(root, 'clone', '-q', remote, vault);
    git(vault, 'config', 'user.email', 'test@example.com');
    git(vault, 'config', 'user.name', 'test');
    writeFileSync(path.join(vault, 'other.md'), 'x\n');
    git(vault, 'add', 'other.md');
    git(vault, 'commit', '-q', '-m', 'init');
    git(vault, 'push', '-q', '-u', 'origin', 'HEAD');
    const r = {
      at: '2026-10-09T01:30:00Z',
      pc: 'PC1',
      size: 'smoke',
      profile: 'srd',
      git: 'abc',
      state: 'passed',
      passed: 1,
      total: 1,
    };
    const res = await writeVaultNote(r, { dir: vault });
    assert.equal(res.state, 'pushed', res.detail);
    const text = readFileSync(path.join(vault, ...NOTE.split('/')), 'utf8');
    assert.match(text, /\| PC1 \| smoke srd \| abc \| passed: 1 of 1 \|/);
    assert.match(
      git(vault, 'log', '-1', '--name-only', '--format=%s'),
      /Test kit run smoke srd on PC1: passed\n+Dev\/Foundry AI Tool\/Test kit runs\.md/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

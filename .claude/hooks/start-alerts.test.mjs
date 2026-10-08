// Tests for the SessionStart alerts hook (start-alerts.mjs): silent on a clean start, one line per
// forced alert, at most nine lines, and nothing printed when the hook itself fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claudeMdAlert,
  collectAlerts,
  foundryPart,
  formatOutput,
  lanesAlert,
  lockAlert,
  mainCheckout,
  readLockFile,
  watchdogAlert,
} from './start-alerts.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'start-alerts.mjs');
const NOW = new Date('2026-10-08T20:00:00Z');
const DOC = '# Foundry AI Tool\n\nRules.\n';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'start-alerts-'));
  const repo = path.join(root, 'repo');
  const vault = path.join(root, 'vault');
  const testEnv = path.join(root, 'test');
  mkdirSync(path.join(vault, 'Dev', 'Foundry AI Tool', 'repo-docs'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  mkdirSync(testEnv, { recursive: true });
  writeFileSync(path.join(repo, 'CLAUDE.md'), DOC);
  writeFileSync(path.join(vault, 'Dev', 'Foundry AI Tool', 'repo-docs', 'CLAUDE.md'), DOC);
  return {
    root,
    repo,
    vault,
    testEnv,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function lane(title, context, extra = {}) {
  return { sessionId: `id-${title}`, title, closed: false, state: 'busy', context, ...extra };
}

function snapshot({ rows = [], watchdog = { state: 'ok', items: [] } } = {}) {
  return {
    version: 3,
    projects: [
      { pack: null, lanes: { rows: [lane('other project', 400_000)] }, panels: {} },
      { pack: 'foundry', lanes: { rows }, panels: { watchdog } },
    ],
  };
}

const answer = snap => async () => ({ ok: true, json: async () => snap });
const refused = async () => {
  throw new Error('ECONNREFUSED');
};

function opts(f, extra = {}) {
  return {
    repoRoot: f.repo,
    vaultDir: f.vault,
    testEnvRoot: f.testEnv,
    snapshotUrl: 'http://127.0.0.1:3200/snapshot.json',
    snapshotFile: path.join(f.root, 'snapshot.json'),
    ccDir: path.join(f.root, 'no-control-center'),
    now: NOW,
    fetchImpl: answer(snapshot()),
    ...extra,
  };
}

test('a clean start is silent', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await collectAlerts(opts(f)), []);
    assert.equal(formatOutput([]), '');
  } finally {
    f.cleanup();
  }
});

test('CLAUDE.md: line endings and trailing space do not count, a real change does', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.repo, 'CLAUDE.md'), `\uFEFF${DOC.replace(/\n/g, '\r\n')}  \n`);
    assert.equal(claudeMdAlert({ repoRoot: f.repo, vaultDir: f.vault }), null);
    const master = path.join(f.vault, 'Dev', 'Foundry AI Tool', 'repo-docs', 'CLAUDE.md');
    writeFileSync(master, `${DOC}New status.\n`);
    utimesSync(path.join(f.repo, 'CLAUDE.md'), new Date('2026-10-01'), new Date('2026-10-01'));
    const line = claudeMdAlert({ repoRoot: f.repo, vaultDir: f.vault });
    assert.match(line, /differs from the vault master \(newer: the vault master\)/);
    rmSync(path.join(f.repo, 'CLAUDE.md'));
    assert.match(claudeMdAlert({ repoRoot: f.repo, vaultDir: f.vault }), /missing/);
    // No vault on this PC: nothing to compare, no alert.
    assert.equal(claudeMdAlert({ repoRoot: f.repo, vaultDir: path.join(f.root, 'none') }), null);
  } finally {
    f.cleanup();
  }
});

test('lock: free is silent; held, old, unreadable and a waiting queue alert', () => {
  const f = fixture();
  try {
    const file = path.join(f.testEnv, 'lock.json');
    assert.equal(lockAlert(readLockFile(f.testEnv), NOW), null); // no lock.json yet
    writeFileSync(file, JSON.stringify({ holder: null, session: null, queue: [] }));
    assert.equal(lockAlert(readLockFile(f.testEnv), NOW), null);

    writeFileSync(
      file,
      JSON.stringify({
        holder: 'Foundry AI Tool test kit 12',
        session: 'local_abc',
        since: '2026-10-08T19:35:00Z',
        purpose: 'live dashboard-write-flows',
        queue: [{ holder: 'module sync', session: 'local_def', since: '2026-10-08T19:50:00Z' }],
      })
    );
    assert.equal(
      lockAlert(readLockFile(f.testEnv), NOW),
      'Test server lock: held by Foundry AI Tool test kit 12 (25 min, "live dashboard-write-flows"); 1 queued (next: module sync).'
    );

    writeFileSync(file, JSON.stringify({ holder: 'kit run', since: '2026-10-08T14:00:00Z' }));
    assert.match(
      lockAlert(readLockFile(f.testEnv), NOW),
      /\(6 h\) \(over 4 h: maybe a crashed session\)/
    );

    writeFileSync(file, '{ not json');
    assert.match(lockAlert(readLockFile(f.testEnv), NOW), /cannot be read/);

    writeFileSync(file, JSON.stringify({ holder: null, queue: [{ holder: 'kit run' }] }));
    assert.match(lockAlert(readLockFile(f.testEnv), NOW), /free, but 1 queued \(next: kit run\)/);
  } finally {
    f.cleanup();
  }
});

test('lanes: only this project, not CLOSED, not stale, 200k and up; 250k says hand over', () => {
  const rows = [
    lane('Foundry AI Tool small', 120_000),
    lane('Foundry AI Tool closed', 300_000, { closed: true }),
    lane('Foundry AI Tool stale', 300_000, { state: 'stale' }),
    lane('Foundry AI Tool amber', 210_000, { state: 'waiting' }),
  ];
  const part = foundryPart(snapshot({ rows }));
  assert.equal(lanesAlert(part.lanes), 'Lanes over 200k context: Foundry AI Tool amber 210k.');
  rows.push(lane('Foundry AI Tool red', 260_000));
  assert.match(
    lanesAlert(part.lanes),
    /red 260k, Foundry AI Tool amber 210k \(250k or more: hand over now\)/
  );
  // The old in-repo dashboard snapshot (version 2) has the lanes at the top level.
  assert.ok(lanesAlert(foundryPart({ version: 2, lanes: { rows } }).lanes));
  assert.equal(lanesAlert(foundryPart({ version: 3, projects: [] })?.lanes), null);
});

test('watchdog: missed and paused alert, the rest is silent', () => {
  assert.equal(watchdogAlert({ state: 'waiting', items: [] }), null);
  assert.equal(
    watchdogAlert({
      state: 'missed',
      items: [
        { name: '2026-10-05_2000-discord', state: 'missed' },
        { name: '2026-09-28_2000-discord', state: 'missed' },
      ],
    }),
    'Session notes missed for 2026-10-05_2000-discord and 1 more (no notes run within 24 h).'
  );
  assert.match(
    watchdogAlert({ state: 'paused', items: [{ name: 'x-discord', state: 'paused' }] }),
    /paused on the usage limit for x-discord/
  );
});

test('every alert forced at once: one line each, nine lines at most', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.repo, 'CLAUDE.md'), 'old copy\n');
    writeFileSync(
      path.join(f.testEnv, 'lock.json'),
      JSON.stringify({ holder: 'kit run', since: NOW.toISOString() })
    );
    const snap = snapshot({
      rows: [lane('Lane A', 230_000)],
      watchdog: { state: 'missed', items: [{ name: 'r-discord', state: 'missed' }] },
    });
    const lines = await collectAlerts(opts(f, { fetchImpl: answer(snap) }));
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^CLAUDE\.md differs/);
    assert.match(lines[1], /^Test server lock: held by kit run/);
    assert.match(lines[2], /^Lanes over 200k/);
    assert.match(lines[3], /^Session notes missed/);
    const out = JSON.parse(formatOutput(lines));
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(out.systemMessage.split('\n').length, 5); // the heading plus four alerts
    assert.ok(formatOutput(Array(20).fill('x')).length > 0);
  } finally {
    f.cleanup();
  }
});

test('no control center: a fresh snapshot file is used, an old one is not', async () => {
  const f = fixture();
  try {
    const file = path.join(f.root, 'snapshot.json');
    writeFileSync(file, JSON.stringify(snapshot({ rows: [lane('Lane B', 220_000)] })));
    const fresh = await collectAlerts(opts(f, { fetchImpl: refused, now: new Date() }));
    assert.deepEqual(fresh, ['Lanes over 200k context: Lane B 220k.']);

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(file, old, old);
    assert.deepEqual(await collectAlerts(opts(f, { fetchImpl: refused, now: new Date() })), []);
    // Installed on this PC but not answering: one line says so.
    mkdirSync(path.join(f.root, 'cc'));
    const lines = await collectAlerts(
      opts(f, { fetchImpl: refused, now: new Date(), ccDir: path.join(f.root, 'cc') })
    );
    assert.deepEqual(lines, [
      'Control center not answering on 127.0.0.1:3200: lane context and session notes not checked.',
    ]);
  } finally {
    f.cleanup();
  }
});

test('worktree paths map to the main checkout', () => {
  assert.equal(mainCheckout('C:\\p\\Foundry\\.claude\\worktrees\\x'), 'C:\\p\\Foundry');
  assert.equal(mainCheckout('/p/Foundry'), '/p/Foundry');
});

test('the hook as a process: silent when clean, JSON when an alert fires', () => {
  const f = fixture();
  try {
    const env = {
      ...process.env,
      START_ALERTS_REPO: f.repo,
      START_ALERTS_VAULT: f.vault,
      START_ALERTS_TEST_ROOT: f.testEnv,
      START_ALERTS_SNAPSHOT_URL: 'off',
      START_ALERTS_SNAPSHOT_FILE: path.join(f.root, 'none.json'),
      START_ALERTS_CC_DIR: path.join(f.root, 'none'),
    };
    const run = () =>
      execFileSync(process.execPath, [HOOK], { env, encoding: 'utf8', input: '{}' });
    assert.equal(run(), '');
    writeFileSync(path.join(f.testEnv, 'lock.json'), JSON.stringify({ holder: 'kit run' }));
    const out = JSON.parse(run());
    assert.match(out.systemMessage, /held by kit run/);
  } finally {
    f.cleanup();
  }
});

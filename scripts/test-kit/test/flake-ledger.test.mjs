import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  backfill,
  entryFromReport,
  findFlaky,
  flakyIds,
  flakyRows,
  readHistory,
  recordRun,
  updateFlakySection,
} from '../lib/flake-ledger.mjs';
import { noteRow, recordFlakes, updateNote, versionText } from '../kit-run.mjs';

/** Yesterday, so the rows are never old enough to age out whenever the tests run. */
const D = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const report = (sha, world, scenarios, at = `${D}T10:00:00Z`) => ({
  run: { gitSha: sha, finishedAt: at, size: 'smoke', target: { world } },
  scenarios: Object.entries(scenarios).map(([id, status]) => ({ id, status })),
});

test('same sha and world with a pass and a fail is flaky; another sha is not', () => {
  const runs = [
    { at: '1', sha: 'aaa', world: 'w', scenarios: { x: 'pass', y: 'fail', z: 'pass' } },
    { at: '2', sha: 'aaa', world: 'w', scenarios: { x: 'fail', y: 'fail', z: 'pass' } },
    { at: '3', sha: 'bbb', world: 'w', scenarios: { y: 'pass', z: 'fail' } },
    { at: '4', sha: 'aaa', world: 'other', scenarios: { z: 'fail' } },
  ];
  const flaky = findFlaky(runs);
  assert.deepEqual(
    flaky.map(e => `${e.id}@${e.sha}`),
    ['x@aaa']
  );
  assert.deepEqual([...flakyIds(runs, 'aaa', 'w')], ['x']);
  assert.match(flakyRows(runs, 'PC1')[0], /^\| x \| aaa \| w \| 1 \| 1 \| PC1 \|/);
});

test('dirty-tree runs, unknown shas, other sizes and all-fail runs never make a flake', () => {
  const base = { at: '1', sha: 'a', world: 'w', size: 'smoke' };
  const runs = [
    { ...base, scenarios: { x: 'pass', y: 'pass', z: 'pass' } },
    { ...base, dirty: true, scenarios: { x: 'fail' } },
    { ...base, size: 'full', scenarios: { y: 'fail' } },
    { ...base, sha: 'unknown', scenarios: { z: 'fail' } },
    { ...base, sha: 'unknown', scenarios: { z: 'pass' } },
  ];
  assert.deepEqual(findFlaky(runs), []);
  const dead = {
    run: { gitSha: 'a', target: { world: 'w' } },
    scenarios: ['a', 'b', 'c', 'd'].map(id => ({ id, status: 'error' })),
  };
  assert.equal(entryFromReport(dead), null);
  assert.equal(entryFromReport(report('a', 'w', { x: 'pass' }), 'd', true).dirty, true);
});

test('recordRun keeps history, skips skipped scenarios, replaces the same report folder', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'flake-'));
  try {
    recordRun(home, report('a', 'w', { x: 'pass', s: 'skip' }), 'd1');
    recordRun(home, report('a', 'w', { x: 'error' }, `${D}T11:00:00Z`), 'd2');
    recordRun(home, report('a', 'w', { x: 'error' }, `${D}T11:00:00Z`), 'd2');
    const runs = readHistory(home);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs[0].scenarios, { x: 'pass' });
    assert.equal(findFlaky(runs).length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('backfill seeds from report folders and ignores fake runs', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'flake-'));
  try {
    for (const [d, rep] of [
      ['r1', report('a', 'w', { x: 'pass' })],
      [
        'r2',
        { ...report('a', 'w', { x: 'fail' }), run: { ...report('a', 'w', {}).run, fake: true } },
      ],
    ]) {
      mkdirSync(path.join(home, 'reports', d), { recursive: true });
      writeFileSync(path.join(home, 'reports', d, 'report.json'), JSON.stringify(rep));
    }
    assert.equal(backfill(home), 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the note keeps the flaky section across a new row and replaces only this PC', () => {
  const rows = [`| x | a | w | 1 | 1 | PC1 | ${D} 10:00 |`];
  let text = updateNote('', '| row1 |');
  text = updateFlakySection(text, 'PC1', rows);
  text = updateFlakySection(text, 'PC2', [`| q | a | w | 1 | 1 | PC2 | ${D} 10:00 |`]);
  text = updateNote(text, '| row2 |');
  assert.match(text, /\| row2 \|\n\| row1 \|/);
  assert.match(text, /## Flaky scenarios/);
  assert.match(text, /\| x \|/);
  assert.match(text, /\| q \|/);
  text = updateFlakySection(text, 'PC1', []);
  assert.doesNotMatch(text, /\| x \|/);
  assert.match(text, /\| q \|/);
});

test('recordFlakes marks the failing list and never throws', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'flake-'));
  try {
    for (const [d, st] of [
      ['d1', 'pass'],
      ['d2', 'fail'],
    ]) {
      mkdirSync(path.join(home, 'reports', d), { recursive: true });
      writeFileSync(
        path.join(home, 'reports', d, 'report.json'),
        JSON.stringify(report('a', 'w', { x: st }, `${D}T1${d === 'd1' ? 0 : 1}:00:00Z`))
      );
    }
    recordFlakes(home, path.join(home, 'reports', 'd1'), { pc: 'PC1' }, false);
    const r = recordFlakes(
      home,
      path.join(home, 'reports', 'd2'),
      {
        pc: 'PC1',
        failing: ['x'],
        at: `${D}T11:00:00Z`,
        size: 'smoke',
        profile: 'srd',
        git: 'a',
      },
      false
    );
    assert.deepEqual(r.flaky, ['x']);
    assert.match(noteRow(r), /x \(flaky\)/);
    assert.deepEqual(recordFlakes(home, '/nope', { pc: 'P' }, false), { pc: 'P' });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('flaky marks older than 30 days leave the list and the note; other PCs keep their rows', () => {
  const now = Date.parse('2026-12-31T12:00:00Z');
  const runs = [
    { at: '2026-11-01T10:00:00Z', sha: 'a', world: 'w', size: 's', scenarios: { x: 'pass' } },
    { at: '2026-11-01T11:00:00Z', sha: 'a', world: 'w', size: 's', scenarios: { x: 'fail' } },
    { at: '2026-12-30T10:00:00Z', sha: 'b', world: 'w', size: 's', scenarios: { y: 'pass' } },
    { at: '2026-12-30T11:00:00Z', sha: 'b', world: 'w', size: 's', scenarios: { y: 'fail' } },
  ];
  assert.deepEqual(
    findFlaky(runs, now).map(e => e.id),
    ['y']
  );
  let text = updateFlakySection('', 'PC2', [
    '| old | a | w | 1 | 1 | PC2 | 2026-11-01 10:00 |',
    '| new | a | w | 1 | 1 | PC2 | 2026-12-30 10:00 |',
  ]);
  text = updateFlakySection(text, 'PC1', [], now);
  assert.doesNotMatch(text, /\| old \|/);
  assert.match(text, /\| new \|/);
});

test('rows of three PCs are all kept (no total cap), CRLF notes included', () => {
  const row = (pc, name) => `| ${name} | a | w | 1 | 1 | ${pc} | ${D} 10:00 |`;
  let text = '';
  for (const pc of ['PC1', 'PC2', 'PC3']) {
    const many = Array.from({ length: 30 }, (_, i) => row(pc, `r-${pc}-${i}`));
    text = updateFlakySection(text, pc, many).replace(/\n/g, '\r\n');
  }
  assert.equal((text.match(/\| r-PC\d-\d+ \|/g) ?? []).length, 90);
  const again = updateFlakySection(text, 'PC1', [row('PC1', 'only')]);
  assert.equal((again.match(/\| only \|/g) ?? []).length, 1);
  assert.equal((again.match(/\| r-PC2-\d+ \|/g) ?? []).length, 30);
});

test('a stale lock is taken over and the lock is released after a write', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'flake-'));
  try {
    const lock = path.join(home, 'scenario-history.json.lock');
    writeFileSync(lock, '1');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    recordRun(home, report('a', 'w', { x: 'pass' }), 'd1');
    assert.equal(readHistory(home).length, 1);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('backfill merges into the history instead of overwriting it', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'flake-'));
  try {
    mkdirSync(path.join(home, 'reports', 'r1'), { recursive: true });
    writeFileSync(
      path.join(home, 'reports', 'r1', 'report.json'),
      JSON.stringify(report('a', 'w', { x: 'pass' }))
    );
    const gone = path.join(home, 'reports', 'gone');
    recordRun(home, report('a', 'w', { y: 'fail' }, `${D}T09:00:00Z`), gone, true);
    assert.equal(backfill(home), 1);
    assert.equal(backfill(home), 1);
    const runs = readHistory(home);
    assert.equal(runs.length, 2);
    assert.equal(runs.find(r => r.dir === gone)?.dirty, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the note row names the Foundry build and the dnd5e version when the report has them', () => {
  assert.equal(
    versionText({ coreVersion: '14.370', systemVersion: '6.0.6' }),
    'Foundry 14.370, dnd5e 6.0.6'
  );
  assert.equal(versionText({ systemVersion: '6.0.6' }), 'dnd5e 6.0.6');
  assert.equal(versionText(null), '');
  const base = { at: `${D}T10:00:00Z`, pc: 'PC1', size: 'smoke', profile: 'srd', git: 'abc' };
  assert.match(
    noteRow({ ...base, state: 'passed', versions: 'Foundry 14.370, dnd5e 6.0.6' }),
    /smoke srd \(Foundry 14\.370, dnd5e 6\.0\.6\)/
  );
});

test('the note row shows five failing ids and counts the rest', () => {
  const failing = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const row = noteRow({
    at: `${D}T10:00:00Z`,
    pc: 'PC1',
    size: 'smoke',
    profile: 'srd',
    git: 'abc',
    state: 'failed',
    failed: 7,
    passed: 1,
    total: 8,
    failing,
    flaky: ['a'],
  });
  assert.match(row, /a \(flaky\), b, c, d, e and 2 more/);
});

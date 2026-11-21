import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { noteRow, recordFlakes, updateNote } from '../kit-run.mjs';

const report = (sha, world, scenarios, at = '2026-11-21T10:00:00Z') => ({
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
    recordRun(home, report('a', 'w', { x: 'error' }, '2026-11-21T11:00:00Z'), 'd2');
    recordRun(home, report('a', 'w', { x: 'error' }, '2026-11-21T11:00:00Z'), 'd2');
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
  const rows = ['| x | a | w | 1 | 1 | PC1 | 2026-11-21 10:00 |'];
  let text = updateNote('', '| row1 |');
  text = updateFlakySection(text, 'PC1', rows);
  text = updateFlakySection(text, 'PC2', ['| q | a | w | 1 | 1 | PC2 | 2026-11-21 10:00 |']);
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
        JSON.stringify(report('a', 'w', { x: st }, `2026-11-21T1${d === 'd1' ? 0 : 1}:00:00Z`))
      );
    }
    recordFlakes(home, path.join(home, 'reports', 'd1'), { pc: 'PC1' }, false);
    const r = recordFlakes(
      home,
      path.join(home, 'reports', 'd2'),
      {
        pc: 'PC1',
        failing: ['x'],
        at: '2026-11-21T11:00:00Z',
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

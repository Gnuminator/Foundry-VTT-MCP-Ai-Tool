// Tests for `npm run usage:now` (usage-now.mjs): argument checks, the frontmatter lines, the
// check- numbers from a usage:week report and the written file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkLines,
  main,
  noteFile,
  paceLines,
  parseArgs,
  planLines,
  renderNote,
} from './usage-now.mjs';
import { FALLBACK } from './usage-pace.mjs';

const FALLBACK_PROFILE = { ...FALLBACK, weeks: 0, source: 'fallback' };

const NOW = new Date('2026-10-23T14:05:00Z');
const base = ['--weekly', '79', '--weekly-resets', '2026-10-24T05:00:00.111Z'];

test('plan lines in the board order, models lower-cased', () => {
  const opts = parseArgs([
    ...base,
    '--five-hour', '7%',
    '--five-hour-resets', '2026-10-23T18:50:00Z',
    '--model', 'Sonnet=41',
  ]);
  assert.deepEqual(planLines(opts, NOW), [
    'updated: 2026-10-23T14:05:00.000Z',
    'five-hour-percent: 7',
    'five-hour-resets: 2026-10-23T18:50:00Z',
    'weekly-percent: 79',
    'weekly-resets: 2026-10-24T05:00:00.111Z',
    'weekly-sonnet-percent: 41',
  ]);
});

test('refuses missing, out of range and offset-less input', () => {
  assert.throws(() => planLines(parseArgs([]), NOW), /--weekly/);
  assert.throws(() => planLines(parseArgs(['--weekly', '101']), NOW), /0 to 100/);
  assert.throws(() => planLines(parseArgs(['--weekly', 'x']), NOW), /0 to 100/);
  assert.throws(
    () => planLines(parseArgs(['--weekly', '5', '--weekly-resets', '2026-10-24T07:00:00']), NOW),
    /offset/
  );
  assert.throws(() => planLines(parseArgs(['--weekly', '5', '--five-hour', '3']), NOW), /together/);
  assert.throws(() => parseArgs(['--bogus']), /unknown/);
  assert.throws(() => parseArgs(['--weekly']), /needs a value/);
  assert.throws(() => parseArgs(['--model', 'sonnet']), /name=percent/);
});

test('check lines come from the figures and skip unknown values', () => {
  const report = {
    window: { from: '2026-10-17', to: '2026-10-23' },
    figures: [
      { name: 'startup', value: 74321.4 },
      { name: 'M tokens per PR', value: 16.44 },
      { name: 'sessions a day', value: 14.84 },
      { name: 'weekly % a day', value: null },
      { name: 'weekly points per PR', value: 3.456 },
    ],
  };
  assert.deepEqual(checkLines(report), [
    'check-from: 2026-10-17',
    'check-to: 2026-10-23',
    'check-startup: 74321',
    'check-m-tokens-per-pr: 16.4',
    'check-sessions-a-day: 14.8',
    'check-weekly-points-per-pr: 3.5',
  ]);
  report.figures[4].value = null;
  assert.ok(!checkLines(report).some(l => l.startsWith('check-weekly-points-per-pr')));
});

test('renderNote has frontmatter and no free text beyond the fixed lines', () => {
  const text = renderNote(['updated: x']);
  assert.match(text, /^---\ntype: usage-now\nupdated: x\n---\n/);
});

test('main writes the note into the vault folder (no check)', async () => {
  const vault = mkdtempSync(path.join(os.tmpdir(), 'usage-now-'));
  try {
    mkdirSync(path.join(vault, 'Dev', 'Foundry AI Tool'), { recursive: true });
    let said = '';
    await main([...base, '--no-check'], { USAGE_WEEK_VAULT: vault, USAGE_WEEK_NOW: NOW.toISOString() }, {
      write: s => (said += s),
    });
    const text = readFileSync(noteFile(vault), 'utf8');
    assert.match(text, /weekly-percent: 79/);
    assert.doesNotMatch(text, /check-/);
    assert.match(said, /wrote/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('main with the check reads an empty transcript folder without failing', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-now-root-'));
  try {
    let said = '';
    await main(
      [...base, '--stdout'],
      { USAGE_WEEK_ROOT: root, USAGE_WEEK_VAULT: root, USAGE_WEEK_GH: 'off', USAGE_WEEK_NOW: NOW.toISOString() },
      { write: s => (said += s) }
    );
    assert.match(said, /check-from: 2026-10-17/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the first run after the reset writes the closed week once, later runs write none', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-now-week-'));
  try {
    const env = { USAGE_WEEK_ROOT: root, USAGE_WEEK_VAULT: root, USAGE_WEEK_GH: 'off' };
    // the reset at Sat 2026-10-24 05:00Z has passed; get_usage now reports the next one
    const args = ['--weekly', '3', '--weekly-resets', '2026-10-31T05:00:00.111Z'];
    const weekFile = path.join(root, 'Dev', 'Foundry AI Tool', 'Weekly check.md');
    const sections = () => (readFileSync(weekFile, 'utf8').match(/^## /gm) || []).length;
    let said = '';
    await main(args, { ...env, USAGE_WEEK_NOW: '2026-10-24T07:00:00Z' }, { write: s => (said += s) });
    assert.equal(sections(), 1);
    assert.match(readFileSync(weekFile, 'utf8'), /^## 2026-10-18$/m);
    assert.match(said, /closed week 2026-10-18/);
    said = '';
    await main(args, { ...env, USAGE_WEEK_NOW: '2026-10-26T09:00:00Z' }, { write: s => (said += s) });
    assert.equal(sections(), 1);
    assert.doesNotMatch(said, /closed week/);
    // the next reset closes the next week: a second section
    await main(
      ['--weekly', '4', '--weekly-resets', '2026-11-07T05:00:00.111Z'],
      { ...env, USAGE_WEEK_NOW: '2026-10-31T07:00:00Z' },
      { write: s => (said += s) }
    );
    assert.equal(sections(), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a closed-week write failure still writes Usage now.md', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-now-fail-'));
  try {
    // Weekly check.md is a directory, so reading it as the note fails
    mkdirSync(path.join(root, 'Dev', 'Foundry AI Tool', 'Weekly check.md'), { recursive: true });
    let said = '';
    await main(
      ['--weekly', '3', '--weekly-resets', '2026-10-31T05:00:00.111Z'],
      { USAGE_WEEK_ROOT: root, USAGE_WEEK_VAULT: root, USAGE_WEEK_GH: 'off', USAGE_WEEK_NOW: '2026-10-24T07:00:00Z' },
      { write: s => (said += s) }
    );
    assert.match(said, /closed week skipped/);
    assert.match(readFileSync(noteFile(root), 'utf8'), /weekly-percent: 3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pace lines: expected, delta, projection, active hours left and profile weeks', () => {
  const now = new Date('2026-10-23T14:05:00Z'); // Friday 16:05 CEST
  const opts = parseArgs(base);
  const lines = paceLines({ pace: { profile: FALLBACK_PROFILE } }, opts, now);
  const get = k => Number(lines.find(l => l.startsWith(`${k}:`))?.split(': ')[1]);
  assert.deepEqual(
    lines.map(l => l.split(':')[0]),
    [
      'pace-expected-percent',
      'pace-delta',
      'pace-projected-percent',
      'pace-active-hours-left',
      'pace-profile-weeks',
    ]
  );
  // late Friday afternoon: nearly the whole week is expected, so 79 is well behind
  assert.ok(get('pace-expected-percent') > 85, lines.join('\n'));
  assert.equal(get('pace-delta'), Math.round((79 - get('pace-expected-percent')) * 10) / 10);
  assert.ok(get('pace-active-hours-left') > 0 && get('pace-active-hours-left') < 12);
  assert.equal(get('pace-profile-weeks'), 0);
  // too early in the week: no projection line; no profile or no weekly value: no lines at all
  const early = paceLines({ pace: { profile: FALLBACK_PROFILE } }, opts, new Date('2026-10-17T08:00:00Z'));
  assert.ok(!early.some(l => l.startsWith('pace-projected-percent')));
  assert.deepEqual(paceLines({ pace: null }, opts, now), []);
  assert.deepEqual(paceLines({ pace: { profile: FALLBACK_PROFILE } }, parseArgs([]), now), []);
});

test('main with the check writes the pace lines from the usage log', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'usage-now-pace-'));
  try {
    const dir = path.join(root, 'Dev', 'Foundry AI Tool');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'Usage log (measured).md'),
      '| When (local) | Weekly % (all) |\n| --- | --- |\n| 2026-10-22 20:00 | 60 |\n| 2026-10-22 21:00 | 62 |\n'
    );
    let said = '';
    await main(
      [...base, '--stdout'],
      { USAGE_WEEK_ROOT: root, USAGE_WEEK_VAULT: root, USAGE_WEEK_GH: 'off', USAGE_WEEK_NOW: NOW.toISOString() },
      { write: s => (said += s) }
    );
    assert.match(said, /pace-expected-percent: \d/);
    assert.match(said, /pace-profile-weeks: 0\n/); // one day of log: the fallback table
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

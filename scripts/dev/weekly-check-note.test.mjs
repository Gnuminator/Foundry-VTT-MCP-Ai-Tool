// Tests for the vault note `Weekly check.md` (weekly-check-note.mjs) and `usage:week --write-vault`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { noteFile, sectionFor, splitSections, upsert, writeNote } from './weekly-check-note.mjs';
import { main } from './usage-week.mjs';

const report = (from, to, over = {}) => ({
  window: { from, to },
  figures: [
    { name: 'startup', value: 77822.4, unit: 'tokens' },
    { name: 'M tokens per PR', value: 24.249, unit: 'M' },
    { name: 'sessions a day', value: 12.34, unit: 'sessions' },
    { name: 'weekly % a day', value: null, unit: 'points' },
    { name: 'weekly points per PR', value: 3.456, unit: 'points' },
  ],
  ...over,
});

test('a section carries the pace profile numbers when the report has them', () => {
  const pace = { profile: { weeks: 4, activeHours: { weekday: 12, weekend: 10 } } };
  const text = sectionFor(report('2026-10-17', '2026-10-23', { pace }));
  assert.match(
    text,
    /- pace-profile-weeks: 4\n- pace-active-hours-weekday: 12\n- pace-active-hours-weekend: 10/
  );
  assert.doesNotMatch(sectionFor(report('2026-10-17', '2026-10-23')), /pace-/);
});

test('a section lists numbers only; unknown values are left out, not 0', () => {
  const text = sectionFor(report('2026-10-17', '2026-10-23'));
  assert.equal(
    text,
    [
      '## 2026-10-17',
      '- from: 2026-10-17',
      '- to: 2026-10-23',
      '- startup: 77822',
      '- tokens-m-per-pr: 24.2',
      '- sessions-a-day: 12.3',
      '- weekly-points-per-pr: 3.5',
    ].join('\n')
  );
  // pace is information only (the user, 2026-11-11): no limit or pass/fail line comes back
  assert.doesNotMatch(text, /-limit|-ok/);
});

test('a section carries advisor and tool call numbers only when they are known', () => {
  const text = sectionFor(
    report('2026-10-17', '2026-10-23', {
      advisorCalls: 6,
      advisorPerPr: 1.234,
      toolCalls: { total: 40, errors: 2, used: 9, never: 31 },
    })
  );
  assert.match(text, /- advisor-calls: 6\n- advisor-per-pr: 1\.2\n/);
  assert.match(
    text,
    /- tool-calls: 40\n- tool-errors: 2\n- tools-used: 9\n- tools-never-used: 31$/
  );
  const noCatalog = sectionFor(
    report('2026-10-17', '2026-10-23', { toolCalls: { total: 3, errors: 0, used: 2, never: null } })
  );
  assert.match(noCatalog, /- tools-used: 2$/);
  assert.doesNotMatch(noCatalog, /tools-never-used/);
  const none = sectionFor(
    report('2026-10-17', '2026-10-23', { toolCalls: { total: 0, errors: 0, used: 0, never: 5 } })
  );
  assert.doesNotMatch(none, /tool-calls|advisor/);
});

test('upsert keeps weeks newest first and replaces the section of the same window', () => {
  let text = upsert('', report('2026-10-10', '2026-10-16'));
  text = upsert(text, report('2026-10-24', '2026-10-30'));
  text = upsert(text, report('2026-10-17', '2026-10-23'));
  assert.deepEqual(
    splitSections(text).map(([d]) => d),
    ['2026-10-24', '2026-10-17', '2026-10-10']
  );
  const again = upsert(
    text,
    report('2026-10-17', '2026-10-23', {
      figures: [{ name: 'startup', value: 70000, unit: 'tokens' }],
    })
  );
  const sections = splitSections(again);
  assert.equal(sections.length, 3);
  assert.match(sections[1][1], /- startup: 70000/);
  assert.doesNotMatch(sections[1][1], /sessions-a-day/);
  assert.match(again, /^---\ntype: weekly-check\n---/);
});

test('--write-vault writes the note into the vault', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'weekly-check-'));
  try {
    const env = {
      USAGE_WEEK_ROOT: path.join(dir, 'projects'),
      USAGE_WEEK_VAULT: dir,
      USAGE_WEEK_GH: 'off',
      USAGE_WEEK_NOW: '2026-10-24T09:00:00',
    };
    let out = '';
    await main(['--write-vault'], env, { write: s => (out += s) });
    const file = noteFile(dir);
    assert.ok(existsSync(file));
    assert.match(readFileSync(file, 'utf8'), /## 2026-10-18\n- from: 2026-10-18\n- to: 2026-10-24/);
    assert.match(out, /Weekly check\.md/);
    writeNote(file, report('2026-10-11', '2026-10-17'));
    assert.equal(splitSections(readFileSync(file, 'utf8')).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

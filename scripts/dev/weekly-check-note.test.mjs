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
  targets: [
    { name: 'startup', value: 77822.4, limit: 75000, unit: 'tokens', ok: false },
    { name: 'M tokens per PR', value: 24.249, limit: 18, unit: 'M', ok: false },
    { name: 'sessions a day', value: 12.34, limit: 15, unit: 'sessions', ok: true },
    { name: 'weekly % a day', value: null, limit: 14, unit: 'points', ok: null },
  ],
  ...over,
});

test('a section lists numbers, limits and ok; unknown values are left out, not 0', () => {
  assert.equal(
    sectionFor(report('2026-10-17', '2026-10-23')),
    [
      '## 2026-10-17',
      '- from: 2026-10-17',
      '- to: 2026-10-23',
      '- startup: 77822',
      '- startup-limit: 75000',
      '- startup-ok: no',
      '- tokens-m-per-pr: 24.2',
      '- tokens-m-per-pr-limit: 18',
      '- tokens-m-per-pr-ok: no',
      '- sessions-a-day: 12.3',
      '- sessions-a-day-limit: 15',
      '- sessions-a-day-ok: yes',
      '- weekly-points-a-day-limit: 14',
      '- weekly-points-a-day-ok: unknown',
    ].join('\n')
  );
});

test('ok is judged on the rounded number the note shows', () => {
  const r = report('2026-10-17', '2026-10-23', {
    targets: [{ name: 'sessions a day', value: 15.04, limit: 15, unit: 'sessions', ok: false }],
  });
  assert.match(sectionFor(r), /- sessions-a-day: 15\n- sessions-a-day-limit: 15\n- sessions-a-day-ok: yes/);
});

test('upsert keeps weeks newest first and replaces the section of the same window', () => {
  let text = upsert('', report('2026-10-10', '2026-10-16'));
  text = upsert(text, report('2026-10-24', '2026-10-30'));
  text = upsert(text, report('2026-10-17', '2026-10-23'));
  assert.deepEqual(splitSections(text).map(([d]) => d), ['2026-10-24', '2026-10-17', '2026-10-10']);
  const again = upsert(
    text,
    report('2026-10-17', '2026-10-23', {
      targets: [{ name: 'startup', value: 70000, limit: 75000, unit: 'tokens', ok: true }],
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

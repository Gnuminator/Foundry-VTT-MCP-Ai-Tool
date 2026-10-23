// Tests for `npm run usage:now` (usage-now.mjs): argument checks, the frontmatter lines, the
// check- numbers from a usage:week report and the written file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLines, main, noteFile, parseArgs, planLines, renderNote } from './usage-now.mjs';

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

test('check lines come from the targets and skip unknown values', () => {
  const report = {
    window: { from: '2026-10-17', to: '2026-10-23' },
    targets: [
      { name: 'startup', value: 74321.4 },
      { name: 'M tokens per PR', value: 16.44 },
      { name: 'sessions a day', value: 14.84 },
      { name: 'weekly % a day', value: null },
    ],
  };
  assert.deepEqual(checkLines(report), [
    'check-from: 2026-10-17',
    'check-to: 2026-10-23',
    'check-startup: 74321',
    'check-m-tokens-per-pr: 16.4',
    'check-sessions-a-day: 14.8',
  ]);
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

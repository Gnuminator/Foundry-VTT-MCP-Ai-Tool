// The recorder rehearsal wrapper: argument parsing and the note row. Nothing here starts the bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, rehearsalRow } from '../recorder-rehearsal.mjs';

test('parseArgs: defaults are 60 s with a drop at 30 s', () => {
  assert.deepEqual(parseArgs(['tracks']), {
    dir: 'tracks',
    seconds: 60,
    dropAt: 30,
    record: true,
    help: false,
  });
});

test('parseArgs: refuses bad input', () => {
  assert.throws(() => parseArgs([]), /folder/);
  assert.throws(() => parseArgs(['t', '--seconds', 'x']), /positive/);
  assert.throws(() => parseArgs(['t', '--drop-at', '90']), /before/);
  assert.throws(() => parseArgs(['t', '--nope']), /unknown/);
});

const meta = {
  at: new Date(2026, 10, 23, 20, 5),
  pc: 'PC',
  seconds: 60,
  dropAt: 30,
  version: '0.31.0',
  git: 'abc1234',
};

test('rehearsalRow: a pass row carries PASS and the folder', () => {
  const row = rehearsalRow(
    {
      verdict: 'pass',
      folder: 'C:\\r\\x',
      playedSeconds: 60,
      awaySeconds: 1.6,
      interTrackSpreadMs: 12,
      speakers: [{ lossOutsideGapPct: 0.1 }, { lossOutsideGapPct: 0.3 }],
      reasons: [],
    },
    meta
  );
  assert.match(
    row,
    /^\| 2026-11-23 20:05 \| PC \| recorder rehearse 60 s, drop at 30 s \(discord-bot 0\.31\.0\) \| abc1234 \| PASS: 2 tracks/
  );
  assert.match(row, /loss 0\.3 %/);
  assert.match(row, /`C:\\r\\x` \|$/);
});

test('rehearsalRow: a check row lists the reasons', () => {
  const row = rehearsalRow(
    { verdict: 'check', folder: 'f', playedSeconds: 60, speakers: [], reasons: ['no rejoin | x'] },
    meta
  );
  assert.match(row, /CHECK: 1 reason/);
  assert.match(row, /no rejoin \/ x/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ABILITY_KEYS,
  DEFAULTS,
  TARGET,
  main,
  nextArrayMove,
  parseArgs,
  planArrayMoves,
  refusals,
} from '../player-run.mjs';

const WANT = ABILITY_KEYS.map(key => TARGET[key]);

test('parseArgs: url and user are required, the rest defaults to the wizard run', () => {
  assert.deepEqual(parseArgs(['http://pi:30000', 'Kit Player']), {
    url: 'http://pi:30000',
    user: 'Kit Player',
    ...DEFAULTS,
    out: null,
  });
  assert.throws(() => parseArgs([]), /usage:/);
  assert.throws(() => parseArgs(['http://pi:30000']), /usage:/);
});

test('parseArgs: class, species, background and --out in any place', () => {
  const o = parseArgs([
    '--out',
    'x/y',
    'http://pi:30000',
    'Kit Player',
    'Cleric',
    'Human',
    'Acolyte',
  ]);
  assert.equal(o.className, 'Cleric');
  assert.equal(o.speciesName, 'Human');
  assert.equal(o.backgroundName, 'Acolyte');
  assert.equal(o.out, 'x/y');
});

test('parseArgs: refuses an unknown option, a bare --out and extra words', () => {
  assert.throws(() => parseArgs(['u', 'p', '--keep']), /unknown option --keep/);
  assert.throws(() => parseArgs(['u', 'p', '--out']), /--out needs a folder/);
  assert.throws(() => parseArgs(['u', 'p', '--out', '--x']), /--out needs a folder/);
  assert.throws(() => parseArgs(['u', 'p', 'a', 'b', 'c', 'd']), /too many arguments \(d\)/);
});

test('the standard array target is the 8 13 14 15 12 10 wizard array', () => {
  assert.deepEqual(WANT, [8, 13, 14, 15, 12, 10]);
});

test('nextArrayMove: null when in order, the row to move up otherwise', () => {
  assert.equal(nextArrayMove(WANT, WANT), null);
  // 15 sits in row 0 and 8 in row 3: row 0 wants 8, which is in row 3.
  assert.equal(nextArrayMove([15, 14, 13, 8, 12, 10], WANT), 3);
});

test('nextArrayMove: a value the page does not offer cannot be reached', () => {
  assert.throws(() => nextArrayMove([15, 14, 13, 12, 10, 9], WANT), /cannot reach/);
});

test('planArrayMoves: swaps one place up per click and ends in order, from the usual start orders', () => {
  const starts = [
    [15, 14, 13, 12, 10, 8], // the descending default
    [8, 10, 12, 13, 14, 15],
    [15, 14, 13, 8, 12, 10],
  ];
  for (const start of starts) {
    const rows = [...start];
    for (const j of planArrayMoves(start, WANT)) {
      assert.ok(j >= 1 && j <= 5, `row ${j} can move up`);
      [rows[j - 1], rows[j]] = [rows[j], rows[j - 1]];
    }
    assert.deepEqual(rows, WANT, `from ${start}`);
  }
  assert.deepEqual(planArrayMoves(WANT, WANT), []);
});

test('planArrayMoves: a reversed array takes at most the bubble-sort count of clicks', () => {
  const reversed = [...WANT].reverse();
  assert.ok(planArrayMoves(reversed, WANT).length <= 15);
});

test('refusals: the Curse of Strahd world, a GM and a user that cannot create actors', () => {
  const ok = { world: 'strahd-kit', isGM: false, canCreate: true };
  assert.deepEqual(refusals(ok), []);
  assert.match(refusals({ ...ok, world: 'curse-of-strahd' }).join(), /curse-of-strahd/);
  assert.match(refusals({ ...ok, isGM: true }).join(), /needs a Player/);
  assert.match(refusals({ ...ok, canCreate: false }).join(), /may not create actors/);
});

test('main refuses a live bridge port before it opens a browser', async () => {
  await assert.rejects(() => main(['http://127.0.0.1:31415', 'Kit Player']), /live bridge/);
});

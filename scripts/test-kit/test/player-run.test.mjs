import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ABILITY_KEYS,
  DEFAULTS,
  TARGET,
  chooseStandardArrayMethod,
  main,
  nextArrayMove,
  parseArgs,
  planArrayMoves,
  insideRepo,
  refusals,
  standardArrayChoice,
  worldRefusals,
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

test('insideRepo: the repo and anything under it, not a sibling or a temp folder', () => {
  const root = path.resolve('some', 'repo');
  assert.equal(insideRepo(root, root), true);
  assert.equal(insideRepo(path.join(root, 'out'), root), true);
  assert.equal(insideRepo(path.join(root, '..', 'repo-out'), root), false);
  assert.equal(insideRepo(path.join(root, '..out'), root), true);
  assert.equal(insideRepo(path.join(root, '..', '..out'), root), false);
  assert.equal(insideRepo(path.join(root, '..'), root), false);
  assert.equal(insideRepo(os.tmpdir(), root), false);
});

const statusOf = body => async () => ({ json: async () => body });

test('worldRefusals: the live world, a server with no world and a server that is down are refused; a test world passes', async () => {
  const url = 'http://pi:30000';
  assert.deepEqual(await worldRefusals(url, statusOf({ world: 'strahd-kit' })), []);
  assert.match(
    (await worldRefusals(url, statusOf({ world: 'curse-of-strahd' }))).join(),
    /the world is curse-of-strahd/
  );
  assert.match((await worldRefusals(url, statusOf({ active: false }))).join(), /reports no world/);
  const down = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.match((await worldRefusals(url, down)).join(), /did not answer.*ECONNREFUSED/);
});

test('main refuses the live world through /api/status before it opens a browser', async () => {
  const seen = [];
  const fetchImpl = async u => {
    seen.push(String(u));
    return { json: async () => ({ world: 'curse-of-strahd' }) };
  };
  await assert.rejects(
    () => main(['http://127.0.0.1:30000', 'Kit Player', '--out', os.tmpdir()], { fetchImpl }),
    /refused: the world is curse-of-strahd/
  );
  assert.deepEqual(seen, ['http://127.0.0.1:30000/api/status']);
});

test('main makes no temp folder when the world is refused', async () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'pr-tmp-'));
  const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = sandbox;
  try {
    const fetchImpl = async () => ({ json: async () => ({ world: 'curse-of-strahd' }) });
    await assert.rejects(
      () => main(['http://127.0.0.1:30000', 'Kit Player'], { fetchImpl }),
      /refused: the world is curse-of-strahd/
    );
    assert.deepEqual(readdirSync(sandbox), []);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('main refuses an --out folder inside the repo before it opens a browser', async () => {
  await assert.rejects(
    () =>
      main([
        'http://127.0.0.1:30000',
        'Kit Player',
        '--out',
        path.join(import.meta.dirname, '..', 'out'),
      ]),
    /inside the repo/
  );
});

test('standardArrayChoice: picks Standard Array from the method list, or nothing when it already shows', () => {
  const labels = ['Point Buy', 'Standard Array'];
  assert.equal(standardArrayChoice(labels, 'Point Buy'), 1);
  assert.equal(standardArrayChoice(labels, ''), 1);
  assert.equal(standardArrayChoice(labels, 'Standard Array'), null);
  assert.equal(standardArrayChoice(['Point Buy', 'Manual Entry'], 'Point Buy'), -1);
});

/**
 * A fake Playwright page for the ability method drop-down: a select with a current label and a list of
 * options. It records every click and every key press, and "Standard Array" sticks when its option is clicked.
 * @param {{ shows: string, labels: string[], present?: boolean, sticks?: boolean }} o
 */
function fakeMethodPage({ shows, labels, present = true, sticks = true }) {
  const events = [];
  let current = shows;
  const option = {
    filter: () => ({
      first: () => ({
        click: async () => {
          events.push('click option');
          if (sticks) current = 'Standard Array';
        },
      }),
    }),
  };
  const select = {
    count: async () => (present ? 1 : 0),
    locator: sel => {
      if (sel === '.selected-option') {
        return {
          innerText: async () => current,
          click: async () => events.push('click selected'),
        };
      }
      if (sel === '.option') return option;
      if (sel === '.option .option-label') return { allInnerTexts: async () => labels };
      throw new Error(`unexpected selector ${sel}`);
    },
  };
  const page = { keyboard: { press: async key => events.push(`press ${key}`) } };
  const studio = { rootOf: () => ({ locator: () => select }) };
  return { page, studio, events };
}

const noWait = async () => {};

test('chooseStandardArrayMethod: no drop-down means a single method and no clicks', async () => {
  const f = fakeMethodPage({ shows: '', labels: [], present: false });
  assert.equal(await chooseStandardArrayMethod(f.page, f.studio, noWait), 'single method');
  assert.deepEqual(f.events, []);
});

test('chooseStandardArrayMethod: Standard Array already showing opens nothing', async () => {
  const f = fakeMethodPage({ shows: 'Standard Array', labels: ['Point Buy', 'Standard Array'] });
  assert.equal(await chooseStandardArrayMethod(f.page, f.studio, noWait), 'already Standard Array');
  assert.deepEqual(f.events, []);
});

test('chooseStandardArrayMethod: another method showing picks Standard Array and never presses Escape', async () => {
  const f = fakeMethodPage({ shows: 'Point Buy', labels: ['Point Buy', 'Standard Array'] });
  assert.equal(await chooseStandardArrayMethod(f.page, f.studio, noWait), 'picked Standard Array');
  assert.deepEqual(f.events, ['click selected', 'click option']);
});

test('chooseStandardArrayMethod: a list without Standard Array is closed by a click, not Escape, then throws', async () => {
  const f = fakeMethodPage({ shows: 'Point Buy', labels: ['Point Buy', 'Manual Entry'] });
  await assert.rejects(
    () => chooseStandardArrayMethod(f.page, f.studio, noWait),
    /Standard Array is not offered/
  );
  assert.deepEqual(f.events, ['click selected', 'click selected']);
});

test('chooseStandardArrayMethod: a pick that does not stick throws with what the tab shows', async () => {
  const f = fakeMethodPage({
    shows: 'Point Buy',
    labels: ['Point Buy', 'Standard Array'],
    sticks: false,
  });
  await assert.rejects(
    () => chooseStandardArrayMethod(f.page, f.studio, noWait),
    /did not stick.*"Point Buy"/
  );
});

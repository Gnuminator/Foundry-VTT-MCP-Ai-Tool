// Tests for the world switches of Pi stage 11 (scripts/pi/remote/world-switches.mjs, docs/dev/PI-SETUP.md,
// "World switches"):
//   node --test scripts/pi/world-switches.test.mjs
// - the in-browser part against a fake `game`: every switch set, a second run changing nothing, a setting that is
//   already right left alone, an optional module that is missing (a warning, not a failure), a required setting that
//   is missing or a client setting (a blocker), and the read-back check;
// - the table in PI-SETUP.md and PROFILE name the same settings with the same values;
// - every AI Tool setting key in PROFILE is one the foundry module registers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROFILE,
  applyState,
  blockers,
  mismatches,
  readState,
  warnings,
} from './remote/world-switches.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const key = e => `${e.ns}.${e.key}`;

// A fake `game` with every PROFILE setting registered as a world setting, off (booleans false, downed 'none').
// `without` leaves settings unregistered, `client` makes some of them client settings, `set` overrides values.
function fakeGame({
  without = [],
  client = [],
  set = {},
  isGM = true,
  world = 'w',
  active = [],
} = {}) {
  const values = new Map(PROFILE.map(e => [key(e), typeof e.value === 'boolean' ? false : 'none']));
  for (const [k, v] of Object.entries(set)) values.set(k, v);
  const registered = new Map(
    PROFILE.filter(e => !without.includes(key(e))).map(e => [
      key(e),
      { scope: client.includes(key(e)) ? 'client' : 'world' },
    ])
  );
  const sets = [];
  return {
    sets,
    values,
    world: { id: world },
    user: { name: 'Gamemaster', isGM },
    system: { id: 'dnd5e' },
    modules: { get: ns => (active.includes(ns) ? { active: true } : undefined) },
    settings: {
      settings: registered,
      get(ns, k) {
        if (!registered.has(`${ns}.${k}`))
          throw new Error(`${ns}.${k} is not a registered game setting`);
        return values.get(`${ns}.${k}`);
      },
      async set(ns, k, v) {
        sets.push(`${ns}.${k}`);
        values.set(`${ns}.${k}`, v);
      },
    },
  };
}

// readState and applyState run in the browser, where `game` is a global.
const inGame = async (game, fn, arg) => {
  globalThis.game = game;
  try {
    return await fn(arg);
  } finally {
    delete globalThis.game;
  }
};
const ARGS = { profile: PROFILE };

describe('world-switches.mjs against a fake game', () => {
  test('sets every switch, reads it back and a second run changes nothing', async () => {
    const game = fakeGame();
    const before = await inGame(game, readState, ARGS);
    assert.deepEqual(blockers(before, 'w'), []);
    assert.deepEqual(warnings(before), []);
    const changed = await inGame(game, applyState, ARGS);
    assert.deepEqual(changed, PROFILE.map(key));
    const after = await inGame(game, readState, ARGS);
    assert.deepEqual(mismatches(after), []);
    assert.equal(game.values.get('dnd5e.autoApplyDowned'), 'all');
    assert.equal(game.values.get('foundry-mcp-bridge.feature.handouts.enabled'), true);
    const again = await inGame(game, applyState, ARGS);
    assert.deepEqual(again, []);
    assert.equal(game.sets.length, PROFILE.length, 'no second write');
  });

  test('a setting that is already right is not written again', async () => {
    const game = fakeGame({
      set: { 'dnd5e.autoApplyDowned': 'all', 'foundry-mcp-bridge.gmWindows': true },
    });
    const changed = await inGame(game, applyState, ARGS);
    assert.ok(!changed.includes('dnd5e.autoApplyDowned'));
    assert.ok(!changed.includes('foundry-mcp-bridge.gmWindows'));
    assert.equal(changed.length, PROFILE.length - 2);
  });

  test('Item Piles missing: a warning, the rest is set and verified', async () => {
    const game = fakeGame({ without: ['item-piles.enableTrading'] });
    const before = await inGame(game, readState, ARGS);
    assert.deepEqual(blockers(before, 'w'), []);
    assert.deepEqual(warnings(before), [
      'item-piles.enableTrading skipped: the item-piles module is not active in this world',
    ]);
    const changed = await inGame(game, applyState, ARGS);
    assert.ok(!changed.includes('item-piles.enableTrading'));
    assert.deepEqual(mismatches(await inGame(game, readState, ARGS)), []);
  });

  test('an optional setting that is not a world setting is a warning, never a blocker or a mismatch', async () => {
    const game = fakeGame({ client: ['item-piles.enableTrading'] });
    const before = await inGame(game, readState, ARGS);
    assert.deepEqual(blockers(before, 'w'), []);
    assert.match(
      warnings(before).join(';'),
      /item-piles\.enableTrading skipped: it is a client setting/
    );
    const changed = await inGame(game, applyState, ARGS);
    assert.ok(!changed.includes('item-piles.enableTrading'));
    assert.deepEqual(mismatches(await inGame(game, readState, ARGS)), []);
  });

  test('an optional module that is active but registers nothing is a blocker: the key is probably wrong', async () => {
    const game = fakeGame({ without: ['item-piles.enableTrading'], active: ['item-piles'] });
    const before = await inGame(game, readState, ARGS);
    assert.match(
      blockers(before, 'w').join(';'),
      /item-piles.enableTrading is not registered although item-piles is active/
    );
    assert.deepEqual(warnings(before), []);
    assert.match(mismatches(before).join(';'), /item-piles.enableTrading is not registered/);
  });

  test('a required setting that is not registered, a client setting, a wrong world or a non-GM block', async () => {
    const missing = await inGame(fakeGame({ without: ['dnd5e.autoApplyDowned'] }), readState, ARGS);
    assert.match(blockers(missing, 'w').join(';'), /dnd5e\.autoApplyDowned is not registered/);
    const client = await inGame(
      fakeGame({ client: ['foundry-mcp-bridge.gmWindows'] }),
      readState,
      ARGS
    );
    assert.match(blockers(client, 'w').join(';'), /gmWindows is a client setting/);
    const other = await inGame(fakeGame({ world: 'x', isGM: false }), readState, ARGS);
    const text = blockers(other, 'w').join(';');
    assert.match(text, /joined world x, expected w/);
    assert.match(text, /Gamemaster is not a GM/);
  });

  test('applyState leaves a client setting alone, and the read-back reports a value that did not stick', async () => {
    const game = fakeGame({ client: ['foundry-mcp-bridge.gmWindows'] });
    const changed = await inGame(game, applyState, ARGS);
    assert.ok(!changed.includes('foundry-mcp-bridge.gmWindows'));
    const lost = fakeGame();
    lost.settings.set = async () => {}; // Foundry dropped the write without an error
    await inGame(lost, applyState, ARGS);
    const wrong = mismatches(await inGame(lost, readState, ARGS));
    assert.equal(wrong.length, PROFILE.length);
    assert.match(wrong[0], /is false, expected true/);
  });
});

describe('PROFILE and the docs', () => {
  const doc = readFileSync(path.join(repo, 'docs', 'dev', 'PI-SETUP.md'), 'utf8');
  const section = doc.slice(
    doc.indexOf('### World switches'),
    doc.indexOf('## Player character creation')
  );

  test('the table in PI-SETUP.md is PROFILE', () => {
    assert.ok(section.length > 100, 'no "World switches" section in PI-SETUP.md');
    const rows = [...section.matchAll(/^\| `([\w.-]+)`\s*\| ([^|]+?)\s*\|/gm)].map(m => ({
      key: m[1],
      value: m[2].trim(),
    }));
    const want = PROFILE.map(e => ({
      key: key(e),
      value: typeof e.value === 'boolean' ? (e.value ? 'on' : 'off') : `\`${e.value}\``,
    }));
    assert.deepEqual(rows, want);
  });

  test('every foundry-mcp-bridge key is one the module registers', () => {
    const src = readdirSync(path.join(repo, 'packages', 'foundry-module', 'src'), {
      recursive: true,
    })
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map(f => readFileSync(path.join(repo, 'packages', 'foundry-module', 'src', f), 'utf8'))
      .join('\n');
    for (const e of PROFILE.filter(p => p.ns === 'foundry-mcp-bridge')) {
      const feature = /^feature\.([\w-]+)\.enabled$/.exec(e.key);
      if (feature) {
        // registerGuardedFeature({ id: 'handouts' ... }) or id: SOME_FEATURE_ID with the constant defined as that id.
        const direct = new RegExp(`id: '${feature[1]}'`).test(src);
        const viaConst = new RegExp(`FEATURE_ID = '${feature[1]}'`).test(src);
        assert.ok(direct || viaConst, `no guarded feature ${feature[1]} in the module`);
      } else {
        assert.match(src, new RegExp(`'${e.key}'`), `the module does not register ${e.key}`);
      }
    }
  });
});

test('the in-browser script parses (node --check)', () => {
  const r = spawnSync(
    process.execPath,
    ['--check', path.join(repo, 'scripts', 'pi', 'remote', 'world-switches.mjs')],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
});

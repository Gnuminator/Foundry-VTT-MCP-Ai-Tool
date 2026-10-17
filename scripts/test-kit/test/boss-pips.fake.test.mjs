/**
 * The boss pips on the fake: a combat of the kit's legendary monster reports its legendary pool
 * through the dashboard, spendLegendary spends one action and restoreLegendary puts it back.
 * (The dashboard-controls scenario runs the same two actions against real Foundry.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKit } from '../lib/builder.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { tokenHeroes } from '../lib/helpers.mjs';

const WORLD = 'ai-tool-kit-srd';

/**
 * The boss part of a combatant in get-combat-state, which the dashboard polls (null for a combatant
 * without boss resources). @param {ReturnType<typeof createDashboardClient>} dashboard @param {string} id
 */
async function bossOf(dashboard, id) {
  const state = await dashboard.tool('get-combat-state');
  const row = state.combatants.find((/** @type {any} */ c) => c.id === id);
  assert.ok(row, `combatant ${id} is in the combat state`);
  return row.boss;
}

test('a legendary action spent on the fake shows in the dashboard combat state, and goes back', async () => {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const kit = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      profile: loadProfile('srd'),
    });
    const boss = kit.monsters.find((/** @type {any} */ m) => m.cell === 'legendary' && m.tokenId);
    assert.ok(boss, 'the kit has a legendary monster on the scene');
    const hero = tokenHeroes(kit)[0];
    const sceneId = kit.scene.sceneId;
    const combat = await fake.gm.call('startCombat', {
      sceneId,
      tokenIds: [boss.tokenId, hero.tokenId],
    });
    const bossId = combat.combatantIds[0];
    const heroId = combat.combatantIds[1];

    const full = await bossOf(dashboard, bossId);
    assert.equal(full.legendary.spent, 0);
    assert.equal(full.legendary.remaining, full.legendary.max);
    assert.equal(await bossOf(dashboard, heroId), null, 'a hero is no boss');

    const token = { sceneId, tokenId: boss.tokenId };
    const spent = await fake.gm.call('spendLegendary', token);
    assert.deepEqual(spent.before, { max: full.legendary.max, spent: 0 });
    assert.deepEqual(spent.after, { max: full.legendary.max, spent: 1 });
    const once = await bossOf(dashboard, bossId);
    assert.equal(once.legendary.spent, 1);
    assert.equal(once.legendary.remaining, full.legendary.max - 1);

    const back = await fake.gm.call('restoreLegendary', { ...token, spent: 0, messageId: null });
    assert.equal(back.spent, 0);
    assert.equal((await bossOf(dashboard, bossId)).legendary.remaining, full.legendary.max);
  } finally {
    await fake.close();
  }
});

test('spendLegendary refuses a token without legendary actions', async () => {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const kit = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      profile: loadProfile('srd'),
    });
    const hero = tokenHeroes(kit)[0];
    await assert.rejects(
      fake.gm.call('spendLegendary', { sceneId: kit.scene.sceneId, tokenId: hero.tokenId }),
      /no legendary actions/
    );
  } finally {
    await fake.close();
  }
});

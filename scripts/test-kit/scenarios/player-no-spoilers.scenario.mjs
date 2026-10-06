/**
 * What the player screen must never show. A hidden monster token with a canary name joins a
 * combat with a visible monster and a hero; the player state and page must not name the hidden
 * one, must not list it as a combatant and must not show monster HP numbers.
 *
 * The rules are in packages/cogm-dashboard/src/player/projection.ts: HP numbers only for player
 * characters, bands (words) for others when the table allows them, hidden combatants dropped.
 * A player character is an actor a player owns: the kit gives one hero (the manifest row with an
 * `owner`) to the Kit Player user, so the player screen must show its HP as numbers that match
 * Foundry, while the monsters stay hidden.
 */
import { monsterOf, playerHero, waitFor } from '../lib/helpers.mjs';

const CANARY = 'KIT-CANARY-HIDDEN';
const BANDS = [null, 'healthy', 'bloodied', 'critical', 'down'];

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'player-no-spoilers',
  title: 'The player screen shows no hidden token, no monster HP numbers and no true names',
  sizes: ['smoke', 'full'],
  tags: ['player', 'dashboard'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: ['get-player-visibility', 'plan-token-change', 'apply-planned-change'],
  gmActions: ['placeToken', 'startCombat', 'endCombats', 'readActor'],
  timeoutMs: 120000,

  async run(t) {
    const hero = playerHero(t.kit);
    const visible = monsterOf(t.kit, 'beast');
    const secret = monsterOf(t.kit, 'flyer');
    const sceneId = t.kit.scene.sceneId;

    /** @type {{tokenId: string}} */
    let hidden;
    await t.step('place a hidden token with a canary name', async () => {
      hidden = await t.gm('placeToken', {
        sceneId,
        actorId: secret.actorId,
        x: t.kit.scene.width - 4,
        y: t.kit.scene.height - 6,
        hidden: true,
        name: CANARY,
      });
      // Runs last: the combat is over by then, so the token can go.
      t.cleanup(async () => {
        await t.guarded.planApply('plan-token-change', { action: 'delete', tokens: [CANARY] });
      });
    });

    /** @type {{combatId: string, combatantIds: string[]}} */
    let combat;
    await t.step('start a combat with the hero, a visible monster and the hidden one', async () => {
      combat = await t.gm('startCombat', {
        sceneId,
        tokenIds: [hero.tokenId, visible.tokenId, hidden.tokenId],
      });
      t.cleanup(async () => {
        await t.gm('endCombats');
      });
      t.equal(combat.combatantIds.length, 3, 'combatants');
    });

    /** @type {any} */
    let state;
    await t.step('the player state shows the combat', async () => {
      state = await waitFor(
        async () => {
          const s = await t.player.state();
          // The dashboard can still hold the previous combat for a moment: wait for ours.
          const ours = new Set(combat.combatantIds);
          const listed =
            s.combat && s.combat.combatants.some((/** @type {any} */ c) => ours.has(c.id));
          return listed ? s : null;
        },
        { label: 'the combat in /api/player/state', timeoutMs: 40000, intervalMs: 2000 }
      );
      t.check(state.combat.active === true, 'the player combat is active');
    });

    await t.step('the canary name is nowhere in the player state or page', async () => {
      const text = JSON.stringify(state);
      t.check(!text.includes(CANARY), `${CANARY} is in /api/player/state`);
      t.check(!text.includes(secret.name), `${secret.name} is in /api/player/state`);
      const html = await t.player.html();
      t.check(!html.includes(CANARY), `${CANARY} is on the /player page`);
      const visibility = await t.tool('get-player-visibility', {});
      const seen = (visibility.tokens || []).map((/** @type {any} */ x) => x.tokenId);
      t.check(!seen.includes(hidden.tokenId), 'the hidden token is in get-player-visibility');
    });

    await t.step('the hidden combatant is not in the player combat', async () => {
      const ids = state.combat.combatants.map((/** @type {any} */ c) => c.id);
      t.equal(ids.length, 2, 'combatants the players see');
      t.check(!ids.includes(combat.combatantIds[2]), 'the hidden combatant is listed');
      t.check(ids.includes(combat.combatantIds[0]), 'the hero is listed');
      t.check(ids.includes(combat.combatantIds[1]), 'the visible monster is listed');
    });

    await t.step('monsters show no HP numbers and not their true name', async () => {
      const apeHp = (
        await t.gm('readActor', {
          actorId: visible.actorId,
          sceneId,
          tokenId: visible.tokenId,
        })
      ).hp;
      const text = JSON.stringify(state);
      t.check(!text.includes(visible.name), `${visible.name} (true name) is in /api/player/state`);
      for (const c of state.combat.combatants) {
        if (c.isPC) continue;
        t.check(c.hp === null, `a non-player combatant has HP numbers: ${JSON.stringify(c.hp)}`);
        t.check(BANDS.includes(c.hpBand), `hpBand is a word or null, not ${c.hpBand}`);
        const raw = JSON.stringify(c);
        t.check(
          !raw.includes(`"max":${apeHp.max}`) && !raw.includes(`"value":${apeHp.value}`),
          'the monster HP values appear in the combatant',
          raw
        );
      }
    });

    await t.step('the player hero shows its HP as numbers that match Foundry', async () => {
      const row = state.combat.combatants.find(
        (/** @type {any} */ c) => c.id === combat.combatantIds[0]
      );
      t.check(row, 'the player hero is not in the player combat');
      t.check(row.isPC === true, `the hero ${hero.name} is not a player character on the screen`);
      t.check(
        row.hpBand === null,
        `a player character has a band as well as numbers: ${row.hpBand}`
      );
      const real = (
        await t.gm('readActor', { actorId: hero.actorId, sceneId, tokenId: hero.tokenId })
      ).hp;
      t.check(row.hp !== null, 'a player character shows no HP numbers');
      t.equal(
        { value: row.hp.value, max: row.hp.max, temp: row.hp.temp },
        { value: real.value, max: real.max, temp: real.temp },
        'the player hero HP on the screen vs Foundry'
      );
      return `${row.hp.value}/${row.hp.max} HP`;
    });
  },
};

/**
 * Every kit monster is the compendium entry it was made from: same challenge rating, creature
 * type, size, hit point maximum and attacks, and its token stands on the kit scene.
 */
import { SIZE_CODES, listOf } from '../lib/helpers.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'compendium-monsters',
  title: 'Kit monsters match their compendium entries and have tokens on the kit scene',
  sizes: ['smoke', 'full'],
  tags: ['build', 'bridge'],
  needs: ['monsters', 'scene'],
  tools: ['get-compendium-item', 'get-character', 'get-token-positions'],
  timeoutMs: 120000,

  async run(t) {
    /** @type {any} */
    let positions;
    await t.step('get-token-positions lists the kit scene', async () => {
      positions = await t.tool('get-token-positions', { sceneId: t.kit.scene.sceneId });
      t.equal(positions.sceneId, t.kit.scene.sceneId, 'scene id');
      t.check(listOf(positions, 'tokens').length > 0, 'the scene has tokens');
    });

    for (const monster of t.kit.monsters) {
      await t.step(
        `${monster.cell}: ${monster.name}`,
        async () => {
          const entry = await t.tool('get-compendium-item', {
            packId: monster.packId,
            itemId: monster.itemId,
          });
          const source = (entry.fullData && entry.fullData.system) || {};
          const actor = await t.tool('get-character', { identifier: monster.name });
          const stats = actor.stats || {};

          t.equal(actor.id, monster.actorId, 'actor id');
          t.equal(source.details && source.details.cr, monster.cr, 'compendium CR vs the manifest');
          t.equal(stats.challengeRating, source.details.cr, 'actor CR vs the compendium');
          t.equal(
            source.details.type && source.details.type.value,
            monster.type,
            'compendium creature type vs the manifest'
          );
          t.equal(stats.creatureType, monster.type, 'actor creature type');
          const size = SIZE_CODES[monster.size] || monster.size;
          t.equal(source.traits && source.traits.size, size, 'compendium size vs the manifest');
          t.equal(stats.size, size, 'actor size');
          const max = source.attributes && source.attributes.hp && source.attributes.hp.max;
          t.check(max > 0, 'the compendium entry has a hit point maximum', max);
          t.equal(stats.hitPoints && stats.hitPoints.max, max, 'actor HP max vs the compendium');

          // The attacks and features came along.
          const have = new Set((actor.items || []).map((/** @type {any} */ i) => i.name));
          const lacking = (entry.items || [])
            .map((/** @type {any} */ i) => i.name)
            .filter((/** @type {string} */ name) => !have.has(name));
          t.check(lacking.length === 0, `the actor lacks items: ${lacking.join(', ')}`, lacking);

          // Its token is on the kit scene, in the open, inside the room.
          const token = listOf(positions, 'tokens').find(x => x.tokenId === monster.tokenId);
          t.check(token, `no token ${monster.tokenId} on the kit scene`);
          t.equal(token.actorId, monster.actorId, 'token actor');
          t.check(token.hidden === false, 'the token is visible');
          const inside =
            Number.isInteger(token.gridX) &&
            Number.isInteger(token.gridY) &&
            token.gridX >= 0 &&
            token.gridX < t.kit.scene.width &&
            token.gridY >= 0 &&
            token.gridY < t.kit.scene.height;
          t.check(inside, `token square ${token.gridX},${token.gridY} is outside the scene`);
          return `CR ${monster.cr} ${monster.type} ${monster.size}, ${max} HP, square ${token.gridX},${token.gridY}`;
        },
        { continueOnFail: true }
      );
    }
  },
};

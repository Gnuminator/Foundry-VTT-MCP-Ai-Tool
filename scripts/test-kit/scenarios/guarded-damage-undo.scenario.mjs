/**
 * The guarded write path end to end: plan, apply, see it in the recent changes, undo it, and
 * the document is exactly as it was. Also: healing never goes above the maximum.
 *
 * HP is read straight from the token's actor in the Foundry page (the GM action readActor), not
 * through the tool under test. Kit monsters have unlinked tokens, so the change lands on the
 * token's own actor.
 */
import { listOf, monsterOf } from '../lib/helpers.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'guarded-damage-undo',
  title: 'A guarded damage change applies, shows up, undoes exactly, and healing clamps at max',
  sizes: ['smoke', 'full'],
  tags: ['bridge', 'module', 'dashboard'],
  needs: ['monsters', 'scene'],
  tools: [
    'get-compendium-item',
    'plan-actor-change',
    'apply-planned-change',
    'list-recent-changes',
    'undo-change',
  ],
  gmActions: ['readActor'],
  timeoutMs: 90000,

  async run(t) {
    const monster = monsterOf(t.kit, 'beast');
    const read = () =>
      t.gm('readActor', {
        actorId: monster.actorId,
        sceneId: t.kit.scene.sceneId,
        tokenId: monster.tokenId,
      });
    /** Changes applied and not yet undone, newest last; the cleanup undoes what is left. */
    /** @type {string[]} */
    const open = [];
    /** @type {any} */
    let before;

    t.cleanup(async () => {
      while (open.length) await t.guarded.undo(/** @type {string} */ (open.pop()));
      if (!before) return;
      const now = await read();
      t.equal(now.hp, before.hp, 'HP after the clean-up');
    });

    await t.step(
      `${monster.name} starts at full HP and has no bludgeoning resistance`,
      async () => {
        before = await read();
        t.check(before.hp.max > 0, 'the monster has hit points', before.hp);
        t.equal(before.hp.value, before.hp.max, 'starting HP');
        const entry = await t.tool('get-compendium-item', {
          packId: monster.packId,
          itemId: monster.itemId,
        });
        const traits =
          (entry.fullData && entry.fullData.system && entry.fullData.system.traits) || {};
        for (const key of ['dr', 'di', 'dv']) {
          const values = (traits[key] && traits[key].value) || [];
          t.check(
            !values.includes('bludgeoning'),
            `${monster.name} has ${key} bludgeoning`,
            values
          );
        }
        return `${before.hp.value}/${before.hp.max} HP`;
      }
    );

    /** @type {{changeId: string, planId: string, plan: any}} */
    let damage;
    await t.step('plan and apply 5 bludgeoning damage; HP drops by exactly 5', async () => {
      damage = await t.guarded.planApply('plan-actor-change', {
        action: 'damage',
        targets: [monster.name],
        amount: 5,
        damageType: 'bludgeoning',
      });
      open.push(damage.changeId);
      const after = await read();
      t.equal(after.hp.value, before.hp.value - 5, 'HP after 5 damage');
      return `${before.hp.value} to ${after.hp.value}`;
    });

    await t.step('list-recent-changes lists it and it can be undone', async () => {
      const row = listOf(await t.tool('list-recent-changes', { limit: 20 }), 'changes').find(
        c => c.changeId === damage.changeId
      );
      t.check(row, `change ${damage.changeId} is not in list-recent-changes`);
      t.check(row.canUndo === true, 'the change says canUndo', row);
      t.equal(row.mode, 'apply', 'change mode');
    });

    await t.step('undo restores HP exactly and the change can no longer be undone', async () => {
      const undone = await t.guarded.undo(damage.changeId);
      open.pop();
      t.equal(undone.undoOf, damage.changeId, 'the undo points at the change');
      const after = await read();
      t.equal(after.hp, before.hp, 'HP after the undo');
      const row = listOf(await t.tool('list-recent-changes', { limit: 20 }), 'changes').find(
        c => c.changeId === damage.changeId
      );
      t.check(row && row.canUndo === false, 'the undone change still says canUndo', row);
    });

    await t.step('healing above the maximum stops at the maximum, and undoes', async () => {
      const hurt = await t.guarded.planApply('plan-actor-change', {
        action: 'damage',
        targets: [monster.name],
        amount: 5,
        damageType: 'bludgeoning',
      });
      open.push(hurt.changeId);
      t.equal((await read()).hp.value, before.hp.value - 5, 'HP after the second damage');

      const healed = await t.guarded.planApply('plan-actor-change', {
        action: 'healing',
        targets: [monster.name],
        amount: before.hp.max * 5,
      });
      open.push(healed.changeId);
      const after = await read();
      t.equal(after.hp.value, before.hp.max, 'HP after a heal far above the maximum');
      t.equal(after.hp.max, before.hp.max, 'HP maximum is unchanged');

      await t.guarded.undo(/** @type {string} */ (open.pop()));
      t.equal((await read()).hp.value, before.hp.value - 5, 'HP after undoing the heal');
      await t.guarded.undo(/** @type {string} */ (open.pop()));
      t.equal((await read()).hp, before.hp, 'HP after undoing the damage');
    });
  },
};

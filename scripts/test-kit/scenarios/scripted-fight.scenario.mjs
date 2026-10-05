/**
 * A short scripted fight, then the play log: two heroes and two monsters, fixed hero
 * initiatives, a full round into round two, one monster attack, damage on a monster and on a
 * hero. The combat tools, the play-by-play, the session log and the play stats must all tell the
 * same story, and the stats must equal the HP changes read straight from the Foundry page.
 *
 * Needs a play session: it starts one with mark-play-session and ends it again when it is done.
 */
import { listOf, monsterOf, waitFor } from '../lib/helpers.mjs';

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'scripted-fight',
  title: 'A scripted fight shows up in combat state, play-by-play, session log and play stats',
  sizes: ['smoke', 'full'],
  tags: ['playlog', 'module', 'bridge'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: [
    'mark-play-session',
    'roll-initiative-for-npcs',
    'set-initiative',
    'get-combat-state',
    'advance-combat-turn',
    'get-character',
    'use-npc-activity',
    'plan-actor-change',
    'apply-planned-change',
    'undo-change',
    'get-combat-play-by-play',
    'get-session-log',
    'get-play-stats',
  ],
  gmActions: ['startCombat', 'endCombats', 'readActor'],
  timeoutMs: 180000,

  async run(t) {
    const [hero1, hero2] = t.kit.heroes;
    const ape = monsterOf(t.kit, 'beast');
    const baboon = monsterOf(t.kit, 'cr0');
    const names = [hero1.name, hero2.name, ape.name, baboon.name];
    const sceneId = t.kit.scene.sceneId;
    const readHp = (/** @type {{actorId: string, tokenId?: string}} */ who) =>
      t.gm('readActor', { actorId: who.actorId, sceneId, tokenId: who.tokenId }).then(r => r.hp);
    /** @type {string[]} */
    const open = [];
    /** @type {any} */
    let hpBefore;

    // Cleanups run last in, first out: undo the HP changes, end the combat, end the session.
    t.cleanup(async () => {
      await t.tool('mark-play-session', { action: 'end', note: 'test kit scripted fight' });
    });
    t.cleanup(async () => {
      await t.gm('endCombats');
    });
    t.cleanup(async () => {
      while (open.length) await t.guarded.undo(/** @type {string} */ (open.pop()));
      if (!hpBefore) return;
      for (const [key, who] of [
        ['ape', ape],
        ['hero', hero2],
      ]) {
        t.equal(await readHp(who), hpBefore[key], `${who.name} HP after the clean-up`);
      }
    });

    await t.step('start a play session and read the starting HP', async () => {
      const marked = await t.tool('mark-play-session', {
        action: 'start',
        note: 'test kit scripted fight',
      });
      t.check(marked.success === true, 'mark-play-session start', marked);
      hpBefore = { ape: await readHp(ape), hero: await readHp(hero2) };
    });

    /** @type {{combatId: string, combatantIds: string[]}} */
    let combat;
    await t.step('start a combat with two heroes and two monsters', async () => {
      combat = await t.gm('startCombat', {
        sceneId,
        tokenIds: [hero1.tokenId, hero2.tokenId, ape.tokenId, baboon.tokenId],
      });
      t.equal(combat.combatantIds.length, 4, 'combatants');
    });

    await t.step('roll-initiative-for-npcs rolls for the monsters', async () => {
      const rolled = await t.tool('roll-initiative-for-npcs', { scope: 'npcs' });
      t.check(rolled.success === true, 'roll-initiative-for-npcs succeeded', rolled);
      for (const name of [ape.name, baboon.name]) {
        const entry = (rolled.order || []).find((/** @type {any} */ o) => o.name === name);
        t.check(
          entry && Number.isFinite(entry.initiative),
          `${name} has an initiative`,
          rolled.order
        );
      }
    });

    await t.step('set-initiative fixes the heroes: one first, one last', async () => {
      // 40 beats any d20 roll plus modifier; 0 is below any monster's roll.
      await t.tool('set-initiative', { combatantName: hero1.name, initiative: 40 });
      await t.tool('set-initiative', { combatantName: hero2.name, initiative: 0 });
    });

    /** @type {string[]} */
    let order = [];
    await t.step('get-combat-state orders the combatants by initiative', async () => {
      const state = await t.tool('get-combat-state', {});
      t.check(state.active === true, 'the combat is active', state);
      const rows = state.combatants || [];
      order = rows.map((/** @type {any} */ c) => c.name);
      t.equal([...order].sort(), [...names].sort(), 'combatants in the tracker');
      const values = rows.map((/** @type {any} */ c) => c.initiative);
      const sorted = [...values].sort((a, b) => b - a);
      t.equal(values, sorted, 'the order follows initiative, highest first');
      t.equal(rows[0].name, hero1.name, 'the first combatant');
      t.equal(rows[0].initiative, 40, 'the first initiative');
      t.equal(rows[rows.length - 1].name, hero2.name, 'the last combatant');
      t.equal(rows[rows.length - 1].initiative, 0, 'the last initiative');
      return order.join(' > ');
    });

    await t.step('advance-combat-turn goes through a full round into round 2', async () => {
      let state = await t.tool('get-combat-state', {});
      const startRound = state.round;
      for (let i = 0; i < names.length + 1 && state.round === startRound; i++) {
        const moved = await t.tool('advance-combat-turn', {});
        t.check(moved.success === true, 'advance-combat-turn succeeded', moved);
        state = await t.tool('get-combat-state', {});
      }
      t.equal(state.round, startRound + 1, 'the round after a full round');
      t.equal(state.turn, 0, 'the turn at the start of the new round');
      t.equal(state.current && state.current.name, order[0], 'the first combatant acts again');
    });

    /** @type {any} */
    let attack;
    await t.step('a monster attacks with use-npc-activity', async () => {
      const sheet = await t.tool('get-character', { identifier: ape.name });
      const weapon = (sheet.items || []).find((/** @type {any} */ i) => i.type === 'weapon');
      t.check(weapon, `${ape.name} has no weapon item`, sheet.items);
      attack = await t.tool('use-npc-activity', {
        actorName: ape.name,
        itemName: weapon.name,
        targetAC: 15,
      });
      t.check(
        attack.success === true && attack.hadAttack === true,
        'the attack was rolled',
        attack
      );
      t.check(Number.isFinite(attack.attackTotal), 'the attack has a total', attack);
      return `${weapon.name}: ${attack.attackTotal}`;
    });

    /** @type {Record<string, number>} */
    const lost = {};
    await t.step('guarded damage on the monster and on a hero; HP deltas are read', async () => {
      for (const [who, amount, type] of /** @type {const} */ ([
        [ape, 5, 'bludgeoning'],
        [hero2, 3, 'slashing'],
      ])) {
        const change = await t.guarded.planApply('plan-actor-change', {
          action: 'damage',
          targets: [who.name],
          amount,
          damageType: type,
        });
        open.push(change.changeId);
        const before = (who === ape ? hpBefore.ape : hpBefore.hero).value;
        lost[who.name] = before - (await readHp(who)).value;
      }
      t.equal(lost[ape.name], 5, `${ape.name} HP lost`);
      t.check(lost[hero2.name] > 0 && lost[hero2.name] <= 3, `${hero2.name} HP lost`, lost);
      return `${ape.name} -${lost[ape.name]}, ${hero2.name} -${lost[hero2.name]}`;
    });

    await t.step('get-combat-play-by-play has the rounds and the attack', async () => {
      const pbp = await waitFor(
        async () => {
          const r = await t.tool('get-combat-play-by-play', {});
          const actions = listOf(r, 'rounds').flatMap(round =>
            (round.turns || []).flatMap((/** @type {any} */ turn) => turn.actions || [])
          );
          return actions.some(a => a.actor === ape.name && a.rollTotal === attack.attackTotal)
            ? r
            : null;
        },
        { label: `${ape.name}'s attack in the play-by-play`, timeoutMs: 20000 }
      );
      t.check(pbp.totalRounds >= 2, 'the play-by-play counts two rounds', pbp.totalRounds);
      const rounds = listOf(pbp, 'rounds').map(r => r.round);
      t.check(rounds.includes(1) && rounds.includes(2), 'rounds 1 and 2 are listed', rounds);
    });

    await t.step('get-session-log has the events in order', async () => {
      const events = await waitFor(
        async () => {
          const log = await t.tool('get-session-log', { limit: 300 });
          // Only what happened after this combat started (earlier scenarios log HP changes too).
          const all = listOf(log, 'events');
          const from = all.findIndex(
            e => e.eventType === 'combat-start' && e.details.combatId === combat.combatId
          );
          if (from < 0) return null;
          const mine = all.slice(from);
          const damaged = mine.filter(e => e.eventType === 'damage');
          return [ape.name, hero2.name].every(n => damaged.some(e => e.actorName === n))
            ? mine
            : null;
        },
        { label: 'the damage events in the session log', timeoutMs: 20000 }
      );
      t.attach(
        'session-log',
        events.map(e => ({ type: e.eventType, actor: e.actorName, text: e.description }))
      );
      const at = (/** @type {(e: any) => boolean} */ match) => events.findIndex(match);
      const attackRoll = at(
        e => e.eventType === 'roll' && e.actorName === ape.name && e.details.rollType === 'attack'
      );
      const damageRoll = at(e => e.eventType === 'damage-roll' && e.actorName === ape.name);
      const apeHit = at(e => e.eventType === 'damage' && e.actorName === ape.name);
      const heroHit = at(e => e.eventType === 'damage' && e.actorName === hero2.name);
      t.equal(events[0].details.combatId, combat.combatId, 'the log starts at this combat');
      t.check(attackRoll > 0, 'the attack roll comes after combat-start', attackRoll);
      t.check(damageRoll > attackRoll, 'the damage roll comes after the attack roll');
      t.check(apeHit > damageRoll, `the HP loss of ${ape.name} comes after the damage roll`);
      t.check(heroHit > apeHit, `the HP loss of ${hero2.name} comes last`);
      t.equal(events[apeHit].details.amount, lost[ape.name], 'logged damage of the monster');
      t.equal(events[heroHit].details.amount, lost[hero2.name], 'logged damage of the hero');
      t.check(
        events.some(e => e.eventType === 'gm-change'),
        'the guarded changes are logged'
      );
    });

    await t.step('get-play-stats damage totals equal the HP deltas', async () => {
      const combatStats = await waitFor(
        async () => {
          const stats = await t.tool('get-play-stats', {});
          const found = ((stats.session && stats.session.combats) || []).find(
            (/** @type {any} */ c) => c.combatId === combat.combatId
          );
          const taken = (found && found.damageTaken) || {};
          return found && taken[ape.name] === lost[ape.name] ? found : null;
        },
        { label: 'the combat in the play stats', timeoutMs: 30000 }
      );
      t.equal(combatStats.damageTaken[ape.name], lost[ape.name], `${ape.name} damage taken`);
      t.equal(combatStats.damageTaken[hero2.name], lost[hero2.name], `${hero2.name} damage taken`);
      t.check(combatStats.rounds >= 2, 'the combat shows two rounds', combatStats.rounds);
      for (const name of names) {
        t.check(combatStats.participants.includes(name), `${name} took part in the combat`);
      }
    });
  },
};

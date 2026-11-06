/**
 * Combat flows with real kit characters (Backlog real-character-flows, G1). Each step is a bug
 * that in-memory unit tests missed and a real world showed. It uses the kit's built heroes (real
 * actors with owners, tokens and items) and the kit's second user, never made-up documents,
 * except the one side scene (the only thing a "not viewed" fight needs).
 *
 *  1. An assigned character beside a second owned actor (PR 573): a player who owns two actors
 *     gets the roll for the character assigned to them, not the first actor they own.
 *  2. A poisoned roll with Automated Conditions (PR 562): the roll-request button rolls through
 *     dnd5e, so a poisoned character rolls with disadvantage. Skips when AC5e is not active.
 *  3. A timed condition put on by the AI and undone after turns have passed (PR 705): Foundry
 *     rewrites the effect as turns pass, which must not read as someone's edit.
 *  4. A drop to 0 HP and its undo (PR 608): HP and the Unconscious rider come back together.
 *  5. A fight on a scene the GM is not viewing (PR 608): start, turn and end work without
 *     `game.combat`.
 *  6. A headless write without a canvas (PR 651): `use-item` with targets on a client that has
 *     `core.noCanvas` on and no canvas drawn.
 *
 * Each check except the 0 HP one fails on the code before its fix (that one is a regression guard);
 * the PR description names how that was shown.
 * Everything the scenario changes is put back (ownership, assigned character, statuses, HP, the
 * side scene, the fights, the viewed scene's canvas).
 */
import { builtHeroes, listOf, monsterOf, tokenHeroes, waitFor } from '../lib/helpers.mjs';

const AC5E = 'automated-conditions-5e';

/** Runs in the Foundry GM page: ids of the chat messages there are now. */
const MESSAGE_IDS = () => game.messages.contents.map(m => m.id);

/** Runs in the Foundry GM page: the roll buttons and rolls of the chat messages made since `known`. */
const NEW_ROLLS = ({ known }) => {
  const seen = new Set(known);
  const out = { buttons: [], rolls: [] };
  for (const m of game.messages.contents) {
    if (seen.has(m.id)) continue;
    const doc = new DOMParser().parseFromString(m.content ?? '', 'text/html');
    for (const b of doc.querySelectorAll('.mcp-roll-button')) {
      out.buttons.push({
        id: b.getAttribute('data-button-id') ?? '',
        label: b.textContent.trim(),
      });
    }
    for (const r of m.rolls ?? []) {
      out.rolls.push({
        formula: r.formula,
        advantageMode: r.options?.advantageMode ?? null,
        speakerActor: m.speaker?.actor ?? null,
        flavor: m.flavor ?? '',
      });
    }
  }
  return out;
};

/** Runs in the Foundry GM page: click a roll button in the chat log, as the GM would. */
const CLICK_BUTTON = ({ buttonId }) => {
  const b = document.querySelector(`.mcp-roll-button[data-button-id="${buttonId}"]`);
  if (!b) return false;
  b.click();
  return true;
};

/** Runs in the Foundry GM page: delete the chat messages made since `known`. */
const DELETE_MESSAGES = async ({ known }) => {
  const seen = new Set(known);
  for (const m of game.messages.contents) if (!seen.has(m.id)) await m.delete();
};

/** Runs in the Foundry GM page: which actors a user owns (in the order `game.actors` lists them) and the assigned one. */
const READ_USER = ({ userName }) => {
  const user = game.users.getName(userName);
  if (!user) return { error: `no user ${userName}` };
  return {
    userId: user.id,
    character: user.character?.id ?? null,
    owned: game.actors.filter(a => a.testUserPermission(user, 'OWNER')).map(a => ({ id: a.id, name: a.name })),
    ownership: Object.fromEntries(game.actors.map(a => [a.id, a.ownership?.[user.id] ?? null])),
  };
};

/** Runs in the Foundry GM page: assign a character to a user (null clears it). */
const SET_CHARACTER = async ({ userName, actorId }) => {
  const user = game.users.getName(userName);
  if (!user) return { error: `no user ${userName}` };
  await user.update({ character: actorId });
  return { character: user.character?.id ?? null };
};

/**
 * Runs in the Foundry GM page: set an actor's ownership level for a user. No entry before (null)
 * goes back as level 0 (None): Foundry refuses a null entry, and None reads the same.
 */
const SET_OWNERSHIP = async ({ actorId, userName, level }) => {
  const actor = game.actors.get(actorId);
  const user = game.users.getName(userName);
  if (!actor || !user) return { error: 'no actor or user' };
  await actor.update({ [`ownership.${user.id}`]: level === null ? 0 : Number(level) });
  return { level: actor.ownership?.[user.id] ?? null };
};

/** Runs in the Foundry GM page: add or remove a status on a world actor. */
const TOGGLE_STATUS = async ({ actorId, status, active }) => {
  const actor = game.actors.get(actorId);
  if (!actor) return { error: 'no actor' };
  await actor.toggleStatusEffect(status, { active });
  return { has: actor.statuses.has(status) };
};

/** Runs in the Foundry GM page: is AC5e active? */
const AC5E_ACTIVE = ({ id }) => !!game.modules.get(id)?.active;

/** Runs in the Foundry GM page: the actor's status ids, HP and the effect documents' names. */
const READ_ACTOR = ({ actorId }) => {
  const a = game.actors.get(actorId);
  if (!a) return { error: 'no actor' };
  const hp = a.system.attributes.hp;
  return {
    hp: { value: hp.value, max: hp.max, temp: hp.temp ?? 0 },
    statuses: [...a.statuses].sort(),
    effects: a.effects.map(e => ({ id: e.id, name: e.name, statuses: [...e.statuses] })),
  };
};

/** Runs in the Foundry GM page: make a side scene (never viewed) with tokens of these actors. */
const MAKE_SIDE_SCENE = async ({ name, actorIds, flag }) => {
  const scene = await Scene.create({
    name,
    width: 1200,
    height: 800,
    grid: { size: 100 },
    flags: { [flag.scope]: { [flag.key]: { built: true } } },
  });
  const tokens = [];
  let x = 200;
  for (const id of actorIds) {
    const actor = game.actors.get(id);
    const doc = await actor.getTokenDocument({ x, y: 300 });
    tokens.push(doc.toObject());
    x += 200;
  }
  const created = await scene.createEmbeddedDocuments('Token', tokens);
  return {
    sceneId: scene.id,
    tokenIds: created.map(t => t.id),
    viewed: canvas.scene?.id ?? null,
    gameCombat: game.combat?.id ?? null,
  };
};

/** Runs in the Foundry GM page: delete the side scene and any fight on it. */
const DELETE_SIDE_SCENE = async ({ sceneId }) => {
  const scene = game.scenes.get(sceneId);
  if (!scene) return { deleted: false };
  const ids = game.combats.filter(c => c.scene?.id === sceneId).map(c => c.id);
  if (ids.length) await Combat.deleteDocuments(ids);
  await scene.delete();
  return { deleted: true, combats: ids.length };
};

/** Runs in the Foundry GM page: the state of the combats (which scene, started, round). */
const READ_COMBATS = () => ({
  gameCombat: game.combat?.id ?? null,
  viewed: canvas.scene?.id ?? null,
  combats: game.combats.map(c => ({ id: c.id, scene: c.scene?.id ?? null, round: c.round, started: c.started })),
});

/**
 * Runs in the Foundry GM page: put this client in the headless state the Pi's Assistant GM runs in
 * (`core.noCanvas` on, no canvas drawn). Reports what it could do.
 */
const GO_HEADLESS = async () => {
  const before = { noCanvas: game.settings.get('core', 'noCanvas'), ready: !!canvas.ready };
  // A client setting; read at call time by the bridge handler. Its reload prompt is a dialog only.
  await game.settings.set('core', 'noCanvas', true);
  // Drawing no scene leaves canvas.ready false, as a client that never draws one has it.
  if (canvas.ready) await canvas.draw(null);
  return { before, noCanvas: game.settings.get('core', 'noCanvas'), ready: !!canvas.ready };
};

/** Runs in the Foundry GM page: back to a normal client, with the scene drawn again. */
const LEAVE_HEADLESS = async ({ sceneId }) => {
  await game.settings.set('core', 'noCanvas', false);
  const scene = game.scenes.get(sceneId);
  if (scene && !canvas.ready) await canvas.draw(scene);
  // Targets the headless call may have left.
  game.user.targets.clear?.();
  return { noCanvas: game.settings.get('core', 'noCanvas'), ready: !!canvas.ready, viewed: canvas.scene?.id ?? null };
};

/** Runs in the Foundry GM page: the targets set the user holds (document ids, whatever they are). */
const READ_TARGETS = () => [...game.user.targets].map(x => x.document?.id ?? x.id);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * The roll mode a formula shows: two d20s keeping the lower is disadvantage, the higher advantage,
 * one d20 normal.
 * @param {string} formula
 */
export function modeOfFormula(formula) {
  const m = /^(\d+)d20(kl|kh)?/.exec(String(formula).trim());
  if (!m) return 'other';
  if (m[2] === 'kl' && m[1] !== '1') return 'disadvantage';
  if (m[2] === 'kh' && m[1] !== '1') return 'advantage';
  return m[1] === '1' ? 'normal' : 'other';
}

const rollMode = roll =>
  roll?.advantageMode === -1
    ? 'disadvantage'
    : roll?.advantageMode === 1
      ? 'advantage'
      : modeOfFormula(roll?.formula ?? '');

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'real-character-flows',
  title: 'Combat flows with real characters: assigned character, poisoned roll, timed condition undo, 0 HP undo, fight on an unviewed scene, no-canvas write',
  sizes: ['smoke', 'full'],
  tags: ['bridge', 'module', 'playlog'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: [
    'request-ability-check',
    'set-initiative',
    'get-combat-state',
    'advance-combat-turn',
    'plan-actor-change',
    'plan-combat-change',
    'apply-planned-change',
    'undo-change',
    'list-recent-changes',
    'get-character',
    'use-item',
  ],
  gmActions: ['readActor', 'startCombat', 'endCombats'],
  timeoutMs: 420000,

  async run(t) {
    if (t.fake || !t.page) t.skip('needs the real Foundry GM page');
    const page = t.page;
    const sceneId = t.kit.scene.sceneId;
    const heroes = tokenHeroes(t.kit);
    if (heroes.length < 3) t.skip('needs three heroes with tokens on the kit scene');
    const owner = builtHeroes(t.kit).find(h => h.owner);
    if (!owner) t.skip('the kit has no hero with an owner');
    const PLAYER = owner.owner;
    // Two owned actors for the player: the kit's own player hero and a second hero.
    const first = owner;
    const second = heroes.find(h => h.actorId !== first.actorId);
    // The two heroes of the fights (not the player's): `druid` and `cleric` are only labels.
    const [cleric, druid] = heroes.filter(h => h.actorId !== first.actorId && h.actorId !== second.actorId);
    const flag = { scope: 'world', key: 'testKit' };
    const known = await page.evaluate(MESSAGE_IDS);

    /** Changes applied and not yet undone; the cleanup undoes what is left. */
    /** @type {string[]} */
    const open = [];
    /** @type {any} */
    let userBefore;
    let sideSceneId = null;
    let headless = false;

    t.cleanup(async () => {
      if (headless) await page.evaluate(LEAVE_HEADLESS, { sceneId });
    });
    t.cleanup(async () => {
      if (sideSceneId) await page.evaluate(DELETE_SIDE_SCENE, { sceneId: sideSceneId });
    });
    t.cleanup(async () => {
      await t.gm('endCombats');
    });
    t.cleanup(async () => {
      while (open.length) await t.guarded.undo(/** @type {string} */ (open.pop()));
    });
    t.cleanup(async () => {
      await page.evaluate(TOGGLE_STATUS, { actorId: first.actorId, status: 'poisoned', active: false });
      await page.evaluate(DELETE_MESSAGES, { known });
    });
    t.cleanup(async () => {
      if (!userBefore) return;
      await page.evaluate(SET_CHARACTER, { userName: PLAYER, actorId: userBefore.character });
      for (const a of [first, second]) {
        await page.evaluate(SET_OWNERSHIP, {
          actorId: a.actorId,
          userName: PLAYER,
          level: userBefore.ownership[a.actorId],
        });
      }
    });

    // The two roll requests need the player user online.
    if (!t.joinFoundry) t.skip('needs a second Foundry page for the kit player');
    await t.step('the kit player is online', async () => {
      const player = await t.joinFoundry(PLAYER);
      t.check(player?.page, 'the kit player could not join');
    });

    /**
     * Posts a roll request for the player, clicks its button as the GM and returns the roll that made.
     * @param {string} ability
     */
    const requestAndRoll = async ability => {
      const before = await page.evaluate(MESSAGE_IDS);
      await t.tool('request-ability-check', { targetPlayer: PLAYER, ability, isPublic: true }, { confirm: true });
      const posted = await page.evaluate(NEW_ROLLS, { known: before });
      const b = posted.buttons[0];
      t.check(b, 'a roll button was posted', posted);
      const beforeClick = await page.evaluate(MESSAGE_IDS);
      t.check(await page.evaluate(CLICK_BUTTON, { buttonId: b.id }), 'the button is in the chat log');
      let roll;
      for (let i = 0; i < 30 && !roll; i++) {
        await sleep(500);
        roll = (await page.evaluate(NEW_ROLLS, { known: beforeClick })).rolls[0];
      }
      t.check(roll, 'clicking the button made a roll');
      return roll;
    };

    // --- 1. Assigned character beside a second owned actor (PR 573) -----------------------
    /** @type {{assigned: any, other: any}} */
    let pair;
    await t.step('the player owns two actors; the assigned one is not the first they own', async () => {
      userBefore = await page.evaluate(READ_USER, { userName: PLAYER });
      t.check(!userBefore.error, `no user ${PLAYER}`, userBefore);
      for (const a of [first, second]) {
        const r = await page.evaluate(SET_OWNERSHIP, { actorId: a.actorId, userName: PLAYER, level: 3 });
        t.check(!r.error, `ownership for ${a.name}`, r);
      }
      const now = await page.evaluate(READ_USER, { userName: PLAYER });
      const ownedIds = now.owned.map(o => o.id);
      t.check(
        ownedIds.includes(first.actorId) && ownedIds.includes(second.actorId),
        'the player owns both actors',
        now.owned
      );
      // The old code rolled for the first actor in game.actors order; assign the other one.
      const firstOwned = now.owned.find(o => o.id === first.actorId || o.id === second.actorId);
      const assigned = firstOwned.id === first.actorId ? second : first;
      const other = firstOwned.id === first.actorId ? first : second;
      const set = await page.evaluate(SET_CHARACTER, { userName: PLAYER, actorId: assigned.actorId });
      t.equal(set.character, assigned.actorId, 'the assigned character');
      pair = { assigned, other };
      return `assigned ${assigned.name}, other owned ${other.name}`;
    });

    await t.step('the roll request rolls for the assigned character', async () => {
      const roll = await requestAndRoll('str');
      t.equal(roll.speakerActor, pair.assigned.actorId, `the roll's speaker (${roll.formula})`);
    });

    // --- 2. Poisoned roll with Automated Conditions (PR 562) -------------------------------
    await t.step('a poisoned assigned character rolls with disadvantage (Automated Conditions)', async () => {
      if (!(await page.evaluate(AC5E_ACTIVE, { id: AC5E }))) t.skip('Automated Conditions 5e is not active in this kit world');
      const base = await requestAndRoll('str');
      t.equal(rollMode(base), 'normal', `the unpoisoned roll (${base.formula})`);
      const r = await page.evaluate(TOGGLE_STATUS, { actorId: pair.assigned.actorId, status: 'poisoned', active: true });
      t.check(r.has, 'poisoned is on', r);
      try {
        const roll = await requestAndRoll('str');
        t.equal(rollMode(roll), 'disadvantage', `the poisoned roll (${roll.formula})`);
        return roll.formula;
      } finally {
        await page.evaluate(TOGGLE_STATUS, { actorId: pair.assigned.actorId, status: 'poisoned', active: false });
      }
    });

    // --- A fight on the viewed kit scene for the condition and 0 HP steps -------------------
    /** @type {any} */
    let hpBefore;
    await t.step('set-up: a fight on the kit scene with two heroes', async () => {
      await t.gm('endCombats');
      const combat = await t.gm('startCombat', { sceneId, tokenIds: [druid.tokenId, cleric.tokenId] });
      t.equal(combat.combatantIds.length, 2, 'combatants');
      await t.tool('set-initiative', { combatantName: druid.name, initiative: 30 });
      await t.tool('set-initiative', { combatantName: cleric.name, initiative: 10 });
      hpBefore = await page.evaluate(READ_ACTOR, { actorId: cleric.actorId });
      t.check(hpBefore.hp.value > 0, 'the cleric has HP', hpBefore);
    });

    // --- 3. Timed condition undo after turns (PR 705) -------------------------------------
    await t.step('a timed condition put on by the AI is undone after turns have passed', async () => {
      const applied = await t.guarded.planApply('plan-actor-change', {
        action: 'condition',
        targets: [druid.name],
        condition: 'blinded',
        rounds: 1,
      });
      open.push(applied.changeId);
      t.check(
        (await page.evaluate(READ_ACTOR, { actorId: druid.actorId })).statuses.includes('blinded'),
        'blinded is on after the apply'
      );
      // Past the holder's next turn start: two turns of a two-creature fight is a new round.
      for (let i = 0; i < 3; i++) {
        const moved = await t.tool('advance-combat-turn', {});
        t.check(moved.success === true, 'advance-combat-turn', moved);
        await sleep(800);
      }
      const state = await t.tool('get-combat-state', {});
      const row = (state.combatants || []).find(c => c.name === druid.name);
      t.log(`after the turns: round ${state.round}, ${druid.name} conditions ${JSON.stringify(row?.conditions)} timed ${JSON.stringify(row?.timed)}`);
      const undone = await t.guarded.undo(/** @type {string} */ (open.pop()));
      t.equal(undone.undoOf, applied.changeId, 'the undo points at the change');
      const after = await page.evaluate(READ_ACTOR, { actorId: druid.actorId });
      t.check(!after.statuses.includes('blinded'), 'blinded is gone after the undo', after);
    });

    // --- 4. A drop to 0 HP and its undo (PR 608) ------------------------------------------
    await t.step('a drop to 0 HP undoes together with its dnd5e follow-ups', async () => {
      const damage = await t.guarded.planApply('plan-actor-change', {
        action: 'damage',
        targets: [cleric.name],
        amount: hpBefore.hp.value + hpBefore.hp.temp + 20,
        damageType: 'force',
      });
      open.push(damage.changeId);
      const down = await page.evaluate(READ_ACTOR, { actorId: cleric.actorId });
      t.equal(down.hp.value, 0, 'HP at the drop');
      // dnd5e's own follow-ups (Unconscious, Prone) come a moment later; give them time.
      await sleep(4000);
      const rows = listOf(await t.tool('list-recent-changes', { limit: 20 }), 'changes');
      const row = rows.find(c => c.changeId === damage.changeId);
      t.check(row && row.canUndo === true, 'the AI change is listed and can be undone', row);
      const downAfter = await page.evaluate(READ_ACTOR, { actorId: cleric.actorId });
      t.log(`at 0 HP the statuses are ${JSON.stringify(downAfter.statuses)}`);
      await t.guarded.undo(/** @type {string} */ (open.pop()));
      // dnd5e's bloodied and unconscious riders follow the HP a moment after the write.
      let up = await page.evaluate(READ_ACTOR, { actorId: cleric.actorId });
      for (let i = 0; i < 20 && up.statuses.join() !== hpBefore.statuses.join(); i++) {
        await sleep(500);
        up = await page.evaluate(READ_ACTOR, { actorId: cleric.actorId });
      }
      t.equal(up.hp, hpBefore.hp, 'HP after the undo');
      t.equal(up.statuses, hpBefore.statuses, 'statuses after the undo (the riders came off with the HP)');
    });

    await t.step('a monster dropped to 0 HP undoes with the rider dnd5e added (unlinked token)', async () => {
      const monster = monsterOf(t.kit, 'beast');
      const read = () => t.gm('readActor', { actorId: monster.actorId, sceneId, tokenId: monster.tokenId });
      const before = await read();
      const damage = await t.guarded.planApply('plan-actor-change', {
        action: 'damage',
        targets: [monster.name],
        amount: before.hp.value + 20,
        damageType: 'force',
      });
      open.push(damage.changeId);
      await sleep(4000);
      const down = await read();
      t.equal(down.hp.value, 0, 'HP at the drop');
      t.log(`${monster.name} at 0 HP: conditions ${JSON.stringify(down.conditions)} (before ${JSON.stringify(before.conditions)})`);
      t.check(
        down.conditions.length > before.conditions.length,
        'dnd5e added a rider (Unconscious or Dead) at 0 HP',
        down.conditions
      );
      const row = listOf(await t.tool('list-recent-changes', { limit: 20 }), 'changes').find(
        c => c.changeId === damage.changeId
      );
      t.check(row && row.canUndo === true, 'the AI change is listed and can be undone', row);
      await t.guarded.undo(/** @type {string} */ (open.pop()));
      let up = await read();
      for (let i = 0; i < 20 && up.conditions.join() !== before.conditions.join(); i++) {
        await sleep(500);
        up = await read();
      }
      t.equal(up.hp, before.hp, 'HP after the undo');
      t.equal(up.conditions, before.conditions, 'conditions after the undo (the rider came off)');
    });

    // --- 5. A fight on a scene the GM is not viewing (PR 608) -----------------------------
    await t.step('a fight on a scene the GM is not viewing starts, turns and ends', async () => {
      await t.gm('endCombats');
      // Earlier steps' pending undos stay in `open` for the cleanup; this step drops only its own.
      const openMark = open.length;
      const made = await page.evaluate(MAKE_SIDE_SCENE, {
        name: 'Kit Flows Side Scene',
        actorIds: [druid.actorId, cleric.actorId],
        flag,
      });
      sideSceneId = made.sceneId;
      t.check(made.viewed !== made.sceneId, 'the GM does not view the side scene', made);
      t.equal(made.gameCombat, null, 'no live combat on the viewed scene');
      const started = await t.guarded.planApply('plan-combat-change', {
        action: 'start',
        sceneId: made.sceneId,
        tokenIds: made.tokenIds,
      });
      open.push(started.changeId);
      const seen = await page.evaluate(READ_COMBATS);
      t.equal(seen.gameCombat, null, 'game.combat is still null: the fight is on another scene');
      t.check(seen.combats.some(c => c.scene === made.sceneId), 'the fight belongs to the side scene', seen);
      await t.tool('set-initiative', { combatantName: druid.name, initiative: 30 });
      await t.tool('set-initiative', { combatantName: cleric.name, initiative: 10 });
      const state = await t.tool('get-combat-state', {});
      t.equal((state.combatants || []).length, 2, 'get-combat-state finds the fight');
      const moved = await t.tool('advance-combat-turn', {});
      t.check(moved.success === true, 'advance-combat-turn on the unviewed fight', moved);
      const ended = await t.guarded.planApply('plan-combat-change', { action: 'end' });
      open.push(ended.changeId);
      t.equal((await page.evaluate(READ_COMBATS)).combats.filter(c => c.scene === made.sceneId).length, 0, 'the fight is over');
      await t.guarded.undo(/** @type {string} */ (open.pop()));
      t.equal((await page.evaluate(READ_COMBATS)).combats.filter(c => c.scene === made.sceneId).length, 1, 'the undo brought the fight back');
      // The undo of the end re-created the combat, so the first change (the start) now conflicts;
      // deleting the side scene in the cleanup removes the fight.
      open.length = openMark;
    });

    // --- 6. A headless write without a canvas (PR 651) --------------------------------------
    await t.step('use-item with targets works on a client with no canvas', async () => {
      const monster = monsterOf(t.kit, 'beast');
      /** @type {any} */
      let weapon;
      let user = second;
      for (const h of heroes) {
        const sheet = await t.tool('get-character', { identifier: h.name });
        weapon = (sheet.items || []).find(i => i.type === 'weapon');
        if (weapon) {
          user = h;
          break;
        }
      }
      t.check(weapon, 'one of the heroes has a weapon');
      headless = true;
      const state = await page.evaluate(GO_HEADLESS);
      t.check(state.noCanvas === true && state.ready === false, 'the client is headless now', state);
      const before = await page.evaluate(MESSAGE_IDS);
      const used = await t.tool('use-item', {
        actorIdentifier: user.name,
        itemIdentifier: weapon.name,
        targets: [monster.name],
      });
      t.log(`use-item answered: ${JSON.stringify(used).slice(0, 200)}`);
      let card;
      await waitFor(
        async () => {
          const now = await page.evaluate(({ known }) => {
            const seen = new Set(known);
            return game.messages.contents
              .filter(m => !seen.has(m.id))
              .map(m => ({ flavor: m.flavor ?? '', targets: m.flags?.dnd5e?.targets ?? m.system?.targets ?? null }));
          }, { known: before });
          card = now[0];
          return now.length > 0;
        },
        { label: 'the usage card', timeoutMs: 15000, intervalMs: 500 }
      );
      t.check(card, 'a usage card was made');
      t.log(`card targets: ${JSON.stringify(card.targets).slice(0, 200)}`);
      t.check(
        JSON.stringify(card.targets ?? []).includes(monster.name),
        `the usage card names ${monster.name} as its target`,
        card.targets
      );
      const targets = await page.evaluate(READ_TARGETS);
      t.equal(targets, [], 'no targets are left behind on the headless client');
      const back = await page.evaluate(LEAVE_HEADLESS, { sceneId });
      headless = false;
      t.check(back.ready === true && back.noCanvas === false, 'the client is back to normal', back);
    });
  },
};

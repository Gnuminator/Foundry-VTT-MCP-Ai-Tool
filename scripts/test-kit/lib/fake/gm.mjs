/**
 * The fake's twin of lib/gm-actions.mjs: every GM_ACTIONS action, on the in-memory world. Same
 * arguments, same results.
 */
import { GM_ACTIONS } from '../contract.mjs';
import { markTurn, sortCombat } from './tools-combat.mjs';
import { ToolFailure, addEvent, newId, roll, tick } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

/** @type {Record<string, (w: World, args: any) => any>} */
const ACTIONS = {
  worldStatus: w => ({
    worldId: w.worldId,
    systemId: 'dnd5e',
    systemVersion: '6.0.5',
    coreVersion: '14.368',
    userName: 'Kit GM',
    isGM: true,
    moduleActive: true,
    moduleVersion: w.moduleVersion,
  }),

  wipeKit: w => {
    const deleted = {
      Actor: w.actors.size,
      Scene: w.scenes.size,
      Item: 0,
      JournalEntry: 0,
      Combat: w.combat ? 1 : 0,
      Folder: w.folders.size,
    };
    for (const map of [w.actors, w.scenes, w.tokens, w.plans, w.folders]) map.clear();
    w.combat = null;
    w.activeSceneId = null;
    return { deleted };
  },

  ensureFolder: (w, args) => {
    const key = `${args.type}:${args.name}`;
    if (!w.folders.has(key)) w.folders.set(key, newId(w, 'fld'));
    return { folderId: w.folders.get(key) };
  },

  createHero: (w, args) => {
    const level = Number(args.level ?? 1);
    const max = 7 + level + (args.classId.length % 5);
    const id = newId(w, 'hero');
    w.actors.set(id, {
      id,
      name: args.name,
      type: 'character',
      hp: { value: max, max, temp: 0 },
      items: [{ id: newId(w, 'itm'), name: String(args.classId), type: 'class' }],
      cr: 0,
      creatureType: 'humanoid',
      size: 'med',
      level,
    });
    return {
      actorId: id,
      name: args.name,
      classIdentifier: String(args.classId).toLowerCase(),
      level,
      hp: { value: max, max },
    };
  },

  createCombatScene: (w, args) => {
    const id = newId(w, 'scn');
    const grid = args.grid ?? 100;
    w.scenes.set(id, {
      id,
      name: args.name,
      width: args.width,
      height: args.height,
      grid,
      walls: args.walls === false ? 0 : 3 + ((args.doors ?? 1) > 0 ? 3 : 1),
      lights: args.lights ?? 1,
    });
    w.activeSceneId = id;
    return { sceneId: id, name: args.name };
  },

  placeToken: (w, args) => {
    const scene = w.scenes.get(args.sceneId);
    const actor = w.actors.get(args.actorId);
    if (!scene) throw new ToolFailure(`placeToken: no scene ${args.sceneId}`);
    if (!actor) throw new ToolFailure(`placeToken: no actor ${args.actorId}`);
    const id = newId(w, 'tok');
    // Heroes are linked (the token shares the actor's HP); monsters are not (the token has its own).
    const hp = actor.type === 'character' ? actor.hp : { ...actor.hp };
    w.tokens.set(id, {
      id,
      sceneId: scene.id,
      actorId: actor.id,
      name: args.name ?? actor.name,
      x: args.x,
      y: args.y,
      hidden: Boolean(args.hidden),
      hp,
    });
    return { tokenId: id };
  },

  startCombat: (w, args) => {
    const scene = w.scenes.get(args.sceneId);
    if (!scene) throw new ToolFailure(`startCombat: no scene ${args.sceneId}`);
    const combatants = args.tokenIds.map((/** @type {string} */ tokenId) => {
      const token = w.tokens.get(tokenId);
      if (!token) throw new ToolFailure(`startCombat: no token ${tokenId} on ${scene.name}`);
      const actor = /** @type {import('./state.mjs').FakeActor} */ (w.actors.get(token.actorId));
      const initiative = roll(w, 20) + 2;
      addEvent(w, 'roll', {
        actor,
        description: `${actor.name}, Initiative: 1d20 +2 = ${initiative}`,
        details: { rollType: 'initiative', total: initiative },
      });
      return {
        id: newId(w, 'cmb'),
        tokenId,
        actorId: actor.id,
        name: token.name,
        initiative,
        hidden: token.hidden,
        category: actor.type === 'character' ? 'npc' : 'enemy',
      };
    });
    const combat = {
      id: newId(w, 'cbt'),
      sceneId: scene.id,
      round: 1,
      turn: 0,
      combatants,
      timeline: [],
    };
    const ids = combatants.map((/** @type {any} */ c) => c.id); // in the order asked for
    w.combat = combat;
    sortCombat(combat);
    markTurn(w);
    w.combats.push({
      combatId: combat.id,
      startedAt: new Date(tick(w)).toISOString(),
      endedAt: null,
      rounds: 1,
      sceneName: scene.name,
      participants: combatants.map((/** @type {any} */ c) => c.name).sort(),
      damageTaken: {},
      damageDealt: {},
      healing: {},
      downs: [],
      kills: [],
      crits: 0,
      fumbles: 0,
    });
    addEvent(w, 'combat-start', {
      description: `Combat started with ${combatants.length} combatants`,
      details: { combatId: combat.id, round: 0, combatantCount: combatants.length },
    });
    return { combatId: combat.id, combatantIds: ids };
  },

  endCombats: w => {
    const combat = w.combat;
    if (!combat) return { ended: 0 };
    const record = w.combats.find(c => c.combatId === combat.id);
    if (record) {
      record.rounds = combat.round;
      record.endedAt = new Date().toISOString();
    }
    addEvent(w, 'combat-end', {
      description: `Combat ended after ${combat.round} rounds`,
      details: { combatId: combat.id, rounds: combat.round },
    });
    w.lastCombat = combat;
    w.combat = null;
    return { ended: 1 };
  },

  readActor: (w, args) => {
    let actor = w.actors.get(args.actorId);
    let hp = actor?.hp;
    if (args.tokenId) {
      const token = w.tokens.get(args.tokenId);
      if (!token || token.sceneId !== args.sceneId) {
        throw new ToolFailure(`readActor: no token ${args.tokenId} on ${args.sceneId}`);
      }
      actor = w.actors.get(token.actorId);
      hp = token.hp;
    }
    if (!actor || !hp) throw new ToolFailure(`readActor: no actor ${args.actorId}`);
    return {
      name: actor.name,
      hp: { value: hp.value, max: hp.max, temp: hp.temp },
      conditions: [],
    };
  },

  consoleErrors: () => ({ errors: [] }),
};

/**
 * @param {World} w
 * @returns {{call: (action: string, args?: object) => Promise<any>}}
 */
export function createFakeGm(w) {
  return {
    async call(action, args = {}) {
      if (!(action in GM_ACTIONS) || !(action in ACTIONS)) {
        throw new Error(`the fake has no GM action "${action}"`);
      }
      // Plain JSON in, plain JSON out, as with the real page.
      return JSON.parse(JSON.stringify(ACTIONS[action](w, JSON.parse(JSON.stringify(args)))));
    },
  };
}

/** Every action name the fake implements, for the test that it covers GM_ACTIONS. */
export const FAKE_GM_ACTIONS = Object.keys(ACTIONS);

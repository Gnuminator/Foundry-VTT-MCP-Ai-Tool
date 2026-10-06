/**
 * The fake's twin of lib/gm-actions.mjs: every GM_ACTIONS action, on the in-memory world. Same
 * arguments, same results.
 */
import { GM_ACTIONS } from '../contract.mjs';
import {
  FAKE_CLASSES,
  FAKE_ORIGINS,
  FAKE_PACKS,
  FAKE_SUBCLASSES,
  describe,
  featureUuid,
  findClass,
  findSubclass,
  uuidOf,
} from './classes.mjs';
import { fakeExerciseActor, fakeFeatures, fakeInspectFeatures } from './features.mjs';
import {
  fakeCreateMonster,
  fakeDeleteMonsters,
  fakeExerciseMonster,
  fakeInspectMonster,
  fakeListMonsters,
} from './monsters.mjs';
import { markTurn, sortCombat } from './tools-combat.mjs';
import { ToolFailure, addEvent, newId, roll, tick } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

const SKILL_IDS = [
  'acr',
  'ani',
  'arc',
  'ath',
  'dec',
  'his',
  'ins',
  'itm',
  'inv',
  'med',
  'nat',
  'prc',
  'prf',
  'per',
  'rel',
  'slt',
  'ste',
  'sur',
];

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

  listCompendium: (w, args) => {
    /** @type {any[]} */
    const entries = [];
    /** @type {string[]} */
    const missing = [];
    for (const packId of args.packIds ?? []) {
      if (!FAKE_PACKS.includes(packId)) {
        missing.push(packId);
        continue;
      }
      const row = (/** @type {any} */ d, /** @type {string} */ type) => ({
        packId,
        id: d.id,
        uuid: uuidOf(packId, d.id),
        name: d.name,
        type,
        identifier: d.identifier ?? d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        ...(d.classIdentifier ? { classIdentifier: d.classIdentifier } : {}),
        rules: d.rules ?? '2024',
        book: '',
      });
      for (const c of FAKE_CLASSES) if (c.pack === packId) entries.push(row(c, 'class'));
      for (const c of FAKE_SUBCLASSES) if (c.pack === packId) entries.push(row(c, 'subclass'));
      if (packId === 'dnd5e.origins24') for (const o of FAKE_ORIGINS) entries.push(row(o, o.type));
    }
    return { entries: entries.filter(e => !args.type || e.type === args.type), missing };
  },

  createHero: (w, args) => {
    const k = findClass(String(args.classUuid));
    if (!k) throw new ToolFailure(`createHero: no class ${args.classUuid}`);
    const s = args.subclassUuid ? findSubclass(String(args.subclassUuid)) : null;
    if (args.subclassUuid && !s)
      throw new ToolFailure(`createHero: no subclass ${args.subclassUuid}`);
    const level = Math.max(1, Math.min(20, Number(args.level ?? 1)));
    const rotation = Math.max(0, Math.floor(Number(args.rotation ?? 0)));
    let k2 = 0;
    const pick = (/** @type {string[]} */ list) => list[(rotation + k2++) % list.length];
    const expected = describe(k, s, level);
    const hasSub = Boolean(s && level >= k.subclassAt);
    /** @type {any[]} */
    const picks = [
      {
        level: 0,
        advancement: 'Trait',
        title: 'Soldier: Background Proficiencies',
        chosen: ['tool:game:card'],
      },
    ];
    /** @type {string[]} */
    const warnings = [];
    /** @type {Array<{id: string, name: string, type: string, sourceUuid: string}>} */
    const items = [
      {
        id: newId(w, 'itm'),
        name: 'Human',
        type: 'race',
        sourceUuid: uuidOf('dnd5e.origins24', 'fakeSpHuman0000001'),
      },
      {
        id: newId(w, 'itm'),
        name: 'Soldier',
        type: 'background',
        sourceUuid: uuidOf('dnd5e.origins24', 'fakeBgSoldier00001'),
      },
      { id: newId(w, 'itm'), name: k.name, type: 'class', sourceUuid: args.classUuid },
    ];
    if (hasSub && s) {
      items.push({
        id: newId(w, 'itm'),
        name: s.name,
        type: 'subclass',
        sourceUuid: args.subclassUuid,
      });
      picks.push({
        level: k.subclassAt,
        advancement: 'Subclass',
        title: `${k.name}: Subclass`,
        chosen: [s.name],
      });
    } else if (args.subclassUuid) {
      warnings.push(
        'the subclass was asked for but not applied (the class has no subclass step up to this level)'
      );
    }
    for (const g of expected.grants) {
      items.push({ id: newId(w, 'itm'), name: g.name, type: 'feat', sourceUuid: g.uuid });
    }
    for (const c of k.itemChoices.filter(x => x.level <= level)) {
      const chosen = [];
      for (let i = 0; i < c.count; i += 1) chosen.push(pick(c.options));
      for (const name of chosen)
        items.push({ id: newId(w, 'itm'), name, type: 'feat', sourceUuid: featureUuid(name) });
      picks.push({
        level: c.level,
        advancement: 'ItemChoice',
        title: `${k.name}: Choose a style`,
        chosen,
      });
    }
    const skills = [];
    while (skills.length < k.skillsChosen) {
      const key = `skills:${pick(k.skillPool)}`;
      if (!skills.includes(key)) skills.push(key);
    }
    picks.push({
      level: 1,
      advancement: 'Trait',
      title: `${k.name}: Skill Proficiencies`,
      chosen: skills,
    });
    const improve = ['str', 'dex', 'wis', 'int', 'cha'];
    for (const l of k.asi.filter(x => x <= level)) {
      picks.push({
        level: l,
        advancement: 'AbilityScoreImprovement',
        title: `${k.name}: Ability Score Improvement`,
        chosen: [`${pick(improve)} +2`],
      });
    }
    const max = expected.hpFixed + level; // Constitution 13 gives +1 a level
    const id = newId(w, 'hero');
    /** @type {Record<string, number>} */
    const skillMap = Object.fromEntries(SKILL_IDS.map(x => [x, 0]));
    for (const key of [...skills, 'skills:ath']) skillMap[key.slice(7)] = 1;
    /** @type {Record<string, any>} */
    const spells = {};
    for (const [n, count] of Object.entries(expected.spellSlots?.leveled ?? {}))
      spells[`spell${n}`] = { max: count };
    if (expected.spellSlots?.pact) spells.pact = expected.spellSlots.pact;
    w.actors.set(id, {
      id,
      name: args.name,
      type: 'character',
      hp: { value: max, max, temp: 0 },
      items,
      cr: 0,
      creatureType: 'humanoid',
      size: 'med',
      level,
      ownership: { default: 0, 'Kit GM': 3 },
      sheet: {
        classes: [
          { identifier: k.identifier, levels: level, subclass: hasSub && s ? s.identifier : null },
        ],
        abilities: {
          str: { value: 15, mod: 2 },
          dex: { value: 14, mod: 2 },
          con: { value: 13, mod: 1 },
          int: { value: 12, mod: 1 },
          wis: { value: 10, mod: 0 },
          cha: { value: 8, mod: -1 },
        },
        scale: {
          [k.identifier]: Object.fromEntries(expected.scale.map(x => [x.identifier, x.value])),
        },
        spells,
        skills: skillMap,
        saves: Object.fromEntries(
          ['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => [a, k.saves.includes(a) ? 1 : 0])
        ),
        features: fakeFeatures(k, level, k.rules, id),
      },
    });
    return {
      actorId: id,
      name: args.name,
      classIdentifier: k.identifier,
      subclassIdentifier: hasSub && s ? s.identifier : '',
      level,
      hp: { value: max, max },
      picks,
      warnings,
    };
  },

  describeClass: (w, args) => {
    const k = findClass(String(args.classUuid));
    if (!k) throw new ToolFailure(`describeClass: no class ${args.classUuid}`);
    const s = args.subclassUuid ? findSubclass(String(args.subclassUuid)) : null;
    if (args.subclassUuid && !s)
      throw new ToolFailure(`describeClass: no subclass ${args.subclassUuid}`);
    const level = Math.max(1, Math.min(20, Number(args.level ?? 1)));
    return { expected: describe(k, s, level, w.faults.unresolved) };
  },

  inspectActor: (w, args) => {
    const actor = w.actors.get(args.actorId);
    if (!actor || !actor.sheet) throw new ToolFailure(`inspectActor: no actor ${args.actorId}`);
    return {
      name: actor.name,
      level: actor.level,
      classes: actor.sheet.classes,
      hp: {
        value: actor.hp.value,
        max: actor.hp.max,
        bonuses: { level: 0, overall: 0 },
        sources: [],
      },
      abilities: actor.sheet.abilities,
      items: actor.items.map(i => ({
        name: i.name,
        type: i.type,
        sourceUuid: i.sourceUuid ?? null,
        identifier: i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      })),
      scale: actor.sheet.scale,
      spells: actor.sheet.spells,
      skills: actor.sheet.skills,
      saves: actor.sheet.saves,
      ownership: actor.ownership,
    };
  },

  setOwnership: (w, args) => {
    const actor = w.actors.get(args.actorId);
    if (!actor) throw new ToolFailure(`setOwnership: no actor ${args.actorId}`);
    actor.ownership = { ...(actor.ownership ?? {}), [args.userName]: Number(args.level) };
    return { ok: true };
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

  inspectFeatures: (w, args) =>
    w.actors.get(args.actorId)?.sheet?.monster
      ? fakeInspectMonster(w, args)
      : fakeInspectFeatures(w, args),

  exerciseActor: (w, args) =>
    w.actors.get(args.actorId)?.sheet?.monster
      ? fakeExerciseMonster(w, args)
      : fakeExerciseActor(w, args),

  listMonsters: (w, args) => fakeListMonsters(w, args),

  createMonster: (w, args) => fakeCreateMonster(w, args),

  deleteMonsters: (w, args) => fakeDeleteMonsters(w, args),

  inspectBuild: (w, args) => {
    const actor = w.actors.get(args.actorId);
    if (!actor || !actor.sheet) throw new ToolFailure(`inspectBuild: no actor ${args.actorId}`);
    return {
      name: actor.name,
      level: actor.level,
      items: actor.items.map(i => ({
        type: i.type,
        name: i.name,
        identifier: i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sourceUuid: i.sourceUuid ?? '',
        origin: null,
        root: null,
        prepared: null,
        quantity: null,
        level: i.type === 'spell' ? 1 : null,
      })),
      advancements: [],
      skills: Object.fromEntries(
        Object.entries(actor.sheet.skills ?? {}).map(([id, v]) => [id, v ? 1 : 0])
      ),
      saves: { ...(actor.sheet.saves ?? {}) },
      proficiencies: {
        languages: [],
        weapons: [],
        armor: [],
        tools: [],
        damageResistances: [],
        damageImmunities: [],
        conditionImmunities: [],
      },
      senses: {},
      movement: { walk: 30 },
      size: 'med',
      hp: { max: actor.hp.max, bonuses: {} },
      ac: { value: 10, calc: 'default' },
    };
  },

  // The fake has no Actor Studio window: the studio scenario skips the real driver in the fake.
  studioPump: (_w, args) =>
    args.op === 'stop' || args.op === 'status'
      ? null
      : {
          running: false,
          k: 0,
          picks: [],
          warnings: [],
          errors: [],
          answered: 0,
          managersSeen: 0,
          completed: 0,
          lastStep: '',
          lastActivityAt: 0,
        },

  adoptActor: (w, args) => {
    const actor = w.actors.get(args.actorId);
    if (!actor) throw new ToolFailure(`adoptActor: no actor ${args.actorId}`);
    if (args.name) actor.name = args.name;
    actor.kit = true;
    return { ok: true };
  },

  deleteKitActor: (w, args) => {
    const actor = w.actors.get(args.actorId);
    if (!actor) return { deleted: false };
    w.actors.delete(args.actorId);
    return { deleted: true };
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

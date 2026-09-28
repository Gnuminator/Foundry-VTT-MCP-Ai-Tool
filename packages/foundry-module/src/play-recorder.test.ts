/**
 * Unit tests for PlayRecorder (O3): the module's raw play-log recorder.
 *
 * Uses the Foundry-mock harness (`test-support/foundry-mock`) for `game`,
 * `Hooks`, `CONST` and `foundry.utils`, and fires hooks with small plain
 * fixture objects shaped like the real Foundry/dnd5e documents (the same
 * approach `session-events.test.ts` uses for `EventTracker`) rather than the
 * harness's full document builders, since PlayRecorder only ever reads the
 * duck-typed hook arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  d20Roll,
  fireUpdate,
  makeFixtureActor,
  makeFixtureItem,
} from './test-support/play-log-fixtures.js';
import { PlayRecorder, playRecordKeys } from './play-recorder.js';

let world: TestWorld;
let restore: () => void;
let recorder: PlayRecorder;

function setup(currentUser: { isGM?: boolean } = { isGM: true }): void {
  world = createTestWorld({ currentUser });
  restore = world.install();
  recorder = new PlayRecorder();
  recorder.registerHooks();
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  restore();
  delete (globalThis as any).canvas;
});

// --- Shadow diffs / document-state keys --------------------------------------

describe('actor state shadows', () => {
  it('gives a before/after/delta only once a shadow exists, keyed off modifiedTime', () => {
    // A modifiedTime is trusted only within 60s of now, so the fixture clock is Date.now()-based.
    const now = Date.now();
    const actor = makeFixtureActor({ system: { attributes: { hp: { value: 20 } } }, t: now });
    world.actors.add(actor);

    // First sighting: no shadow yet at the time of the hook (recorder hasn't seeded).
    // updateActor seeds lazily from the actor's CURRENT (post-update) state, so the
    // first change is swallowed, matching EventTracker's "first sighting seeds" rule.
    fireUpdate('updateActor', actor, { system: { attributes: { hp: { value: 15 } } } }, {}, 'u1');
    expect(recorder.getPlayRecords({}).records).toHaveLength(0);

    actor._stats.modifiedTime = now + 1000;
    fireUpdate('updateActor', actor, { system: { attributes: { hp: { value: 9 } } } }, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('hp');
    expect(record.path).toBe('system.attributes.hp.value');
    expect(record.before).toBe(15);
    expect(record.after).toBe(9);
    expect(record.delta).toBe(-6);
    expect(record.t).toBe(now + 1000);
    expect(record.key).toBe(
      playRecordKeys.docChange('hp', actor.uuid, 'system.attributes.hp.value', now + 1000)
    );
    expect(record.actor).toEqual({ uuid: actor.uuid, isPC: true, name: 'Hero' });
    expect(record.userId).toBe('u1');
  });

  it('falls back to Date.now() and a bucketed key when modifiedTime is stale or the actor is synthetic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const NOW = 1_790_000_000_000;
      vi.setSystemTime(NOW);
      const stale = makeFixtureActor({
        id: 'old',
        system: { attributes: { hp: { value: 20 } } },
        t: NOW - 10 * 60_000,
      });
      world.actors.add(stale);
      recorder.seed();
      // An unlinked token's actor reports the base actor's modifiedTime: it can look fresh and still be wrong.
      const synthetic = makeFixtureActor({
        id: 'synth',
        uuid: 'Scene.s1.Token.tk2.Actor.synth',
        isToken: true,
        tokenUuid: 'Scene.s1.Token.tk2',
        system: { attributes: { hp: { value: 10 } } },
        t: NOW - 500,
      });
      Hooks.callAll(
        'createToken',
        {
          uuid: 'Scene.s1.Token.tk2',
          actor: synthetic,
          actorLink: false,
          _stats: { modifiedTime: NOW },
        },
        {},
        {},
        'u1'
      );

      const path = 'system.attributes.hp.value';
      fireUpdate('updateActor', stale, { system: { attributes: { hp: { value: 14 } } } }, {}, 'u1');
      fireUpdate(
        'updateActor',
        synthetic,
        { system: { attributes: { hp: { value: 4 } } } },
        {},
        'u1'
      );
      const hp = recorder.getPlayRecords({}).records.filter(r => r.kind === 'hp');
      expect(hp.map(r => [r.t, r.key])).toEqual([
        [NOW, playRecordKeys.docChangeBucketed('hp', stale.uuid, path, 20, 14, NOW)],
        [NOW, playRecordKeys.docChangeBucketed('hp', synthetic.uuid, path, 10, 4, NOW)],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeds explicitly via seed() so the very first real update produces a record', () => {
    const actor = makeFixtureActor({ system: { attributes: { hp: { value: 20 } } } });
    world.actors.add(actor);
    recorder.seed();

    actor._stats.modifiedTime = 3000;
    fireUpdate('updateActor', actor, { system: { attributes: { hp: { value: 14 } } } }, {}, 'u1');
    const records = recorder.getPlayRecords({}).records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'hp', before: 20, after: 14, delta: -6 });
  });

  it('tracks hp-temp, hp-max and death saves as separate records', () => {
    const actor = makeFixtureActor({
      system: {
        attributes: { hp: { value: 10, temp: 0, max: 30 }, death: { success: 0, failure: 0 } },
      },
    });
    world.actors.add(actor);
    recorder.seed();
    actor._stats.modifiedTime = 4000;
    fireUpdate(
      'updateActor',
      actor,
      { system: { attributes: { hp: { temp: 5, max: 32 }, death: { success: 1, failure: 2 } } } },
      {},
      'u1'
    );
    const kinds = recorder.getPlayRecords({}).records.map(r => r.kind);
    expect(kinds.sort()).toEqual(['death-save', 'death-save', 'hp-max', 'hp-temp']);
  });

  it('unlinked token actor carries the synthetic actor uuid plus tokenUuid', () => {
    const actor = makeFixtureActor({
      id: 'tokActor',
      isToken: true,
      tokenUuid: 'Scene.s1.Token.tk1',
      uuid: 'Scene.s1.Token.tk1.Actor.tokActor',
      system: { attributes: { hp: { value: 10 } } },
    });
    world.actors.add(actor);
    recorder.seed();
    actor._stats.modifiedTime = 5000;
    fireUpdate('updateActor', actor, { system: { attributes: { hp: { value: 4 } } } }, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.actor).toEqual({
      uuid: 'Scene.s1.Token.tk1.Actor.tokActor',
      tokenUuid: 'Scene.s1.Token.tk1',
      isPC: true,
      name: 'Hero',
    });
  });

  it('tracks spell slots, resources and currency by key', () => {
    const actor = makeFixtureActor({
      system: {
        spells: { spell1: { value: 4 } },
        resources: { legres: { value: 3 } },
        currency: { gp: 10, sp: 5 },
      },
    });
    world.actors.add(actor);
    recorder.seed();
    actor._stats.modifiedTime = 6000;
    Hooks.callAll(
      'updateActor',
      actor,
      {
        system: {
          spells: { spell1: { value: 3 } },
          resources: { legres: { value: 2 } },
          currency: { gp: 20 },
        },
      },
      {},
      null
    );
    const records = recorder.getPlayRecords({}).records;
    const slot = records.find(r => r.kind === 'slot');
    const resource = records.find(r => r.kind === 'resource');
    const currency = records.find(r => r.kind === 'currency');
    expect(slot).toMatchObject({
      path: 'system.spells.spell1.value',
      before: 4,
      after: 3,
      delta: -1,
    });
    expect(resource).toMatchObject({
      path: 'system.resources.legres.value',
      before: 3,
      after: 2,
      delta: -1,
    });
    expect(currency).toMatchObject({
      path: 'system.currency.gp',
      before: 10,
      after: 20,
      delta: 10,
    });
  });

  it('xp changes are recorded', () => {
    const actor = makeFixtureActor({ system: { details: { xp: { value: 100 } } } });
    world.actors.add(actor);
    recorder.seed();
    actor._stats.modifiedTime = 7000;
    Hooks.callAll('updateActor', actor, { system: { details: { xp: { value: 250 } } } }, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record).toMatchObject({ kind: 'xp', before: 100, after: 250, delta: 150 });
  });
});

// --- Items on actors ----------------------------------------------------------

describe('items on actors', () => {
  it('records item-create (with quantity in after) and item-delete', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const item = makeFixtureItem({
      name: 'Potion of Healing',
      type: 'consumable',
      system: { quantity: 2 },
    });
    item.actor = actor;
    Hooks.callAll('createItem', item, {}, {}, 'u1');
    Hooks.callAll('deleteItem', item, {}, 'u1');
    const kinds = recorder.getPlayRecords({}).records.map(r => r.kind);
    expect(kinds).toEqual(['item-create', 'item-delete']);
    const [created] = recorder.getPlayRecords({}).records;
    expect(created.item).toEqual({
      uuid: item.uuid,
      name: 'Potion of Healing',
      type: 'consumable',
    });
    expect(created.actor?.uuid).toBe(actor.uuid);
    expect(created.after).toBe(2);
  });

  it('tracks item uses spent (4+) and legacy uses value', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const item = makeFixtureItem({ system: { uses: { spent: 0, max: 3 } } });
    item.actor = actor;
    Hooks.callAll('createItem', item, {}, {}, 'u1');
    item._stats.modifiedTime = 8000;
    Hooks.callAll('updateItem', item, { system: { uses: { spent: 1 } } }, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records.filter(r => r.kind === 'item-uses');
    expect(record).toMatchObject({ path: 'system.uses.spent', before: 0, after: 1, delta: 1 });
  });

  it('tracks item quantity', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const item = makeFixtureItem({ type: 'consumable', system: { quantity: 3 } });
    item.actor = actor;
    Hooks.callAll('createItem', item, {}, {}, 'u1');
    item._stats.modifiedTime = 9000;
    Hooks.callAll('updateItem', item, { system: { quantity: 2 } }, {}, 'u1');
    const record = recorder.getPlayRecords({}).records.find(r => r.kind === 'item-quantity');
    expect(record).toMatchObject({ before: 3, after: 2, delta: -1 });
  });

  it('tracks hit dice spent (4+ and legacy) on class items only', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const classItem = makeFixtureItem({ type: 'class', system: { levels: 3, hd: { spent: 0 } } });
    classItem.actor = actor;
    Hooks.callAll('createItem', classItem, {}, {}, 'u1');
    classItem._stats.modifiedTime = 10_000;
    Hooks.callAll('updateItem', classItem, { system: { hd: { spent: 1 } } }, {}, 'u1');
    const record = recorder.getPlayRecords({}).records.find(r => r.kind === 'hit-dice');
    expect(record).toMatchObject({ path: 'system.hd.spent', before: 0, after: 1, delta: 1 });
  });

  it('recomputes character level from class item system.levels; NPCs are skipped', () => {
    const actor = makeFixtureActor({ type: 'character' });
    world.actors.add(actor);
    const classItem = makeFixtureItem({ type: 'class', system: { levels: 3 } });
    classItem.actor = actor;
    // A real Foundry embedded collection already carries the new item by the
    // time `createItem` fires; the plain-array fixture needs this spelled out.
    actor.items.push(classItem);
    Hooks.callAll('createItem', classItem, {}, {}, 'u1');
    // Level goes from 3 (seeded at create) — bump it to see a level record.
    classItem._stats.modifiedTime = 11_000;
    fireUpdate('updateItem', classItem, { system: { levels: 4 } }, {}, 'u1');
    const level = recorder.getPlayRecords({}).records.find(r => r.kind === 'level');
    expect(level).toMatchObject({ before: 3, after: 4, delta: 1 });

    const npc = makeFixtureActor({
      id: 'npc1',
      uuid: 'Actor.npc1',
      type: 'npc',
      system: { details: { cr: 4 } },
    });
    world.actors.add(npc);
    const npcClassLikeItem = makeFixtureItem({
      id: 'i2',
      uuid: 'Item.i2',
      type: 'class',
      system: { levels: 2 },
    });
    npcClassLikeItem.actor = npc;
    npc.items.push(npcClassLikeItem);
    Hooks.callAll('createItem', npcClassLikeItem, {}, {}, 'u1');
    expect(
      recorder
        .getPlayRecords({})
        .records.some(r => r.kind === 'level' && r.actor?.uuid === npc.uuid)
    ).toBe(false);
  });
});

// --- Effects, tokens -----------------------------------------------------------

describe('effects and tokens', () => {
  it('records effect-add and effect-remove', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const effect = {
      uuid: 'ActiveEffect.e1',
      name: 'Prone',
      statuses: new Set(['prone']),
      parent: actor,
    };
    Hooks.callAll('createActiveEffect', effect, {}, {}, 'u1');
    Hooks.callAll('deleteActiveEffect', effect, {}, 'u1');
    const kinds = recorder.getPlayRecords({}).records.map(r => r.kind);
    expect(kinds).toEqual(['effect-add', 'effect-remove']);
    expect(recorder.getPlayRecords({}).records[0].data).toMatchObject({
      effectName: 'Prone',
      statuses: ['prone'],
    });
  });

  it('records token create/delete/move; move carries no coordinates', () => {
    const now = Date.now();
    const actor = makeFixtureActor({ t: now });
    const token = {
      uuid: 'Scene.s1.Token.tk1',
      actor,
      actorLink: true,
      _stats: { modifiedTime: now },
    };
    Hooks.callAll('createToken', token, {}, {}, 'u1');
    token._stats.modifiedTime = now + 500;
    Hooks.callAll('updateToken', token, { x: 100, y: 200 }, {}, 'u1');
    Hooks.callAll('deleteToken', token, {}, 'u1');
    const records = recorder.getPlayRecords({}).records;
    expect(records.map(r => r.kind)).toEqual(['token-create', 'token-move', 'token-delete']);
    const move = records[1];
    expect(move.path).toBeUndefined();
    expect(move.before).toBeUndefined();
    expect(move.key).toBe(playRecordKeys.tokenMove(token.uuid, now + 500));
  });

  it('an unlinked token seeds and drops its synthetic actor shadow', () => {
    const synthetic = makeFixtureActor({
      id: 'synth',
      uuid: 'Scene.s1.Token.tk2.Actor.synth',
      isToken: true,
      tokenUuid: 'Scene.s1.Token.tk2',
      system: { attributes: { hp: { value: 10 } } },
    });
    const token = {
      uuid: 'Scene.s1.Token.tk2',
      actor: synthetic,
      actorLink: false,
      _stats: { modifiedTime: 1000 },
    };
    Hooks.callAll('createToken', token, {}, {}, 'u1');
    synthetic._stats.modifiedTime = 2000;
    fireUpdate(
      'updateActor',
      synthetic,
      { system: { attributes: { hp: { value: 4 } } } },
      {},
      'u1'
    );
    const hpRecord = recorder.getPlayRecords({}).records.find(r => r.kind === 'hp');
    expect(hpRecord).toMatchObject({ before: 10, after: 4 });

    Hooks.callAll('deleteToken', token, {}, 'u1');
    // A later update should now re-seed from scratch (no synthetic "before"),
    // since a real Foundry document already reflects its new value by the
    // time the hook fires (fireUpdate mirrors that on the fixture).
    synthetic._stats.modifiedTime = 3000;
    fireUpdate(
      'updateActor',
      synthetic,
      { system: { attributes: { hp: { value: 1 } } } },
      {},
      'u1'
    );
    expect(recorder.getPlayRecords({}).records.filter(r => r.kind === 'hp')).toHaveLength(1);
  });
});

// --- Combat, scene, world time, users -------------------------------------------

describe('combat, scene, world time and users', () => {
  it('records combat-start, combat-turn (with the current combatant) and combat-end', () => {
    const now = Date.now();
    const actor = makeFixtureActor({ t: now });
    const combatant = { id: 'c1', name: 'Hero', actor };
    const combat: any = {
      id: 'combat1',
      round: 1,
      turn: 0,
      combatants: { size: 1 },
      combatant,
      _stats: { modifiedTime: now },
    };
    Hooks.callAll('combatStart', combat);
    combat.round = 1;
    combat.turn = 1;
    combat._stats.modifiedTime = now + 500;
    Hooks.callAll('updateCombat', combat, { turn: 1 }, {}, 'u1');
    combat._stats.modifiedTime = now + 1000;
    Hooks.callAll('deleteCombat', combat);
    const records = recorder.getPlayRecords({}).records;
    expect(records.map(r => r.kind)).toEqual(['combat-start', 'combat-turn', 'combat-end']);
    expect(records[0].key).toBe(playRecordKeys.combatStart('combat1'));
    expect(records[1].key).toBe(playRecordKeys.combatTurn('combat1', 1, 1));
    expect(records[1].actor?.uuid).toBe(actor.uuid);
    // A delete hook never trusts the document's own modifiedTime: Date.now(), bucketed.
    expect(records[2].key).toBe(
      playRecordKeys.createDeleteBucketed('combat-end', 'combat1', records[2].t)
    );
    expect(records[2].combat).toEqual({ id: 'combat1', round: 1, turn: 1 });
  });

  it('records a scene change once per new viewed scene (canvasReady)', () => {
    (globalThis as any).canvas = { scene: { id: 'sceneA' } };
    Hooks.callAll('canvasReady');
    (globalThis as any).canvas = { scene: { id: 'sceneA' } };
    Hooks.callAll('canvasReady');
    (globalThis as any).canvas = { scene: { id: 'sceneB' } };
    Hooks.callAll('canvasReady');
    const scenes = recorder.getPlayRecords({}).records.filter(r => r.kind === 'scene');
    expect(scenes).toHaveLength(2);
    expect(scenes.map(s => s.sceneId)).toEqual(['sceneA', 'sceneB']);
  });

  it('records world time with before/after/delta in seconds', () => {
    Hooks.callAll('updateWorldTime', 3600, 600, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record).toMatchObject({ kind: 'world-time', before: 3000, after: 3600, delta: 600 });
    expect(record.key).toBe(playRecordKeys.worldTime(3600));
  });

  it('records user-join and user-leave', () => {
    Hooks.callAll('userConnected', { id: 'p1', name: 'Alice' }, true);
    Hooks.callAll('userConnected', { id: 'p1', name: 'Alice' }, false);
    const kinds = recorder.getPlayRecords({}).records.map(r => r.kind);
    expect(kinds).toEqual(['user-join', 'user-leave']);
  });
});

// --- Chat: rolls, item-use, rest, plain chat -------------------------------------

describe('chat roll parsing (6.0 message.system)', () => {
  it('attack with a known target AC produces dc and outcome', () => {
    const message = {
      id: 'm1',
      type: 'attack',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 15 }, total: 18 })],
      system: { ability: 'str', item: { uuid: 'Item.sword', name: 'Longsword', type: 'weapon' } },
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    world.actors.add(makeFixtureActor());
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('roll');
    expect(record.roll).toMatchObject({
      rollType: 'attack',
      dc: 15,
      outcome: 'success',
      total: 18,
    });
    expect(record.item).toEqual({ uuid: 'Item.sword', name: 'Longsword', type: 'weapon' });
    expect(record.key).toBe(playRecordKeys.roll('m1', 0));
  });

  it('an advantage roll (2d20kh) puts the dropped die in dropped, not results', () => {
    const message = {
      id: 'm1b',
      type: 'check',
      speaker: { actor: 'a1' },
      rolls: [
        d20Roll({
          options: { advantageMode: 1 },
          dice: [
            {
              faces: 20,
              number: 2,
              modifiers: ['kh'],
              results: [
                { result: 3, active: false },
                { result: 17, active: true },
              ],
            },
          ],
          total: 22,
        }),
      ],
      system: { ability: 'dex', type: 'ability' },
      flags: {},
      _stats: { modifiedTime: 1500 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.roll?.dice).toEqual([{ faces: 20, results: [17], dropped: [3] }]);
    expect(record.roll?.advantage).toBe('advantage');
  });

  it('save with a DC and a subject ability', () => {
    const message = {
      id: 'm2',
      type: 'save',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 13 }, total: 10 })],
      system: { ability: 'dex', type: 'ability' },
      flags: {},
      _stats: { modifiedTime: 2000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.roll).toMatchObject({
      rollType: 'save',
      subject: 'dex',
      dc: 13,
      outcome: 'failure',
    });
  });

  it('skill check names the skill as subject', () => {
    const message = {
      id: 'm3',
      type: 'check',
      speaker: { actor: 'a1' },
      rolls: [d20Roll()],
      system: { ability: 'dex', skill: 'ste', type: 'ability' },
      flags: {},
      _stats: { modifiedTime: 3000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.roll).toMatchObject({ rollType: 'skill', subject: 'ste' });
  });

  it('initiative check', () => {
    const message = {
      id: 'm4',
      type: 'check',
      speaker: { actor: 'a1' },
      rolls: [d20Roll()],
      system: { ability: 'dex', type: 'initiative' },
      flags: {},
      _stats: { modifiedTime: 4000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll?.rollType).toBe('initiative');
  });

  it('death save', () => {
    const message = {
      id: 'm5',
      type: 'save',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 10 }, total: 4 })],
      system: { type: 'death' },
      flags: {},
      _stats: { modifiedTime: 5000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll).toMatchObject({
      rollType: 'death',
      outcome: 'failure',
    });
  });

  it('damage roll names its damage types', () => {
    const message = {
      id: 'm6',
      type: 'damage',
      speaker: { actor: 'a1' },
      rolls: [
        d20Roll({
          terms: [{ options: { flavor: 'slashing' } }],
          options: {},
          total: 9,
          dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        }),
      ],
      system: {},
      flags: {},
      _stats: { modifiedTime: 6000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll).toMatchObject({
      rollType: 'damage',
      damageTypes: ['slashing'],
    });
  });
});

describe('chat roll parsing (5.3 flags.dnd5e)', () => {
  it('attack with a known target AC produces dc and outcome', () => {
    const message = {
      id: 'lm1',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 15 }, total: 18 })],
      flags: {
        dnd5e: {
          roll: { type: 'attack', ability: 'str' },
          item: { id: 'sword', uuid: 'Item.sword', name: 'Longsword', type: 'weapon' },
        },
      },
      _stats: { modifiedTime: 1000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.roll).toMatchObject({ rollType: 'attack', dc: 15, outcome: 'success' });
    expect(record.item?.uuid).toBe('Item.sword');
  });

  it('save with a DC and skill subject', () => {
    const message = {
      id: 'lm2',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 13 }, total: 8 })],
      flags: { dnd5e: { roll: { type: 'save', ability: 'wis' } } },
      _stats: { modifiedTime: 2000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll).toMatchObject({
      rollType: 'save',
      subject: 'wis',
      dc: 13,
      outcome: 'failure',
    });
  });

  it('skill check', () => {
    const message = {
      id: 'lm3',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [d20Roll()],
      flags: { dnd5e: { roll: { type: 'skill', skill: 'prc', ability: 'wis' } } },
      _stats: { modifiedTime: 3000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll).toMatchObject({
      rollType: 'skill',
      subject: 'prc',
    });
  });

  it('initiative and death save', () => {
    const initiative = {
      id: 'lm4',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [d20Roll()],
      flags: { dnd5e: { roll: { type: 'initiative' } } },
      _stats: { modifiedTime: 4000 },
    };
    const death = {
      id: 'lm5',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [d20Roll({ options: { target: 10 }, total: 15 })],
      flags: { dnd5e: { roll: { type: 'death' } } },
      _stats: { modifiedTime: 5000 },
    };
    Hooks.callAll('createChatMessage', initiative, {}, 'u1');
    Hooks.callAll('createChatMessage', death, {}, 'u1');
    const records = recorder.getPlayRecords({}).records;
    expect(records[0].roll?.rollType).toBe('initiative');
    expect(records[1].roll).toMatchObject({ rollType: 'death', outcome: 'success' });
  });

  it('damage roll names its damage types', () => {
    const message = {
      id: 'lm6',
      type: 'base',
      speaker: { actor: 'a1' },
      rolls: [
        d20Roll({
          terms: [{ options: { flavor: 'fire' } }],
          total: 9,
          dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        }),
      ],
      flags: { dnd5e: { roll: { type: 'damage' } } },
      _stats: { modifiedTime: 6000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    expect(recorder.getPlayRecords({}).records[0].roll).toMatchObject({
      rollType: 'damage',
      damageTypes: ['fire'],
    });
  });
});

describe('item usage, rest and plain chat', () => {
  it('records an item-use card with spellLevel (6.0 message.system.level)', () => {
    const message = {
      id: 'u1',
      type: 'usage',
      speaker: { actor: 'a1' },
      rolls: [],
      system: { item: { uuid: 'Item.fireball', name: 'Fireball', type: 'spell' }, level: 5 },
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('item-use');
    expect(record.item).toEqual({ uuid: 'Item.fireball', name: 'Fireball', type: 'spell' });
    expect(record.data).toEqual({ spellLevel: 5 });
    expect(record.key).toBe(playRecordKeys.itemUse('u1'));
  });

  it('records a rest chat card (6.0 message.system.type)', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const message = {
      id: 'r1',
      type: 'rest',
      speaker: { actor: actor.id },
      rolls: [],
      system: { type: 'long' },
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('rest');
    expect(record.data).toEqual({ restType: 'long' });
    expect(record.key).toBe(playRecordKeys.rest(actor.uuid, 'r1'));
  });

  it('records a card-less rest from dnd5e.restCompleted (manage-rest rests with chat off)', () => {
    world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true });
    const actor = makeFixtureActor();
    world.actors.add(actor);
    Hooks.callAll(
      'dnd5e.restCompleted',
      actor,
      { type: 'short', deltas: { hitPoints: 4, hitDice: 1 } },
      { type: 'short', chat: false }
    );
    const [record] = recorder.getPlayRecords({}).records;
    expect(record).toMatchObject({
      kind: 'rest',
      userId: 'gm',
      userName: 'Gamemaster',
      actor: { uuid: actor.uuid },
      data: { restType: 'short' },
    });
    expect(record.key).toBe(playRecordKeys.rest(actor.uuid, String(record.t)));
    expect(record.source).toBeUndefined();
  });

  it('records a rest with a card once, from the card (restCompleted fires after it)', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const card = {
      id: 'r2',
      type: 'rest',
      speaker: { actor: actor.id },
      rolls: [],
      system: { type: 'long' },
      flags: {},
      _stats: { modifiedTime: Date.now() },
    };
    Hooks.callAll('createChatMessage', card, {}, 'u1');
    Hooks.callAll('dnd5e.restCompleted', actor, { type: 'long', message: card }, { chat: true });
    const rests = recorder.getPlayRecords({}).records.filter(r => r.kind === 'rest');
    expect(rests.map(r => r.key)).toEqual([playRecordKeys.rest(actor.uuid, 'r2')]);
  });

  it('records a non-roll chat message with HTML stripped and truncated', () => {
    const message = {
      id: 'c1',
      type: 'base',
      speaker: { alias: 'Bartender' },
      rolls: [],
      content: `<p>${'a'.repeat(600)}</p>`,
      style: 2,
      whisper: ['u2'],
      blind: false,
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    Hooks.callAll('createChatMessage', message, {}, 'u1');
    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('chat');
    expect(record.data?.whisper).toBe(true);
    expect((record.data?.text as string).length).toBe(500);
    expect(record.key).toBe(playRecordKeys.chat('c1'));
  });
});

// --- HP attribution -------------------------------------------------------------

describe('HP attribution to the most recent damage/healing roll', () => {
  // Attribution and the module's internal ring of recent rolls both anchor on
  // real wall-clock time (`Date.now()`, matching production's real
  // `_stats.modifiedTime`), so fixtures here use a `Date.now()`-based clock
  // rather than small synthetic counters.
  it('attributes an HP loss to a damage roll within 10s, and an HP gain to a healing roll', () => {
    const now = Date.now();
    const actor = makeFixtureActor({ system: { attributes: { hp: { value: 20 } } }, t: now });
    world.actors.add(actor);
    recorder.seed();

    const damageMessage = {
      id: 'dmg1',
      type: 'damage',
      speaker: { actor: actor.id },
      rolls: [
        d20Roll({
          total: 6,
          terms: [],
          dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        }),
      ],
      system: {},
      flags: {},
      _stats: { modifiedTime: now },
    };
    Hooks.callAll('createChatMessage', damageMessage, {}, 'u1');

    actor._stats.modifiedTime = now + 500; // 500ms after the roll: within the 10s window
    Hooks.callAll(
      'updateActor',
      actor,
      { system: { attributes: { hp: { value: 14 } } } },
      {},
      'u1'
    );
    const hpLoss = recorder.getPlayRecords({}).records.find(r => r.kind === 'hp');
    expect(hpLoss?.source).toEqual({ messageId: 'dmg1', attributed: true });

    const healMessage = {
      id: 'heal1',
      type: 'healing',
      speaker: { actor: actor.id },
      rolls: [
        d20Roll({
          total: 4,
          terms: [],
          dice: [{ faces: 4, results: [{ result: 4, active: true }] }],
        }),
      ],
      system: {},
      flags: {},
      _stats: { modifiedTime: now + 1000 },
    };
    Hooks.callAll('createChatMessage', healMessage, {}, 'u1');
    actor._stats.modifiedTime = now + 1200;
    Hooks.callAll(
      'updateActor',
      actor,
      { system: { attributes: { hp: { value: 18 } } } },
      {},
      'u1'
    );
    const hpGain = recorder
      .getPlayRecords({})
      .records.filter(r => r.kind === 'hp')
      .at(-1);
    expect(hpGain?.source).toEqual({ messageId: 'heal1', attributed: true });
  });

  it('does not attribute an HP change outside the 10s window', () => {
    const now = Date.now();
    const actor = makeFixtureActor({ system: { attributes: { hp: { value: 20 } } }, t: now });
    world.actors.add(actor);
    recorder.seed();

    const damageMessage = {
      id: 'dmg2',
      type: 'damage',
      speaker: { actor: actor.id },
      rolls: [
        d20Roll({
          total: 6,
          terms: [],
          dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        }),
      ],
      system: {},
      flags: {},
      _stats: { modifiedTime: now },
    };
    Hooks.callAll('createChatMessage', damageMessage, {}, 'u1');

    actor._stats.modifiedTime = now + 10_001; // just outside the window
    Hooks.callAll(
      'updateActor',
      actor,
      { system: { attributes: { hp: { value: 14 } } } },
      {},
      'u1'
    );
    const hpLoss = recorder.getPlayRecords({}).records.find(r => r.kind === 'hp');
    expect(hpLoss?.source).toBeUndefined();
  });

  it('credits one message once per target: every target of an area roll, never the same target twice', () => {
    const now = Date.now();
    const a = makeFixtureActor({ id: 'a1', system: { attributes: { hp: { value: 20 } } }, t: now });
    const b = makeFixtureActor({ id: 'a2', system: { attributes: { hp: { value: 20 } } }, t: now });
    world.actors.add(a);
    world.actors.add(b);
    recorder.seed();

    const roll = (total: number): ReturnType<typeof d20Roll> =>
      d20Roll({
        total,
        terms: [],
        dice: [{ faces: 6, results: [{ result: total, active: true }] }],
      });
    // Two rolls in one message (e.g. fire + radiant): still one HP change per target.
    Hooks.callAll(
      'createChatMessage',
      {
        id: 'aoe1',
        type: 'damage',
        speaker: { actor: a.id },
        rolls: [roll(5), roll(3)],
        system: {},
        flags: {},
        _stats: { modifiedTime: now },
      },
      {},
      'u1'
    );

    const hurt = (actor: any, hp: number, at: number): void => {
      actor._stats.modifiedTime = at;
      Hooks.callAll(
        'updateActor',
        actor,
        { system: { attributes: { hp: { value: hp } } } },
        {},
        'u1'
      );
    };
    hurt(a, 12, now + 300);
    hurt(b, 12, now + 400);
    hurt(a, 9, now + 2000); // a later hit on the same target: not the area roll again

    const hp = recorder.getPlayRecords({}).records.filter(r => r.kind === 'hp');
    expect(hp.map(r => [r.actor?.uuid, r.after, r.source])).toEqual([
      ['Actor.a1', 12, { messageId: 'aoe1', attributed: true }],
      ['Actor.a2', 12, { messageId: 'aoe1', attributed: true }],
      ['Actor.a1', 9, undefined],
    ]);
  });
});

// --- GM gating, buffer and perf ---------------------------------------------------

describe('GM gating', () => {
  it('a non-GM client records nothing', () => {
    restore();
    setup({ isGM: false });
    const actor = makeFixtureActor({ system: { attributes: { hp: { value: 20 } } } });
    world.actors.add(actor);
    recorder.seed();
    actor._stats.modifiedTime = 2000;
    Hooks.callAll('updateActor', actor, { system: { attributes: { hp: { value: 5 } } } }, {}, 'u1');
    Hooks.callAll('userConnected', { id: 'p1', name: 'Bob' }, true);
    Hooks.callAll('dnd5e.restCompleted', actor, { type: 'short' }, { chat: false });
    expect(recorder.getPlayRecords({}).records).toHaveLength(0);
  });
});

describe('user names', () => {
  it('every record that names a user carries the name too, rolls and chat included', () => {
    world.addUser({ id: 'u1', name: 'Aria' });
    const actor = makeFixtureActor();
    world.actors.add(actor);
    const message = (id: string, rolls: unknown[]): Record<string, unknown> => ({
      id,
      type: 'base',
      speaker: { actor: actor.id },
      rolls,
      content: '<p>Hello</p>',
      system: {},
      flags: {},
      _stats: { modifiedTime: Date.now() },
    });
    Hooks.callAll('createChatMessage', message('m1', [d20Roll({ total: 12 })]), {}, 'u1');
    Hooks.callAll('createChatMessage', message('m2', []), {}, 'u1');
    Hooks.callAll('createChatMessage', message('m3', []), {}, 'gone'); // a deleted user: no name
    const records = recorder.getPlayRecords({}).records;
    expect(records.map(r => [r.kind, r.userId, r.userName])).toEqual([
      ['roll', 'u1', 'Aria'],
      ['chat', 'u1', 'Aria'],
      ['chat', 'gone', undefined],
    ]);
  });
});

describe('the ring buffer and getPlayRecords', () => {
  it('respects sinceSeq and limit, and reports oldestSeq/latestSeq', () => {
    for (let i = 0; i < 5; i++) {
      Hooks.callAll('userConnected', { id: `p${i}`, name: `P${i}` }, true);
    }
    const all = recorder.getPlayRecords({});
    expect(all.records).toHaveLength(5);
    expect(all.oldestSeq).toBe(1);
    expect(all.latestSeq).toBe(5);
    expect(all.clientId).toEqual(expect.any(String));

    const page = recorder.getPlayRecords({ sinceSeq: 2, limit: 2 });
    expect(page.records.map(r => r.seq)).toEqual([3, 4]);
    expect(page.oldestSeq).toBe(1);
    expect(page.latestSeq).toBe(5);
  });

  it('defaults sinceSeq to 0 and limit to 2000, capped at 5000', () => {
    const empty = recorder.getPlayRecords({});
    expect(empty.records).toEqual([]);
    const capped = recorder.getPlayRecords({ limit: 999_999 });
    expect(capped.records).toEqual([]); // nothing recorded yet, but no throw on a huge limit
  });

  it('keeps only the newest 5000 records', () => {
    for (let i = 0; i < 5010; i++) {
      Hooks.callAll('userConnected', { id: `p${i}`, name: `P${i}` }, true);
    }
    const page = recorder.getPlayRecords({ limit: 5000 });
    expect(page.oldestSeq).toBe(11);
    expect(page.latestSeq).toBe(5010);
    expect(page.records).toHaveLength(5000);
  });

  it('records 1000 events quickly', () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      Hooks.callAll('userConnected', { id: `p${i}`, name: `P${i}` }, true);
    }
    expect(Date.now() - start).toBeLessThan(1000);
    expect(recorder.getPlayRecords({ limit: 5000 }).records).toHaveLength(1000);
  });
});

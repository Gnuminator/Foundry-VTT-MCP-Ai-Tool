/**
 * Unit tests for paper sync (Paper nights A): `planPaperSync` turns the numbers on one paper
 * sheet into guarded ops. Nothing is written; these tests pin the ops, the change lines, that
 * only differing fields become ops, and that anything above a maximum refuses the whole request.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PAPER_SYNC_COINS as SHARED_COINS,
  PAPER_SYNC_FEATURE_ID as SHARED_FEATURE,
  PAPER_SYNC_FIELDS as SHARED_FIELDS,
  PAPER_SYNC_QUERY as SHARED_QUERY,
  PAPER_SYNC_SLOT_KEYS as SHARED_SLOTS,
} from '../../../shared/src/paper-sync.js';
import {
  COINS,
  FIELDS,
  PAPER_SYNC_FEATURE_ID,
  PAPER_SYNC_QUERY,
  SLOT_KEYS,
  planPaperSync,
} from './paper-sync-plan.js';
import { NON_WRITE_METHODS, WRITE_METHODS } from './write-gate.js';
import {
  createTestWorld,
  makeEffect,
  makeItem,
  type TestWorld,
} from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;

const g = globalThis as any;

const STATUS_EFFECTS = {
  prone: { _id: 'dnd5eprone000000', name: 'Prone', img: 'prone.svg' },
  poisoned: { _id: 'dnd5epoisoned000', name: 'Poisoned', img: 'poisoned.svg' },
  stunned: { _id: 'dnd5estunned0000', name: 'Stunned', img: 'stunned.svg' },
  unconscious: {
    _id: 'dnd5eunconscious',
    name: 'Unconscious',
    img: 'unconscious.svg',
    riders: ['prone'],
  },
  concentrating: { _id: 'dnd5econcentrat0', name: 'Concentrating', img: 'conc.svg' },
  exhaustion: { _id: 'dnd5eexhaustion0', name: 'Exhaustion', img: 'exh.svg', levels: 6 },
};

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  g.CONFIG.statusEffects = structuredClone(STATUS_EFFECTS);
});

afterEach(() => {
  restore();
});

interface Sheet {
  hp?: { value: number; max: number; temp: number; effectiveMax?: number };
  exhaustion?: number;
  inspiration?: boolean;
  death?: { success: number; failure: number };
  spells?: Record<string, { value: number; max: number }>;
  currency?: Record<string, number>;
  resources?: Record<string, { label: string; value: number; max: number }>;
  items?: any[];
  effects?: any[];
  statuses?: string[];
  type?: string;
}

/** Mira, a level 5 fighter with a bit of everything on the sheet. */
function addMira(sheet: Sheet = {}): any {
  return world.addActor({
    id: 'a1',
    name: 'Mira',
    type: sheet.type ?? 'character',
    uuid: 'Actor.a1',
    system: {
      attributes: {
        hp: sheet.hp ?? { value: 31, max: 31, temp: 0 },
        exhaustion: sheet.exhaustion ?? 0,
        inspiration: sheet.inspiration ?? false,
        death: sheet.death ?? { success: 0, failure: 0 },
      },
      spells: sheet.spells ?? {
        spell1: { value: 4, max: 4 },
        spell2: { value: 3, max: 3 },
        pact: { value: 2, max: 2 },
      },
      currency: sheet.currency ?? { pp: 0, gp: 112, ep: 0, sp: 5, cp: 0 },
      resources: sheet.resources ?? { primary: { label: 'Ki Points', value: 3, max: 5 } },
    },
    items: sheet.items ?? [],
    effects: sheet.effects ?? [],
    statuses: new Set(sheet.statuses ?? []),
  });
}

const fighter = (spent = 2): any =>
  makeItem({
    id: 'c1',
    name: 'Fighter',
    type: 'class',
    uuid: 'Actor.a1.Item.c1',
    system: { levels: 5, identifier: 'fighter', hd: { denomination: 'd10', spent } },
  });

const rope = (quantity = 1): any =>
  makeItem({
    id: 'i1',
    name: 'Rope',
    type: 'loot',
    uuid: 'Actor.a1.Item.i1',
    system: { quantity },
  });

const potion = (quantity = 2): any =>
  makeItem({
    id: 'i2',
    name: 'Potion of Healing',
    type: 'consumable',
    uuid: 'Actor.a1.Item.i2',
    system: { quantity, uses: { spent: 0, max: 1, value: 1 } },
  });

function effect(id: string, name: string, statuses: string[]): any {
  return makeEffect({ id, name, uuid: `Actor.a1.ActiveEffect.${id}`, statuses });
}

describe('wire contract', () => {
  it('mirrors the shared constants', () => {
    expect(PAPER_SYNC_QUERY).toBe(SHARED_QUERY);
    expect(PAPER_SYNC_FEATURE_ID).toBe(SHARED_FEATURE);
    expect([...SLOT_KEYS]).toEqual([...SHARED_SLOTS]);
    expect([...COINS]).toEqual([...SHARED_COINS]);
    expect([...FIELDS]).toEqual([...SHARED_FIELDS]);
  });

  it('is a read-only method: planning goes through the write gate list as a non-write', () => {
    expect(NON_WRITE_METHODS).toContain(PAPER_SYNC_QUERY);
    expect(WRITE_METHODS).not.toContain(PAPER_SYNC_QUERY);
  });
});

describe('request checks', () => {
  it('refuses another game system', async () => {
    addMira();
    g.game.system = { id: 'pf2e' };
    await expect(planPaperSync({ actor: 'Mira', hp: 10 })).rejects.toThrow(/dnd5e/);
  });

  it('asks for the character', async () => {
    await expect(planPaperSync({ hp: 10 })).rejects.toThrow(/Name the character/);
  });

  it('refuses XP, level, class and max HP, with the reason', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', xp: 900 })).rejects.toThrow(
      /xp: XP is not synced \(the campaign uses milestones\)/
    );
    await expect(planPaperSync({ actor: 'Mira', level: 6, class: 'Rogue' })).rejects.toThrow(
      /level: .*never changed.*; class: .*never changed/
    );
    await expect(planPaperSync({ actor: 'Mira', maxHp: 40 })).rejects.toThrow(/max HP is never/);
    await expect(planPaperSync({ actor: 'Mira', speed: 40 })).rejects.toThrow(
      /speed: not a paper sync field/
    );
  });

  it('refuses an unknown character and a non-character actor', async () => {
    await expect(planPaperSync({ actor: 'Nobody', hp: 1 })).rejects.toThrow(/Nobody/);
    addMira({ type: 'npc' });
    await expect(planPaperSync({ actor: 'Mira', hp: 1 })).rejects.toThrow(/not a player character/);
  });

  it('throws "Nothing to change" and lists what already matched', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', hp: 31, coins: { gp: 112 } })).rejects.toThrow(
      'Nothing to change for Mira: HP already 31 of 31; gp already 112'
    );
    await expect(planPaperSync({ actor: 'Mira' })).rejects.toThrow(/no fields were given/);
  });

  it('writes nothing at plan time', async () => {
    const mira = addMira();
    await planPaperSync({ actor: 'Mira', hp: 5, coins: { gp: 1 } });
    expect(mira.system.attributes.hp.value).toBe(31);
    expect(mira.system.currency.gp).toBe(112);
  });
});

describe('hit points', () => {
  it('sets HP and temp HP as absolute values in one update', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', hp: 18, tempHp: 4 });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'system.attributes.hp.value': 18, 'system.attributes.hp.temp': 4 },
      },
    ]);
    expect(plan.changes.map(c => c.line)).toEqual(['HP 31 to 18 of 31', 'Temp HP 0 to 4']);
    expect(plan.summary).toBe('Paper sync Mira: HP 31 to 18 of 31, Temp HP 0 to 4');
    expect(plan.actor).toEqual({ name: 'Mira', uuid: 'Actor.a1' });
  });

  it('can raise HP back to the maximum, and sets 0', async () => {
    addMira({ hp: { value: 5, max: 31, temp: 0 } });
    const up = await planPaperSync({ actor: 'Mira', hp: 31 });
    expect(up.ops[0]).toMatchObject({ changes: { 'system.attributes.hp.value': 31 } });
    const down = await planPaperSync({ actor: 'Mira', hp: 0 });
    expect(down.ops[0]).toMatchObject({ changes: { 'system.attributes.hp.value': 0 } });
  });

  it('refuses HP above the maximum, but counts a temporary max HP bonus', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', hp: 32 })).rejects.toThrow(
      /HP 32 is more than the maximum 31/
    );
    const mira = world.actors.get('a1') as any;
    mira.system.attributes.hp.effectiveMax = 40;
    const plan = await planPaperSync({ actor: 'Mira', hp: 40 });
    expect(plan.changes[0]?.line).toBe('HP 31 to 40 of 40');
  });

  it('refuses a fraction and a negative number', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', hp: 12.5 })).rejects.toThrow(/whole number/);
    await expect(planPaperSync({ actor: 'Mira', tempHp: -1 })).rejects.toThrow(/whole number/);
  });

  it('leaves out a matching value and says so', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', hp: 31, tempHp: 3 });
    expect(plan.ops).toHaveLength(1);
    expect(plan.unchanged).toEqual(['HP already 31 of 31']);
  });

  it('refuses an actor without hit points', async () => {
    world.addActor({ id: 'a1', name: 'Mira', type: 'character', uuid: 'Actor.a1', system: {} });
    await expect(planPaperSync({ actor: 'Mira', hp: 3 })).rejects.toThrow(/no hit points/);
  });
});

describe('spell slots', () => {
  it('sets slots per level and pact slots, the current value only', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', slots: { '1': 1, '2': 0, pact: 1 } });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: {
          'system.spells.spell1.value': 1,
          'system.spells.spell2.value': 0,
          'system.spells.pact.value': 1,
        },
      },
    ]);
    expect(plan.changes.map(c => c.line)).toEqual([
      'level 1 spell slots 4 to 1 of 4',
      'level 2 spell slots 3 to 0 of 3',
      'pact slots 2 to 1 of 2',
    ]);
  });

  it('refuses more than the maximum, a level without slots and an unknown key', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', slots: { '1': 5 } })).rejects.toThrow(
      /5 is more than the maximum 4/
    );
    await expect(planPaperSync({ actor: 'Mira', slots: { '5': 1 } })).rejects.toThrow(
      /no level 5 spell slots/
    );
    await expect(planPaperSync({ actor: 'Mira', slots: { '10': 1 } })).rejects.toThrow(
      /"10" is not a spell level/
    );
  });

  it('lists every problem at once', async () => {
    addMira();
    await expect(
      planPaperSync({ actor: 'Mira', hp: 99, slots: { '1': 9 }, coins: { gp: -1 } })
    ).rejects.toThrow(/HP 99.*Slots 1.*gp/s);
  });
});

describe('hit dice', () => {
  it('writes spent for the class, from the hit dice left', async () => {
    addMira({ items: [fighter(2)] });
    const plan = await planPaperSync({
      actor: 'Mira',
      hitDice: [{ class: 'fighter', left: 1 }],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.c1', changes: { 'system.hd.spent': 4 } },
    ]);
    expect(plan.changes[0]?.line).toBe('Fighter hit dice (d10) 3 to 1 of 5');
  });

  it('needs no class name for a single-class character, but asks for it with two', async () => {
    addMira({ items: [fighter(0)] });
    const one = await planPaperSync({ actor: 'Mira', hitDice: [{ left: 5 - 3 }] });
    expect(one.ops[0]).toMatchObject({ changes: { 'system.hd.spent': 3 } });
    world.actors.get('a1')!.items.set(
      'c2',
      makeItem({
        id: 'c2',
        name: 'Rogue',
        type: 'class',
        uuid: 'Actor.a1.Item.c2',
        system: { levels: 1, hd: { denomination: 'd8', spent: 0 } },
      })
    );
    await expect(planPaperSync({ actor: 'Mira', hitDice: [{ left: 1 }] })).rejects.toThrow(
      /name the class \(classes: Fighter, Rogue\)/
    );
    const two = await planPaperSync({ actor: 'Mira', hitDice: [{ class: 'Rogue', left: 0 }] });
    expect(two.ops[0]).toMatchObject({
      uuid: 'Actor.a1.Item.c2',
      changes: { 'system.hd.spent': 1 },
    });
  });

  it('refuses more hit dice than levels, an unknown class and a matching value', async () => {
    addMira({ items: [fighter(2)] });
    await expect(
      planPaperSync({ actor: 'Mira', hitDice: [{ class: 'Fighter', left: 6 }] })
    ).rejects.toThrow(/6 is more than the 5 hit dice of Fighter/);
    await expect(
      planPaperSync({ actor: 'Mira', hitDice: [{ class: 'Wizard', left: 1 }] })
    ).rejects.toThrow(/no class "Wizard"/);
    await expect(
      planPaperSync({ actor: 'Mira', hitDice: [{ class: 'Fighter', left: 3 }] })
    ).rejects.toThrow('Nothing to change for Mira: Fighter hit dice (d10) already 3 of 5');
  });
});

describe('class resources and item uses', () => {
  it('sets a class resource by label', async () => {
    addMira();
    const plan = await planPaperSync({
      actor: 'Mira',
      resources: [{ name: 'ki points', value: 1 }],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.resources.primary.value': 1 } },
    ]);
    expect(plan.changes[0]?.line).toBe('Ki Points 3 to 1 of 5');
  });

  it('writes item uses through spent, on the item', async () => {
    const wand = makeItem({
      id: 'w1',
      name: 'Wand of Magic Missiles',
      type: 'equipment',
      uuid: 'Actor.a1.Item.w1',
      system: { quantity: 1, uses: { spent: 0, max: 7, value: 7 } },
    });
    addMira({ items: [wand] });
    const plan = await planPaperSync({
      actor: 'Mira',
      resources: [{ name: 'Wand of Magic Missiles', value: 4 }],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.w1', changes: { 'system.uses.spent': 3 } },
    ]);
  });

  it('refuses more than the maximum and an unknown resource', async () => {
    addMira();
    await expect(
      planPaperSync({ actor: 'Mira', resources: [{ name: 'Ki Points', value: 6 }] })
    ).rejects.toThrow(/6 is more than the maximum 5 for "Ki Points"/);
    await expect(
      planPaperSync({ actor: 'Mira', resources: [{ name: 'Bardic Inspiration', value: 1 }] })
    ).rejects.toThrow(/No resource "Bardic Inspiration"/);
  });
});

describe('coins', () => {
  it('writes the absolute coins that differ', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', coins: { gp: 87, sp: 5, cp: 12 } });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'system.currency.gp': 87, 'system.currency.cp': 12 },
      },
    ]);
    expect(plan.changes.map(c => c.line)).toEqual(['gp 112 to 87', 'cp 0 to 12']);
    expect(plan.unchanged).toEqual(['sp already 5']);
  });

  it('refuses a negative amount and a made-up coin', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', coins: { gp: -5 } })).rejects.toThrow(
      /gp: gp must be a whole number/
    );
    await expect(planPaperSync({ actor: 'Mira', coins: { dubloons: 5 } })).rejects.toThrow(
      /dubloons: not a coin/
    );
  });
});

describe('exhaustion', () => {
  it('sets the level as an update', async () => {
    addMira({ exhaustion: 1 });
    const plan = await planPaperSync({ actor: 'Mira', exhaustion: 3 });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.exhaustion': 3 } },
    ]);
    expect(plan.changes[0]?.line).toBe('Exhaustion 1 to 3');
  });

  it('clears it with 0, merges with an HP change on the same actor, and refuses above 6', async () => {
    addMira({ exhaustion: 2 });
    const plan = await planPaperSync({ actor: 'Mira', exhaustion: 0, hp: 20 });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'system.attributes.hp.value': 20, 'system.attributes.exhaustion': 0 },
      },
    ]);
    await expect(planPaperSync({ actor: 'Mira', exhaustion: 7 })).rejects.toThrow(
      /level 7 is more than the maximum 6/
    );
  });
});

describe('conditions', () => {
  it('creates the missing conditions with their status effect id kept', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', conditions: ['poisoned'] });
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      kind: 'create',
      documentName: 'ActiveEffect',
      parentUuid: 'Actor.a1',
      keepId: true,
      data: { statuses: ['poisoned'] },
    });
    expect(plan.changes[0]?.line).toBe('Conditions none to Poisoned');
  });

  it('removes the conditions that are no longer on the sheet (the exact set)', async () => {
    addMira({
      statuses: ['poisoned', 'stunned'],
      effects: [effect('e1', 'Poisoned', ['poisoned']), effect('e2', 'Stunned', ['stunned'])],
    });
    const plan = await planPaperSync({ actor: 'Mira', conditions: ['stunned'] });
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' }]);
    expect(plan.changes[0]?.line).toBe('Conditions Poisoned, Stunned to Stunned');
    // Removing a condition effect is no destructive delete: the service only counts non-effects.
    expect(plan.ops.every(op => op.kind === 'delete' && op.uuid.includes('ActiveEffect'))).toBe(
      true
    );
  });

  it('clears all conditions with an empty list, leaves them alone when omitted', async () => {
    addMira({
      statuses: ['poisoned'],
      effects: [effect('e1', 'Poisoned', ['poisoned'])],
    });
    const clear = await planPaperSync({ actor: 'Mira', conditions: [] });
    expect(clear.ops).toEqual([{ kind: 'delete', uuid: 'Actor.a1.ActiveEffect.e1' }]);
    await expect(planPaperSync({ actor: 'Mira', hp: 31 })).rejects.toThrow(/Nothing to change/);
  });

  it('keeps the rider of a condition (Unconscious brings Prone) and adds it first', async () => {
    addMira();
    const plan = await planPaperSync({ actor: 'Mira', conditions: ['unconscious'] });
    expect(
      plan.ops.map(op => (op.kind === 'create' ? (op.data.statuses as string[])[0] : op.kind))
    ).toEqual(['prone', 'unconscious']);
  });

  it('does not remove the rider already on a character who is unconscious', async () => {
    addMira({
      statuses: ['unconscious', 'prone'],
      effects: [effect('e1', 'Unconscious', ['unconscious']), effect('e2', 'Prone', ['prone'])],
    });
    await expect(planPaperSync({ actor: 'Mira', conditions: ['unconscious'] })).rejects.toThrow(
      /Nothing to change.*Conditions already Prone, Unconscious/
    );
  });

  it('leaves statuses that are not on a sheet alone (concentration)', async () => {
    addMira({
      statuses: ['concentrating'],
      effects: [effect('e1', 'Concentrating', ['concentrating'])],
    });
    await expect(planPaperSync({ actor: 'Mira', conditions: [] })).rejects.toThrow(
      /Nothing to change.*Conditions already none/
    );
  });

  it('refuses an unknown condition, a non-sheet status and exhaustion in the list', async () => {
    addMira();
    await expect(planPaperSync({ actor: 'Mira', conditions: ['hexed'] })).rejects.toThrow(
      /Unknown condition "hexed"/
    );
    await expect(planPaperSync({ actor: 'Mira', conditions: ['concentrating'] })).rejects.toThrow(
      /not a condition on a character sheet/
    );
    await expect(planPaperSync({ actor: 'Mira', conditions: ['exhaustion'] })).rejects.toThrow(
      /exhaustion has its own field/
    );
  });
});

describe('inspiration and death saves', () => {
  it('sets inspiration, both ways', async () => {
    addMira();
    const on = await planPaperSync({ actor: 'Mira', inspiration: true });
    expect(on.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1', changes: { 'system.attributes.inspiration': true } },
    ]);
    expect(on.changes[0]?.line).toBe('Inspiration gained');
    world.actors.get('a1')!.system.attributes.inspiration = true;
    const off = await planPaperSync({ actor: 'Mira', inspiration: false });
    expect(off.changes[0]?.line).toBe('Inspiration used');
    await expect(planPaperSync({ actor: 'Mira', inspiration: true })).rejects.toThrow(
      /Inspiration already on/
    );
  });

  it('resets death saves only when there is something to reset', async () => {
    addMira({ death: { success: 2, failure: 1 } });
    const plan = await planPaperSync({ actor: 'Mira', resetDeathSaves: true });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Actor.a1',
        changes: { 'system.attributes.death.success': 0, 'system.attributes.death.failure': 0 },
      },
    ]);
    expect(plan.changes[0]?.line).toBe('Death saves reset (were 2 successes, 1 failures)');
    world.actors.get('a1')!.system.attributes.death = { success: 0, failure: 0 };
    await expect(planPaperSync({ actor: 'Mira', resetDeathSaves: true })).rejects.toThrow(
      /Death saves already clear/
    );
  });

  it('does nothing for resetDeathSaves false', async () => {
    addMira({ death: { success: 2, failure: 1 } });
    await expect(planPaperSync({ actor: 'Mira', resetDeathSaves: false })).rejects.toThrow(
      /no fields were given/
    );
  });
});

describe('inventory', () => {
  it('sets a quantity on the item by name', async () => {
    addMira({ items: [rope(1), potion(2)] });
    const plan = await planPaperSync({
      actor: 'Mira',
      inventory: [{ item: 'potion of healing', quantity: 1 }],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.i2', changes: { 'system.quantity': 1 } },
    ]);
    expect(plan.changes[0]?.line).toBe('Potion of Healing 2 to 1');
  });

  it('removes an item with quantity 0 (a delete, so the plan is destructive)', async () => {
    addMira({ items: [rope(1)] });
    const plan = await planPaperSync({ actor: 'Mira', inventory: [{ item: 'Rope', quantity: 0 }] });
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Actor.a1.Item.i1' }]);
    expect(plan.changes[0]?.line).toBe('Rope removed (was 1)');
  });

  it('warns when a container is removed', async () => {
    const pack = makeItem({
      id: 'i3',
      name: 'Backpack',
      type: 'container',
      uuid: 'Actor.a1.Item.i3',
      system: { quantity: 1 },
    });
    addMira({ items: [pack] });
    const plan = await planPaperSync({
      actor: 'Mira',
      inventory: [{ item: 'Backpack', quantity: 0 }],
    });
    expect(plan.warnings).toEqual([
      'Backpack is a container: what is inside it stays on the character',
    ]);
  });

  it('finds an item by id, and refuses an ambiguous partial name', async () => {
    const a = makeItem({
      id: 'd1',
      name: 'Dagger',
      type: 'weapon',
      uuid: 'Actor.a1.Item.d1',
      system: { quantity: 1 },
    });
    const b = makeItem({
      id: 'd2',
      name: 'Dagger +1',
      type: 'weapon',
      uuid: 'Actor.a1.Item.d2',
      system: { quantity: 1 },
    });
    addMira({ items: [a, b] });
    const byId = await planPaperSync({ actor: 'Mira', inventory: [{ item: 'd2', quantity: 3 }] });
    expect(byId.ops[0]).toMatchObject({ uuid: 'Actor.a1.Item.d2' });
    const exact = await planPaperSync({
      actor: 'Mira',
      inventory: [{ item: 'Dagger', quantity: 3 }],
    });
    expect(exact.ops[0]).toMatchObject({ uuid: 'Actor.a1.Item.d1' });
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ item: 'dag', quantity: 3 }] })
    ).rejects.toThrow(/"dag" matches Dagger \(id d1\), Dagger \+1 \(id d2\): give the id/);
  });

  it('refuses an item the character does not have, and one without a quantity', async () => {
    addMira({ items: [fighter()] });
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ item: 'Torch', quantity: 3 }] })
    ).rejects.toThrow(/Mira has no item "Torch" \(to add one, give its compendium uuid/);
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ item: 'Fighter', quantity: 3 }] })
    ).rejects.toThrow(/Fighter has no quantity/);
  });

  it('adds a compendium item with the quantity, via the loot item data (no _id)', async () => {
    addMira();
    g.fromUuid = (uuid: string): Promise<unknown> =>
      Promise.resolve(
        uuid === 'Compendium.dnd5e.items.Torch'
          ? {
              documentName: 'Item',
              toObject: (): Record<string, unknown> => ({
                _id: 'orig',
                name: 'Torch',
                type: 'consumable',
                folder: 'f1',
                sort: 3,
                ownership: { default: 3 },
                system: { quantity: 1, weight: { value: 1 } },
              }),
            }
          : null
      );
    const plan = await planPaperSync({
      actor: 'Mira',
      inventory: [{ uuid: 'Compendium.dnd5e.items.Torch', quantity: 4 }],
    });
    expect(plan.ops).toEqual([
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: 'Actor.a1',
        data: {
          name: 'Torch',
          type: 'consumable',
          system: { quantity: 4, weight: { value: 1 } },
        },
      },
    ]);
    expect(plan.changes[0]?.line).toBe('Torch added (4)');
  });

  it('sets the quantity instead when the character already has that item', async () => {
    addMira({ items: [rope(1)] });
    g.fromUuid = (): Promise<unknown> =>
      Promise.resolve({
        documentName: 'Item',
        toObject: () => ({ name: 'Rope', type: 'loot', system: { quantity: 1 } }),
      });
    const plan = await planPaperSync({
      actor: 'Mira',
      inventory: [{ uuid: 'Compendium.x.y.Rope', quantity: 2 }],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.a1.Item.i1', changes: { 'system.quantity': 2 } },
    ]);
  });

  it('refuses a uuid that is no item or has no quantity, and a line with both item and uuid', async () => {
    addMira();
    g.fromUuid = (): Promise<unknown> => Promise.resolve(null);
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ uuid: 'Compendium.x.y.Z', quantity: 1 }] })
    ).rejects.toThrow(/is not an item/);
    g.fromUuid = (): Promise<unknown> =>
      Promise.resolve({
        documentName: 'Item',
        toObject: () => ({ name: 'Darkvision', type: 'feat', system: {} }),
      });
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ uuid: 'Compendium.x.y.F', quantity: 1 }] })
    ).rejects.toThrow(/Darkvision has no quantity/);
    await expect(
      planPaperSync({
        actor: 'Mira',
        inventory: [{ item: 'Rope', uuid: 'Compendium.x', quantity: 1 }],
      })
    ).rejects.toThrow(/either "item"/);
  });

  it('skips adding a compendium item with quantity 0, and refuses the same item twice', async () => {
    addMira({ items: [rope(1)] });
    g.fromUuid = (): Promise<unknown> =>
      Promise.resolve({
        documentName: 'Item',
        toObject: () => ({ name: 'Torch', type: 'consumable', system: { quantity: 1 } }),
      });
    await expect(
      planPaperSync({ actor: 'Mira', inventory: [{ uuid: 'Compendium.x.y.T', quantity: 0 }] })
    ).rejects.toThrow(/Torch not on the character, quantity 0/);
    await expect(
      planPaperSync({
        actor: 'Mira',
        inventory: [
          { item: 'Rope', quantity: 2 },
          { item: 'Rope', quantity: 3 },
        ],
      })
    ).rejects.toThrow(/Rope is on the list twice/);
  });
});

describe('a whole sheet', () => {
  it('builds one plan with only the differing fields', async () => {
    addMira({
      items: [fighter(2), rope(1), potion(2)],
      death: { success: 1, failure: 0 },
    });
    const plan = await planPaperSync({
      actor: 'Mira',
      hp: 18,
      tempHp: 0,
      slots: { '1': 2, '2': 3 },
      hitDice: [{ left: 1 }],
      resources: [{ name: 'Ki Points', value: 2 }],
      coins: { gp: 87 },
      exhaustion: 0,
      conditions: [],
      inspiration: false,
      resetDeathSaves: true,
      inventory: [
        { item: 'Rope', quantity: 0 },
        { item: 'Potion of Healing', quantity: 1 },
      ],
    });
    expect(plan.changes.map(c => c.field)).toEqual([
      'hp',
      'slots',
      'hitDice',
      'resources',
      'coins',
      'resetDeathSaves',
      'inventory',
      'inventory',
    ]);
    expect(plan.unchanged).toEqual([
      'Temp HP already 0',
      'level 2 spell slots already 3 of 3',
      'Exhaustion already 0',
      'Conditions already none',
      'Inspiration already off',
    ]);
    // one update per document: the actor once, the class, the potion; one delete for the rope
    expect(plan.ops.filter(op => op.kind === 'update').map(op => (op as any).uuid)).toEqual([
      'Actor.a1',
      'Actor.a1.Item.c1',
      'Actor.a1.Item.i2',
    ]);
    expect(plan.ops.filter(op => op.kind === 'delete')).toEqual([
      { kind: 'delete', uuid: 'Actor.a1.Item.i1' },
    ]);
    expect(plan.summary.length).toBeLessThanOrEqual(300);
  });
});

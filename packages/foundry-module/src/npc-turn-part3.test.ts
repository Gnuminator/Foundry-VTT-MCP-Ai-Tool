/**
 * NPC turn assistant, part 3: activities (attack, save, utility), legendary actions, and the
 * damage from the rolls planned together with the move. Fixtures use neutral names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planNpcTurnWithDamage } from './npc-turn-damage.js';
import { planNpcTurn } from './npc-turn.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});
afterEach(() => {
  restore();
  delete g.CONFIG;
});

const attackActivity = (name = 'Attack', extra: Record<string, unknown> = {}): any => ({
  type: 'attack',
  name,
  attack: { type: { value: 'melee' } },
  ...extra,
});
const saveActivity = (name: string, extra: Record<string, unknown> = {}): any => ({
  type: 'save',
  name,
  save: { ability: new Set(['dex']), dc: { value: 14 } },
  damage: { onSave: 'half', parts: [{ number: 2, denomination: 8 }] },
  ...extra,
});
const legendary = (value = 1): any => ({ activation: { type: 'legendary', value } });

function item(name: string, activities: any[], range: Record<string, unknown> = { reach: 5 }): any {
  return { name, system: { range, activities: { contents: activities } } };
}

function token(id: string, name: string, x: number, y: number, extra: any = {}): any {
  return {
    id,
    uuid: `Scene.s1.Token.${id}`,
    name,
    x: x * 100,
    y: y * 100,
    width: 1,
    height: 1,
    disposition: -1,
    ...extra,
  };
}

/** A hero whose `applyDamage` mimics dnd5e: it calls the dry-run hook and writes only when allowed. */
function hero(id: string, hp: number, extra: any = {}): any {
  const actor: any = {
    id: `a-${id}`,
    uuid: `Actor.${id}`,
    name: id,
    type: 'character',
    items: { contents: [] },
    effects: { contents: [] },
    statuses: new Set<string>(),
    system: { attributes: { ac: { value: 16 }, hp: { value: hp, max: 30, temp: 0 } } },
    applyDamage(damages: any[], options: any = {}): Promise<any> {
      let amount = 0;
      for (const d of damages)
        amount += d.type === extra.resists ? Math.floor(d.value / 2) : d.value;
      const hpNow = actor.system.attributes.hp;
      const updates = {
        'system.attributes.hp.value': Math.max(hpNow.value - amount, 0),
        'system.attributes.hp.temp': 0,
      };
      g.Hooks.call('dnd5e.preApplyDamage', actor, amount, updates, options);
      return Promise.resolve(actor);
    },
  };
  return actor;
}

interface Arena {
  items?: any[];
  legact?: { max: number; spent: number; value: number };
  /** The NPC with the legendary actions is a second creature, not the one whose turn it is. */
  boss?: boolean;
  walk?: number;
}

/** Wolf (t1) has the turn; Hero (t2) stands 5 squares east; Goblin (t4) is a second enemy. */
function arena(opts: Arena = {}): any {
  const system = {
    attributes: {
      movement: { walk: opts.walk ?? 30 },
      ac: { value: 13 },
      hp: { value: 11, max: 11 },
    },
    ...(opts.legact ? { resources: { legact: opts.legact } } : {}),
  };
  const npc = {
    id: 'a-npc',
    name: 'Aboleth',
    type: 'npc',
    items: { contents: opts.items ?? [] },
    statuses: new Set<string>(),
    system,
  };
  const wolf = token('t1', 'Wolf', 2, 2, {
    actor: opts.boss
      ? {
          ...npc,
          id: 'a-wolf',
          name: 'Wolf',
          items: { contents: [] },
          system: { ...system, resources: undefined },
        }
      : npc,
  });
  const boss = token('t3', 'Boss', 2, 4, { actor: npc });
  const heroToken = token('t2', 'Hero', 7, 2, { disposition: 1, actor: hero('Hero', 30) });
  const goblinToken = token('t4', 'Goblin', 7, 4, { disposition: 1, actor: hero('Goblin', 12) });
  const all = opts.boss ? [wolf, boss, heroToken, goblinToken] : [wolf, heroToken, goblinToken];
  const scene = {
    id: 's1',
    name: 'Arena',
    grid: { size: 100, distance: 5, units: 'ft' },
    tokens: { contents: all },
    walls: { contents: [] },
    regions: { contents: [] },
  };
  g.game.scenes = { current: scene, active: scene };
  const combatants = all.map((t, i) => ({ id: `c${i}`, tokenId: t.id, defeated: false }));
  g.game.combats = {
    contents: [
      {
        started: true,
        round: 1,
        turn: 0,
        combatants: { contents: combatants },
        turns: combatants,
        combatant: combatants[0],
        scene: { id: 's1' },
      },
    ],
  };
  return { scene, heroToken, goblinToken };
}

const lash = item('Lash', [{ type: 'utility', name: 'Lash', ...legendary(1) }], { reach: 10 });
const tentacle = item('Tentacle', [attackActivity('Attack'), { type: 'utility', name: 'Slime' }]);
const cloud = item('Mucus Cloud', [saveActivity('Cloud'), attackActivity('Swipe')], { value: 30 });

describe('activities and saves', () => {
  it('lists every activity with its save and legendary cost', () => {
    arena({ items: [tentacle, cloud, lash], legact: { max: 3, spent: 0, value: 3 } });
    const actions = planNpcTurn({}).context.actions;
    expect(actions.map(a => a.name)).toEqual(['Tentacle', 'Mucus Cloud', 'Lash']);
    expect(actions[1]?.activities?.[0]).toEqual({
      name: 'Cloud',
      type: 'save',
      legendaryCost: null,
      save: { abilities: ['dex'], dc: 14, onSave: 'half' },
      damage: true,
    });
    expect(actions[2]?.activities?.[0]).toMatchObject({ type: 'utility', legendaryCost: 1 });
  });

  it('plans a save-based activity with the save to roll and what half damage means', () => {
    arena({ items: [cloud] });
    const plan = planNpcTurn({
      attacks: [{ itemName: 'Mucus Cloud', target: 'Hero', activity: 'cloud' }],
    });
    const attack = plan.attacks[0];
    expect(attack).toMatchObject({ kind: 'save', activity: 'Cloud', save: { dc: 14 } });
    expect(attack.saveWith).toBe(
      'roll-saving-throws {"targets":["t2"],"rollType":"save","ability":"dex","dc":14}'
    );
    expect(attack.rollWith).toContain('"activity":"Cloud"');
    expect(attack.rollWith).not.toContain('targetAC');
    expect(attack.damageWith).toContain('"multiplier":0.5 when the save succeeded');
    expect(plan.steps.join(' ')).toMatch(
      /Mucus Cloud \(Cloud\) on Hero \(DEX save DC 14, half damage on a success\)/
    );
  });

  it('defaults to the attack, then the save, and refuses an unknown activity', () => {
    arena({ items: [item('Cloud only', [saveActivity('Cloud')], { value: 30 })] });
    expect(planNpcTurn({ itemName: 'Cloud only', target: 'Hero' }).attack?.kind).toBe('save');
    arena({
      items: [item('Spit', [saveActivity('Spit'), attackActivity('Spit attack')], { value: 30 })],
    });
    expect(planNpcTurn({ itemName: 'Spit', target: 'Hero' }).attack?.activity).toBe('Spit attack');
    expect(() =>
      planNpcTurn({ attacks: [{ itemName: 'Spit', target: 'Hero', activity: 'Nope' }] })
    ).toThrow(/has no activity "Nope" \(it has: Spit, Spit attack\)/);
  });
});

describe('damage hints', () => {
  it('asks for one results entry per damageByType entry', () => {
    arena({ items: [tentacle, cloud] });
    const plan = planNpcTurn({ attacks: [{ itemName: 'Tentacle', target: 'Hero' }] });
    expect(plan.attack?.damageWith).toMatch(/one entry per damageByType entry/);
    const save = planNpcTurn({ itemName: 'Mucus Cloud', activity: 'Cloud', target: 'Hero' });
    expect(save.attack?.damageWith).toMatch(/one entry per damageByType entry/);
  });
});

describe('legendary actions', () => {
  it("refuses a legendary action on the NPC's own turn", () => {
    arena({ items: [lash], legact: { max: 3, spent: 0, value: 3 } });
    expect(planNpcTurn({}).context.ownTurn).toBe(true);
    expect(() => planNpcTurn({ itemName: 'Lash', target: 'Hero' })).toThrow(/own turn/);
  });

  it("plans one on another creature's turn and notes the pool", () => {
    arena({ boss: true, items: [lash], legact: { max: 3, spent: 1, value: 2 } });
    const plan = planNpcTurn({ token: 'Boss', itemName: 'Lash', target: 'Hero' });
    expect(plan.context).toMatchObject({
      ownTurn: false,
      legendary: { max: 3, spent: 1, value: 2 },
    });
    expect(plan.attack).toMatchObject({ kind: 'other', legendaryCost: 1 });
    expect(plan.steps.join(' ')).toMatch(/legendary action, costs 1/);
    expect(plan.context.notes.join(' ')).toMatch(/Legendary actions used: 1 of 2 left/);
  });

  it('refuses when the cost is more than the actions left', () => {
    arena({ boss: true, items: [lash], legact: { max: 3, spent: 3, value: 0 } });
    expect(() => planNpcTurn({ token: 'Boss', itemName: 'Lash', target: 'Hero' })).toThrow(
      /0 legendary actions left, and this turn needs 1/
    );
    const heavy = item('Heavy Lash', [{ type: 'utility', name: 'Heavy Lash', ...legendary(2) }]);
    arena({ boss: true, items: [heavy], legact: { max: 3, spent: 2, value: 1 } });
    expect(() => planNpcTurn({ token: 'Boss', itemName: 'Heavy Lash', target: 'Hero' })).toThrow(
      /1 legendary action left, and this turn needs 2/
    );
  });

  it('refuses several legendary actions in one plan', () => {
    arena({ boss: true, items: [lash], legact: { max: 3, spent: 0, value: 3 } });
    expect(() =>
      planNpcTurn({
        token: 'Boss',
        attacks: [
          { itemName: 'Lash', target: 'Hero' },
          { itemName: 'Lash', target: 'Goblin' },
        ],
      })
    ).toThrow(/only one legendary action can be used at a time.*other targets/);
  });

  it('notes a normal attack planned off the NPC turn', () => {
    arena({ boss: true, items: [lash, tentacle], legact: { max: 3, spent: 0, value: 3 } });
    const plan = planNpcTurn({ token: 'Boss', itemName: 'Tentacle', target: 'Hero' });
    expect(plan.context.notes.join(' ')).toMatch(
      /only a reaction or a legendary action can be used now/
    );
    const lashPlan = planNpcTurn({ token: 'Boss', itemName: 'Lash', target: 'Hero' });
    expect(lashPlan.context.notes.join(' ')).not.toMatch(/only a reaction or a legendary action/);
  });

  it('does not give the off-turn note to a creature with no legendary actions', () => {
    arena({ boss: true, items: [tentacle] });
    const plan = planNpcTurn({ token: 'Boss', itemName: 'Tentacle', target: 'Hero' });
    expect(plan.context.notes.join(' ')).not.toMatch(/only a reaction or a legendary action/);
  });

  it('notes that a move taken as a legendary action is often limited', () => {
    arena({ boss: true, items: [lash], legact: { max: 3, spent: 0, value: 3 }, walk: 30 });
    const plan = planNpcTurn({
      token: 'Boss',
      moveTo: { gridX: 6, gridY: 4 },
      itemName: 'Lash',
      target: 'Goblin',
    });
    expect(plan.context.notes.join(' ')).toMatch(/some creatures: half the speed, 15 ft/);
  });

  it('does not count the actions twice once the roll has spent them (results given)', () => {
    arena({ boss: true, items: [lash], legact: { max: 3, spent: 3, value: 0 } });
    const plan = planNpcTurn({
      token: 'Boss',
      attacks: [{ itemName: 'Lash', target: 'Hero' }],
      results: [{ target: 'Hero', amount: 1 }],
    });
    expect(plan.context.notes.join(' ')).toMatch(/already spent by the roll \(0 left\)/);
  });

  it('still refuses on its own turn when results are given', () => {
    arena({ items: [lash], legact: { max: 3, spent: 1, value: 2 } });
    expect(() =>
      planNpcTurn({
        itemName: 'Lash',
        target: 'Hero',
        results: [{ target: 'Hero', amount: 1 }],
      })
    ).toThrow(/own turn/);
  });
});

describe('damage from the rolls, planned with the move', () => {
  const bite = item('Bite', [attackActivity()]);
  const toSix = { moveTo: { gridX: 6, gridY: 2 } };

  it('puts the move and every hit point change in one plan', async () => {
    arena({ items: [bite] });
    const plan = await planNpcTurnWithDamage({
      ...toSix,
      attacks: [{ itemName: 'Bite', target: 'Hero' }],
      results: [
        { target: 'Hero', amount: 8, damageType: 'piercing' },
        { target: 't4', amount: 9, damageType: 'poison', multiplier: 0.5 },
      ],
    });
    expect(plan.ops).toEqual([
      expect.objectContaining({ kind: 'update', uuid: 'Scene.s1.Token.t1' }),
      { kind: 'update', uuid: 'Actor.Hero', changes: { 'system.attributes.hp.value': 22 } },
      { kind: 'update', uuid: 'Actor.Goblin', changes: { 'system.attributes.hp.value': 8 } },
    ]);
    expect(plan.summary).toBe('NPC turn: Wolf to (6,2), then Bite on Hero, damage to Hero, Goblin');
    expect(plan.steps.slice(-2)).toEqual([
      'Hero: 8 piercing damage, 8 taken, HP 30 to 22',
      'Goblin: 4 poison (x0.5 of 9) damage, 4 taken, HP 12 to 8',
    ]);
  });

  it('plans damage alone when no move is asked for, and merges several hits on one target', async () => {
    arena({ items: [bite] });
    const plan = await planNpcTurnWithDamage({
      results: [
        { target: 'Hero', amount: 5, damageType: 'slashing' },
        { target: 'Hero', amount: 7, damageType: 'slashing' },
      ],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.Hero', changes: { 'system.attributes.hp.value': 18 } },
    ]);
    expect(plan.summary).toBe('NPC turn: Wolf, damage to Hero');
  });

  it('merges the hits on two tokens of one linked actor into one op', async () => {
    const { scene, heroToken } = arena({ items: [bite] });
    scene.tokens.contents.push(
      token('t9', 'Hero twin', 8, 2, { disposition: 1, actor: heroToken.actor })
    );
    g.game.combats.contents[0].combatants.contents.push({
      id: 'c9',
      tokenId: 't9',
      defeated: false,
    });
    const plan = await planNpcTurnWithDamage({
      results: [
        { target: 't2', amount: 5, damageType: 'slashing' },
        { target: 't9', amount: 4, damageType: 'slashing' },
      ],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.Hero', changes: { 'system.attributes.hp.value': 21 } },
    ]);
    expect(plan.steps.at(-1)).toMatch(/5 slashing.* \+ 4 slashing.*\(Hero twin\)/);
  });

  it('lets dnd5e apply resistance and keeps a failed-save zero out of the plan', async () => {
    const { heroToken } = arena({ items: [bite] });
    heroToken.actor = hero('Hero', 30, { resists: 'fire' });
    const plan = await planNpcTurnWithDamage({
      results: [
        { target: 'Hero', amount: 10, damageType: 'fire' },
        { target: 'Goblin', amount: 9, multiplier: 0 },
      ],
    });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.Hero', changes: { 'system.attributes.hp.value': 25 } },
    ]);
    expect(plan.steps.at(-1)).toMatch(/Goblin: 0 \(x0 of 9\) damage, no change/);
  });

  it('refuses nothing to change, a bad target, amount or multiplier', async () => {
    arena({ items: [bite] });
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 'Goblin', amount: 3, multiplier: 0 }] })
    ).rejects.toThrow(/Nothing to change/);
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 'Ghost', amount: 3 }] })
    ).rejects.toThrow(/"Ghost" is not a target in this fight \(targets: Hero, Goblin\)/);
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 'Hero', amount: -1 }] })
    ).rejects.toThrow(/amount of 0 or more/);
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 'Hero', amount: 3, multiplier: 2 }] })
    ).rejects.toThrow(/multiplier must be between 0 and 1/);
    await expect(planNpcTurnWithDamage({ results: [] })).rejects.toThrow(/at least one entry/);
  });

  it('refuses a name shared by several targets and an unknown damage type', async () => {
    const { scene } = arena({ items: [bite] });
    scene.tokens.contents.push(
      token('t9', 'Hero', 8, 2, { disposition: 1, actor: hero('Hero2', 30) })
    );
    g.game.combats.contents[0].combatants.contents.push({
      id: 'c9',
      tokenId: 't9',
      defeated: false,
    });
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 'Hero', amount: 3 }] })
    ).rejects.toThrow(/Several targets are named "Hero": use the token id \(t2, t9\)/);
    const plan = await planNpcTurnWithDamage({ results: [{ target: 't9', amount: 3 }] });
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Actor.Hero2', changes: { 'system.attributes.hp.value': 27 } },
    ]);
    g.CONFIG = { DND5E: { damageTypes: { fire: {}, poison: {} } } };
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 't9', amount: 3, damageType: 'Frost' }] })
    ).rejects.toThrow(/"frost" is not a dnd5e damage type \(fire, poison\)/);
    await expect(
      planNpcTurnWithDamage({ results: [{ target: 't9', amount: 3, damageType: 'FIRE' }] })
    ).resolves.toBeDefined();
  });

  it('is the plain plan when there are no results', async () => {
    arena({ items: [bite] });
    const plan = await planNpcTurnWithDamage(toSix);
    expect(plan.ops).toHaveLength(1);
    expect(plan.summary).toBe('NPC turn: Wolf to (6,2)');
  });
});

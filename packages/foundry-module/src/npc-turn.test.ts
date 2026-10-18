/**
 * NPC turn assistant (I-125): `planNpcTurn` reads the fight and plans one NPC move. Driven
 * through the Foundry-mock harness; also pins the names mirrored from the shared contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NPC_TURN_FEATURE_ID as SHARED_FEATURE,
  NPC_TURN_QUERY as SHARED_QUERY,
} from '../../../shared/src/npc-turn.js';
import { NPC_TURN_FEATURE_ID, NPC_TURN_QUERY, planNpcTurn } from './npc-turn.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { NON_WRITE_METHODS } from './write-gate.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});
afterEach(() => restore());

function item(
  name: string,
  opts: { melee?: boolean; reach?: number; value?: number; long?: number }
): any {
  return {
    name,
    system: {
      range: { reach: opts.reach ?? null, value: opts.value ?? null, long: opts.long ?? null },
      activities: {
        contents: [
          {
            type: 'attack',
            attack: { type: { value: opts.melee === false ? 'ranged' : 'melee' } },
          },
        ],
      },
    },
  };
}

function token(
  id: string,
  name: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): any {
  return {
    id,
    uuid: `Scene.s1.Token.${id}`,
    name,
    x,
    y,
    width: 1,
    height: 1,
    disposition: -1,
    actor: null as any,
    ...extra,
  };
}

function npcActor(items: any[], walk = 30): any {
  return {
    id: 'a-wolf',
    name: 'Wolf',
    type: 'npc',
    items: { contents: items },
    statuses: new Set<string>(),
    system: { attributes: { movement: { walk }, ac: { value: 13 }, hp: { value: 11, max: 11 } } },
  };
}

function heroActor(): any {
  return {
    id: 'a-hero',
    name: 'Hero',
    type: 'character',
    items: { contents: [] },
    statuses: new Set(['prone']),
    system: { attributes: { ac: { value: 16 }, hp: { value: 20, max: 24 } } },
  };
}

/** A fight: Wolf at (2,2) with its turn, Hero at (7,2), Cleric at (2,3) (dead). */
function setFight(opts: { started?: boolean; turnToHero?: boolean } = {}): void {
  const wolf = token('t1', 'Wolf', 200, 200, {
    actor: npcActor([
      item('Bite', { reach: 5 }),
      item('Spit', { melee: false, value: 30, long: 60 }),
    ]),
  });
  const hero = token('t2', 'Hero', 700, 200, { disposition: 1, actor: heroActor() });
  const dead = token('t3', 'Cleric', 200, 300, { disposition: 1, actor: heroActor() });
  const scene = {
    id: 's1',
    name: 'Arena',
    grid: { size: 100, distance: 5, units: 'ft' },
    tokens: { contents: [wolf, hero, dead] },
  };
  g.game.scenes = { current: scene, active: scene };
  const combatants = [
    { id: 'c1', tokenId: 't1', defeated: false },
    { id: 'c2', tokenId: 't2', defeated: false },
    { id: 'c3', tokenId: 't3', defeated: true },
  ];
  // game.combat is a getter on the mock; the planner falls back to the latest of game.combats.
  g.game.combats = {
    contents: [
      {
        started: opts.started ?? true,
        round: 2,
        turn: opts.turnToHero ? 1 : 0,
        combatants: { contents: combatants },
        turns: combatants,
        combatant: opts.turnToHero ? combatants[1] : combatants[0],
      },
    ],
  };
}

describe('planNpcTurn: names', () => {
  it('mirrors the shared names and is classified as a read', () => {
    expect(NPC_TURN_QUERY).toBe(SHARED_QUERY);
    expect(NPC_TURN_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(NON_WRITE_METHODS).toContain(NPC_TURN_QUERY);
  });
});

describe('planNpcTurn: context', () => {
  it('reads the current NPC, its actions and the live enemies by distance', () => {
    setFight();
    const plan = planNpcTurn({});
    expect(plan.ops).toBeUndefined();
    expect(plan.context.token).toMatchObject({ name: 'Wolf', gridX: 2, gridY: 2 });
    expect(plan.context.speed).toBe(30);
    expect(plan.context.actions).toEqual([
      { name: 'Bite', activityTypes: ['attack'], rangeFt: 5, longRangeFt: null, melee: true },
      { name: 'Spit', activityTypes: ['attack'], rangeFt: 30, longRangeFt: 60, melee: false },
    ]);
    // The defeated Cleric is left out; Hero is 5 squares away, edge to edge 4 gaps + 1.
    expect(plan.context.targets).toHaveLength(1);
    expect(plan.context.targets[0]).toMatchObject({
      name: 'Hero',
      distance: 25,
      ac: 16,
      hp: { value: 20, max: 24 },
      conditions: ['prone'],
    });
    expect(plan.context.notes.join(' ')).toMatch(/Walls/);
  });

  it('refuses without a running combat', () => {
    setFight({ started: false });
    expect(() => planNpcTurn({})).toThrow(/No running combat/);
  });

  it('refuses a player character and a wrong game system', () => {
    setFight({ turnToHero: true });
    expect(() => planNpcTurn({})).toThrow(/player character/);
    setFight();
    g.game.system = { id: 'pf2e' };
    expect(() => planNpcTurn({})).toThrow(/needs dnd5e/);
  });

  it('can name another token and notes that it is not its turn', () => {
    setFight({ turnToHero: true });
    const plan = planNpcTurn({ token: 'wolf' });
    expect(plan.context.notes.join(' ')).toMatch(/not Wolf's turn/);
  });
});

describe('planNpcTurn: move', () => {
  it('plans a move inside the speed as a token update', () => {
    setFight();
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 }, reason: 'close in' });
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 600 } }]);
    expect(plan.summary).toBe('NPC turn: Wolf to (6,2) (close in)');
    expect(plan.steps[0]).toMatch(/Wolf: \(2,2\) to \(6,2\), 20 ft/);
    expect(plan.context.targets[0]?.distanceAfterMove).toBe(5);
  });

  it('refuses a square beyond the speed, off the scene or taken', () => {
    setFight();
    expect(() => planNpcTurn({ moveTo: { gridX: 9, gridY: 2 } })).toThrow(
      /more than Wolf's speed of 30 ft/
    );
    expect(() => planNpcTurn({ moveTo: { gridX: -1, gridY: 2 } })).toThrow(/outside the scene/);
    expect(() => planNpcTurn({ moveTo: { gridX: 7, gridY: 2 } })).toThrow(/taken by Hero/);
    expect(() => planNpcTurn({ moveTo: { gridX: 2, gridY: 3 } })).toThrow(/taken by Cleric/);
    expect(() => planNpcTurn({ moveTo: { gridX: 2.5, gridY: 2 } })).toThrow(/whole numbers/);
  });

  it('plans nothing when the NPC stays put', () => {
    setFight();
    const plan = planNpcTurn({ moveTo: { gridX: 2, gridY: 2 } });
    expect(plan.ops).toBeUndefined();
    expect(plan.steps[0]).toMatch(/stays at \(2,2\)/);
  });
});

describe('planNpcTurn: attack', () => {
  it('checks reach after the move and spells out the attack step', () => {
    setFight();
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 }, itemName: 'bite', target: 'Hero' });
    expect(plan.attack).toMatchObject({
      itemName: 'Bite',
      target: 'Hero',
      targetAC: 16,
      inReach: true,
    });
    expect(plan.attack?.rollWith).toBe(
      'use-npc-activity {"actorName":"t1","itemName":"Bite","targetAC":16}'
    );
    expect(plan.summary).toBe('NPC turn: Wolf to (6,2), then Bite on Hero');
    expect(plan.steps[plan.steps.length - 1]).toMatch(/Then Bite on Hero \(AC 16\)/);
  });

  it('refuses a move that leaves the target out of reach', () => {
    setFight();
    expect(() =>
      planNpcTurn({ moveTo: { gridX: 4, gridY: 2 }, itemName: 'Bite', target: 'Hero' })
    ).toThrow(/Bite reaches 5 ft, but Hero would be 15 ft away/);
  });

  it('uses the long range of a ranged attack and flags reach without a move', () => {
    setFight();
    const far = planNpcTurn({ itemName: 'Spit', target: 't2' });
    expect(far.attack?.inReach).toBe(true);
    const near = planNpcTurn({ itemName: 'Bite', target: 'Hero' });
    expect(near.attack?.inReach).toBe(false);
    expect(near.steps[0]).toMatch(/out of reach/);
  });

  it('refuses an unknown item, an unknown target and half an attack', () => {
    setFight();
    expect(() => planNpcTurn({ itemName: 'Claw', target: 'Hero' })).toThrow(
      /no attack or action named "Claw" \(it has: Bite, Spit\)/
    );
    expect(() => planNpcTurn({ itemName: 'Bite', target: 'Ghost' })).toThrow(/not a target.*Hero/);
    expect(() => planNpcTurn({ itemName: 'Bite' })).toThrow(/both itemName and target/);
  });
});

describe('planNpcTurn: review fixes', () => {
  const wolfItems = (items: any[]): void => {
    setFight();
    const wolf = g.game.scenes.current.tokens.contents[0];
    wolf.actor.items = { contents: items };
  };

  it('does not tell Claude to double a critical hit (use-npc-activity already does)', () => {
    setFight();
    const plan = planNpcTurn({ itemName: 'Bite', target: 'Hero' });
    expect(plan.attack?.damageWith).not.toMatch(/"multiplier":2/);
    expect(plan.attack?.damageWith).toMatch(/do not add a multiplier/);
  });

  it('builds valid JSON for an item name with a quote', () => {
    wolfItems([item('Jaws "of" Doom', { reach: 5 })]);
    const plan = planNpcTurn({ itemName: 'Jaws "of" Doom', target: 'Hero' });
    const json = plan.attack!.rollWith.replace(/^use-npc-activity /, '');
    expect(JSON.parse(json).itemName).toBe('Jaws "of" Doom');
  });

  it('gives a thrown weapon its throwing range', () => {
    const javelin = item('Javelin', { value: 30, long: 120 });
    javelin.system.properties = new Set(['thr']);
    wolfItems([javelin]);
    const plan = planNpcTurn({ itemName: 'Javelin', target: 'Hero' });
    expect(plan.context.actions[0]).toMatchObject({ melee: true, rangeFt: 5, longRangeFt: 120 });
    expect(plan.attack?.inReach).toBe(true);
  });

  it('reads the range of a feat from its activity', () => {
    const spit = item('Acid Spit', { melee: false });
    spit.system.activities.contents[0].range = { value: 60, units: 'ft' };
    wolfItems([spit]);
    const plan = planNpcTurn({ itemName: 'Acid Spit', target: 'Hero' });
    expect(plan.context.actions[0]).toMatchObject({ melee: false, rangeFt: 60 });
  });

  it('reads speed from movement.speeds.walk and refuses a player-owned actor', () => {
    setFight();
    const wolf = g.game.scenes.current.tokens.contents[0];
    wolf.actor.system.attributes.movement = { speeds: { walk: 50 } };
    expect(planNpcTurn({}).context.speed).toBe(50);
    wolf.actor.hasPlayerOwner = true;
    expect(() => planNpcTurn({})).toThrow(/player character/);
  });
});

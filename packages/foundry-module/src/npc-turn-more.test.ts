/**
 * NPC turn assistant (I-125, second part): multiattack, wall and terrain aware moves, target
 * choice, and the PR #414 review lows (grid rules, scene edges, levels, the viewed scene's combat,
 * movement units and Dash). Fixtures use neutral names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  delete g.canvas;
  delete g.CONFIG;
});

function weapon(name: string, opts: { reach?: number; value?: number; long?: number } = {}): any {
  return {
    name,
    system: {
      range: { reach: opts.reach ?? null, value: opts.value ?? null, long: opts.long ?? null },
      activities: {
        contents: [
          { type: 'attack', attack: { type: { value: opts.value ? 'ranged' : 'melee' } } },
        ],
      },
    },
  };
}

function multiattackFeat(html: string): any {
  return {
    name: 'Multiattack',
    system: { description: { value: html }, activities: { contents: [] } },
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
    x: x * 100,
    y: y * 100,
    width: 1,
    height: 1,
    disposition: -1,
    actor: null as any,
    ...extra,
  };
}

function heroActor(extra: Record<string, unknown> = {}, hp = 20, statuses: string[] = []): any {
  return {
    id: 'a-hero',
    name: 'Hero',
    type: 'character',
    items: { contents: [] },
    statuses: new Set<string>(statuses),
    system: { attributes: { ac: { value: 16 }, hp: { value: hp, max: 24 } } },
    ...extra,
  };
}

interface Arena {
  items?: any[];
  walk?: number;
  movement?: Record<string, unknown>;
  walls?: any[];
  regions?: any[];
  grid?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
  tokens?: any[];
  heroAt?: [number, number];
  combatScene?: unknown;
  wolfExtra?: Record<string, unknown>;
  heroActorExtra?: Record<string, unknown>;
}

/** Wolf (id t1) at (2,2) with the turn; Hero (t2) at (7,2) by default. */
function arena(opts: Arena = {}): any {
  const movement = opts.movement ?? { walk: opts.walk ?? 30 };
  const wolf = token('t1', 'Wolf', 2, 2, {
    ...opts.wolfExtra,
    actor: {
      id: 'a-wolf',
      name: 'Wolf',
      type: 'npc',
      items: {
        contents: opts.items ?? [weapon('Bite', { reach: 5 }), weapon('Claw', { reach: 5 })],
      },
      statuses: new Set<string>(),
      system: { attributes: { movement, ac: { value: 13 }, hp: { value: 11, max: 11 } } },
    },
  });
  const [hx, hy] = opts.heroAt ?? [7, 2];
  const hero = token('t2', 'Hero', hx, hy, {
    disposition: 1,
    actor: heroActor(opts.heroActorExtra),
  });
  const scene = {
    id: 's1',
    name: 'Arena',
    grid: { size: 100, distance: 5, units: 'ft', ...opts.grid },
    dimensions: opts.dimensions,
    tokens: { contents: [wolf, hero, ...(opts.tokens ?? [])] },
    walls: { contents: opts.walls ?? [] },
    regions: { contents: opts.regions ?? [] },
  };
  g.game.scenes = { current: scene, active: scene };
  const combatants = [wolf, hero, ...(opts.tokens ?? [])].map((t, i) => ({
    id: `c${i}`,
    tokenId: t.id,
    defeated: false,
  }));
  const combat = {
    started: true,
    round: 1,
    turn: 0,
    combatants: { contents: combatants },
    turns: combatants,
    combatant: combatants[0],
    scene: opts.combatScene === undefined ? { id: 's1' } : opts.combatScene,
  };
  g.game.combats = { contents: [combat] };
  return { scene, wolf, hero, combat };
}

const wall = (c: number[], extra: Record<string, unknown> = {}): any => ({
  c,
  move: 20,
  door: 0,
  ds: 0,
  ...extra,
});

describe('multiattack', () => {
  const feat = multiattackFeat(
    '<p>The wolf makes <strong>two</strong> attacks:&nbsp;one with its bite and one with its claw.</p>'
  );

  it('reads the Multiattack text and checks every attack on its own', () => {
    arena({ items: [feat, weapon('Bite', { reach: 5 }), weapon('Claw', { reach: 5 })] });
    const plan = planNpcTurn({
      moveTo: { gridX: 6, gridY: 2 },
      attacks: [
        { itemName: 'Bite', target: 'Hero' },
        { itemName: 'claw', target: 't2' },
      ],
    });
    expect(plan.context.multiattack).toBe(
      'The wolf makes two attacks: one with its bite and one with its claw.'
    );
    expect(plan.attacks.map(a => a.itemName)).toEqual(['Bite', 'Claw']);
    expect(plan.attack).toBe(plan.attacks[0]);
    expect(plan.steps.filter(s => /^Attack \d of 2/.test(s))).toHaveLength(2);
    expect(plan.summary).toBe('NPC turn: Wolf to (6,2), then Bite on Hero, Claw on Hero');
    expect(plan.attacks[1]?.rollWith).toBe(
      'use-npc-activity {"actorName":"t1","itemName":"Claw","targetAC":16}'
    );
  });

  it('keeps only the labels of Foundry enrichers in the Multiattack text', () => {
    arena({
      items: [
        multiattackFeat(
          '<p>The [[lookup @name lowercase]]{monster} makes two [[/item .abc123]]{Claw} attacks and uses @UUID[Item.x.y]{Bite}.</p>'
        ),
        weapon('Claw', { reach: 5 }),
      ],
    });
    expect(planNpcTurn({}).context.multiattack).toBe(
      'The monster makes two Claw attacks and uses Bite.'
    );
  });

  it('also cleans &Reference, unlabelled @UUID and HTML entities', () => {
    arena({
      items: [
        multiattackFeat(
          '<p>Two bites; the target is &Reference[prone] and @UUID[Item.x.y] hurts &amp; it&#39;s &quot;mean&quot;.</p>'
        ),
        weapon('Claw', { reach: 5 }),
      ],
    });
    expect(planNpcTurn({}).context.multiattack).toBe(
      `Two bites; the target is prone and Item.x.y hurts & it's "mean".`
    );
  });

  it('adds itemName and target to the list, and flags several attacks without a Multiattack feature', () => {
    arena();
    const plan = planNpcTurn({
      itemName: 'Bite',
      target: 'Hero',
      attacks: [{ itemName: 'Claw', target: 'Hero' }],
    });
    expect(plan.attacks).toHaveLength(2);
    expect(plan.context.notes.join(' ')).toMatch(/no Multiattack feature/);
  });

  it('refuses a bad entry and an attack that cannot reach after the move', () => {
    arena();
    expect(() => planNpcTurn({ attacks: [{ itemName: 'Bite' }] })).toThrow(/itemName and a target/);
    expect(() => planNpcTurn({ attacks: [{ itemName: 'Horn', target: 'Hero' }] })).toThrow(
      /no attack or action named "Horn"/
    );
    expect(() =>
      planNpcTurn({
        moveTo: { gridX: 5, gridY: 2 },
        attacks: [
          { itemName: 'Bite', target: 'Hero' },
          { itemName: 'Claw', target: 'Hero' },
        ],
      })
    ).toThrow(/Bite reaches 5 ft, but Hero would be 10 ft away/);
  });

  it('stops a melee attack through a wall, and flags it without a move', () => {
    // A wall between (6,2) and (7,2).
    arena({ walls: [wall([700, 150, 700, 250])] });
    expect(() =>
      planNpcTurn({
        moveTo: { gridX: 6, gridY: 2 },
        attacks: [{ itemName: 'Bite', target: 'Hero' }],
      })
    ).toThrow(/a wall or closed door is between \(6,2\) and Hero/);
    arena({ walls: [wall([300, 150, 300, 250])], heroAt: [3, 2] });
    const plan = planNpcTurn({ attacks: [{ itemName: 'Bite', target: 'Hero' }] });
    expect(plan.attacks[0]).toMatchObject({ inReach: true, blockedByWall: true });
    expect(plan.steps[0]).toMatch(/a wall is in the way/);
  });
});

describe('walls and doors', () => {
  const tall = (extra: Record<string, unknown> = {}): any => wall([500, 0, 500, 400], extra);

  it('plans the way round a wall and says what it costs', () => {
    arena({ walls: [tall()] });
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });
    expect(plan.moveCost).toBe(25);
    expect(plan.path?.[0]).toEqual({ gridX: 2, gridY: 2 });
    expect(plan.path?.at(-1)).toEqual({ gridX: 6, gridY: 2 });
    expect(plan.path?.some(p => p.gridY >= 3)).toBe(true);
    expect(plan.steps[0]).toMatch(/Wolf: \(2,2\) to \(6,2\), 25 ft, going round an obstacle/);
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 600 } }]);
    expect(plan.context.notes.join(' ')).toMatch(/read from the scene's wall data/);
  });

  it('refuses a square the wall puts out of reach, and says why', () => {
    arena({ walls: [tall()], walk: 20 });
    expect(() => planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } })).toThrow(
      /\(6,2\) cannot be reached within 20 ft: walls/
    );
  });

  it('lets a closed door block and an open door, or a wall that stops no movement, pass', () => {
    arena({ walls: [tall({ door: 1, ds: 0 })] });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(25);
    arena({ walls: [tall({ door: 1, ds: 2 })] });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(25);
    arena({ walls: [tall({ door: 1, ds: 1 })] });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(20);
    arena({ walls: [tall({ move: 0 })] });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(20);
  });

  it("uses Foundry's own collision test when the map is drawn", () => {
    arena({ walls: [tall()] });
    const testCollision = vi.fn(
      (a: { x: number; y: number }, b: { x: number; y: number }) =>
        a.x < 500 !== b.x < 500 && Math.min(a.y, b.y) < 400
    );
    g.canvas = { ready: true, scene: { id: 's1' } };
    g.CONFIG = { Canvas: { polygonBackends: { move: { testCollision } } } };
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });
    expect(testCollision).toHaveBeenCalled();
    expect(plan.moveCost).toBe(25);
    expect(plan.context.notes.join(' ')).toMatch(/Foundry's own check/);
  });

  it('does not let a hostile creature be walked through, but lets an ally be', () => {
    // A corridor: walls above and below row 2 from x=300 to 600.
    const corridor = [wall([300, 200, 700, 200]), wall([300, 300, 700, 300])];
    const ally = token('t5', 'Pack mate', 4, 2, { actor: heroActor() });
    arena({ walls: corridor, tokens: [ally] });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(20);
    const enemy = token('t6', 'Intruder', 4, 2, { disposition: 1, actor: heroActor() });
    arena({ walls: corridor, tokens: [enemy] });
    expect(() => planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } })).toThrow(/cannot be reached/);
  });
});

describe('difficult terrain', () => {
  const mud = (factor: number | null, extra: Record<string, unknown> = {}): any => ({
    behaviors: {
      contents: [
        {
          type: 'modifyMovementCost',
          disabled: false,
          system: { difficulties: { walk: factor } },
          ...extra,
        },
      ],
    },
    testPoint: ({ x }: { x: number }) => x >= 300 && x <= 500,
  });

  it('doubles the cost of entering a square in a movement-cost region', () => {
    arena({ regions: [mud(2)] });
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });
    expect(plan.moveCost).toBe(30);
    expect(plan.steps[0]).toMatch(/through difficult terrain/);
    expect(plan.context.notes.join(' ')).toMatch(/Difficult terrain/);
    arena({ regions: [mud(2)], walk: 25 });
    expect(() => planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } })).toThrow(/cannot be reached/);
  });

  it('leaves out a disabled behavior, a factor of 1 and null', () => {
    for (const region of [mud(2, { disabled: true }), mud(1), mud(null)]) {
      arena({ regions: [region] });
      expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(20);
    }
  });

  it('stacks overlapping regions', () => {
    arena({ regions: [mud(2), mud(2)], walk: 60 });
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).moveCost).toBe(50);
  });

  // dnd5e's own Difficult Terrain behavior (also what Spike Growth and Web create): +1 once.
  const thorns = (
    system: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
  ): any => ({
    behaviors: {
      contents: [{ type: 'dnd5e.difficultTerrain', disabled: false, system, ...extra }],
    },
    testPoint: ({ x }: { x: number }) => x >= 300 && x <= 500,
  });
  const toSix = (): any => planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });

  it("counts dnd5e's Difficult Terrain behavior as double cost, once however many overlap", () => {
    arena({ regions: [thorns()] });
    const plan = toSix();
    expect(plan.moveCost).toBe(30);
    expect(plan.steps[0]).toMatch(/through difficult terrain/);
    expect(plan.context.notes.join(' ')).toMatch(/Difficult terrain/);
    arena({ regions: [thorns(), thorns()] });
    expect(toSix().moveCost).toBe(30);
    arena({ regions: [thorns({}, { disabled: true })] });
    expect(toSix().moveCost).toBe(20);
  });

  it('adds one to a core movement-cost region (2x and Difficult Terrain make 3x)', () => {
    arena({ regions: [mud(2), thorns()], walk: 60 });
    expect(toSix().moveCost).toBe(40);
  });

  it('skips Difficult Terrain the region or the creature ignores', () => {
    arena({ regions: [thorns({ ignoredDispositions: new Set([-1]) })] });
    expect(toSix().moveCost).toBe(20);
    arena({ regions: [thorns({ ignoredDispositions: new Set([1]) })] });
    expect(toSix().moveCost).toBe(30);
    const ignores = (...kinds: string[]): void => {
      const { wolf } = arena({ regions: [thorns({ magical: false, types: new Set(['plants']) })] });
      wolf.actor.system.attributes.movement.ignoredDifficultTerrain = new Set(kinds);
    };
    ignores('all');
    expect(toSix().moveCost).toBe(20);
    ignores('nonmagical');
    expect(toSix().moveCost).toBe(20);
    ignores('magical');
    expect(toSix().moveCost).toBe(30);
    ignores('plants');
    expect(toSix().moveCost).toBe(20);
  });

  it('ignores Difficult Terrain when the dnd5e movement automation is off, but not core regions', () => {
    world.settings.set('dnd5e.movementAutomation', 'none');
    arena({ regions: [thorns()] });
    expect(toSix().moveCost).toBe(20);
    arena({ regions: [thorns(), mud(2)] });
    expect(toSix().moveCost).toBe(30);
  });

  it("leaves out a region that is not on the NPC's level", () => {
    const onLevel2 = { ...mud(2), includedInLevel: (id: string): boolean => id === 'l2' };
    arena({ regions: [onLevel2], wolfExtra: { level: 'l1' } });
    expect(toSix().moveCost).toBe(20);
    arena({ regions: [onLevel2], wolfExtra: { level: 'l2' } });
    expect(toSix().moveCost).toBe(30);
  });
});

describe('target choice', () => {
  it('scores concentration, a low hit point total and being out of reach', () => {
    const mage = token('t3', 'Mage', 5, 5, {
      disposition: 1,
      actor: heroActor({ statuses: new Set(['concentrating']) }, 9),
    });
    const archer = token('t4', 'Archer', 20, 2, { disposition: 1, actor: heroActor({}, 24) });
    arena({ tokens: [mage, archer] });
    const plan = planNpcTurn({});
    const by = (name: string): any => plan.context.targets.find(t => t.name === name);
    expect(by('Mage')).toMatchObject({ concentrating: true, prone: false, down: false });
    expect(by('Mage').reasons.join(' ')).toMatch(/concentrating/);
    expect(by('Mage').reasons.join(' ')).toMatch(/lowest hit points \(9\)/);
    expect(by('Archer').engage).toBeNull();
    expect(by('Archer').reasons).toContain('cannot be reached this turn');
    expect(plan.context.suggested).toMatchObject({ name: 'Mage' });
    expect(plan.context.engageWith).toBe('Bite');
  });

  it('gives the square to attack from, and counts prone by melee or ranged', () => {
    arena({
      heroActorExtra: { statuses: new Set(['prone']) },
      items: [weapon('Bite', { reach: 5 }), weapon('Spit', { value: 30, long: 60 })],
    });
    const hero = planNpcTurn({}).context.targets[0];
    expect(hero.engage).toMatchObject({ gridX: 6, cost: 20 });
    expect(hero.reasons).toContain('prone (melee attacks have advantage)');
    const ranged = planNpcTurn({ itemName: 'Spit', target: 'Hero' }).context.targets[0];
    expect(ranged.engage).toMatchObject({ cost: 0 });
    expect(ranged.reasons).toContain('prone (ranged attacks have disadvantage)');
  });

  it('marks a target at 0 hit points and does not favour it', () => {
    const downed = token('t3', 'Scout', 3, 2, { disposition: 1, actor: heroActor({}, 0) });
    arena({ tokens: [downed] });
    const plan = planNpcTurn({});
    expect(plan.context.targets.find(t => t.name === 'Scout')?.down).toBe(true);
    expect(plan.context.suggested?.name).toBe('Hero');
  });

  it('does not stand the NPC where a wall would come between it and a melee target', () => {
    arena({ walls: [wall([700, 150, 700, 250])] });
    const hero = planNpcTurn({}).context.targets[0];
    // (6,2) is walled off from (7,2); the next best square is diagonal to it.
    expect(hero.engage).not.toBeNull();
    expect(`${hero.engage?.gridX},${hero.engage?.gridY}`).not.toBe('6,2');
  });
});

describe('review lows from PR #414', () => {
  it('L1: follows the world diagonal setting for speed and reach', () => {
    arena({ grid: { diagonals: 4 }, heroAt: [4, 4] });
    const near = planNpcTurn({});
    // 1 + 2 squares for two diagonals under the alternating rule: 15 ft, not 10.
    expect(near.context.targets[0]?.distance).toBe(15);
    expect(near.context.notes.join(' ')).toMatch(/alternate 1 and 2/);
    expect(() => planNpcTurn({ moveTo: { gridX: 8, gridY: 8 } })).toThrow(
      /45 ft from \(2,2\), more than Wolf's speed of 30 ft/
    );
    // Two diagonals and a straight step: 1 + 2 + 1 squares.
    expect(planNpcTurn({ moveTo: { gridX: 4, gridY: 5 } }).moveCost).toBe(20);
  });

  it('L1: reads the diagonal rule from the setting when the grid does not carry it', () => {
    arena({ heroAt: [4, 4] });
    world.settings.set('core.gridDiagonals', 3);
    expect(planNpcTurn({}).context.targets[0]?.distance).toBe(20);
  });

  it('L1: refuses hex and gridless scenes', () => {
    arena({ grid: { type: 2 } });
    expect(() => planNpcTurn({})).toThrow(/hex grid.*square grids only/);
    arena({ grid: { type: 0 } });
    expect(() => planNpcTurn({})).toThrow(/no grid.*square grids only/);
    arena({ grid: { type: 1 } });
    expect(() => planNpcTurn({})).not.toThrow();
  });

  it('L1: refuses squares past the scene edge and in the padding', () => {
    // A 10 by 8 scene with one square of padding on every side.
    arena({ dimensions: { sceneRect: { x: 100, y: 100, width: 1000, height: 800 } } });
    expect(() => planNpcTurn({ moveTo: { gridX: 11, gridY: 2 } })).toThrow(/outside the scene/);
    expect(() => planNpcTurn({ moveTo: { gridX: 4, gridY: 9 } })).toThrow(/outside the scene/);
    expect(() => planNpcTurn({ moveTo: { gridX: 0, gridY: 2 } })).toThrow(/outside the scene/);
    expect(planNpcTurn({ moveTo: { gridX: 1, gridY: 2 } }).ops).toBeDefined();
  });

  it('L1: keeps a big token inside the scene by its whole footprint', () => {
    arena({
      dimensions: { sceneRect: { x: 0, y: 0, width: 800, height: 800 } },
      wolfExtra: { width: 2, height: 2 },
      heroAt: [0, 7],
    });
    expect(() => planNpcTurn({ moveTo: { gridX: 7, gridY: 2 } })).toThrow(/outside the scene/);
    expect(planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } }).ops).toBeDefined();
  });

  it('L2: leaves out tokens on other levels, as blockers and as targets', () => {
    const upstairs = token('t3', 'Guard', 6, 2, {
      level: 'L2',
      disposition: 1,
      actor: heroActor(),
    });
    arena({ wolfExtra: { level: 'L1' }, tokens: [upstairs] });
    g.game.scenes.current.tokens.contents[1].level = 'L1';
    const plan = planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });
    expect(plan.ops).toBeDefined();
    expect(plan.context.targets.map(t => t.name)).toEqual(['Hero']);
    expect(plan.context.notes.join(' ')).toMatch(/1 token is on another level/);
    g.game.scenes.current.tokens.contents[1].level = 'L2';
    expect(planNpcTurn({}).context.targets).toEqual([]);
  });

  it('L3: converts a speed kept in metres and refuses units it cannot compare', () => {
    arena({ movement: { walk: 9, units: 'm' } });
    expect(planNpcTurn({}).context.speed).toBe(29.53);
    arena({ movement: { walk: 30, units: 'ft' } });
    expect(planNpcTurn({}).context.speed).toBe(30);
    arena({ movement: { walk: 30, units: 'spaces' } });
    expect(() => planNpcTurn({})).toThrow(/speed is in spaces but the scene measures in ft/);
    arena({ movement: { walk: 30, units: 'ft' }, grid: { units: 'm', distance: 1.5 } });
    expect(planNpcTurn({}).context.speed).toBe(9.14);
  });

  it('L3: plans a Dash with twice the speed', () => {
    arena();
    expect(() => planNpcTurn({ moveTo: { gridX: 9, gridY: 3 } })).toThrow(
      /more than Wolf's speed of 30 ft/
    );
    const plan = planNpcTurn({ moveTo: { gridX: 8, gridY: 3 }, dash: true });
    expect(plan.context.moveLimit).toBe(60);
    expect(plan.context.speed).toBe(30);
    expect(plan.moveCost).toBe(30);
    arena();
    expect(() => planNpcTurn({ moveTo: { gridX: 12, gridY: 5 }, dash: true })).not.toThrow(/speed/);
    expect(planNpcTurn({ moveTo: { gridX: 3, gridY: 9 }, dash: true }).steps[0]).toMatch(
      /\(Dash\)/
    );
    expect(planNpcTurn({ dash: true }).context.notes.join(' ')).toMatch(/Dash/);
  });

  it('L4: uses only a combat on the viewed scene', () => {
    const { combat } = arena({ combatScene: { id: 'elsewhere' } });
    expect(() => planNpcTurn({})).toThrow(/No running combat on Arena/);
    // A combat of the viewed scene is found even when another one was made later.
    const other = { ...combat, scene: { id: 'elsewhere' }, round: 9 };
    const mine = { ...combat, scene: { id: 's1' }, round: 3 };
    g.game.combats = { contents: [mine, other] };
    expect(planNpcTurn({}).context.round).toBe(3);
    // game.combat wins when it is on the viewed scene, and is ignored when it is not.
    world.currentCombat = { ...mine, round: 5 };
    expect(planNpcTurn({}).context.round).toBe(5);
    world.currentCombat = { ...mine, round: 7, scene: { id: 'elsewhere' } };
    expect(planNpcTurn({}).context.round).toBe(3);
  });

  it('R2-L1: a weapon keeps its normal range when the activity holds the long range', () => {
    const bow = weapon('Longbow', { value: 150, long: 600 });
    bow.system.activities.contents[0].range = { value: 600, units: 'ft' };
    arena({ items: [bow] });
    expect(planNpcTurn({}).context.actions[0]).toMatchObject({ rangeFt: 150, longRangeFt: 600 });
  });
});

describe('lows from the PR #447 Opus review', () => {
  // Row 2 is a corridor from x=300 to 700; a creature in (4,2) is in the way to (6,2).
  const corridor = (): any[] => [wall([300, 200, 700, 200]), wall([300, 300, 700, 300])];
  const toSix = (): any => planNpcTurn({ moveTo: { gridX: 6, gridY: 2 } });
  const creature = (
    extra: Record<string, unknown> = {},
    system: Record<string, unknown> = {}
  ): any =>
    token('t6', 'Stranger', 4, 2, {
      disposition: 1,
      actor: heroActor({ system: { ...system }, ...extra }),
    });

  afterEach(() => {
    delete g.dnd5e;
  });

  describe('L1: the NPC level in the wall check', () => {
    const tall = (levels: string[]): any => wall([500, 0, 500, 400], { levels: new Set(levels) });

    it('leaves out the walls of other levels when it reads the scene data', () => {
      arena({ walls: [tall(['L2'])], wolfExtra: { level: 'L1' } });
      expect(toSix().moveCost).toBe(20);
      arena({ walls: [tall(['L2'])], wolfExtra: { level: 'L2' } });
      expect(toSix().moveCost).toBe(25);
      // A wall with no level list is on every level.
      arena({ walls: [tall([])], wolfExtra: { level: 'L1' } });
      expect(toSix().moveCost).toBe(25);
    });

    it("hands Foundry's collision test the NPC's level and elevation", () => {
      const { scene } = arena({
        walls: [wall([500, 0, 500, 400])],
        wolfExtra: { level: 'L1', elevation: 10 },
      });
      scene.levels = { get: (id: string): unknown => ({ id, name: `Level ${id}` }) };
      const testCollision = vi.fn(() => false);
      g.canvas = { ready: true, scene: { id: 's1' } };
      g.CONFIG = { Canvas: { polygonBackends: { move: { testCollision } } } };
      toSix();
      expect(testCollision).toHaveBeenCalledWith(
        expect.objectContaining({ elevation: 10 }),
        expect.objectContaining({ elevation: 10 }),
        { type: 'move', mode: 'any', level: { id: 'L1', name: 'Level L1' } }
      );
    });
  });

  describe('L2: who blocks and who slows, as dnd5e decides it', () => {
    it('lets a hostile creature two sizes apart, a Tiny one and a non-creature be passed', () => {
      arena({ walls: corridor(), tokens: [creature({}, { traits: { size: 'lg' } })] });
      expect(() => toSix()).toThrow(/cannot be reached/);
      arena({ walls: corridor(), tokens: [creature({}, { traits: { size: 'huge' } })] });
      expect(toSix().moveCost).toBe(25);
      arena({ walls: corridor(), tokens: [creature({}, { traits: { size: 'tiny' } })] });
      expect(toSix().moveCost).toBe(20);
      arena({ walls: corridor(), tokens: [creature({}, { isCreature: false })] });
      expect(toSix().moveCost).toBe(20);
    });

    it('lets a dead or unconscious creature be passed, but its square still costs double', () => {
      arena({ walls: corridor(), tokens: [creature({ statuses: new Set(['unconscious']) })] });
      expect(toSix().moveCost).toBe(25);
      g.CONFIG = { DND5E: { neverBlockStatuses: new Set(['petrified']) } };
      arena({ walls: corridor(), tokens: [creature({ statuses: new Set(['petrified']) })] });
      expect(toSix().moveCost).toBe(25);
    });

    it('does not count a hidden token, and a Tiny one blocks a Small creature under the legacy rules', () => {
      const hidden = creature();
      hidden.hidden = true;
      arena({ walls: corridor(), tokens: [hidden] });
      expect(toSix().moveCost).toBe(20);
      const small = (): void => {
        const { wolf } = arena({
          walls: corridor(),
          tokens: [creature({}, { traits: { size: 'tiny' } })],
        });
        wolf.actor.system.traits = { size: 'sm' };
      };
      small();
      expect(toSix().moveCost).toBe(20);
      g.dnd5e = { settings: { rulesVersion: 'legacy' } };
      small();
      expect(() => toSix()).toThrow(/cannot be reached/);
    });

    it("makes an ally's square difficult terrain under the legacy rules only", () => {
      const ally = (): any =>
        token('t5', 'Pack mate', 4, 2, {
          actor: heroActor({ system: { traits: { size: 'med' } } }),
        });
      arena({ walls: corridor(), tokens: [ally()] });
      expect(toSix().moveCost).toBe(20);
      g.dnd5e = { settings: { rulesVersion: 'legacy' } };
      arena({ walls: corridor(), tokens: [ally()] });
      const plan = toSix();
      expect(plan.moveCost).toBe(25);
      expect(plan.steps[0]).toMatch(/through difficult terrain/);
    });

    it('follows the movement automation setting and what the creature ignores', () => {
      world.settings.set('dnd5e.movementAutomation', 'partial');
      arena({ walls: corridor(), tokens: [creature({}, { traits: { size: 'lg' } })] });
      // Partial automation: creatures no longer block, and they still slow.
      expect(toSix().moveCost).toBe(25);
      world.settings.set('dnd5e.movementAutomation', 'none');
      arena({ walls: corridor(), tokens: [creature({}, { traits: { size: 'lg' } })] });
      expect(toSix().moveCost).toBe(20);
      world.settings.set('dnd5e.movementAutomation', 'full');
      const { wolf } = arena({
        walls: corridor(),
        tokens: [creature({}, { traits: { size: 'huge' } })],
      });
      wolf.actor.system.attributes.movement.ignoredDifficultTerrain = new Set(['all']);
      expect(toSix().moveCost).toBe(20);
    });

    it('asks the drawn map when it shows the scene', () => {
      const blocking = vi.fn((space: { i: number; j: number; k: number }) => space.j === 4);
      const slowing = vi.fn(() => false);
      arena({ walls: corridor(), walk: 60, tokens: [creature({}, { traits: { size: 'tiny' } })] });
      g.canvas = {
        ready: true,
        scene: { id: 's1' },
        tokens: {
          get: (id: string): unknown => ({ id }),
          isOccupiedGridSpaceBlocking: blocking,
          isOccupiedGridSpaceDifficult: slowing,
        },
      };
      // Tiny would pass under the rules, but the map says (4,2) is blocked: the map wins.
      expect(() => toSix()).toThrow(/cannot be reached/);
      expect(blocking).toHaveBeenCalledWith({ i: 2, j: 4, k: 0 }, { id: 't1' });
      slowing.mockImplementation(() => true);
      blocking.mockImplementation(() => false);
      const plan = toSix();
      expect(plan.moveCost).toBe(40);
      expect(plan.context.notes.join(' ')).toMatch(/asked of the drawn map/);
    });
  });

  describe('L3: a Dash takes the action', () => {
    const bite = [{ itemName: 'Bite', target: 'Hero' }];

    it('refuses attacks after a Dash unless the reason names a bonus-action Dash', () => {
      arena();
      expect(() =>
        planNpcTurn({ moveTo: { gridX: 6, gridY: 2 }, dash: true, attacks: bite })
      ).toThrow(/A Dash takes Wolf's action/);
      expect(() =>
        planNpcTurn({
          moveTo: { gridX: 6, gridY: 2 },
          dash: true,
          itemName: 'Bite',
          target: 'Hero',
        })
      ).toThrow(/A Dash takes Wolf's action/);
      const plan = planNpcTurn({
        moveTo: { gridX: 6, gridY: 2 },
        dash: true,
        attacks: bite,
        reason: 'Nimble Escape: Dash as a bonus action',
      });
      expect(plan.steps.at(-1)).toMatch(/\(after a bonus-action Dash\)/);
      expect(plan.context.notes.join(' ')).toMatch(/Dash as a bonus action/);
    });

    it('still plans a plain Dash move, and says attacks are given up', () => {
      arena();
      const plan = planNpcTurn({ moveTo: { gridX: 8, gridY: 3 }, dash: true });
      expect(plan.moveCost).toBe(30);
      expect(plan.context.notes.join(' ')).toMatch(/gives up its attacks/);
    });
  });

  it('R2-L2: the move step says the token is placed, not walked', () => {
    arena();
    expect(toSix().steps[0]).toMatch(
      /Wolf: \(2,2\) to \(6,2\), 20 ft; the token is placed, not walked \(Foundry's ruler does not count it\)/
    );
  });

  it('R2-L3: &Reference options and named entities leave the Multiattack text', () => {
    arena({
      items: [
        multiattackFeat(
          '<p>Two bites; the target is &Reference[condition=prone] or &Reference[unconscious apply=false]&mdash;it&rsquo;s a &Reference[damage=fire type=x]&hellip;</p>'
        ),
        weapon('Claw', { reach: 5 }),
      ],
    });
    expect(planNpcTurn({}).context.multiattack).toBe(
      'Two bites; the target is prone or unconscious - it’s a fire…'
    );
  });
});

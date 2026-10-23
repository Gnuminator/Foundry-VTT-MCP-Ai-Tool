/**
 * Unit tests for the token plans (F5 L2): `planTokenChange` turns one `plan-token-change`
 * request into guarded ops. Nothing is written; these tests pin the ops, the preview lines and
 * the refusals, plus that the module's field list mirrors the shared `LIVE_TOKEN_FIELDS`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LIVE_TOKEN_FIELDS } from '../../../shared/src/live-play.js';
import { planLiveChange } from './live-plan.js';
import { planTokenChange, TOKEN_FIELDS } from './live-plan-token.js';
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
});

interface TokenOptions {
  id: string;
  name: string;
  x?: number;
  y?: number;
  hidden?: boolean;
  disposition?: number;
  /** The stored data (`_source`); on Foundry 14 the document values lag behind during a move. */
  source?: Record<string, unknown>;
}

function makeTok(opts: TokenOptions): any {
  const doc: any = {
    id: opts.id,
    uuid: `Scene.s1.Token.${opts.id}`,
    name: opts.name,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    hidden: opts.hidden ?? false,
    disposition: opts.disposition ?? -1,
    elevation: 0,
    rotation: 0,
    lockRotation: false,
    width: 1,
    height: 1,
    sight: { enabled: false, range: 0, visionMode: 'basic' },
    light: { dim: 0, bright: 0, color: null, animation: { type: null } },
  };
  if (opts.source) doc._source = opts.source;
  return doc;
}

/** Put a scene (100 px squares, 5 ft each) and optionally combats on the mock game. */
function setScene(tokens: any[], combats?: any[]): any {
  const scene = {
    id: 's1',
    name: 'Arena',
    grid: { size: 100, distance: 5, units: 'ft' },
    tokens: { contents: tokens },
  };
  g.game.scenes = { current: scene, active: scene };
  if (combats) g.game.combats = { contents: combats };
  return scene;
}

function standardScene(): void {
  setScene([
    makeTok({ id: 't1', name: 'Wolf 1', x: 200, y: 200 }),
    makeTok({ id: 't2', name: 'Wolf 2', x: 300, y: 200 }),
    makeTok({ id: 't3', name: 'Hero', x: 500, y: 500, disposition: 1 }),
  ]);
}

const move = (extra: Record<string, unknown>, tokens = ['Wolf 1']): any => ({
  scope: 'token',
  action: 'move',
  tokens,
  ...extra,
});

describe('TOKEN_FIELDS', () => {
  it('equals the shared LIVE_TOKEN_FIELDS (the browser cannot import it at runtime)', () => {
    expect(TOKEN_FIELDS).toEqual(LIVE_TOKEN_FIELDS);
  });
});

describe('planTokenChange: scene and tokens', () => {
  it('needs a current scene', () => {
    g.game.scenes = { current: null, active: null };
    expect(() => planTokenChange(move({ gridX: 1, gridY: 1 }))).toThrow(/No current scene/);
  });

  it('falls back to the active scene when there is no current one', () => {
    const scene = setScene([makeTok({ id: 't1', name: 'Wolf 1', x: 200, y: 200 })]);
    g.game.scenes = { current: null, active: scene };
    const plan = planTokenChange(move({ gridX: 5, gridY: 5 }));
    expect(plan.ops).toHaveLength(1);
  });

  it('finds a token by id and by name, ignoring case', () => {
    standardScene();
    const byId = planTokenChange(move({ gridX: 5, gridY: 5 }, ['t1']));
    const byName = planTokenChange(move({ gridX: 5, gridY: 5 }, ['wolf 1']));
    expect(byId.ops).toEqual(byName.ops);
    expect(byId.ops[0]).toMatchObject({ kind: 'update', uuid: 'Scene.s1.Token.t1' });
  });

  it('refuses an ambiguous name and lists the ids', () => {
    setScene([
      makeTok({ id: 't5', name: 'Wolf', x: 100, y: 100 }),
      makeTok({ id: 't6', name: 'Wolf', x: 200, y: 100 }),
    ]);
    expect(() => planTokenChange(move({ gridX: 5, gridY: 5 }, ['Wolf']))).toThrow(
      /Several tokens are named "Wolf".*t5, t6/
    );
    expect(planTokenChange(move({ gridX: 5, gridY: 5 }, ['t6'])).ops).toHaveLength(1);
  });

  it('refuses an unknown token and an empty list', () => {
    standardScene();
    expect(() => planTokenChange(move({ gridX: 1, gridY: 1 }, ['Ghost']))).toThrow(
      /No token named "Ghost" on the current scene \(Arena\)/
    );
    expect(() => planTokenChange(move({ gridX: 1, gridY: 1 }, []))).toThrow(
      /Name at least one token/
    );
  });

  it('names every missing token in one refusal', () => {
    standardScene();
    expect(() => planTokenChange(move({ dx: 1 }, ['Wolf 1', 'Ghost', 'Specter']))).toThrow(
      /"Ghost", "Specter"/
    );
  });

  it('refuses an unknown action', () => {
    standardScene();
    expect(() =>
      planTokenChange({ scope: 'token', action: 'teleport', tokens: ['Wolf 1'] } as any)
    ).toThrow(/Unknown action "teleport"/);
  });
});

/** What every move preview says about how the token gets there. */
const PLACED = ", placed, not walked (Foundry's ruler does not count it)";

describe('planTokenChange: move', () => {
  beforeEach(standardScene);

  it('moves one token to a grid square: one update op and a preview with squares and feet', () => {
    const plan = planTokenChange(move({ gridX: 5, gridY: 4 }));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 500, y: 400 } },
    ]);
    expect(plan.targets).toEqual([
      {
        target: 'Wolf 1',
        actorUuid: 'Scene.s1.Token.t1',
        line: `Wolf 1: (2,2) to (5,4), 15 ft${PLACED}`,
        move: { distance: 15, units: 'ft', speed: null, speedUnits: null },
      },
    ]);
    expect(plan.summary).toBe('Move Wolf 1 to (5,4)');
  });

  it("reports the creature's walking speed with the distance, else its best other speed", () => {
    const scene = g.game.scenes.current;
    const wolf = scene.tokens.contents.find((t: any) => t.name === 'Wolf 1');
    wolf.actor = { system: { attributes: { movement: { walk: 40, fly: 60, units: 'ft' } } } };
    expect(planTokenChange(move({ gridX: 5, gridY: 4 })).targets[0]?.move).toEqual({
      distance: 15,
      units: 'ft',
      speed: 40,
      speedUnits: 'ft',
    });
    wolf.actor = { system: { attributes: { movement: { walk: 0, fly: 60 } } } };
    expect(planTokenChange(move({ gridX: 5, gridY: 4 })).targets[0]?.move?.speed).toBe(60);
  });

  it('warns when a wall or closed door lies between the old and the new square (R2-L2)', () => {
    const scene = g.game.scenes.current;
    scene.walls = { contents: [{ c: [400, 0, 400, 900], move: 20, door: 0, ds: 0 }] };
    const across = planTokenChange(move({ gridX: 5, gridY: 2 }));
    expect(across.targets[0]?.line).toBe(
      `Wolf 1: (2,2) to (5,2), 15 ft${PLACED}; WARNING: a wall or closed door lies in between`
    );
    const same = planTokenChange(move({ gridX: 3, gridY: 2 }));
    expect(same.targets[0]?.line).not.toMatch(/WARNING/);
    // The wall still lets the move through: only the preview warns.
    expect(across.ops).toHaveLength(1);
  });

  it('writes only the coordinate that changes', () => {
    const plan = planTokenChange(move({ gridX: 5 }));
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 500 } }]);
  });

  it('moves one token to absolute pixels', () => {
    const plan = planTokenChange(move({ x: 700, y: 200 }));
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 700 } }]);
    expect(plan.targets[0]?.line).toBe(`Wolf 1: (2,2) to (7,2), 25 ft${PLACED}`);
  });

  it('shifts several tokens by dx/dy squares, one op each', () => {
    const plan = planTokenChange(move({ dx: 1, dy: -1 }, ['Wolf 1', 'Wolf 2']));
    expect(plan.ops).toEqual([
      { kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 300, y: 100 } },
      { kind: 'update', uuid: 'Scene.s1.Token.t2', changes: { x: 400, y: 100 } },
    ]);
    expect(plan.targets.map(t => t.line)).toEqual([
      `Wolf 1: (2,2) to (3,1), 5 ft${PLACED}`,
      `Wolf 2: (3,2) to (4,1), 5 ft${PLACED}`,
    ]);
    expect(plan.summary).toBe('Move Wolf 1, Wolf 2 by 1 right, -1 down (squares)');
  });

  it('skips a token already on the target square, so there is nothing to change', () => {
    expect(() => planTokenChange(move({ gridX: 2, gridY: 2 }))).toThrow(
      /Nothing to change: Wolf 1: already at \(2,2\)/
    );
    expect(() => planTokenChange(move({ x: 200, y: 200 }))).toThrow(/Nothing to change/);
  });

  it('treats a zero shift as no move for every token', () => {
    expect(() => planTokenChange(move({ dx: 0, dy: 0 }, ['Wolf 1', 'Wolf 2']))).toThrow(
      /Nothing to change: Wolf 1: already at \(2,2\); Wolf 2: already at \(3,2\)/
    );
  });

  it('refuses an absolute move for two tokens', () => {
    expect(() => planTokenChange(move({ gridX: 4, gridY: 4 }, ['Wolf 1', 'Wolf 2']))).toThrow(
      /Moving to a position takes one token/
    );
    expect(() => planTokenChange(move({ x: 400, y: 400 }, ['Wolf 1', 'Wolf 2']))).toThrow(
      /takes one token/
    );
  });

  it('refuses a negative position', () => {
    expect(() => planTokenChange(move({ dx: -3 }))).toThrow(/Wolf 1 would leave the scene/);
    expect(() => planTokenChange(move({ x: -100, y: 0 }))).toThrow(/would leave the scene/);
    expect(() => planTokenChange(move({ gridX: -1, gridY: 0 }))).toThrow(/would leave the scene/);
  });

  it('refuses mixing dx with gridX, or giving no position at all', () => {
    expect(() => planTokenChange(move({ dx: 1, gridX: 4 }))).toThrow(/one of: dx\/dy/);
    expect(() => planTokenChange(move({ gridX: 4, x: 400 }))).toThrow(/one of: dx\/dy/);
    expect(() => planTokenChange(move({}))).toThrow(/one of: dx\/dy/);
  });

  describe('plans from the stored position (_source), not the lagging document x/y', () => {
    beforeEach(() => {
      // Wolf 1 was moved to (500,400); on Foundry 14 doc.x/y still say (200,200) while it animates.
      setScene([
        makeTok({ id: 't1', name: 'Wolf 1', x: 200, y: 200, source: { x: 500, y: 400 } }),
        makeTok({ id: 't2', name: 'Wolf 2', x: 300, y: 200 }),
      ]);
    });

    it('shifts by dx/dy from _source', () => {
      const plan = planTokenChange(move({ dx: 1, dy: 1 }, ['Wolf 1', 'Wolf 2']));
      expect(plan.ops[0]).toMatchObject({ changes: { x: 600, y: 500 } });
      // Wolf 2 has no _source: it falls back to the document values.
      expect(plan.ops[1]).toMatchObject({ changes: { x: 400, y: 300 } });
      expect(plan.targets[0]?.line).toBe(`Wolf 1: (5,4) to (6,5), 5 ft${PLACED}`);
    });

    it('measures a grid move from _source', () => {
      const plan = planTokenChange(move({ gridX: 8, gridY: 4 }));
      expect(plan.ops).toEqual([
        { kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 800 } },
      ]);
      expect(plan.targets[0]?.line).toBe(`Wolf 1: (5,4) to (8,4), 15 ft${PLACED}`);
    });

    it('treats a move to the stored square as no move, whatever the document says', () => {
      expect(() => planTokenChange(move({ gridX: 5, gridY: 4 }))).toThrow(
        /Nothing to change: Wolf 1: already at \(5,4\)/
      );
    });

    it('keeps the unchanged axis of a one-axis move at the stored value', () => {
      const plan = planTokenChange(move({ gridX: 7 }));
      expect(plan.ops).toEqual([
        { kind: 'update', uuid: 'Scene.s1.Token.t1', changes: { x: 700 } },
      ]);
    });
  });

  it('uses the scene grid for squares and distance', () => {
    const scene = setScene([makeTok({ id: 't1', name: 'Wolf 1', x: 0, y: 0 })]);
    scene.grid = { size: 50, distance: 10, units: 'm' };
    const plan = planTokenChange(move({ dx: 2 }));
    expect(plan.ops[0]).toMatchObject({ changes: { x: 100 } });
    expect(plan.targets[0]?.line).toBe(`Wolf 1: (0,0) to (2,0), 20 m${PLACED}`);
  });
});

describe('planTokenChange: update', () => {
  beforeEach(standardScene);

  const update = (changes: Record<string, unknown>, tokens = ['Wolf 1']): any => ({
    scope: 'token',
    action: 'update',
    tokens,
    changes,
  });

  it('writes only the paths that change and previews them readably', () => {
    const plan = planTokenChange(
      update({ hidden: true, disposition: 1, lightDim: 20, name: 'Wolf 1', lightColor: '#ff9329' })
    );
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Scene.s1.Token.t1',
        changes: { hidden: true, disposition: 1, 'light.dim': 20, 'light.color': '#ff9329' },
      },
    ]);
    expect(plan.targets[0]?.line).toBe(
      'Wolf 1: hidden false to true, disposition hostile to friendly, dim light 0 to 20, ' +
        'light color none to #ff9329'
    );
    expect(plan.summary).toBe('Change hidden, disposition, dim light, name, light color of Wolf 1');
  });

  it('compares against the stored values (_source) when they exist', () => {
    setScene([
      makeTok({
        id: 't1',
        name: 'Wolf 1',
        source: { hidden: true, light: { dim: 40 }, sight: { enabled: false } },
      }),
    ]);
    // The document still says hidden false and dim 0 (stale); the source is the truth.
    const plan = planTokenChange(update({ hidden: false, lightDim: 40, sightEnabled: true }));
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Scene.s1.Token.t1',
        changes: { hidden: false, 'sight.enabled': true },
      },
    ]);
    expect(plan.targets[0]?.line).toBe('Wolf 1: hidden true to false, vision false to true');
  });

  it('falls back to the document value for a path missing from _source', () => {
    setScene([makeTok({ id: 't1', name: 'Wolf 1', source: { hidden: true } })]);
    // disposition is not in the source: the document's -1 counts, so -1 is no change.
    expect(() => planTokenChange(update({ disposition: -1 }))).toThrow(/Nothing to change/);
    const plan = planTokenChange(update({ disposition: 1, hidden: true }));
    expect(plan.ops[0]).toMatchObject({ changes: { disposition: 1 } });
    expect(plan.targets[0]?.line).toBe('Wolf 1: disposition hostile to friendly');
  });

  it('writes nested sight and light paths', () => {
    const plan = planTokenChange(
      update({
        sightEnabled: true,
        sightRange: 60,
        visionMode: 'darkvision',
        lightAnimation: 'torch',
      })
    );
    expect(plan.ops[0]).toMatchObject({
      changes: {
        'sight.enabled': true,
        'sight.range': 60,
        'sight.visionMode': 'darkvision',
        'light.animation.type': 'torch',
      },
    });
  });

  it('shows secret, neutral and hostile dispositions by name', () => {
    expect(planTokenChange(update({ disposition: -2 })).targets[0]?.line).toContain(
      'hostile to secret'
    );
    expect(planTokenChange(update({ disposition: 0 }, ['Hero'])).targets[0]?.line).toContain(
      'friendly to neutral'
    );
  });

  it('plans several tokens, skipping the ones already matching', () => {
    const plan = planTokenChange(update({ disposition: 1 }, ['Wolf 1', 'Hero']));
    expect(plan.ops).toHaveLength(1);
    expect(plan.targets).toEqual([
      expect.objectContaining({ target: 'Wolf 1', line: expect.stringContaining('to friendly') }),
      expect.objectContaining({ target: 'Hero', line: 'Hero: no change', skipped: true }),
    ]);
  });

  it('throws "Nothing to change" when every field already matches', () => {
    expect(() => planTokenChange(update({ hidden: false }))).toThrow(
      /Nothing to change: Wolf 1: no change/
    );
  });

  it('needs at least one field', () => {
    expect(() => planTokenChange(update({}))).toThrow(/Update needs at least one field/);
    expect(() =>
      planTokenChange({ scope: 'token', action: 'update', tokens: ['Wolf 1'] } as any)
    ).toThrow(/Update needs at least one field/);
    expect(() => planTokenChange(update({ hidden: undefined }))).toThrow(
      /Update needs at least one field/
    );
  });

  it('refuses a field that is not on the list', () => {
    expect(() => planTokenChange(update({ bogus: 1 }))).toThrow(/"bogus" cannot be changed here/);
    expect(() => planTokenChange(update({ x: 100 }))).toThrow(/"x" cannot be changed here/);
    expect(() => planTokenChange(update({ actorId: 'abc' }))).toThrow(/cannot be changed here/);
  });

  it('checks the values', () => {
    expect(() => planTokenChange(update({ disposition: 5 }))).toThrow(/disposition must be -2/);
    expect(() => planTokenChange(update({ disposition: 'hostile' }))).toThrow(
      /disposition must be a number/
    );
    expect(() => planTokenChange(update({ lightDim: -5 }))).toThrow(/lightDim cannot be negative/);
    expect(() => planTokenChange(update({ sightRange: -1 }))).toThrow(/cannot be negative/);
    expect(() => planTokenChange(update({ lightColor: 'red' }))).toThrow(
      /lightColor must be a hex/
    );
    expect(() => planTokenChange(update({ hidden: 'yes' }))).toThrow(
      /hidden must be true or false/
    );
    expect(() => planTokenChange(update({ width: 0 }))).toThrow(/width must be more than 0/);
    expect(() => planTokenChange(update({ name: '  ' }))).toThrow(/name cannot be empty/);
    expect(() => planTokenChange(update({ visionMode: 3 }))).toThrow(/visionMode must be text/);
  });
});

describe('planTokenChange: delete', () => {
  const del = (tokens: string[]): any => ({ scope: 'token', action: 'delete', tokens });

  it('deletes a token with nothing else attached as one op', () => {
    standardScene();
    const plan = planTokenChange(del(['Wolf 1']));
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.s1.Token.t1' }]);
    expect(plan.targets[0]?.line).toBe('Wolf 1: delete');
    expect(plan.summary).toBe('Delete Wolf 1 from Arena');
  });

  it('puts the combatant deletes before the token delete and mentions the initiative', () => {
    setScene(
      [
        makeTok({ id: 't1', name: 'Wolf 1', x: 200, y: 200 }),
        makeTok({ id: 't2', name: 'Wolf 2', x: 300, y: 200 }),
      ],
      [
        {
          combatants: {
            contents: [
              { uuid: 'Combat.c1.Combatant.cb1', tokenId: 't1', sceneId: 's1', initiative: 14 },
              { uuid: 'Combat.c1.Combatant.cb2', tokenId: 't2', sceneId: 's1', initiative: 8 },
              // Same token id on another scene: not ours.
              { uuid: 'Combat.c1.Combatant.cb3', tokenId: 't1', sceneId: 's9', initiative: 3 },
            ],
          },
        },
      ]
    );
    const plan = planTokenChange(del(['Wolf 1']));
    expect(plan.ops).toEqual([
      { kind: 'delete', uuid: 'Combat.c1.Combatant.cb1' },
      { kind: 'delete', uuid: 'Scene.s1.Token.t1' },
    ]);
    expect(plan.targets[0]?.line).toBe(
      'Wolf 1: delete, with its place in the encounter (initiative 14)'
    );
  });

  it('handles combatants without an initiative yet, in more than one combat', () => {
    setScene(
      [makeTok({ id: 't1', name: 'Wolf 1', x: 200, y: 200 })],
      [
        {
          combatants: [{ uuid: 'Combat.c1.Combatant.cb1', tokenId: 't1', initiative: null }],
        },
        {
          combatants: [{ uuid: 'Combat.c2.Combatant.cb9', tokenId: 't1', initiative: 11 }],
        },
      ]
    );
    const plan = planTokenChange(del(['Wolf 1']));
    expect(plan.ops.map(o => o.uuid)).toEqual([
      'Combat.c1.Combatant.cb1',
      'Combat.c2.Combatant.cb9',
      'Scene.s1.Token.t1',
    ]);
    expect(plan.targets[0]?.line).toBe(
      'Wolf 1: delete, with its place in the encounter and its place in the encounter ' +
        '(initiative 11)'
    );
  });

  it('deletes several tokens, each with its own combatants first', () => {
    setScene(
      [makeTok({ id: 't1', name: 'Wolf 1' }), makeTok({ id: 't2', name: 'Wolf 2', x: 100 })],
      [
        {
          combatants: {
            contents: [{ uuid: 'Combat.c1.Combatant.cb2', tokenId: 't2', initiative: 5 }],
          },
        },
      ]
    );
    const plan = planTokenChange(del(['Wolf 1', 'Wolf 2']));
    expect(plan.ops.map(o => o.uuid)).toEqual([
      'Scene.s1.Token.t1',
      'Combat.c1.Combatant.cb2',
      'Scene.s1.Token.t2',
    ]);
    expect(plan.summary).toBe('Delete Wolf 1, Wolf 2 from Arena');
  });

  it('lists the same token only once when named twice', () => {
    standardScene();
    const plan = planTokenChange(del(['Wolf 1', 't1', 'wolf 1']));
    expect(plan.ops).toEqual([{ kind: 'delete', uuid: 'Scene.s1.Token.t1' }]);
  });
});

describe('planTokenChange: fit-scale', () => {
  const fit = (tokens?: string[]): any => ({
    scope: 'token',
    action: 'fit-scale',
    ...(tokens ? { tokens } : {}),
  });

  function townScene(grid: Record<string, unknown>): void {
    const withSize = (id: string, name: string, size?: string, w = 1): any => {
      const t = makeTok({ id, name });
      t.width = w;
      t.height = w;
      if (size !== undefined) t.actor = { system: { traits: size ? { size } : {} } };
      return t;
    };
    const scene = setScene([
      withSize('t1', 'Hero', 'med'),
      withSize('t2', 'Ogre', 'lg', 2),
      withSize('t3', 'Dragon', 'grg', 4),
      withSize('t4', 'Rat', 'tiny', 0.5),
      withSize('t5', 'Mystery', ''),
      withSize('t6', 'Marker'),
    ]);
    scene.grid = { size: 100, distance: 5, units: 'ft', ...grid };
  }

  it('sizes every token from its actor size at 20 ft per square', () => {
    townScene({ distance: 20 });
    const plan = planTokenChange(fit());
    const sizes = plan.ops.map(o => (o as any).changes.width);
    // med 5/20, lg 10/20, grg 20/20, tiny floored at 0.25; Mystery (no size) is left alone
    expect(sizes).toEqual([0.25, 0.5, 1, 0.25]);
    expect(plan.ops[1]).toEqual({
      kind: 'update',
      uuid: 'Scene.s1.Token.t2',
      changes: { width: 0.5, height: 0.5, depth: 0.5, 'flags.dnd5e.lockSize': true },
    });
    expect(plan.targets[1]?.line).toBe('Ogre: 2x2 to 0.5x0.5 squares');
    expect(plan.targets).toHaveLength(4);
    expect(plan.summary).toContain('every creature');
  });

  it('applies the floor: 200 ft squares do not shrink a token below 0.25', () => {
    townScene({ distance: 200 });
    const plan = planTokenChange(fit(['Hero']));
    expect((plan.ops[0] as any).changes).toEqual({
      width: 0.25,
      height: 0.25,
      depth: 0.25,
      'flags.dnd5e.lockSize': true,
    });
  });

  it('uses a pixel floor on small grids (50 px: 24 px = 0.48)', () => {
    townScene({ distance: 200, size: 50 });
    const plan = planTokenChange(fit(['Hero']));
    expect((plan.ops[0] as any).changes).toEqual({
      width: 0.48,
      height: 0.48,
      depth: 0.48,
      'flags.dnd5e.lockSize': true,
    });
  });

  it('rounds to two decimals for odd distances (16.66 ft)', () => {
    townScene({ distance: 16.66 });
    const plan = planTokenChange(fit(['Ogre']));
    expect((plan.ops[0] as any).changes.width).toBe(0.6);
  });

  it('scales up on a finer grid (2.5 ft squares)', () => {
    townScene({ distance: 2.5 });
    const plan = planTokenChange(fit(['Hero']));
    expect((plan.ops[0] as any).changes.width).toBe(2);
  });

  it('treats a named token without a size as medium', () => {
    townScene({ distance: 20 });
    const plan = planTokenChange(fit(['Mystery']));
    expect(plan.targets[0]?.line).toContain('size unknown, treated as medium');
  });

  it('says so when only the size lock is missing', () => {
    townScene({ distance: 20 });
    const hero = g.game.scenes.current.tokens.contents[0];
    hero.width = hero.height = 0.25;
    hero._source = { depth: 0.25 };
    const plan = planTokenChange(fit(['Hero']));
    expect(plan.targets[0]?.line).toBe('Hero: already 0.25 squares; locks the size');
    expect((plan.ops[0] as any).changes).toEqual({ 'flags.dnd5e.lockSize': true });
    expect(plan.ops).toHaveLength(1);
  });

  it('is a no-op on a 5 ft scene', () => {
    townScene({});
    expect(() => planTokenChange(fit())).toThrow(/already at 5 ft per square/);
  });

  it('skips tokens that already fit and refuses when none change', () => {
    townScene({ distance: 20 });
    const first = planTokenChange(fit(['Hero']));
    const hero = g.game.scenes.current.tokens.contents[0];
    hero.width = hero.height = (first.ops[0] as any).changes.width;
    hero._source = { flags: { dnd5e: { lockSize: true } } };
    expect(() => planTokenChange(fit(['Hero']))).toThrow(/Nothing to change: Hero: already/);
  });

  it('refuses a scene measured in miles', () => {
    townScene({ distance: 6, units: 'mi' });
    expect(() => planTokenChange(fit())).toThrow(/not feet/);
  });

  it('treats a scene without units as feet, and works on hex and gridless scenes', () => {
    townScene({ distance: 50, units: '', type: 2 });
    expect(planTokenChange(fit(['Hero'])).ops).toHaveLength(1);
    townScene({ distance: 50, type: 0 });
    expect(planTokenChange(fit(['Hero'])).ops).toHaveLength(1);
  });

  it('still needs a token name for other actions', () => {
    townScene({ distance: 20 });
    expect(() => planTokenChange({ scope: 'token', action: 'update' } as any)).toThrow(
      /at least one token/
    );
  });
});

describe('planLiveChange routing', () => {
  it('sends scope "token" to the token planner', async () => {
    standardScene();
    const plan = await planLiveChange({
      scope: 'token',
      action: 'move',
      tokens: ['Wolf 1'],
      gridX: 5,
      gridY: 4,
    });
    expect(plan.summary).toBe('Move Wolf 1 to (5,4)');
    expect(plan.ops).toHaveLength(1);
  });

  it('still refuses an unknown scope', async () => {
    standardScene();
    await expect(planLiveChange({ scope: 'party', tokens: ['Wolf 1'] })).rejects.toThrow(
      /Unknown live change scope/
    );
  });
});

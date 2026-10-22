import { afterEach, describe, expect, it } from 'vitest';

import {
  findSpots,
  overlaps,
  planPartyPlacement,
  type GridLike,
  type Rect,
} from './party-place.js';

/** A square grid like Foundry's: offset i = row, j = column. */
function squareGrid(size: number): GridLike & {
  getCenterPoint(o: { i: number; j: number }): { x: number; y: number };
} {
  return {
    size,
    isGridless: false,
    getOffset: ({ x, y }) => ({ i: Math.floor(y / size), j: Math.floor(x / size) }),
    getTopLeftPoint: ({ i, j }) => ({ x: j * size, y: i * size }),
    getCenterPoint: ({ i, j }) => ({ x: (j + 0.5) * size, y: (i + 0.5) * size }),
  };
}

const gridless = (size: number): GridLike => ({
  size,
  isGridless: true,
  getOffset: ({ x, y }) => ({ i: y, j: x }),
  getTopLeftPoint: ({ i, j }) => ({ x: j, y: i }),
});

const bounds: Rect = { x: 0, y: 0, w: 2000, h: 2000 };

describe('findSpots', () => {
  it('steps tokens smaller than a square by their own size from the spot', () => {
    const grid = squareGrid(100);
    const small = { w: 0.25, h: 0.25 };
    const spots = findSpots(grid, bounds, [], { x: 1050, y: 1050 }, [small, small, small, small]);
    const rects = spots.map(s => ({ x: s!.x, y: s!.y, w: 25, h: 25 }));
    for (const [a, ra] of rects.entries()) {
      for (const [b, rb] of rects.entries()) if (a !== b) expect(overlaps(ra, rb)).toBe(false);
      expect(Math.hypot(ra.x + 12.5 - 1050, ra.y + 12.5 - 1050)).toBeLessThanOrEqual(40);
    }
    expect(spots[0]).toEqual({ x: 1038, y: 1038 });
  });

  it('keeps small tokens off a bigger token and out of a wall shadow', () => {
    const grid = squareGrid(100);
    const small = { w: 0.25, h: 0.25 };
    const big: Rect = { x: 1000, y: 1000, w: 100, h: 100 };
    const spots = findSpots(grid, bounds, [big], { x: 1050, y: 1050 }, [small, small]);
    for (const s of spots) expect(overlaps({ x: s!.x, y: s!.y, w: 25, h: 25 }, big)).toBe(false);
    const walled = findSpots(
      grid,
      bounds,
      [],
      { x: 1050, y: 1050 },
      [small, small],
      (_from, to) => to.x > 1060
    );
    for (const s of walled) expect(s!.x + 12.5).toBeLessThanOrEqual(1060);
  });

  it('puts the first token on the spot and the rest on the nearest free squares, none overlapping', () => {
    const grid = squareGrid(100);
    const spots = findSpots(grid, bounds, [], { x: 1050, y: 1050 }, [
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    expect(spots[0]).toEqual({ x: 1000, y: 1000 });
    const rects = spots.map(s => ({ x: s!.x, y: s!.y, w: 100, h: 100 }));
    for (const [a, ra] of rects.entries()) {
      for (const [b, rb] of rects.entries()) if (a !== b) expect(overlaps(ra, rb)).toBe(false);
      expect(Math.hypot(ra.x - 1000, ra.y - 1000)).toBeLessThanOrEqual(150);
    }
  });

  it('never covers an existing token, and reads the grid size (50 px here)', () => {
    const grid = squareGrid(50);
    const existing: Rect[] = [{ x: 500, y: 500, w: 50, h: 50 }];
    const [spot] = findSpots(grid, bounds, existing, { x: 525, y: 525 }, [{ w: 1, h: 1 }]);
    expect(spot).not.toEqual({ x: 500, y: 500 });
    expect(overlaps({ ...spot!, w: 50, h: 50 }, existing[0])).toBe(false);
  });

  it('packs a Large token first and keeps every token at its own size', () => {
    const grid = squareGrid(100);
    const spots = findSpots(grid, bounds, [], { x: 1050, y: 1050 }, [
      { w: 1, h: 1 },
      { w: 2, h: 2 },
      { w: 0.5, h: 0.5 },
    ]);
    const sizes = [1, 2, 0.5];
    const rects = spots.map((s, i) => ({
      x: s!.x,
      y: s!.y,
      w: sizes[i] * 100,
      h: sizes[i] * 100,
    }));
    expect(rects[1]).toEqual({ x: 1000, y: 1000, w: 200, h: 200 });
    expect(overlaps(rects[0], rects[1])).toBe(false);
    expect(overlaps(rects[2], rects[1])).toBe(false);
    expect(overlaps(rects[0], rects[2])).toBe(false);
  });

  it('stays inside the scene rectangle at its edge', () => {
    const grid = squareGrid(100);
    const scene: Rect = { x: 200, y: 200, w: 300, h: 300 };
    const spots = findSpots(grid, scene, [], { x: 250, y: 250 }, [
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    for (const s of spots) {
      expect(s!.x).toBeGreaterThanOrEqual(200);
      expect(s!.y).toBeGreaterThanOrEqual(200);
      expect(s!.x + 100).toBeLessThanOrEqual(500);
      expect(s!.y + 100).toBeLessThanOrEqual(500);
    }
  });

  it('skips spots behind a wall, and gives null when there is no room at all', () => {
    const grid = squareGrid(100);
    const wallAtX = 1100; // everything right of x = 1100 is behind a wall
    const spots = findSpots(
      grid,
      bounds,
      [],
      { x: 1050, y: 1050 },
      [
        { w: 1, h: 1 },
        { w: 1, h: 1 },
      ],
      (_from, to) => to.x > wallAtX
    );
    for (const s of spots) expect(s!.x + 50).toBeLessThanOrEqual(wallAtX);

    const tiny: Rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(
      findSpots(grid, tiny, [], { x: 50, y: 50 }, [
        { w: 1, h: 1 },
        { w: 1, h: 1 },
      ])[1]
    ).toBeNull();
  });

  it('on a gridless scene steps one grid size apart around the spot', () => {
    const spots = findSpots(gridless(80), bounds, [], { x: 1000, y: 1000 }, [
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
    expect(spots[0]).toEqual({ x: 960, y: 960 });
    expect(overlaps({ ...spots[0]!, w: 80, h: 80 }, { ...spots[1]!, w: 80, h: 80 })).toBe(false);
  });
});

describe('planPartyPlacement', () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.canvas;
    delete g.CONFIG;
  });

  function world(
    opts: {
      viewed?: boolean;
      walls?: boolean;
      distance?: number;
      units?: string;
      gridSize?: number;
      noSize?: boolean;
    } = {}
  ): void {
    const grid = {
      ...squareGrid(opts.gridSize ?? 100),
      ...(opts.distance !== undefined ? { distance: opts.distance } : {}),
      ...(opts.units ? { units: opts.units } : {}),
    };
    const actor = (id: string, name: string, w = 1): Record<string, unknown> => ({
      id,
      name,
      system: { traits: opts.noSize ? {} : { size: w === 2 ? 'lg' : 'med' } },
      type: 'character',
      prototypeToken: { width: w, height: w },
      getTokenDocument: (data: Record<string, unknown>) =>
        Promise.resolve({
          // Like mergeObject in Foundry: dotted keys are expanded into nested objects.
          toObject: (): Record<string, unknown> => {
            const { 'flags.dnd5e.lockSize': lock, ...rest } = data;
            return {
              _id: 'tmp',
              name,
              actorId: id,
              width: w,
              height: w,
              ...rest,
              ...(lock === undefined ? {} : { flags: { dnd5e: { lockSize: lock } } }),
            };
          },
        }),
    });
    const hero = actor('a1', 'Test Hero');
    const mage = actor('a2', 'Silvera');
    const horse = actor('a3', 'Warhorse', 2);
    const group = {
      id: 'g1',
      type: 'group',
      system: { members: [{ actor: hero }, { actor: mage }, { actor: horse }] },
    };
    const scene = {
      id: 's1',
      uuid: 'Scene.s1',
      name: 'Test Arena',
      grid,
      dimensions: { sceneRect: { x: 0, y: 0, width: 2000, height: 2000 } },
      tokens: [
        { name: 'Silvera', actorId: 'a2', _source: { x: 300, y: 300, width: 1, height: 1 } },
      ],
      notes: [{ text: 'Inn door', x: 1550, y: 450 }],
      walls: opts.walls ? [{}] : [],
    };
    g.game = {
      user: { isGM: true },
      actors: { get: (id: string) => (id === 'g1' ? group : undefined) },
      scenes: { current: scene },
    };
    if (opts.viewed) g.canvas = { ready: true, scene, stage: { pivot: { x: 1050, y: 950 } } };
  }

  it('places the members without a token around the centre of the view, hidden when asked', async () => {
    world({ viewed: true });
    const result = await planPartyPlacement({ groupId: 'g1', hidden: true });
    expect(result.scene).toEqual({ sceneId: 's1', uuid: 'Scene.s1', name: 'Test Arena' });
    expect(result.anchor.label).toBe('around the centre of your view');
    expect(result.tokens.map(t => t.name)).toEqual(['Test Hero', 'Warhorse']);
    expect(result.skipped).toEqual([{ name: 'Silvera', reason: 'already on this scene' }]);
    for (const t of result.tokens) {
      expect(t.data._id).toBeUndefined();
      expect(t.data.hidden).toBe(true);
    }
    // The Large horse packs onto the spot first.
    expect(result.tokens.find(t => t.name === 'Warhorse')?.data).toMatchObject({ x: 1000, y: 900 });
  });

  it('sizes tokens to the map scale like fit-scale; a 5 ft scene is unchanged', async () => {
    world({ viewed: true, distance: 5 });
    const five = await planPartyPlacement({ groupId: 'g1' });
    expect(five.tokens.map(t => [t.data.width, t.data.height])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(five.tokens[0].data.flags).toBeUndefined();

    world({ viewed: true, distance: 40 });
    const town = await planPartyPlacement({ groupId: 'g1' });
    // 5 ft / 40 ft = 0.125, floored to 0.25 squares; Large 10 / 40 = 0.25.
    expect(town.tokens.map(t => [t.data.width, t.data.height])).toEqual([
      [0.25, 0.25],
      [0.25, 0.25],
    ]);
    expect(town.tokens[0].data.flags).toEqual({ dnd5e: { lockSize: true } });
    // Depth follows width and height, like fit-scale.
    expect(town.tokens.map(t => t.data.depth)).toEqual([0.25, 0.25]);

    world({ viewed: true, distance: 2.5 });
    const fine = await planPartyPlacement({ groupId: 'g1' });
    expect(fine.tokens.map(t => t.data.width)).toEqual([2, 4]);
  });

  it('packs tokens smaller than a square close together on the spot, none overlapping', async () => {
    world({ viewed: true, distance: 40 });
    const town = await planPartyPlacement({ groupId: 'g1' });
    // Hero and horse are 25 px tokens on a 100 px grid; Silvera's token stays where it was.
    const rects = town.tokens.map(t => ({
      x: t.data.x as number,
      y: t.data.y as number,
      w: 25,
      h: 25,
    }));
    expect(overlaps(rects[0], rects[1])).toBe(false);
    for (const r of rects) {
      // Within one square of the centre of the view (1050, 950), not a square each.
      expect(Math.hypot(r.x + 12.5 - 1050, r.y + 12.5 - 950)).toBeLessThanOrEqual(50);
    }
    // The first token is centred on the spot.
    expect(rects[0]).toMatchObject({ x: 1038, y: 938 });
  });

  it('floors the token edge at 24 px on a 50 px grid (0.48 squares), packed by that step', async () => {
    world({ viewed: true, distance: 40, gridSize: 50 });
    const town = await planPartyPlacement({ groupId: 'g1' });
    expect(town.tokens.map(t => [t.data.width, t.data.height, t.data.depth])).toEqual([
      [0.48, 0.48, 0.48],
      [0.48, 0.48, 0.48],
    ]);
    const [a, b] = town.tokens.map(t => ({
      x: t.data.x as number,
      y: t.data.y as number,
      w: 24,
      h: 24,
    }));
    expect(overlaps(a, b)).toBe(false);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(24 * Math.SQRT2 + 1);
  });

  it('with distance 0 the scene is not scaled and tokens keep their prototype size', async () => {
    world({ viewed: true, distance: 0 });
    const result = await planPartyPlacement({ groupId: 'g1' });
    expect(result.tokens.map(t => [t.data.width, t.data.height])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(result.tokens.every(t => t.data.depth === undefined && t.data.flags === undefined)).toBe(
      true
    );
  });

  it('treats an actor with no size set as medium (5 ft) when scaling', async () => {
    world({ viewed: true, distance: 20, noSize: true });
    const result = await planPartyPlacement({ groupId: 'g1' });
    // 5 ft / 20 ft = 0.25 squares for every member, the horse too.
    expect(result.tokens.map(t => [t.data.width, t.data.height, t.data.depth])).toEqual([
      [0.25, 0.25, 0.25],
      [0.25, 0.25, 0.25],
    ]);
  });

  it('keeps the prototype size on a scene that is not measured in feet, with a warning', async () => {
    world({ viewed: true, distance: 1.5, units: 'm' });
    const metric = await planPartyPlacement({ groupId: 'g1' });
    expect(metric.tokens.map(t => t.data.width)).toEqual([1, 2]);
    expect(metric.warnings).toEqual([
      'The scene measures in "m", not feet, so tokens keep their own size',
    ]);
  });

  it('without a drawn map goes to the middle of the scene and says so; walls are then not checked', async () => {
    world({ walls: true });
    const result = await planPartyPlacement({ groupId: 'g1' });
    expect(result.anchor).toMatchObject({ x: 1000, y: 1000, label: 'in the middle of the scene' });
    expect(result.warnings).toEqual([
      "Foundry's map is not drawn, so the party goes to the middle of the scene",
      "Walls were not checked (Foundry's map is not drawn)",
    ]);
  });

  it('can use a map note or a token as the spot, and refuses an unknown one', async () => {
    world();
    const atNote = await planPartyPlacement({ groupId: 'g1', at: 'note', target: 'inn door' });
    expect(atNote.anchor).toMatchObject({ x: 1550, y: 450, label: 'at the note "Inn door"' });
    const atToken = await planPartyPlacement({ groupId: 'g1', at: 'token', target: 'Silvera' });
    expect(atToken.anchor.label).toBe('next to Silvera');
    await expect(
      planPartyPlacement({ groupId: 'g1', at: 'note', target: 'nowhere' })
    ).rejects.toThrow('No map note "nowhere"');
  });

  it('refuses a non-GM and an unknown group', async () => {
    world();
    await expect(planPartyPlacement({ groupId: 'nope' })).rejects.toThrow('No group actor');
    (g.game as Record<string, unknown>).user = { isGM: false };
    await expect(planPartyPlacement({ groupId: 'g1' })).rejects.toThrow('Only a GM');
  });
});

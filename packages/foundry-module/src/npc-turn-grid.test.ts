/** NPC turn assistant (I-125): the pure grid maths, with no Foundry globals. */
import { describe, expect, it } from 'vitest';

import {
  DIAGONALS,
  cheapestAt,
  gapSquares,
  lineSquares,
  pathOf,
  reachable,
  stepCost,
  tidy,
  type Footprint,
  type ReachInput,
} from './npc-turn-grid.js';

const one = (x: number, y: number): Footprint => ({ x, y, w: 1, h: 1 });

function open(overrides: Partial<ReachInput> = {}): ReachInput {
  return {
    start: one(5, 5),
    rule: DIAGONALS.EQUIDISTANT,
    budget: 3,
    inBounds: () => true,
    passable: () => true,
    wallBetween: () => false,
    terrain: () => 1,
    ...overrides,
  };
}

describe('lineSquares: the world gridDiagonals rules', () => {
  it('counts a diagonal run and a straight one under each rule', () => {
    // 3 across, 2 down: two diagonals and one straight step.
    expect(lineSquares(DIAGONALS.EQUIDISTANT, 3, 2)).toBe(3);
    expect(tidy(lineSquares(DIAGONALS.EXACT, 3, 2))).toBe(3.83);
    expect(lineSquares(DIAGONALS.APPROXIMATE, 3, 2)).toBe(4);
    expect(lineSquares(DIAGONALS.RECTILINEAR, 3, 2)).toBe(5);
    expect(lineSquares(DIAGONALS.ALTERNATING_1, 3, 2)).toBe(4);
    expect(lineSquares(DIAGONALS.ALTERNATING_2, 3, 2)).toBe(4);
    // Three diagonals: 1+2+1 against 2+1+2.
    expect(lineSquares(DIAGONALS.ALTERNATING_1, 3, 3)).toBe(4);
    expect(lineSquares(DIAGONALS.ALTERNATING_2, 3, 3)).toBe(5);
  });

  it('prices a diagonal step by the diagonals already taken', () => {
    expect(stepCost(DIAGONALS.ALTERNATING_1, 1, 1, 0)).toBe(1);
    expect(stepCost(DIAGONALS.ALTERNATING_1, 1, 1, 1)).toBe(2);
    expect(stepCost(DIAGONALS.ALTERNATING_1, 1, 0, 1)).toBe(1);
    expect(stepCost(DIAGONALS.ILLEGAL, 1, 1, 0)).toBe(Infinity);
  });
});

describe('gapSquares', () => {
  it('is 1 for touching tokens, also diagonally, and counts the empty squares between', () => {
    expect(gapSquares(0, one(2, 2), one(3, 2))).toBe(1);
    expect(gapSquares(0, one(2, 2), one(3, 3))).toBe(1);
    expect(gapSquares(0, one(2, 2), one(7, 2))).toBe(5);
    // Overlapping ranges on one axis count as no distance on it.
    expect(gapSquares(0, one(2, 2), one(2, 4))).toBe(2);
  });

  it('uses the footprint edge of a large token', () => {
    expect(gapSquares(0, { x: 2, y: 2, w: 2, h: 2 }, one(4, 2))).toBe(1);
  });

  it('follows the diagonal rule', () => {
    expect(gapSquares(DIAGONALS.ALTERNATING_1, one(2, 2), one(4, 4))).toBe(3);
    expect(gapSquares(DIAGONALS.EQUIDISTANT, one(2, 2), one(4, 4))).toBe(2);
  });
});

describe('reachable', () => {
  it('reaches the squares inside the budget and no more', () => {
    const nodes = reachable(open());
    expect(cheapestAt(nodes, 8, 5)?.cost).toBe(3);
    expect(cheapestAt(nodes, 9, 5)).toBeNull();
    expect(cheapestAt(nodes, 8, 8)?.cost).toBe(3);
  });

  it('does not let a diagonal beat the alternating rule', () => {
    const nodes = reachable(open({ rule: DIAGONALS.ALTERNATING_1, budget: 3 }));
    // 1+2 for two diagonals, so (7,7) is 3, (8,8) is not reachable.
    expect(cheapestAt(nodes, 7, 7)?.cost).toBe(3);
    expect(cheapestAt(nodes, 8, 8)).toBeNull();
  });

  it('goes round a wall and returns the route', () => {
    // A wall between columns 6 and 7 for rows 3 to 7.
    const wall = (a: Footprint, b: Footprint): boolean =>
      a.x !== b.x && Math.min(a.x, b.x) === 6 && a.y >= 3 && a.y <= 7 && b.y >= 3 && b.y <= 7;
    const nodes = reachable(open({ wallBetween: wall, budget: 8 }));
    const node = cheapestAt(nodes, 8, 5);
    expect(node?.cost).toBe(6);
    const route = pathOf(nodes, node!);
    expect(route[0]).toEqual({ x: 5, y: 5 });
    expect(route.at(-1)).toEqual({ x: 8, y: 5 });
    expect(route.some(s => s.y === 2 || s.y === 8)).toBe(true);
    expect(cheapestAt(reachable(open({ wallBetween: wall, budget: 3 })), 8, 5)).toBeNull();
  });

  it('doubles the cost of difficult terrain and finds the cheaper way round it', () => {
    const hard = (f: Footprint): number => (f.x === 6 && f.y >= 4 && f.y <= 6 ? 2 : 1);
    const nodes = reachable(open({ terrain: hard, budget: 4 }));
    // Across the hard column straight: 1 (to col 6 costs 2) ... col 6 entered once at cost 2.
    expect(cheapestAt(nodes, 6, 5)?.cost).toBe(2);
    expect(cheapestAt(nodes, 7, 5)?.cost).toBe(3);
    // Round the patch beats going through when it is wider.
    const wide = reachable(open({ terrain: f => (f.x >= 6 && f.x <= 7 ? 2 : 1), budget: 6 }));
    expect(cheapestAt(wide, 8, 5)?.cost).toBe(5);
  });

  it('will not cross a square the mover is barred from, nor leave the bounds', () => {
    const nodes = reachable(
      open({ passable: f => !(f.x === 6), inBounds: f => f.y >= 5, budget: 3 })
    );
    expect(cheapestAt(nodes, 7, 5)).toBeNull();
    expect(cheapestAt(nodes, 5, 4)).toBeNull();
    expect(cheapestAt(nodes, 5, 6)?.cost).toBe(1);
  });

  it('moves a large token by its whole footprint', () => {
    const big: Footprint = { x: 5, y: 5, w: 2, h: 2 };
    const nodes = reachable(
      open({ start: big, passable: f => !(f.x <= 8 && f.x + f.w > 8 && f.y === 5) })
    );
    // The square (8,5) is barred, so a 2 wide token cannot stand on columns 7 to 8 in row 5.
    expect(cheapestAt(nodes, 7, 5)).toBeNull();
    expect(cheapestAt(nodes, 7, 6)).not.toBeNull();
  });
});

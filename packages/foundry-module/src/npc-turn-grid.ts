/**
 * NPC turn assistant (I-125): the pure grid maths behind `planNpcTurn`. No Foundry globals here, so
 * the rules are unit-tested on their own.
 *
 * - Diagonals follow Foundry's world setting `core.gridDiagonals` (equidistant, exact, 1.5,
 *   rectilinear, alternating 1/2 or 2/1, illegal). All lengths are in squares; the caller multiplies
 *   by the scene's distance per square.
 * - {@link reachable} is a Dijkstra search over the squares a token can walk to inside a budget:
 *   a wall or closed door between two squares blocks the step, difficult terrain multiplies the cost
 *   of entering a square, and a hostile creature's square cannot be crossed.
 */

export interface Square {
  x: number;
  y: number;
}

/** A token's footprint: top-left square and size in squares. */
export interface Footprint extends Square {
  w: number;
  h: number;
}

/** Foundry's `CONST.GRID_DIAGONALS`. */
export const DIAGONALS = {
  EQUIDISTANT: 0,
  EXACT: 1,
  APPROXIMATE: 2,
  RECTILINEAR: 3,
  ALTERNATING_1: 4,
  ALTERNATING_2: 5,
  ILLEGAL: 6,
} as const;

export const DIAGONAL_LABELS: Record<number, string> = {
  0: 'diagonals count 1 square',
  1: 'diagonals count 1.41 squares',
  2: 'diagonals count 1.5 squares',
  3: 'diagonals count 2 squares',
  4: 'diagonals alternate 1 and 2 squares, starting at 1',
  5: 'diagonals alternate 2 and 1 squares, starting at 2',
  6: 'diagonal moves are not allowed',
};

/** Cost in squares of one step; `diagonals` is the number of diagonal steps taken before it. */
export function stepCost(rule: number, dx: number, dy: number, diagonals: number): number {
  if (dx === 0 || dy === 0) return 1;
  switch (rule) {
    case DIAGONALS.EXACT:
      return Math.SQRT2;
    case DIAGONALS.APPROXIMATE:
      return 1.5;
    case DIAGONALS.RECTILINEAR:
      return 2;
    case DIAGONALS.ALTERNATING_1:
      return diagonals % 2 === 0 ? 1 : 2;
    case DIAGONALS.ALTERNATING_2:
      return diagonals % 2 === 0 ? 2 : 1;
    case DIAGONALS.ILLEGAL:
      return Infinity;
    default:
      return 1;
  }
}

/** Straight-line length in squares for `dx` by `dy` squares (a diagonal run, then a straight one). */
export function lineSquares(rule: number, dx: number, dy: number): number {
  const a = Math.abs(dx);
  const b = Math.abs(dy);
  const diag = Math.min(a, b);
  const straight = Math.max(a, b) - diag;
  let total = straight;
  for (let i = 0; i < diag; i++) {
    const cost = stepCost(rule, 1, 1, i);
    // Illegal diagonals are measured as two straight steps (the way round the corner).
    total += Number.isFinite(cost) ? cost : 2;
  }
  return total;
}

/**
 * Squares between two footprints, edge to edge: 1 when they touch, overlapping ranges count as 0
 * on that axis. With the default rule this is the largest axis gap plus one.
 */
export function gapSquares(rule: number, a: Footprint, b: Footprint): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const dx = gx >= 0 ? gx + 1 : 0;
  const dy = gy >= 0 ? gy + 1 : 0;
  // Touching footprints, corner to corner included, are always one square apart (5 ft reach).
  if (Math.max(dx, dy) === 1) return 1;
  return lineSquares(rule, dx, dy);
}

export function overlaps(a: Footprint, b: Footprint): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Round a length so 3 steps of 1.41 squares compare cleanly with a speed. */
export function tidy(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ReachInput {
  start: Footprint;
  rule: number;
  /** Budget in squares (the speed over the scene's distance per square). */
  budget: number;
  /** The whole footprint lies inside the scene. */
  inBounds(at: Footprint): boolean;
  /** The footprint holds no creature that bars the way (hostile to the mover). */
  passable(at: Footprint): boolean;
  /** A wall or closed door stops a step between these two footprints. */
  wallBetween(from: Footprint, to: Footprint): boolean;
  /** Cost multiplier for entering this footprint (1 normal, 2 difficult terrain). */
  terrain(at: Footprint): number;
}

export interface ReachNode {
  at: Footprint;
  /** Cost in squares from the start. */
  cost: number;
  diagonals: number;
  from: string | null;
}

const MAX_RADIUS = 40;
const KEY = (x: number, y: number, parity: number): string => `${x},${y},${parity}`;

/** Every square the mover can reach within the budget (the cheapest way to each). */
export function reachable(input: ReachInput): Map<string, ReachNode> {
  const { start, rule, budget } = input;
  const best = new Map<string, ReachNode>();
  const done = new Set<string>();
  const queue: ReachNode[] = [{ at: start, cost: 0, diagonals: 0, from: null }];
  best.set(KEY(start.x, start.y, 0), queue[0]);
  const alternating = rule === DIAGONALS.ALTERNATING_1 || rule === DIAGONALS.ALTERNATING_2;
  while (queue.length > 0) {
    // A tiny search space (a few thousand squares at most): extract the cheapest by scan.
    let lowest = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[lowest].cost) lowest = i;
    }
    const node = queue.splice(lowest, 1)[0];
    const parity = alternating ? node.diagonals % 2 : 0;
    const key = KEY(node.at.x, node.at.y, parity);
    if (done.has(key)) continue;
    done.add(key);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const next: Footprint = { ...start, x: node.at.x + dx, y: node.at.y + dy };
        if (Math.abs(next.x - start.x) > MAX_RADIUS || Math.abs(next.y - start.y) > MAX_RADIUS) {
          continue;
        }
        const diagonal = dx !== 0 && dy !== 0;
        const step = stepCost(rule, dx, dy, node.diagonals);
        if (!Number.isFinite(step)) continue;
        if (!input.inBounds(next) || !input.passable(next)) continue;
        if (input.wallBetween(node.at, next)) continue;
        const cost = node.cost + step * Math.max(0.25, input.terrain(next));
        if (tidy(cost) > tidy(budget)) continue;
        const diagonals = node.diagonals + (diagonal ? 1 : 0);
        const nextKey = KEY(next.x, next.y, alternating ? diagonals % 2 : 0);
        const known = best.get(nextKey);
        if (known && known.cost <= cost) continue;
        const created: ReachNode = { at: next, cost, diagonals, from: key };
        best.set(nextKey, created);
        queue.push(created);
      }
    }
  }
  return best;
}

/** The cheapest recorded node for a square, over both diagonal parities. */
export function cheapestAt(nodes: Map<string, ReachNode>, x: number, y: number): ReachNode | null {
  let found: ReachNode | null = null;
  for (const parity of [0, 1]) {
    const node = nodes.get(KEY(x, y, parity));
    if (node && (!found || node.cost < found.cost)) found = node;
  }
  return found;
}

/** The squares of the route from the start to `node`, start first. */
export function pathOf(nodes: Map<string, ReachNode>, node: ReachNode): Square[] {
  const out: Square[] = [];
  let cur: ReachNode | undefined = node;
  while (cur) {
    out.push({ x: cur.at.x, y: cur.at.y });
    cur = cur.from ? nodes.get(cur.from) : undefined;
  }
  return out.reverse();
}

/**
 * Walls that stop a token's movement, for the read-only token planners (`plan-npc-turn`, and the
 * crossing warning of `plan-token-change`). Foundry's own collision test is used when the scene
 * is drawn, with the token's level and elevation (Foundry 14 builds the test polygon for the level
 * the GM is looking at otherwise); else the wall data, minus the walls of other levels.
 */
type Rec = Record<string, unknown>;
export type Point = { x: number; y: number };

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const r = rec(collection);
  if (Array.isArray(r?.contents)) return r.contents as unknown[];
  if (r && typeof (r as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(collection as Iterable<unknown>);
  }
  return [];
}

export interface Walls {
  /** True when a wall or closed door lies between the two points. */
  blocked(a: Point, b: Point): boolean;
  /** How the walls were read, for the notes; null when the scene has none. */
  source: 'foundry' | 'scene data' | null;
}

/** True when the canvas is ready and draws this scene. */
export function canvasShows(sceneId: string): boolean {
  const c = rec((globalThis as Rec).canvas);
  return c?.ready === true && rec(c.scene)?.id === sceneId;
}

/** The segments a-b and c-d meet, touching included (a step past a wall's end is not planned). */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point): number =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const within = (p: Point, q: Point, r: Point): boolean =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  const o1 = side(a, b, c);
  const o2 = side(a, b, d);
  const o3 = side(c, d, a);
  const o4 = side(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && within(a, b, c)) ||
    (o2 === 0 && within(a, b, d)) ||
    (o3 === 0 && within(c, d, a)) ||
    (o4 === 0 && within(c, d, b))
  );
}

/** A wall (or region) that exists on this level: one with no level list is on every level. */
export function onLevel(doc: Rec, level: string | null): boolean {
  if (level === null) return true;
  try {
    if (typeof doc.includedInLevel === 'function') {
      return Boolean((doc.includedInLevel as (id: string) => unknown).call(doc, level));
    }
    const levels = contentsOf(doc.levels);
    return levels.length === 0 || levels.includes(level);
  } catch {
    // A wall that cannot say counts as on this level.
    return true;
  }
}

/**
 * The walls and closed doors that stop `token` (its level and elevation decide which walls count).
 * @param scene the scene document
 * @param token the token that walks; omit for a scene-wide check on the viewed level
 */
export function wallsOf(scene: Rec, token?: Rec | null): Walls {
  const level = str(token?.level);
  const elevation = num(token?.elevation);
  const walls = contentsOf(scene.walls)
    .map(rec)
    .filter((w): w is Rec => w !== null && onLevel(w, level));
  if (walls.length === 0) return { blocked: () => false, source: null };
  const segments: Array<[Point, Point]> = [];
  for (const w of walls) {
    const c = Array.isArray(w.c) ? (w.c as unknown[]).map(num) : [];
    if (c.length < 4 || c.some(v => v === null)) continue;
    if (w.move === 0) continue;
    // An open door lets movement through.
    if ((num(w.door) ?? 0) > 0 && num(w.ds) === 1) continue;
    segments.push([
      { x: c[0] as number, y: c[1] as number },
      { x: c[2] as number, y: c[3] as number },
    ]);
  }
  const fromData = (a: Point, b: Point): boolean => segments.some(([c, d]) => crosses(a, b, c, d));
  const backend = rec(rec(rec((globalThis as Rec).CONFIG)?.Canvas)?.polygonBackends)?.move as
    | { testCollision?: (a: Point, b: Point, o: Rec) => unknown }
    | undefined;
  if (canvasShows(str(scene.id) ?? '') && typeof backend?.testCollision === 'function') {
    // Foundry 14: `config.level` picks the walls, the points' elevation the height they are tested at.
    const levels = rec(scene.levels) as { get?: (id: string) => unknown } | null;
    let own: unknown;
    try {
      own = level !== null ? levels?.get?.(level) : undefined;
    } catch {
      own = undefined;
    }
    const options: Rec = { type: 'move', mode: 'any', ...(own ? { level: own } : {}) };
    const at = (p: Point): Point & { elevation?: number } =>
      elevation === null ? p : { ...p, elevation };
    return {
      blocked: (a, b): boolean => {
        try {
          return Boolean(backend.testCollision?.(at(a), at(b), options));
        } catch {
          return fromData(a, b);
        }
      },
      source: 'foundry',
    };
  }
  return { blocked: fromData, source: 'scene data' };
}

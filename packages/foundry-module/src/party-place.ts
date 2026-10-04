/**
 * "Place the party here" (I-097): the read-only `planPartyPlacement` query. On the scene the GM
 * is viewing it works out where each party member without a token there would go and returns
 * the token data; the bridge's `plan-party-change` action `place` turns that into a guarded plan
 * of token creates (Undo deletes them). Nothing is written here.
 *
 * - The spot: the centre of the GM's view (default), a token or map note by name, or a grid
 *   square. Without a drawn canvas the view falls back to the middle of the scene.
 * - Squares: the scene's own grid (`scene.grid`), so square, hex and gridless scenes all work
 *   (gridless steps one grid size at a time); grid sizes vary, nothing assumes 100 px.
 * - Room: each token at its own width and height, inside the scene rectangle, never over another
 *   token or an earlier member; when the map is drawn, not behind a wall from the spot (maps
 *   without walls simply never block).
 *
 * The query and type names mirror `@gnuminator/shared` (`PARTY_PLACE_QUERY`, `PartyPlacement`);
 * the browser cannot import runtime values from it.
 */
import type { PartyPlacement, PartyPlaceRequest } from '@gnuminator/shared';

/** Query name (prefixed with the module id on the wire). GM client only. */
export const PARTY_PLACE_QUERY = 'planPartyPlacement';

/** How many rings of squares around the spot are searched for room. */
export const MAX_RINGS = 12;

type Rec = Record<string, unknown>;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parts of Foundry's BaseGrid the search needs. */
export interface GridLike {
  size: number;
  isGridless: boolean;
  getOffset(point: Point): { i: number; j: number };
  getTopLeftPoint(offset: { i: number; j: number }): Point;
}

/** A token to place: its size in grid units. */
export interface Footprint {
  w: number;
  h: number;
}

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function contentsOf(collection: unknown): unknown[] {
  const c = rec(collection);
  if (Array.isArray(collection)) return collection as unknown[];
  if (c && Array.isArray(c.contents)) return c.contents as unknown[];
  return [];
}

/** Two rectangles overlap (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  const eps = 0.5;
  return (
    a.x < b.x + b.w - eps && a.x + a.w > b.x + eps && a.y < b.y + b.h - eps && a.y + a.h > b.y + eps
  );
}

function inside(r: Rect, bounds: Rect): boolean {
  return (
    r.x >= bounds.x &&
    r.y >= bounds.y &&
    r.x + r.w <= bounds.x + bounds.w &&
    r.y + r.h <= bounds.y + bounds.h
  );
}

function centre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The candidate rectangles for one footprint, nearest the spot first. */
function candidates(grid: GridLike, anchor: Point, foot: Footprint): Rect[] {
  const w = foot.w * grid.size;
  const h = foot.h * grid.size;
  const out: Rect[] = [];
  const origin = grid.isGridless ? null : grid.getOffset(anchor);
  for (let r = 0; r <= MAX_RINGS; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (origin) {
          const tl = grid.getTopLeftPoint({ i: origin.i + di, j: origin.j + dj });
          out.push({ x: tl.x, y: tl.y, w, h });
        } else {
          const cx = anchor.x + dj * grid.size;
          const cy = anchor.y + di * grid.size;
          out.push({ x: cx - w / 2, y: cy - h / 2, w, h });
        }
      }
    }
  }
  const dist = (r: Rect): number => Math.hypot(centre(r).x - anchor.x, centre(r).y - anchor.y);
  return out.sort((a, b) => dist(a) - dist(b));
}

/**
 * Free spots for each footprint, nearest the spot first (larger tokens are packed first, so a
 * Large mount does not end up squeezed out). `null` where there was no room within
 * {@link MAX_RINGS} rings. `blocked(from, to)` reports a wall between the spot and a candidate.
 */
export function findSpots(
  grid: GridLike,
  bounds: Rect,
  occupied: Rect[],
  anchor: Point,
  footprints: Footprint[],
  blocked: (from: Point, to: Point) => boolean = (): boolean => false
): (Point | null)[] {
  const taken = [...occupied];
  const result: (Point | null)[] = footprints.map(() => null);
  const order = footprints
    .map((foot, index) => ({ foot, index }))
    .sort((a, b) => b.foot.w * b.foot.h - a.foot.w * a.foot.h || a.index - b.index);
  for (const { foot, index } of order) {
    for (const rect of candidates(grid, anchor, foot)) {
      if (!inside(rect, bounds)) continue;
      if (taken.some(t => overlaps(rect, t))) continue;
      if (blocked(anchor, centre(rect))) continue;
      taken.push(rect);
      result[index] = { x: Math.round(rect.x), y: Math.round(rect.y) };
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Foundry glue (GM client)

function viewedScene(): Rec | null {
  const scenes = rec((game as unknown as Rec).scenes);
  return rec(scenes?.current) ?? rec(scenes?.active) ?? null;
}

function canvasFor(scene: Rec): Rec | null {
  const c = rec((globalThis as Rec).canvas);
  return c && c.ready === true && rec(c.scene)?.id === scene.id ? c : null;
}

function tokenRect(token: Rec, size: number): Rect | null {
  const src = rec(token._source) ?? token;
  const x = num(src.x);
  const y = num(src.y);
  if (x === null || y === null) return null;
  return { x, y, w: (num(src.width) ?? 1) * size, h: (num(src.height) ?? 1) * size };
}

function labelOfNote(note: Rec): string | null {
  const entry = rec(note.entry);
  const page = rec(note.page);
  return str(note.text) ?? str(page?.name) ?? str(entry?.name);
}

function resolveAnchor(
  scene: Rec,
  grid: GridLike & { getCenterPoint(offset: { i: number; j: number }): Point },
  bounds: Rect,
  request: PartyPlaceRequest,
  warnings: string[]
): { x: number; y: number; label: string } {
  const at = request.at ?? 'view';
  const middle = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  if (at === 'view') {
    const c = canvasFor(scene);
    const pivot = rec(rec(c?.stage)?.pivot);
    const x = num(pivot?.x);
    const y = num(pivot?.y);
    if (x !== null && y !== null) return { x, y, label: 'around the centre of your view' };
    warnings.push("Foundry's map is not drawn, so the party goes to the middle of the scene");
    return { ...middle, label: 'in the middle of the scene' };
  }
  const target = (request.target ?? '').trim().toLowerCase();
  if (at === 'token') {
    if (!target) throw new Error('"at": "token" needs "target", the token\'s name');
    const token = contentsOf(scene.tokens)
      .map(rec)
      .find(t => (str(t?.name) ?? '').toLowerCase() === target);
    const rect = token ? tokenRect(token, grid.size) : null;
    if (!token || !rect) throw new Error(`No token named "${request.target}" on this scene`);
    return { ...centre(rect), label: `next to ${str(token.name) ?? 'the token'}` };
  }
  if (at === 'note') {
    if (!target) throw new Error('"at": "note" needs "target", the map note\'s label');
    const note = contentsOf(scene.notes)
      .map(rec)
      .find(n => n !== null && (labelOfNote(n) ?? '').toLowerCase() === target);
    const x = num(note?.x);
    const y = num(note?.y);
    if (!note || x === null || y === null) {
      throw new Error(`No map note "${request.target}" on this scene`);
    }
    return { x, y, label: `at the note "${labelOfNote(note) ?? request.target}"` };
  }
  const gx = num(request.gridX);
  const gy = num(request.gridY);
  if (gx === null || gy === null) throw new Error('"at": "grid" needs gridX and gridY');
  const point = grid.isGridless
    ? { x: (gx + 0.5) * grid.size, y: (gy + 0.5) * grid.size }
    : grid.getCenterPoint({ i: gy, j: gx });
  return { ...point, label: `around square ${gx}, ${gy}` };
}

function wallTest(scene: Rec, warnings: string[]): (from: Point, to: Point) => boolean {
  const hasWalls = contentsOf(scene.walls).length > 0;
  if (!hasWalls) return (): boolean => false;
  const backend = rec(rec(rec((globalThis as Rec).CONFIG)?.Canvas)?.polygonBackends)?.move as
    | { testCollision?: (a: Point, b: Point, o: Rec) => unknown }
    | undefined;
  if (!canvasFor(scene) || typeof backend?.testCollision !== 'function') {
    warnings.push("Walls were not checked (Foundry's map is not drawn)");
    return (): boolean => false;
  }
  return (from: Point, to: Point): boolean => {
    try {
      return Boolean(backend.testCollision?.(from, to, { type: 'move', mode: 'any' }));
    } catch {
      return false;
    }
  };
}

/** The query handler: `{ groupId, at?, target?, gridX?, gridY?, hidden? }`. */
export async function planPartyPlacement(data: unknown): Promise<PartyPlacement> {
  const request = (rec(data) ?? {}) as unknown as PartyPlaceRequest;
  const user = rec((game as unknown as Rec).user);
  if (user?.isGM !== true) throw new Error('Only a GM can place the party');
  const actors = rec((game as unknown as Rec).actors) as { get?: (id: string) => unknown } | null;
  const group = rec(actors?.get?.(String(request.groupId ?? '')));
  if (!group || group.type !== 'group')
    throw new Error(`No group actor with id "${request.groupId}"`);
  const scene = viewedScene();
  if (!scene) throw new Error('No scene is being viewed: open the scene in Foundry first');
  const grid = scene.grid as GridLike & {
    getCenterPoint(offset: { i: number; j: number }): Point;
  };
  const dims = rec(scene.dimensions);
  const sr = rec(dims?.sceneRect);
  if (!grid || typeof grid.size !== 'number' || !sr) throw new Error('The scene has no dimensions');
  const bounds: Rect = {
    x: num(sr.x) ?? 0,
    y: num(sr.y) ?? 0,
    w: num(sr.width) ?? 0,
    h: num(sr.height) ?? 0,
  };
  const warnings: string[] = [];
  const anchor = resolveAnchor(scene, grid, bounds, request, warnings);

  const sceneTokens = contentsOf(scene.tokens)
    .map(rec)
    .filter((t): t is Rec => t !== null);
  const onScene = new Set(
    sceneTokens.map(t => str(t.actorId)).filter((id): id is string => id !== null)
  );
  const occupied = sceneTokens
    .map(t => tokenRect(t, grid.size))
    .filter((r): r is Rect => r !== null);

  const toPlace: Rec[] = [];
  const skipped: PartyPlacement['skipped'] = [];
  for (const entry of contentsOf(rec(group.system)?.members)) {
    const actor = rec(rec(entry)?.actor);
    if (!actor || typeof actor.id !== 'string') continue;
    const name = str(actor.name) ?? actor.id;
    if (onScene.has(actor.id)) skipped.push({ name, reason: 'already on this scene' });
    else toPlace.push(actor);
  }

  const footprints = toPlace.map(actor => {
    const proto = rec(actor.prototypeToken);
    return { w: num(proto?.width) ?? 1, h: num(proto?.height) ?? 1 };
  });
  const spots = findSpots(grid, bounds, occupied, anchor, footprints, wallTest(scene, warnings));

  const tokens: PartyPlacement['tokens'] = [];
  for (const [index, actor] of toPlace.entries()) {
    const name = str(actor.name) ?? String(actor.id);
    const spot = spots[index];
    if (!spot) {
      skipped.push({ name, reason: 'no free room near the spot' });
      continue;
    }
    const getDoc = actor.getTokenDocument as
      | ((d: Rec, o: Rec) => Promise<{ toObject(): Rec }>)
      | undefined;
    if (typeof getDoc !== 'function') {
      skipped.push({ name, reason: 'Foundry gave no token for this actor' });
      continue;
    }
    const doc = await getDoc.call(
      actor,
      { x: spot.x, y: spot.y, hidden: request.hidden === true },
      { parent: scene }
    );
    const tokenData = doc.toObject();
    delete tokenData._id;
    tokens.push({ actorId: String(actor.id), name, data: tokenData });
  }

  return {
    scene: {
      sceneId: String(scene.id),
      uuid: String(scene.uuid),
      name: str(scene.name) ?? String(scene.id),
    },
    anchor,
    tokens,
    skipped,
    warnings,
  };
}

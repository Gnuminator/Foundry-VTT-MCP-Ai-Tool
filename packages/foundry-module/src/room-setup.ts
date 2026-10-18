/**
 * Room setup plans (I-133): the module's read-only `planRoomSetup` query turns one
 * `plan-room-setup` request into guarded ops (Region and Token creates). Nothing is written
 * here; the backend stores the ops as a plan and `apply-planned-change` runs them, `undo-change`
 * deletes what they made.
 *
 * - teleport: a rectangle Region with Foundry 14's `teleportToken` behavior pointing at a second
 *   rectangle Region (same scene or another). Both are created in one plan with ids made now, so
 *   the behavior can name its destination; `twoWay` adds the way back on the arrival Region.
 * - spawn: Foundry 14 has no spawn-token Region behavior, so this creates a labelled room Region
 *   and the tokens, each set on a free square inside it (hidden unless asked otherwise).
 *
 * Sizes are in grid squares; the scene's own grid turns them into pixels. The wire contract is
 * `shared/src/room-setup.ts`; only its types are imported (the browser cannot resolve
 * `@gnuminator/shared` at runtime). The names are mirrored here and pinned by `room-setup.test.ts`.
 */
import type {
  GuardedOp,
  RoomArea,
  RoomRegionSummary,
  RoomSetupPlan,
  RoomSetupRequest,
  RoomSpawnRequest,
  RoomTeleportRequest,
} from '@gnuminator/shared';

import { MODULE_ID } from './constants.js';
import { findSpots, type GridLike, type Rect } from './party-place.js';
import { currentLevelId, sceneHasLevels } from './systems/core.js';

/** Query name (mirror of the shared `ROOM_SETUP_QUERY`). */
export const ROOM_SETUP_QUERY = 'planRoomSetup';

/** Feature id (mirror of the shared `ROOM_SETUP_FEATURE_ID`). */
export const ROOM_SETUP_FEATURE_ID = 'room-setup';

const MAX_SQUARES = 100;
const MAX_TOKENS = 40;
const PLACEMENTS = ['random', 'center', 'relative'];

type Rec = Record<string, unknown>;

/** The parts of a Scene this planner reads (the Foundry classes are typed for the full API). */
interface SceneLike {
  id: string;
  name: string;
  uuid: string;
  grid?: { size?: number; isGridless?: boolean; type?: number };
  dimensions?: { sceneRect?: { x?: number; y?: number; width?: number; height?: number } };
  tokens?: unknown;
}

/** The parts of an Actor the spawn reads. */
interface ActorLike {
  id: string;
  name?: string;
  prototypeToken?: { width?: number; height?: number };
  getTokenDocument?: (data: Rec, options: Rec) => Promise<{ toObject(): Rec }>;
}

interface Globals {
  foundry?: { utils?: { randomID?: (length: number) => string } };
  CONST?: { REGION_VISIBILITY?: { GAMEMASTER?: number } };
  game: {
    user?: { isGM?: boolean };
    actors?: { get?: (id: string) => ActorLike | undefined; contents?: ActorLike[] };
    scenes?: {
      get?: (id: string) => SceneLike | undefined;
      current?: SceneLike;
      contents?: SceneLike[];
    };
  };
}

const globals = (): Globals => globalThis as unknown as Globals;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function contentsOf(collection: unknown): Rec[] {
  if (Array.isArray(collection)) return collection as Rec[];
  const c = rec(collection);
  return c && Array.isArray(c.contents) ? (c.contents as Rec[]) : [];
}

function quoted(name: unknown): string {
  return `"${typeof name === 'string' ? name : ''}"`;
}

function newId(): string {
  const randomID = globals().foundry?.utils?.randomID;
  if (typeof randomID === 'function') return randomID(16);
  // Foundry always has randomID; this fallback is for the test harness and uses the platform CSPRNG.
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function requireGm(): void {
  if (globals().game.user?.isGM !== true) throw new Error('Only a GM can plan room setup');
}

/** A scene by id or name; the viewed scene when none is given. */
function resolveScene(ref: string | undefined): SceneLike {
  const scenes = globals().game.scenes;
  let scene: SceneLike | undefined;
  if (ref) {
    const wanted = ref.toLowerCase();
    scene = scenes?.get?.(ref);
    if (!scene) {
      const all = Array.isArray(scenes?.contents)
        ? scenes.contents
        : (contentsOf(scenes) as unknown as SceneLike[]);
      const named = all.filter(s => String(s.name ?? '').toLowerCase() === wanted);
      if (named.length > 1) {
        throw new Error(`${named.length} scenes are named "${ref}": give the scene id instead`);
      }
      scene = named[0];
    }
    if (!scene) throw new Error(`No scene "${ref}"`);
  } else {
    scene = scenes?.current;
    if (!scene) throw new Error('No scene is being viewed: open the scene in Foundry first');
  }
  return scene;
}

function sceneGrid(scene: SceneLike): GridLike & { isGridless?: boolean } {
  const grid = scene.grid;
  if (!grid || typeof grid.size !== 'number' || grid.size <= 0) {
    throw new Error(`The scene ${quoted(scene.name)} has no grid size`);
  }
  if (typeof grid.type === 'number' && grid.type > 1) {
    throw new Error(
      `${quoted(scene.name)} has a hex grid: room setup counts square grid cells, so it supports square and gridless scenes only`
    );
  }
  return grid as unknown as GridLike & { isGridless?: boolean };
}

/**
 * An actor by id, then exact name (any case), then a name that contains the text when only one
 * does. Several partial matches are listed instead of picking one ("wolf" must not become "Dire
 * Wolf" or "Werewolf" by luck).
 */
function resolveActor(ref: string): { actor: ActorLike } | { reason: string } {
  const actors = globals().game.actors;
  const byId = actors?.get?.(ref);
  if (byId) return { actor: byId };
  const all = Array.isArray(actors?.contents) ? actors.contents : [];
  const wanted = ref.toLowerCase();
  const exact = all.filter(a => (a.name ?? '').toLowerCase() === wanted);
  if (exact.length === 1) return { actor: exact[0] };
  if (exact.length > 1) {
    return { reason: `${exact.length} actors are named exactly that: give the actor id` };
  }
  const partial = all.filter(a => (a.name ?? '').toLowerCase().includes(wanted));
  if (partial.length === 1) return { actor: partial[0] };
  if (partial.length > 1) {
    const names = partial.map(a => a.name ?? a.id).slice(0, 5);
    return { reason: `several actors match (${names.join(', ')}): give the exact name or id` };
  }
  return { reason: 'no actor with that id or name' };
}

function checkArea(area: unknown, label: string): RoomArea {
  const a = rec(area);
  if (!a) throw new Error(`${label} needs x, y, width and height in grid squares`);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isInteger(a[key]))
      throw new Error(`${label}.${key} must be a whole number of squares`);
  }
  const { x, y, width, height } = a as unknown as RoomArea;
  if (x < 0 || y < 0) throw new Error(`${label}: x and y count from 0 at the top left`);
  if (width < 1 || height < 1 || width > MAX_SQUARES || height > MAX_SQUARES) {
    throw new Error(`${label}: width and height must be 1 to ${MAX_SQUARES} squares`);
  }
  return a as unknown as RoomArea;
}

/** The pixel rectangle of an area on a scene, and a warning when it leaves the map. */
function areaRect(scene: SceneLike, area: RoomArea, label: string, warnings: string[]): Rect {
  const grid = sceneGrid(scene);
  const size = grid.size;
  // Square 0,0 is the top left of the map (the scene rectangle), not of Foundry's padded canvas.
  const sceneRect = scene.dimensions?.sceneRect;
  const origin = {
    x: (sceneRect?.x ?? 0) + area.x * size,
    y: (sceneRect?.y ?? 0) + area.y * size,
  };
  const rect: Rect = {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    w: area.width * size,
    h: area.height * size,
  };
  const sr = sceneRect;
  if (sr && typeof sr.width === 'number' && typeof sr.height === 'number') {
    const right = (sr.x ?? 0) + sr.width;
    const bottom = (sr.y ?? 0) + sr.height;
    if (rect.x + rect.w > right + 1 || rect.y + rect.h > bottom + 1) {
      warnings.push(`${label} reaches past the edge of ${quoted(scene.name)}`);
    }
  }
  if (grid.isGridless === true)
    warnings.push(`${quoted(scene.name)} has no grid; squares are ${size} px`);
  return rect;
}

function levelsFor(scene: SceneLike): string[] | undefined {
  if (!sceneHasLevels(scene as unknown as Scene)) return undefined;
  if (globals().game.scenes?.current?.id !== scene.id) return undefined; // every level
  const id = currentLevelId(scene as unknown as Scene);
  return id ? [id] : undefined;
}

/** Room and teleport regions are for the GM: players must not see a box round hidden monsters. */
function visibilityGm(): number {
  return globals().CONST?.REGION_VISIBILITY?.GAMEMASTER ?? 1;
}

/** `create` data of a rectangle room Region (id fixed so a teleport can name it). */
function regionData(
  scene: SceneLike,
  id: string,
  name: string,
  rect: Rect,
  color: string,
  behaviors: Rec[]
): Rec {
  const data: Rec = {
    _id: id,
    name,
    color,
    shapes: [
      { type: 'rectangle', x: rect.x, y: rect.y, width: rect.w, height: rect.h, rotation: 0 },
    ],
    elevation: { bottom: null, top: null },
    restriction: { enabled: false, type: 'move', priority: 0 },
    visibility: visibilityGm(),
    highlightMode: 'shapes',
    displayMeasurements: false,
    hidden: false,
    locked: false,
    behaviors,
    flags: { [MODULE_ID]: { roomSetup: true } },
  };
  const levels = levelsFor(scene);
  if (levels) data.levels = levels;
  return data;
}

function teleportBehavior(
  destinationUuids: string[],
  request: RoomTeleportRequest,
  name: string
): Rec {
  return {
    _id: newId(),
    type: 'teleportToken',
    name,
    system: {
      destinations: destinationUuids,
      placement: request.placement ?? 'center',
      snap: true,
      choice: request.choice === true,
      revealed: false,
    },
  };
}

function planTeleport(request: RoomTeleportRequest): RoomSetupPlan {
  const from = checkArea(request.from, 'from');
  const to = checkArea(request.to, 'to');
  if (request.placement !== undefined && !PLACEMENTS.includes(request.placement)) {
    throw new Error(`placement must be one of ${PLACEMENTS.join(', ')}`);
  }
  const fromScene = resolveScene(from.scene);
  const toScene = resolveScene(to.scene);
  const warnings: string[] = [];
  const fromRect = areaRect(fromScene, from, 'from', warnings);
  const toRect = areaRect(toScene, to, 'to', warnings);
  if (
    fromScene.id === toScene.id &&
    fromRect.x < toRect.x + toRect.w &&
    toRect.x < fromRect.x + fromRect.w &&
    fromRect.y < toRect.y + toRect.h &&
    toRect.y < fromRect.y + fromRect.h
  ) {
    throw new Error('The entry and the arrival overlap: a token would be teleported again at once');
  }

  const name = (request.name ?? '').trim() || 'Teleport';
  const entryId = newId();
  const arrivalId = newId();
  const entryUuid = `${String(fromScene.uuid)}.Region.${entryId}`;
  const arrivalUuid = `${String(toScene.uuid)}.Region.${arrivalId}`;

  const entry = regionData(fromScene, entryId, name, fromRect, '#4488ff', [
    teleportBehavior([arrivalUuid], request, `${name} (teleport)`),
  ]);
  const arrival = regionData(
    toScene,
    arrivalId,
    `${name} (arrival)`,
    toRect,
    '#44cc88',
    request.twoWay ? [teleportBehavior([entryUuid], request, `${name} (back)`)] : []
  );
  if (request.twoWay) {
    warnings.push(
      'Two-way: a token that arrives lands inside the other region; Foundry does not teleport it again until it moves in from outside'
    );
  }

  const ops: GuardedOp[] = [
    {
      kind: 'create',
      documentName: 'Region',
      parentUuid: String(fromScene.uuid),
      data: entry,
      keepId: true,
    },
    {
      kind: 'create',
      documentName: 'Region',
      parentUuid: String(toScene.uuid),
      data: arrival,
      keepId: true,
    },
  ];
  const regions: RoomRegionSummary[] = [
    {
      name,
      sceneName: String(fromScene.name),
      squares: [from.x, from.y, from.width, from.height],
      role: 'entry',
    },
    {
      name: `${name} (arrival)`,
      sceneName: String(toScene.name),
      squares: [to.x, to.y, to.width, to.height],
      role: 'arrival',
    },
  ];
  const where =
    fromScene.id === toScene.id
      ? `on ${quoted(fromScene.name)}`
      : `from ${quoted(fromScene.name)} to ${quoted(toScene.name)}`;
  return {
    summary: `Add a ${request.twoWay ? 'two-way ' : ''}teleport ${quoted(name)} ${where}`,
    ops,
    regions,
    warnings,
  };
}

async function planSpawn(request: RoomSpawnRequest): Promise<RoomSetupPlan> {
  const name = (request.name ?? '').trim();
  if (!name) throw new Error('A spawn needs a room name');
  const area = checkArea(request.area, 'area');
  if (!Array.isArray(request.creatures) || request.creatures.length === 0) {
    throw new Error('A spawn needs at least one creature: { actor, count }');
  }
  const scene = resolveScene(area.scene);
  const warnings: string[] = [];
  const rect = areaRect(scene, area, 'area', warnings);
  const grid = sceneGrid(scene);

  const wanted: { actor: ActorLike; name: string }[] = [];
  const skipped: NonNullable<RoomSetupPlan['skipped']> = [];
  for (const entry of request.creatures) {
    const ref = String(entry?.actor ?? '').trim();
    const count = entry?.count ?? 1;
    if (!ref) throw new Error('Each creature needs an actor id or name');
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error(`Creature "${ref}": count must be 1 to 20`);
    }
    const found = resolveActor(ref);
    if (!('actor' in found)) {
      skipped.push({ name: ref, reason: found.reason });
      continue;
    }
    const actor = found.actor;
    for (let i = 0; i < count; i++) wanted.push({ actor, name: actor.name ?? ref });
  }
  if (wanted.length === 0)
    throw new Error(`None of the creatures exist: ${skipped.map(s => s.name).join(', ')}`);
  if (wanted.length > MAX_TOKENS) throw new Error(`One plan places at most ${MAX_TOKENS} tokens`);

  const occupied: Rect[] = contentsOf(scene.tokens).flatMap(t => {
    const src = (rec(t._source) ?? t) as {
      x?: unknown;
      y?: unknown;
      width?: number;
      height?: number;
    };
    return typeof src.x === 'number' && typeof src.y === 'number'
      ? [{ x: src.x, y: src.y, w: (src.width ?? 1) * grid.size, h: (src.height ?? 1) * grid.size }]
      : [];
  });
  const footprints = wanted.map(w => ({
    w: Number(w.actor.prototypeToken?.width) || 1,
    h: Number(w.actor.prototypeToken?.height) || 1,
  }));
  const anchor = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const spots = findSpots(grid, rect, occupied, anchor, footprints);

  const asScene = scene as unknown as Scene;
  const level = sceneHasLevels(asScene) ? currentLevelId(asScene) : undefined;
  const hidden = request.hidden !== false;
  const roomId = newId();
  const ops: GuardedOp[] = [
    {
      kind: 'create',
      documentName: 'Region',
      parentUuid: String(scene.uuid),
      data: regionData(scene, roomId, name, rect, '#cc8844', []),
      keepId: true,
    },
  ];
  const tokens: NonNullable<RoomSetupPlan['tokens']> = [];
  for (const [index, entry] of wanted.entries()) {
    const spot = spots[index];
    if (!spot) {
      skipped.push({ name: entry.name, reason: 'no free square left in the room' });
      continue;
    }
    const getDoc = entry.actor.getTokenDocument;
    if (typeof getDoc !== 'function') {
      skipped.push({ name: entry.name, reason: 'Foundry gave no token for this actor' });
      continue;
    }
    const doc = await getDoc.call(entry.actor, { x: spot.x, y: spot.y, hidden }, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    if (level) data.level = level;
    ops.push({ kind: 'create', documentName: 'Token', parentUuid: String(scene.uuid), data });
    tokens.push({ name: entry.name, actorId: entry.actor.id, x: spot.x, y: spot.y });
  }
  if (tokens.length === 0) {
    throw new Error('No creature fits in the room: make the area bigger or clear some tokens');
  }
  if (skipped.length > 0) warnings.push(`${skipped.length} creature(s) left out, see skipped`);

  return {
    summary: `Set up the room ${quoted(name)} on ${quoted(scene.name)} with ${tokens.length} ${hidden ? 'hidden ' : ''}token${tokens.length === 1 ? '' : 's'}`,
    ops,
    regions: [
      {
        name,
        sceneName: String(scene.name),
        squares: [area.x, area.y, area.width, area.height],
        role: 'room',
      },
    ],
    tokens,
    ...(skipped.length > 0 ? { skipped } : {}),
    warnings,
  };
}

/** Build the plan for one request. Throws when nothing would change. */
export async function planRoomSetup(data: unknown): Promise<RoomSetupPlan> {
  requireGm();
  const request = data as RoomSetupRequest | null | undefined;
  switch (request?.action) {
    case 'teleport':
      return planTeleport(request);
    case 'spawn':
      return await planSpawn(request);
    default:
      throw new Error(`Unknown action "${String(rec(data)?.action)}"`);
  }
}

/**
 * NPC turn assistant (I-125, ships off): the module's read-only `planNpcTurn` query. It reads the
 * running combat and the NPC whose turn it is, and, when asked for a move, finds the way (walls,
 * closed doors, hostile creatures and difficult terrain counted), validates the square and builds
 * the guarded ops through the same token-move planner as `plan-token-change`. Nothing is written
 * here; the backend stores the ops as a guarded plan under the `npc-turn` switch.
 *
 * The wire contract is `shared/src/npc-turn.ts`; only its types are imported (the browser cannot
 * resolve `@gnuminator/shared` at runtime). The query and feature names are mirrored here and
 * pinned by `npc-turn.test.ts`. The grid maths is in `npc-turn-grid.ts`.
 *
 * Square grids only (hex and gridless scenes are refused). Diagonals follow the world's
 * `gridDiagonals` setting. Walking only: flying, climbing and teleporting are not planned.
 */
import type {
  GuardedOp,
  NpcTurnAction,
  NpcTurnAttack,
  NpcTurnContext,
  NpcTurnPlan,
  NpcTurnTarget,
} from '@gnuminator/shared';

import { planTokenChange } from './live-plan-token.js';
import {
  DIAGONAL_LABELS,
  DIAGONALS,
  cheapestAt,
  gapSquares,
  lineSquares,
  overlaps,
  pathOf,
  reachable,
  tidy,
  type Footprint,
  type ReachNode,
} from './npc-turn-grid.js';

/** Query name (mirror of the shared `NPC_TURN_QUERY`). */
export const NPC_TURN_QUERY = 'planNpcTurn';

/** Feature id (mirror of the shared `NPC_TURN_FEATURE_ID`). */
export const NPC_TURN_FEATURE_ID = 'npc-turn';

type Rec = Record<string, unknown>;
type Point = { x: number; y: number };

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
function path(source: unknown, keys: string): unknown {
  let cur: unknown = source;
  for (const key of keys.split('.')) {
    const r = rec(cur);
    if (!r) return undefined;
    cur = r[key];
  }
  return cur;
}

/** Foundry's `CONST.GRID_TYPES.SQUARE`; hex grids are 2 to 5, gridless is 0. */
const GRID_SQUARE = 1;

/** Metres, feet and so on, in feet, for speeds kept in other units than the scene. */
const UNIT_FEET: Record<string, number> = {
  ft: 1,
  yd: 3,
  mi: 5280,
  m: 3.28084,
  km: 3280.84,
};

function unitKey(units: string): string {
  return units
    .toLowerCase()
    .replace(/[.\s]/g, '')
    .replace(/^(feet|foot)$/, 'ft')
    .replace(/^(meters?|metres?)$/, 'm')
    .replace(/^miles?$/, 'mi');
}

interface SceneInfo {
  id: string;
  name: string;
  size: number;
  distance: number;
  units: string;
  /** The `gridDiagonals` rule. */
  rule: number;
  /** The playable area in squares ([x0, x1) by [y0, y1)); null when the scene gives none. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  tokens: Rec[];
  raw: Rec;
}

function diagonalRule(grid: Rec | null): number {
  const own = num(grid?.diagonals);
  if (own !== null) return own;
  try {
    const settings = rec(rec(game)?.settings) as { get?: (m: string, k: string) => unknown } | null;
    return num(settings?.get?.('core', 'gridDiagonals')) ?? DIAGONALS.EQUIDISTANT;
  } catch {
    return DIAGONALS.EQUIDISTANT;
  }
}

function currentScene(): SceneInfo {
  const scenes = rec(rec(game)?.scenes);
  const scene = rec(scenes?.current) ?? rec(scenes?.active);
  if (!scene) throw new Error('No current scene: open the scene with the fight first');
  const grid = rec(scene.grid);
  const type = num(grid?.type);
  if (type !== null && type !== GRID_SQUARE) {
    throw new Error(
      `${str(scene.name) ?? 'This scene'} has ${type === 0 ? 'no grid' : 'a hex grid'}: the NPC turn assistant plans on square grids only`
    );
  }
  const size = num(grid?.size) ?? 100;
  const sceneRect = rec(path(scene, 'dimensions.sceneRect'));
  const rx = num(sceneRect?.x);
  const ry = num(sceneRect?.y);
  const rw = num(sceneRect?.width);
  const rh = num(sceneRect?.height);
  const bounds =
    rx !== null && ry !== null && rw !== null && rh !== null
      ? {
          x0: Math.ceil(rx / size - 1e-6),
          y0: Math.ceil(ry / size - 1e-6),
          x1: Math.floor((rx + rw) / size + 1e-6),
          y1: Math.floor((ry + rh) / size + 1e-6),
        }
      : null;
  return {
    id: str(scene.id) ?? '',
    name: str(scene.name) ?? 'the scene',
    size,
    distance: num(grid?.distance) ?? 5,
    units: str(grid?.units) ?? 'ft',
    rule: diagonalRule(grid),
    bounds,
    tokens: contentsOf(scene.tokens)
      .map(rec)
      .filter((t): t is Rec => t !== null),
    raw: scene,
  };
}

/** True when a combat belongs to the scene (a combat with no scene counts for any). */
function onScene(combat: Rec, scene: SceneInfo): boolean {
  const id = str(rec(combat.scene)?.id) ?? str(combat.scene);
  return id === null || id === scene.id;
}

/** The fight on the viewed scene: the active one, else the latest one on that scene. */
function fight(scene: SceneInfo): Rec | null {
  const g = rec(game);
  const active = rec(g?.combat);
  if (active && onScene(active, scene)) return active;
  const here = contentsOf(g?.combats)
    .map(rec)
    .filter((c): c is Rec => c !== null && onScene(c, scene));
  return here.filter(c => c.started === true).pop() ?? here.pop() ?? null;
}

/** A token's stored top-left square and size in squares (Foundry 14 doc.x/y lag during a move). */
function rectOf(scene: SceneInfo, token: Rec): Footprint {
  const source = rec(token._source);
  const x = num(source?.x) ?? num(token.x) ?? 0;
  const y = num(source?.y) ?? num(token.y) ?? 0;
  return {
    x: Math.round(x / scene.size),
    y: Math.round(y / scene.size),
    w: Math.max(1, Math.round(num(token.width) ?? 1)),
    h: Math.max(1, Math.round(num(token.height) ?? 1)),
  };
}

function findToken(scene: SceneInfo, identifier: string): Rec {
  const id = identifier.trim();
  const lower = id.toLowerCase();
  const byId = scene.tokens.find(t => t.id === id);
  if (byId) return byId;
  const byName = scene.tokens.filter(t => str(t.name)?.toLowerCase() === lower);
  if (byName.length > 1) {
    throw new Error(
      `Several tokens are named "${id}" on ${scene.name}: use the id (${byName.map(t => String(t.id)).join(', ')})`
    );
  }
  if (!byName[0]) throw new Error(`No token named "${id}" on the current scene (${scene.name})`);
  return byName[0];
}

/** A player-owned actor (a familiar, a companion): the table moves it, not the assistant. */
function hasPlayerOwner(actor: Rec): boolean {
  return actor.hasPlayerOwner === true;
}

function actorOf(token: Rec): Rec | null {
  return rec(token.actor);
}

/** Foundry 14 levels: tokens on other levels of the same scene are out of the NPC's reach. */
function sameLevel(a: Rec, b: Rec): boolean {
  const la = str(a.level);
  const lb = str(b.level);
  return la === null || lb === null || la === lb;
}

/** The NPC's usable items: those with an attack, save or damage activity. */
function actionsOf(actor: Rec, scene: SceneInfo): NpcTurnAction[] {
  const out: NpcTurnAction[] = [];
  for (const raw of contentsOf(actor.items)) {
    const item = rec(raw);
    const name = str(item?.name);
    if (!item || !name) continue;
    const activities = contentsOf(path(item, 'system.activities'))
      .map(rec)
      .filter((a): a is Rec => a !== null);
    const types = [...new Set(activities.map(a => str(a.type)).filter((t): t is string => !!t))];
    if (!types.some(t => ['attack', 'save', 'damage'].includes(t))) continue;
    const range = rec(path(item, 'system.range'));
    const reach = num(range?.reach);
    // dnd5e 6 feats keep the range on the activity, weapons on the item. A weapon's prepared
    // activity range is its long range, so the item's own value wins.
    const activityRange = activities
      .filter(a => ['attack', 'save', 'damage'].includes(str(a.type) ?? ''))
      .map(a => rec(a.range))
      .find(r => num(r?.value) !== null && (str(r?.units) ?? 'ft') === 'ft');
    const value = num(range?.value) ?? num(activityRange?.value);
    const long = num(range?.long);
    const properties = path(item, 'system.properties');
    const thrown =
      properties !== null &&
      typeof properties === 'object' &&
      (Array.isArray(properties)
        ? properties
        : Array.from(properties as Iterable<unknown>)
      ).includes('thr');
    const meleeActivity = activities.some(a => path(a, 'attack.type.value') === 'melee');
    const melee = meleeActivity || thrown || (reach !== null && value === null);
    const rangeFt = melee ? (reach ?? (thrown ? null : value) ?? scene.distance) : (value ?? reach);
    // A thrown weapon also reaches its throwing range.
    const longRangeFt = thrown ? (long ?? value) : melee ? null : long;
    out.push({ name, activityTypes: types, rangeFt, longRangeFt, melee });
  }
  return out;
}

/** The text of a Multiattack feature, without markup, cut to a readable length. */
function multiattackOf(actor: Rec): string | null {
  for (const raw of contentsOf(actor.items)) {
    const item = rec(raw);
    if (!item || !/^multiattack/i.test(str(item.name) ?? '')) continue;
    const html = str(path(item, 'system.description.value'));
    if (!html) return 'Multiattack (no description)';
    // Foundry enrichers ([[/item .id]]{Label}, @UUID[...]{Label}) keep their label only.
    // `@UUID[...]{Label}` and `&Reference[prone]` keep their label, or the text in the brackets.
    const entities: Record<string, string> = {
      nbsp: ' ',
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    const text = html
      .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
      .replace(
        /[@&]\w+\[([^\]]*)\](?:\{([^}]*)\})?/g,
        (_m, inner: string, label?: string) => label ?? inner
      )
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(
        /&(?:#(\d{1,6})|#x([0-9a-f]{1,5})|(\w+));/gi,
        (m, dec?: string, hex?: string, name?: string) => {
          if (dec || hex)
            return String.fromCodePoint(dec ? Number(dec) : parseInt(hex as string, 16));
          return entities[(name as string).toLowerCase()] ?? m;
        }
      )
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 700 ? `${text.slice(0, 697)}...` : text;
  }
  return null;
}

/** Speed in the scene's units; throws when the actor's movement units cannot be compared. */
function speedOf(actor: Rec, scene: SceneInfo, tokenName: string): number | null {
  const raw = num(
    path(actor, 'system.attributes.movement.speeds.walk') ??
      path(actor, 'system.attributes.movement.walk')
  );
  if (raw === null) return null;
  const from = str(path(actor, 'system.attributes.movement.units'));
  if (!from || unitKey(from) === unitKey(scene.units)) return raw;
  const a = UNIT_FEET[unitKey(from)];
  const b = UNIT_FEET[unitKey(scene.units)];
  if (a === undefined || b === undefined) {
    throw new Error(
      `${tokenName}'s speed is in ${from} but the scene measures in ${scene.units}: set them to the same unit`
    );
  }
  return tidy((raw * a) / b);
}

interface Walls {
  /** True when a wall or closed door lies between the two points. */
  blocked(a: Point, b: Point): boolean;
  /** How the walls were read, for the notes; null when the scene has none. */
  source: 'foundry' | 'scene data' | null;
}

function canvasShows(scene: SceneInfo): boolean {
  const c = rec((globalThis as Rec).canvas);
  return c?.ready === true && rec(c.scene)?.id === scene.id;
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

/** Walls that stop movement: Foundry's own collision test when the map is drawn, else the data. */
function wallsOf(scene: SceneInfo): Walls {
  const walls = contentsOf(scene.raw.walls)
    .map(rec)
    .filter((w): w is Rec => w !== null);
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
  if (canvasShows(scene) && typeof backend?.testCollision === 'function') {
    return {
      blocked: (a, b): boolean => {
        try {
          return Boolean(backend.testCollision?.(a, b, { type: 'move', mode: 'any' }));
        } catch {
          return fromData(a, b);
        }
      },
      source: 'foundry',
    };
  }
  return { blocked: fromData, source: 'scene data' };
}

interface Terrain {
  /** Movement cost multiplier at a point (regions that modify the cost of walking stack). */
  at(point: Point, elevation: number): number;
  any: boolean;
}

/** A Set, an array or a collection of strings, as strings. */
function stringsOf(value: unknown): string[] {
  return contentsOf(value).filter((v): v is string => typeof v === 'string');
}

/** The dnd5e movement automation setting is "none": its Difficult Terrain no longer costs extra. */
function dnd5eMovementAutomationOff(): boolean {
  try {
    const settings = rec(rec(game)?.settings) as { get?: (m: string, k: string) => unknown } | null;
    return settings?.get?.('dnd5e', 'movementAutomation') === 'none';
  } catch {
    return false;
  }
}

/**
 * What it costs this token to walk. Core movement-cost behaviors multiply (as Foundry does);
 * dnd5e's own Difficult Terrain behavior (`dnd5e.difficultTerrain`, also what Spike Growth or Web
 * create) adds 1 to that product once however many such regions overlap (so 2x core plus it is 3x),
 * unless the region ignores this disposition or the actor ignores its kind of difficult terrain.
 */
function terrainOf(scene: SceneInfo, token: Rec, actor: Rec): Terrain {
  const regions = contentsOf(scene.raw.regions)
    .map(rec)
    .filter((r): r is Rec => r !== null);
  const level = str(token.level);
  const disposition = num(token.disposition);
  const ignored = stringsOf(path(actor, 'system.attributes.movement.ignoredDifficultTerrain'));
  const dndOn = !dnd5eMovementAutomationOff() && disposition !== -2 && !ignored.includes('all');
  const costly: Array<{ region: Rec; factor: number }> = [];
  const difficult: Rec[] = [];
  for (const region of regions) {
    if (level !== null && typeof region.includedInLevel === 'function') {
      try {
        if (!(region.includedInLevel as (id: string) => unknown).call(region, level)) continue;
      } catch {
        // A region that cannot say counts as on this level.
      }
    }
    for (const raw of contentsOf(region.behaviors)) {
      const behavior = rec(raw);
      if (!behavior || behavior.disabled === true) continue;
      if (behavior.type === 'modifyMovementCost') {
        const factor = num(path(behavior, 'system.difficulties.walk')) ?? 1;
        if (factor !== 1) costly.push({ region, factor });
      } else if (behavior.type === 'dnd5e.difficultTerrain' && dndOn) {
        const types = stringsOf(path(behavior, 'system.types'));
        const magical = path(behavior, 'system.magical') === true;
        const skipped =
          (disposition !== null &&
            contentsOf(path(behavior, 'system.ignoredDispositions')).includes(disposition)) ||
          (types.length > 0 && types.every(t => ignored.includes(t))) ||
          (magical && ignored.includes('magical')) ||
          (!magical && ignored.includes('nonmagical'));
        if (!skipped) difficult.push(region);
      }
    }
  }
  const inside = (region: Rec, point: Point, elevation: number): boolean => {
    try {
      const test = region.testPoint as ((p: Point & { elevation: number }) => unknown) | undefined;
      return typeof test === 'function' && Boolean(test.call(region, { ...point, elevation }));
    } catch {
      // A region that cannot be tested counts as flat ground.
      return false;
    }
  };
  return {
    any: costly.length > 0 || difficult.length > 0,
    at(point, elevation): number {
      let total = 1;
      for (const { region, factor } of costly) {
        if (inside(region, point, elevation)) total *= factor;
      }
      if (difficult.some(region => inside(region, point, elevation))) {
        total += 1;
      }
      return total;
    },
  };
}

function squareLabel(x: number, y: number): string {
  return `(${x},${y})`;
}

/** Read the fight and, with `moveTo`, plan the NPC's move. Throws a plain message on a refusal. */
export function planNpcTurn(data: unknown): NpcTurnPlan {
  const system = rec(rec(game)?.system);
  if (system && system.id !== 'dnd5e') throw new Error('The NPC turn assistant needs dnd5e');
  const request = rec(data) ?? {};
  const scene = currentScene();
  const combat = fight(scene);
  if (combat?.started !== true) {
    throw new Error(`No running combat on ${scene.name}: start the encounter first`);
  }
  const combatants = contentsOf(combat.combatants)
    .map(rec)
    .filter((c): c is Rec => c !== null);
  const current = rec(combat.combatant) ?? rec(contentsOf(combat.turns)[num(combat.turn) ?? 0]);

  const named = str(request.token);
  const tokenId = named ? null : (str(current?.tokenId) ?? str(rec(current?.token)?.id));
  if (!named && !tokenId)
    throw new Error("It is nobody's turn: advance the combat or name a token");
  const token = named ? findToken(scene, named) : scene.tokens.find(t => t.id === tokenId);
  if (!token) throw new Error('The current combatant has no token on this scene');
  const actor = actorOf(token);
  if (!actor) throw new Error(`${str(token.name) ?? 'The token'} has no actor`);
  if (actor.type === 'character') {
    throw new Error(
      `${str(token.name) ?? 'That token'} is a player character: the assistant plans monster turns only`
    );
  }
  if (hasPlayerOwner(actor)) {
    throw new Error(
      `${str(token.name) ?? 'That token'} is player-owned: the table moves it, the assistant plans monster turns only`
    );
  }

  const tokenName = str(token.name) ?? String(token.id);
  const here = rectOf(scene, token);
  const speed = speedOf(actor, scene, tokenName);
  const dash = request.dash === true;
  const moveLimit = speed === null ? null : tidy(speed * (dash ? 2 : 1));
  const notes: string[] = [
    `Grid: ${DIAGONAL_LABELS[scene.rule] ?? 'diagonals follow the world setting'}. Walking only: flying, climbing and teleporting are not planned.`,
    'The attack roll is not part of the plan (a roll cannot be undone); the attack steps name the tools to run after applying the move.',
  ];
  if (
    current &&
    str(current.tokenId) !== String(token.id) &&
    str(rec(current.token)?.id) !== String(token.id)
  ) {
    notes.push(`It is not ${tokenName}'s turn in the tracker.`);
  }
  if (dash) notes.push('Dash: the move may use twice the speed, and the NPC gives up its attacks.');

  // Who is on the NPC's level: others cannot block it or be attacked.
  const levelTokens = scene.tokens.filter(t => t.id === token.id || sameLevel(token, t));
  const elsewhere = scene.tokens.length - levelTokens.length;
  if (elsewhere > 0) {
    notes.push(
      `${elsewhere} token${elsewhere === 1 ? ' is' : 's are'} on another level of the scene and left out.`
    );
  }
  const defeated = new Set(
    combatants
      .filter(c => c.defeated === true)
      .map(c => str(c.tokenId) ?? str(rec(c.token)?.id))
      .filter((id): id is string => id !== null)
  );
  const myDisposition = num(token.disposition) ?? -1;
  const hostileTo = (t: Rec): boolean =>
    (num(t.disposition) ?? -1) !== myDisposition && !defeated.has(String(t.id));

  const walls = wallsOf(scene);
  const terrain = terrainOf(scene, token, actor);
  if (walls.source) {
    notes.push(
      `Walls and closed doors are counted${walls.source === 'foundry' ? " (Foundry's own check)" : " (read from the scene's wall data: the map is not drawn, so a one-way wall counts as a wall)"}.`
    );
  }
  if (terrain.any) {
    notes.push('Difficult terrain (movement-cost regions) is counted for walking.');
  }

  const centre = (f: Footprint): Point => ({
    x: (f.x + f.w / 2) * scene.size,
    y: (f.y + f.h / 2) * scene.size,
  });
  const wallBetween = (a: Footprint, b: Footprint): boolean => walls.blocked(centre(a), centre(b));
  const elevation = num(token.elevation) ?? 0;
  const inBounds = (f: Footprint): boolean => {
    const b = scene.bounds;
    if (!b) return f.x >= 0 && f.y >= 0;
    return f.x >= b.x0 && f.y >= b.y0 && f.x + f.w <= b.x1 && f.y + f.h <= b.y1;
  };
  const others = levelTokens.filter(t => t.id !== token.id);
  const blockers = others.filter(hostileTo).map(t => rectOf(scene, t));
  const occupied = others.map(t => ({ t, rect: rectOf(scene, t) }));

  // Every square the NPC can walk to this turn, with the cheapest way there.
  const budget = moveLimit === null ? 0 : moveLimit / scene.distance;
  const nodes = reachable({
    start: here,
    rule: scene.rule,
    budget,
    inBounds,
    passable: f => !blockers.some(b => overlaps(f, b)),
    wallBetween,
    terrain: f => terrain.at(centre(f), elevation),
  });

  // The destination, validated.
  let after: Footprint | null = null;
  let node: ReachNode | null = null;
  const moveTo = rec(request.moveTo);
  if (moveTo) {
    const gx = num(moveTo.gridX);
    const gy = num(moveTo.gridY);
    if (gx === null || gy === null || !Number.isInteger(gx) || !Number.isInteger(gy)) {
      throw new Error('moveTo needs whole numbers gridX and gridY');
    }
    after = { ...here, x: gx, y: gy };
    if (gx < 0 || gy < 0 || !inBounds(after)) {
      throw new Error(`${squareLabel(gx, gy)} is outside the scene`);
    }
    if (moveLimit === null) throw new Error(`${tokenName} has no walking speed to plan with`);
    const straight = tidy(lineSquares(scene.rule, gx - here.x, gy - here.y) * scene.distance);
    if (straight > moveLimit) {
      throw new Error(
        `${squareLabel(gx, gy)} is ${straight} ${scene.units} from ${squareLabel(here.x, here.y)}, more than ${tokenName}'s ${dash ? 'Dash ' : ''}speed of ${moveLimit} ${scene.units}`
      );
    }
    const blocker = occupied.find(o => overlaps(after as Footprint, o.rect));
    if (blocker) {
      throw new Error(
        `${squareLabel(gx, gy)} is taken by ${str(blocker.t.name) ?? 'another token'}`
      );
    }
    node = cheapestAt(nodes, gx, gy);
    if (!node) {
      throw new Error(
        `${squareLabel(gx, gy)} cannot be reached within ${moveLimit} ${scene.units}: walls, closed doors, hostile creatures or difficult terrain are in the way`
      );
    }
  }

  // Attack options and the squares to attack from.
  const actions = actionsOf(actor, scene);
  const requested: Array<{ itemName: string; target: string }> = [];
  const itemName = str(request.itemName);
  const targetName = str(request.target);
  if (itemName || targetName) {
    if (!itemName || !targetName) throw new Error('Name both itemName and target for an attack');
    requested.push({ itemName, target: targetName });
  }
  if (Array.isArray(request.attacks)) {
    for (const entry of request.attacks) {
      const e = rec(entry);
      const i = str(e?.itemName);
      const t = str(e?.target);
      if (!i || !t) throw new Error('Each attack needs an itemName and a target');
      requested.push({ itemName: i, target: t });
    }
  }
  const findAction = (name: string): NpcTurnAction => {
    const action = actions.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!action) {
      const names = actions.map(a => a.name).join(', ') || 'none';
      throw new Error(`${tokenName} has no attack or action named "${name}" (it has: ${names})`);
    }
    return action;
  };
  const engageAction =
    (requested[0] ? findAction(requested[0].itemName) : null) ??
    actions.find(a => a.melee) ??
    actions[0] ??
    null;

  const targets = targetsOf({
    scene,
    combatants,
    npcToken: token,
    levelTokens,
    from: here,
    after,
    nodes,
    wallBetween,
    occupied: occupied.map(o => o.rect),
    action: engageAction,
    moveLimit,
  });
  const suggested = targets.slice().sort((a, b) => b.score - a.score || a.distance - b.distance)[0];

  const context: NpcTurnContext = {
    round: num(combat.round) ?? 0,
    token: { id: String(token.id), name: tokenName, gridX: here.x, gridY: here.y },
    actor: { id: str(actor.id) ?? '', name: str(actor.name) ?? tokenName },
    speed,
    moveLimit,
    units: scene.units,
    squareSize: scene.distance,
    actions,
    multiattack: multiattackOf(actor),
    engageWith: engageAction?.name ?? null,
    targets,
    suggested: suggested
      ? { tokenId: suggested.tokenId, name: suggested.name, reasons: suggested.reasons }
      : null,
    notes,
  };

  // The intended attacks, each checked against the items and the reach after the move.
  const steps: string[] = [];
  const attacks: NpcTurnAttack[] = [];
  const finalSpot = after ?? here;
  for (const asked of requested) {
    const action = findAction(asked.itemName);
    const target = context.targets.find(
      t => t.tokenId === asked.target || t.name.toLowerCase() === asked.target.toLowerCase()
    );
    if (!target) {
      const names = context.targets.map(t => t.name).join(', ') || 'none';
      throw new Error(`"${asked.target}" is not a target in this fight (targets: ${names})`);
    }
    const away = target.distanceAfterMove ?? target.distance;
    const farthest = action.longRangeFt ?? action.rangeFt;
    const inReach = farthest === null || away <= farthest;
    if (!inReach && moveTo) {
      throw new Error(
        `${action.name} reaches ${farthest} ${scene.units}, but ${target.name} would be ${away} ${scene.units} away after the move`
      );
    }
    const targetToken = scene.tokens.find(t => String(t.id) === target.tokenId);
    const blockedByWall =
      action.melee && !!targetToken && wallBetween(finalSpot, rectOf(scene, targetToken));
    if (blockedByWall && moveTo) {
      throw new Error(
        `${action.name} is a melee attack, but a wall or closed door is between ${squareLabel(finalSpot.x, finalSpot.y)} and ${target.name}`
      );
    }
    attacks.push({
      itemName: action.name,
      target: target.name,
      targetAC: target.ac,
      inReach,
      blockedByWall,
      rollWith: `use-npc-activity ${JSON.stringify({ actorName: context.token.id, itemName: action.name, ...(target.ac !== null ? { targetAC: target.ac } : {}) })}`,
      damageWith: `plan-actor-change {"action":"damage","targets":[${JSON.stringify(target.tokenId)}],"amount":<the damage the roll reported>,"damageType":"<its type>"} (use-npc-activity already doubles a critical hit's dice: do not add a multiplier)`,
    });
  }
  if (attacks.length > 1 && context.multiattack === null) {
    notes.push(
      `${tokenName} has no Multiattack feature: ${attacks.length} attacks in one turn need a reason (a bonus action, a legendary action, a spell).`
    );
  }

  // The move.
  let ops: GuardedOp[] | undefined;
  let summary: string | undefined;
  let route: NpcTurnPlan['path'];
  let moveCost: number | undefined;
  if (after && node && (after.x !== here.x || after.y !== here.y)) {
    const built = planTokenChange({
      scope: 'token',
      action: 'move',
      tokens: [String(token.id)],
      gridX: after.x,
      gridY: after.y,
    });
    ops = built.ops;
    const squares = pathOf(nodes, node);
    route = squares.map(s => ({ gridX: s.x, gridY: s.y }));
    moveCost = tidy(node.cost * scene.distance);
    const straightLine = Math.max(Math.abs(after.x - here.x), Math.abs(after.y - here.y));
    const detour = squares.length - 1 > straightLine;
    const hard = squares.slice(1).some(s => terrain.at(centre({ ...here, ...s }), elevation) > 1);
    steps.push(
      `${tokenName}: ${squareLabel(here.x, here.y)} to ${squareLabel(after.x, after.y)}, ${moveCost} ${scene.units}${dash ? ' (Dash)' : ''}${detour ? ', going round an obstacle' : ''}${hard ? ', through difficult terrain' : ''}`
    );
  } else if (after) {
    steps.push(`${tokenName} stays at ${squareLabel(here.x, here.y)}`);
  }
  attacks.forEach((a, i) => {
    steps.push(
      `${attacks.length > 1 ? `Attack ${i + 1} of ${attacks.length}: ` : 'Then '}${a.itemName} on ${a.target}${a.targetAC !== null ? ` (AC ${a.targetAC})` : ''}${a.inReach ? '' : ' (out of reach from here)'}${a.blockedByWall ? ' (a wall is in the way)' : ''}${dash ? ' (only with a bonus-action Dash)' : ''}`
    );
  });
  if (ops) {
    const why = str(request.reason);
    const names = attacks.map(a => `${a.itemName} on ${a.target}`);
    summary = `NPC turn: ${tokenName} to ${squareLabel(after!.x, after!.y)}${names.length ? `, then ${names.join(', ')}` : ''}${why ? ` (${why})` : ''}`;
  }

  return {
    context,
    ...(summary ? { summary } : {}),
    ...(ops ? { ops } : {}),
    steps,
    attack: attacks[0] ?? null,
    attacks,
    ...(route ? { path: route } : {}),
    ...(moveCost !== undefined ? { moveCost } : {}),
  };
}

interface TargetsInput {
  scene: SceneInfo;
  combatants: Rec[];
  npcToken: Rec;
  levelTokens: Rec[];
  from: Footprint;
  after: Footprint | null;
  nodes: Map<string, ReachNode>;
  wallBetween(a: Footprint, b: Footprint): boolean;
  /** Every other token's footprint (a square to stop on must be free of all of them). */
  occupied: Footprint[];
  action: NpcTurnAction | null;
  moveLimit: number | null;
}

/** The enemies on the NPC's level, with distance, state, the square to attack from and a score. */
function targetsOf(input: TargetsInput): NpcTurnTarget[] {
  const { scene, npcToken, from, after, nodes, action } = input;
  const myDisposition = num(npcToken.disposition) ?? -1;
  const out: NpcTurnTarget[] = [];
  for (const c of input.combatants) {
    if (c.defeated === true) continue;
    const token = input.levelTokens.find(
      t => t.id === str(c.tokenId) || t.id === str(rec(c.token)?.id)
    );
    if (!token || token.id === npcToken.id) continue;
    if ((num(token.disposition) ?? -1) === myDisposition) continue;
    const actor = actorOf(token);
    const rect = rectOf(scene, token);
    const hp = rec(path(actor, 'system.attributes.hp'));
    const statuses = actor?.statuses;
    const conditions = statuses ? Array.from(statuses as Iterable<unknown>).map(String) : [];
    const hpValue = num(hp?.value);
    const hpMax = num(hp?.max);
    const concentrating =
      conditions.includes('concentrating') ||
      (num(path(actor, 'concentration.effects.size')) ?? 0) > 0;

    // The cheapest square the NPC can reach this turn that lets `action` reach the target.
    let engage: NpcTurnTarget['engage'] = null;
    if (action) {
      const farthest = action.longRangeFt ?? action.rangeFt;
      let bestCost = Infinity;
      for (const n of nodes.values()) {
        if (n.cost >= bestCost) continue;
        if (input.occupied.some(o => overlaps(n.at, o))) continue;
        const away = gapSquares(scene.rule, n.at, rect) * scene.distance;
        if (farthest !== null && away > farthest) continue;
        if (action.melee && input.wallBetween(n.at, rect)) continue;
        bestCost = n.cost;
        engage = {
          gridX: n.at.x,
          gridY: n.at.y,
          cost: tidy(n.cost * scene.distance),
        };
      }
    }

    const prone = conditions.includes('prone');
    const down = hpValue !== null && hpValue <= 0;
    const reasons: string[] = [];
    let score = 0;
    if (!engage) {
      score -= 5;
      reasons.push('cannot be reached this turn');
    } else {
      score += 2;
      if (engage.cost > 0) reasons.push(`reachable by moving ${engage.cost} ${scene.units}`);
      else reasons.push('already in reach');
    }
    if (concentrating) {
      score += 3;
      reasons.push('concentrating on a spell (a hit forces a save)');
    }
    if (prone) {
      score += action?.melee ? 1 : -1;
      reasons.push(
        action?.melee
          ? 'prone (melee attacks have advantage)'
          : 'prone (ranged attacks have disadvantage)'
      );
    }
    if (down) {
      score -= 3;
      reasons.push('already at 0 hit points');
    } else if (hpValue !== null && hpMax !== null && hpMax > 0 && hpValue <= hpMax / 2) {
      score += 1;
      reasons.push(`bloodied (${hpValue}/${hpMax})`);
    }
    out.push({
      tokenId: String(token.id),
      name: str(token.name) ?? String(token.id),
      gridX: rect.x,
      gridY: rect.y,
      distance: tidy(gapSquares(scene.rule, from, rect) * scene.distance),
      ...(after
        ? { distanceAfterMove: tidy(gapSquares(scene.rule, after, rect) * scene.distance) }
        : {}),
      ac: num(path(actor, 'system.attributes.ac.value')),
      hp: hp ? { value: hpValue, max: hpMax } : null,
      conditions,
      concentrating,
      prone,
      down,
      engage,
      score,
      reasons,
    });
  }
  // Lowest hit points among those still standing.
  const standing = out.filter(t => !t.down && t.hp?.value != null);
  if (standing.length > 1) {
    const lowest = standing.reduce((a, b) => ((b.hp?.value ?? 0) < (a.hp?.value ?? 0) ? b : a));
    if (standing.filter(t => t.hp?.value === lowest.hp?.value).length === 1) {
      lowest.score += 2;
      lowest.reasons.push(`lowest hit points (${lowest.hp?.value})`);
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

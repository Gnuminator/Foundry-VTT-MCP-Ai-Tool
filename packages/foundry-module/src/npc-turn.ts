/**
 * NPC turn assistant (I-125, ships off): the module's read-only `planNpcTurn` query. It reads the
 * running combat and the NPC whose turn it is, and, when asked for a move, validates the square
 * and builds the guarded ops through the same token-move planner as `plan-token-change`. Nothing
 * is written here; the backend stores the ops as a guarded plan under the `npc-turn` switch.
 *
 * The wire contract is `shared/src/npc-turn.ts`; only its types are imported (the browser cannot
 * resolve `@gnuminator/shared` at runtime). The query and feature names are mirrored here and
 * pinned by `npc-turn.test.ts`.
 *
 * Distances count whole squares with diagonals as one (the 5e default); walls, doors and
 * difficult terrain are not checked, and the reply says so.
 */
import type {
  GuardedOp,
  NpcTurnAction,
  NpcTurnContext,
  NpcTurnPlan,
  NpcTurnTarget,
} from '@gnuminator/shared';

import { planTokenChange } from './live-plan-token.js';

/** Query name (mirror of the shared `NPC_TURN_QUERY`). */
export const NPC_TURN_QUERY = 'planNpcTurn';

/** Feature id (mirror of the shared `NPC_TURN_FEATURE_ID`). */
export const NPC_TURN_FEATURE_ID = 'npc-turn';

type Rec = Record<string, unknown>;

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

interface SceneInfo {
  id: string;
  name: string;
  size: number;
  distance: number;
  units: string;
  tokens: Rec[];
}

function currentScene(): SceneInfo {
  const scenes = rec(rec(game)?.scenes);
  const scene = rec(scenes?.current) ?? rec(scenes?.active);
  if (!scene) throw new Error('No current scene: open the scene with the fight first');
  const grid = rec(scene.grid);
  return {
    id: str(scene.id) ?? '',
    name: str(scene.name) ?? 'the scene',
    size: num(grid?.size) ?? 100,
    distance: num(grid?.distance) ?? 5,
    units: str(grid?.units) ?? 'ft',
    tokens: contentsOf(scene.tokens)
      .map(rec)
      .filter((t): t is Rec => t !== null),
  };
}

/** The fight the dashboard shows: the active one, else the latest. */
function fight(): Rec | null {
  const g = rec(game);
  const combats = contentsOf(g?.combats);
  return rec(g?.combat) ?? rec(combats[combats.length - 1]);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A token's stored top-left square and size in squares (Foundry 14 doc.x/y lag during a move). */
function rectOf(scene: SceneInfo, token: Rec): Rect {
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

/** Squares between two tokens: edge to edge, 1 when they touch, diagonals as one. */
function squaresBetween(a: Rect, b: Rect): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.max(gx, gy) + 1;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
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
    // dnd5e 6 feats keep the range on the activity, weapons on the item.
    const activityRange = activities
      .filter(a => ['attack', 'save', 'damage'].includes(str(a.type) ?? ''))
      .map(a => rec(a.range))
      .find(r => num(r?.value) !== null && (str(r?.units) ?? 'ft') === 'ft');
    const value = num(activityRange?.value) ?? num(range?.value);
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

function targetsOf(
  scene: SceneInfo,
  combatants: Rec[],
  npcToken: Rec,
  from: Rect,
  after: Rect | null
): NpcTurnTarget[] {
  const out: NpcTurnTarget[] = [];
  const myDisposition = num(npcToken.disposition) ?? -1;
  for (const c of combatants) {
    if (c.defeated === true) continue;
    const token = scene.tokens.find(t => t.id === str(c.tokenId) || t.id === str(rec(c.token)?.id));
    if (!token || token.id === npcToken.id) continue;
    if ((num(token.disposition) ?? -1) === myDisposition) continue;
    const actor = actorOf(token);
    const rect = rectOf(scene, token);
    const hp = rec(path(actor, 'system.attributes.hp'));
    const statuses = path(actor, 'statuses');
    out.push({
      tokenId: String(token.id),
      name: str(token.name) ?? String(token.id),
      gridX: rect.x,
      gridY: rect.y,
      distance: squaresBetween(from, rect) * scene.distance,
      ...(after ? { distanceAfterMove: squaresBetween(after, rect) * scene.distance } : {}),
      ac: num(path(actor, 'system.attributes.ac.value')),
      hp: hp ? { value: num(hp.value), max: num(hp.max) } : null,
      conditions: statuses ? Array.from(statuses as Iterable<unknown>).map(String) : [],
    });
  }
  return out.sort((a, b) => a.distance - b.distance);
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
  const combat = fight();
  if (combat?.started !== true) {
    throw new Error('No running combat: start the encounter first');
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
  if (actor.type === 'character' || hasPlayerOwner(actor)) {
    throw new Error(
      `${str(token.name) ?? 'That token'} is a player character: the assistant plans monster turns only`
    );
  }

  const tokenName = str(token.name) ?? String(token.id);
  const here = rectOf(scene, token);
  const speed = num(
    path(actor, 'system.attributes.movement.speeds.walk') ??
      path(actor, 'system.attributes.movement.walk')
  );
  const notes = [
    'Distances count whole squares, diagonals as one. Walls, doors and difficult terrain are not checked: look at the map.',
    'The attack roll is not part of the plan (a roll cannot be undone); the attack step names the tools to run after applying the move.',
  ];
  if (
    current &&
    str(current.tokenId) !== String(token.id) &&
    str(rec(current.token)?.id) !== String(token.id)
  ) {
    notes.push(`It is not ${tokenName}'s turn in the tracker.`);
  }

  // The destination, validated.
  let after: Rect | null = null;
  const moveTo = rec(request.moveTo);
  if (moveTo) {
    const gx = num(moveTo.gridX);
    const gy = num(moveTo.gridY);
    if (gx === null || gy === null || !Number.isInteger(gx) || !Number.isInteger(gy)) {
      throw new Error('moveTo needs whole numbers gridX and gridY');
    }
    if (gx < 0 || gy < 0) throw new Error(`${squareLabel(gx, gy)} is outside the scene`);
    after = { ...here, x: gx, y: gy };
    const squares = Math.max(Math.abs(gx - here.x), Math.abs(gy - here.y));
    const far = squares * scene.distance;
    if (speed === null) throw new Error(`${tokenName} has no walking speed to plan with`);
    if (far > speed) {
      throw new Error(
        `${squareLabel(gx, gy)} is ${far} ${scene.units} from ${squareLabel(here.x, here.y)}, more than ${tokenName}'s speed of ${speed} ${scene.units}`
      );
    }
    const blocker = scene.tokens.find(
      t => t.id !== token.id && overlaps(after as Rect, rectOf(scene, t))
    );
    if (blocker) {
      throw new Error(`${squareLabel(gx, gy)} is taken by ${str(blocker.name) ?? 'another token'}`);
    }
  }

  const context: NpcTurnContext = {
    round: num(combat.round) ?? 0,
    token: { id: String(token.id), name: tokenName, gridX: here.x, gridY: here.y },
    actor: { id: str(actor.id) ?? '', name: str(actor.name) ?? tokenName },
    speed,
    units: scene.units,
    squareSize: scene.distance,
    actions: actionsOf(actor, scene),
    targets: targetsOf(scene, combatants, token, here, after),
    notes,
  };

  // The intended attack, checked against the items and the reach after the move.
  const steps: string[] = [];
  let attack: NpcTurnPlan['attack'] = null;
  const itemName = str(request.itemName);
  const targetName = str(request.target);
  if (itemName || targetName) {
    if (!itemName || !targetName) throw new Error('Name both itemName and target for an attack');
    const action = context.actions.find(a => a.name.toLowerCase() === itemName.toLowerCase());
    if (!action) {
      const names = context.actions.map(a => a.name).join(', ') || 'none';
      throw new Error(
        `${tokenName} has no attack or action named "${itemName}" (it has: ${names})`
      );
    }
    const target = context.targets.find(
      t => t.tokenId === targetName || t.name.toLowerCase() === targetName.toLowerCase()
    );
    if (!target) {
      const names = context.targets.map(t => t.name).join(', ') || 'none';
      throw new Error(`"${targetName}" is not a target in this fight (targets: ${names})`);
    }
    const away = target.distanceAfterMove ?? target.distance;
    const reach = action.rangeFt;
    const farthest = action.longRangeFt ?? reach;
    const inReach = farthest === null || away <= farthest;
    if (!inReach && moveTo) {
      throw new Error(
        `${action.name} reaches ${farthest} ${scene.units}, but ${target.name} would be ${away} ${scene.units} away after the move`
      );
    }
    attack = {
      itemName: action.name,
      target: target.name,
      targetAC: target.ac,
      inReach,
      rollWith: `use-npc-activity ${JSON.stringify({ actorName: context.token.id, itemName: action.name, ...(target.ac !== null ? { targetAC: target.ac } : {}) })}`,
      damageWith: `plan-actor-change {"action":"damage","targets":[${JSON.stringify(target.tokenId)}],"amount":<the damage the roll reported>,"damageType":"<its type>"} (use-npc-activity already doubles a critical hit's dice: do not add a multiplier)`,
    };
  }

  // The move.
  let ops: GuardedOp[] | undefined;
  let summary: string | undefined;
  if (after && (after.x !== here.x || after.y !== here.y)) {
    const built = planTokenChange({
      scope: 'token',
      action: 'move',
      tokens: [String(token.id)],
      gridX: after.x,
      gridY: after.y,
    });
    ops = built.ops;
    steps.push(...built.targets.map(t => t.line));
  } else if (after) {
    steps.push(`${tokenName} stays at ${squareLabel(here.x, here.y)}`);
  }
  if (attack) {
    steps.push(
      `Then ${attack.itemName} on ${attack.target}${attack.targetAC !== null ? ` (AC ${attack.targetAC})` : ''}${attack.inReach ? '' : ' (out of reach from here)'}`
    );
  }
  if (ops) {
    const why = str(request.reason);
    summary = `NPC turn: ${tokenName} to ${squareLabel(after!.x, after!.y)}${attack ? `, then ${attack.itemName} on ${attack.target}` : ''}${why ? ` (${why})` : ''}`;
  }

  return {
    context,
    ...(summary ? { summary } : {}),
    ...(ops ? { ops } : {}),
    steps,
    attack,
  };
}

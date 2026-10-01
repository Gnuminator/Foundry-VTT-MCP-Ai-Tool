/**
 * Token plans (F5 L2, D-082): the `scope: "token"` half of the module's
 * read-only `planLiveChange` query. Builds guarded ops for `plan-token-change`;
 * nothing is written here.
 *
 * - move: an update of the token's `x` and `y` (one token to a pixel position
 *   or grid square, or any number of tokens shifted by whole squares). Undo
 *   writes the old position back, which Foundry 14 treats as a move too.
 * - update: an update of a fixed list of token fields ({@link TOKEN_FIELDS}),
 *   vision and light included; only values that differ are written.
 * - delete: deletes of the token's combatants first (each one an explicit op,
 *   so undo puts them back with their initiative), then of the token. Undo
 *   re-creates both with their ids, in reverse order. The combat's turn
 *   pointer and any targets on the token are not restored.
 *
 * The field list mirrors the shared `LIVE_TOKEN_FIELDS` (pinned by
 * `live-plan-token.test.ts`; the browser cannot import runtime values from
 * `@gnuminator/shared`).
 */
import type {
  GuardedOp,
  LiveChangePlan,
  LiveTargetPreview,
  LiveTokenRequest,
} from '@gnuminator/shared';

/** Mirror of the shared `LIVE_TOKEN_FIELDS`: parameter name to token path. */
export const TOKEN_FIELDS = {
  name: 'name',
  hidden: 'hidden',
  disposition: 'disposition',
  elevation: 'elevation',
  rotation: 'rotation',
  lockRotation: 'lockRotation',
  width: 'width',
  height: 'height',
  sightEnabled: 'sight.enabled',
  sightRange: 'sight.range',
  visionMode: 'sight.visionMode',
  lightDim: 'light.dim',
  lightBright: 'light.bright',
  lightColor: 'light.color',
  lightAnimation: 'light.animation.type',
} as const;

type TokenField = keyof typeof TOKEN_FIELDS;

/** Readable names for the preview lines. */
const FIELD_LABELS: Record<TokenField, string> = {
  name: 'name',
  hidden: 'hidden',
  disposition: 'disposition',
  elevation: 'elevation',
  rotation: 'rotation',
  lockRotation: 'rotation lock',
  width: 'width',
  height: 'height',
  sightEnabled: 'vision',
  sightRange: 'vision range',
  visionMode: 'vision mode',
  lightDim: 'dim light',
  lightBright: 'bright light',
  lightColor: 'light color',
  lightAnimation: 'light animation',
};

const DISPOSITIONS: Record<number, string> = {
  [-2]: 'secret',
  [-1]: 'hostile',
  0: 'neutral',
  1: 'friendly',
};

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

function getPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const key of path.split('.')) {
    const r = rec(cur);
    if (!r) return undefined;
    cur = r[key];
  }
  return cur;
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

interface SceneInfo {
  id: string;
  name: string;
  size: number;
  distance: number;
  units: string;
  tokens: Rec[];
}

function currentScene(): SceneInfo {
  const scenes = rec(rec(game as unknown)?.scenes);
  const scene = rec(scenes?.current) ?? rec(scenes?.active);
  if (!scene) throw new Error('No current scene: open the scene with the tokens first');
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

interface TokenRef {
  doc: Rec;
  id: string;
  uuid: string;
  name: string;
}

/** Tokens on the current scene by id or name; a name used by several tokens needs the id. */
function resolveTokens(scene: SceneInfo, identifiers: string[]): TokenRef[] {
  if (identifiers.length === 0) throw new Error('Name at least one token');
  const out: TokenRef[] = [];
  const missing: string[] = [];
  for (const raw of identifiers) {
    const id = raw.trim();
    const lower = id.toLowerCase();
    const byId = scene.tokens.find(t => t.id === id);
    const byName = byId ? [] : scene.tokens.filter(t => str(t.name)?.toLowerCase() === lower);
    if (byName.length > 1) {
      const ids = byName.map(t => String(t.id)).join(', ');
      throw new Error(`Several tokens are named "${id}" on ${scene.name}: use the id (${ids})`);
    }
    const doc = byId ?? byName[0];
    const uuid = str(doc?.uuid);
    if (!doc || !uuid) {
      missing.push(id);
      continue;
    }
    if (!out.some(t => t.uuid === uuid)) {
      out.push({ doc, id: String(doc.id), uuid, name: str(doc.name) ?? String(doc.id) });
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `No token named ${missing.map(m => `"${m}"`).join(', ')} on the current scene (${scene.name})`
    );
  }
  return out;
}

function square(scene: SceneInfo, x: number, y: number): string {
  return `(${Math.round(x / scene.size)},${Math.round(y / scene.size)})`;
}

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

function planMove(
  scene: SceneInfo,
  tokens: TokenRef[],
  request: LiveTokenRequest
): { ops: GuardedOp[]; previews: LiveTargetPreview[]; summary: string } {
  const relative = request.dx !== undefined || request.dy !== undefined;
  const grid = request.gridX !== undefined || request.gridY !== undefined;
  const pixels = request.x !== undefined || request.y !== undefined;
  if ([relative, grid, pixels].filter(Boolean).length !== 1) {
    throw new Error('Move needs one of: dx/dy (squares), gridX/gridY (a square) or x/y (pixels)');
  }
  if (!relative && tokens.length !== 1) {
    throw new Error('Moving to a position takes one token; use dx/dy to shift several');
  }
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  let destination: string | null = null;
  for (const token of tokens) {
    // The stored position: on Foundry 14 doc.x/y lag behind while a move animates.
    const source = rec(token.doc._source);
    const x0 = num(source?.x) ?? num(token.doc.x) ?? 0;
    const y0 = num(source?.y) ?? num(token.doc.y) ?? 0;
    let x: number;
    let y: number;
    if (relative) {
      x = x0 + Math.round((request.dx ?? 0) * scene.size);
      y = y0 + Math.round((request.dy ?? 0) * scene.size);
    } else if (grid) {
      x = Math.round((request.gridX ?? x0 / scene.size) * scene.size);
      y = Math.round((request.gridY ?? y0 / scene.size) * scene.size);
    } else {
      x = Math.round(request.x ?? x0);
      y = Math.round(request.y ?? y0);
    }
    if (x < 0 || y < 0) throw new Error(`${token.name} would leave the scene (${x}, ${y})`);
    destination = square(scene, x, y);
    if (x === x0 && y === y0) {
      previews.push({
        target: token.name,
        actorUuid: token.uuid,
        line: `${token.name}: already at ${square(scene, x0, y0)}`,
        skipped: true,
      });
      continue;
    }
    const squares = Math.max(Math.abs(x - x0), Math.abs(y - y0)) / scene.size;
    const far = Math.round(squares * scene.distance * 10) / 10;
    const changes: Rec = {};
    if (x !== x0) changes.x = x;
    if (y !== y0) changes.y = y;
    ops.push({ kind: 'update', uuid: token.uuid, changes });
    previews.push({
      target: token.name,
      actorUuid: token.uuid,
      line: `${token.name}: ${square(scene, x0, y0)} to ${square(scene, x, y)}, ${far} ${scene.units}`,
    });
  }
  const who = tokens.map(t => t.name).join(', ');
  const summary = relative
    ? `Move ${who} by ${request.dx ?? 0} right, ${request.dy ?? 0} down (squares)`
    : `Move ${who} to ${destination ?? 'its square'}`;
  return { ops, previews, summary };
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

function checkValue(field: TokenField, value: unknown): string | number | boolean {
  const bools: TokenField[] = ['hidden', 'lockRotation', 'sightEnabled'];
  const strings: TokenField[] = ['name', 'visionMode', 'lightColor', 'lightAnimation'];
  if (bools.includes(field)) {
    if (typeof value !== 'boolean') throw new Error(`${field} must be true or false`);
    return value;
  }
  if (strings.includes(field)) {
    if (typeof value !== 'string') throw new Error(`${field} must be text`);
    if (field === 'name' && !value.trim()) throw new Error('name cannot be empty');
    if (field === 'lightColor' && value && !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error('lightColor must be a hex color like "#ff9329"');
    }
    return value;
  }
  const n = num(value);
  if (n === null) throw new Error(`${field} must be a number`);
  if (field === 'disposition' && !(n in DISPOSITIONS)) {
    throw new Error('disposition must be -2 (secret), -1 (hostile), 0 (neutral) or 1 (friendly)');
  }
  if ((field === 'width' || field === 'height') && n <= 0) {
    throw new Error(`${field} must be more than 0`);
  }
  if (['sightRange', 'lightDim', 'lightBright'].includes(field) && n < 0) {
    throw new Error(`${field} cannot be negative`);
  }
  return n;
}

function show(field: TokenField, value: unknown): string {
  if (field === 'disposition' && typeof value === 'number')
    return DISPOSITIONS[value] ?? String(value);
  if (value === undefined || value === null || value === '') return 'none';
  return String(value);
}

function planUpdate(
  tokens: TokenRef[],
  request: LiveTokenRequest
): { ops: GuardedOp[]; previews: LiveTargetPreview[]; summary: string } {
  const entries = Object.entries(request.changes ?? {}).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    throw new Error(`Update needs at least one field: ${Object.keys(TOKEN_FIELDS).join(', ')}`);
  }
  const wanted: Array<[TokenField, string | number | boolean]> = entries.map(([key, value]) => {
    if (!(key in TOKEN_FIELDS)) {
      throw new Error(
        `"${key}" cannot be changed here; fields: ${Object.keys(TOKEN_FIELDS).join(', ')}`
      );
    }
    return [key as TokenField, checkValue(key as TokenField, value)];
  });
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  for (const token of tokens) {
    const changes: Rec = {};
    const parts: string[] = [];
    for (const [field, value] of wanted) {
      const path = TOKEN_FIELDS[field];
      const stored = getPath(token.doc._source, path);
      const current = stored !== undefined ? stored : getPath(token.doc, path);
      if (current === value) continue;
      changes[path] = value;
      parts.push(`${FIELD_LABELS[field]} ${show(field, current)} to ${show(field, value)}`);
    }
    if (parts.length === 0) {
      previews.push({
        target: token.name,
        actorUuid: token.uuid,
        line: `${token.name}: no change`,
        skipped: true,
      });
      continue;
    }
    ops.push({ kind: 'update', uuid: token.uuid, changes });
    previews.push({
      target: token.name,
      actorUuid: token.uuid,
      line: `${token.name}: ${parts.join(', ')}`,
    });
  }
  const labels = wanted.map(([field]) => FIELD_LABELS[field]).join(', ');
  return { ops, previews, summary: `Change ${labels} of ${tokens.map(t => t.name).join(', ')}` };
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/** Combatants of any encounter that stand for this token. */
function combatantsOf(scene: SceneInfo, token: TokenRef): Rec[] {
  const combats = contentsOf(rec(game as unknown)?.combats);
  return combats.flatMap(combat =>
    contentsOf(rec(combat)?.combatants)
      .map(rec)
      .filter(
        (c): c is Rec =>
          c !== null &&
          c.tokenId === token.id &&
          (c.sceneId === undefined || c.sceneId === scene.id)
      )
  );
}

function planDelete(
  scene: SceneInfo,
  tokens: TokenRef[]
): { ops: GuardedOp[]; previews: LiveTargetPreview[]; summary: string } {
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  for (const token of tokens) {
    const combatants = combatantsOf(scene, token);
    const extras: string[] = [];
    for (const c of combatants) {
      const uuid = str(c.uuid);
      if (!uuid) continue;
      ops.push({ kind: 'delete', uuid });
      const init = num(c.initiative);
      extras.push(
        init === null
          ? 'its place in the encounter'
          : `its place in the encounter (initiative ${init})`
      );
    }
    ops.push({ kind: 'delete', uuid: token.uuid });
    const tail = extras.length > 0 ? `, with ${extras.join(' and ')}` : '';
    previews.push({
      target: token.name,
      actorUuid: token.uuid,
      line: `${token.name}: delete${tail}`,
    });
  }
  return {
    ops,
    previews,
    summary: `Delete ${tokens.map(t => t.name).join(', ')} from ${scene.name}`,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Build a token plan. Throws when nothing would change. */
export function planTokenChange(request: LiveTokenRequest): LiveChangePlan {
  const scene = currentScene();
  const tokens = resolveTokens(scene, Array.isArray(request.tokens) ? request.tokens : []);
  let built: { ops: GuardedOp[]; previews: LiveTargetPreview[]; summary: string };
  switch (request.action) {
    case 'move':
      built = planMove(scene, tokens, request);
      break;
    case 'update':
      built = planUpdate(tokens, request);
      break;
    case 'delete':
      built = planDelete(scene, tokens);
      break;
    default:
      throw new Error(`Unknown action "${String((request as { action?: unknown }).action)}"`);
  }
  if (built.ops.length === 0) {
    throw new Error(`Nothing to change: ${built.previews.map(p => p.line).join('; ')}`);
  }
  return { summary: built.summary, ops: built.ops, targets: built.previews };
}

/**
 * Compares a scene's live walls, lights, tiles and tokens with a backup copy and builds the
 * guarded ops that put the backup state back (I-128). Pure: no I/O.
 *
 * By document id:
 * - in the backup, not live: `create` with the old id (added back);
 * - live, not in the backup: `delete` (removed);
 * - both, different: one `update` of the differing fields (dot paths). Position changes (x, y, c,
 *   elevation) count as "moved", anything else as "changed".
 *
 * An update only sets fields the backup holds; it never unsets a field, because a backup stores
 * documents without their default values and unsetting would read every default as a difference.
 * A token's `delta` (an unlinked token's own hit points, effects and items) is left as it is, so a
 * restore puts tokens back on the map without undoing the damage dealt since.
 */
import {
  SCENE_RESTORE_DOCUMENT,
  SCENE_RESTORE_PARTS,
  type GuardedOp,
  type SceneRestorePart,
} from '@gnuminator/shared';

type Doc = Record<string, unknown>;

/** Fields never compared or written, per part. */
const IGNORED: Record<SceneRestorePart, ReadonlySet<string>> = {
  walls: new Set(['_id', '_stats']),
  lights: new Set(['_id', '_stats']),
  tiles: new Set(['_id', '_stats']),
  tokens: new Set(['_id', '_stats', 'delta', '_movementHistory', '_regions']),
};

/** A document's data for a `create`: the backup copy without the fields never restored. */
function createData(part: SceneRestorePart, doc: Doc): Doc {
  const data: Doc = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id' || !IGNORED[part].has(key)) data[key] = value;
  }
  return data;
}

/** The value at a dot path of a document, or undefined. */
function valueAt(doc: Doc, path: string): unknown {
  let node: unknown = doc;
  for (const key of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Fields whose change counts as a move. */
const POSITION = new Set(['x', 'y', 'c', 'elevation', 'rotation']);

export interface PartCounts {
  added: number;
  removed: number;
  moved: number;
  changed: number;
  unchanged: number;
}

export interface RestoreDiff {
  ops: GuardedOp[];
  counts: Record<SceneRestorePart, PartCounts>;
  /** The names of tokens added and removed (a token is easier to recognise than an id). */
  tokenNames: { added: string[]; removed: string[] };
}

function isPlainObject(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Leaf values of a document by dot path; arrays and empty objects are leaves. */
export function flatten(
  value: unknown,
  prefix = '',
  out: Map<string, unknown> = new Map()
): Map<string, unknown> {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Numbers within a hair of each other are equal (a position saved through a float round trip). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return stable(a) === stable(b);
}

/** The changed leaf paths of `live` that the backup document sets differently. */
function differingPaths(part: SceneRestorePart, live: Doc, backup: Doc): Map<string, unknown> {
  const liveLeaves = flatten(live);
  const changes = new Map<string, unknown>();
  for (const [path, value] of flatten(backup)) {
    if (path === '' || IGNORED[part].has(path.split('.')[0] ?? '')) continue;
    // An empty object says nothing a field-by-field update could set (and would never settle).
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    if (!liveLeaves.has(path) || !same(liveLeaves.get(path), value)) changes.set(path, value);
  }
  // Where the live value at a parent field is not an object (null), set the whole subtree so an
  // undo puts the original back exactly, not an empty object.
  for (const path of [...changes.keys()]) {
    const keys = path.split('.');
    for (let i = 1; i < keys.length; i++) {
      const parent = keys.slice(0, i).join('.');
      if (liveLeaves.has(parent) && !isPlainObject(liveLeaves.get(parent))) {
        for (const other of [...changes.keys()]) {
          if (other === parent || other.startsWith(`${parent}.`)) changes.delete(other);
        }
        changes.set(parent, valueAt(backup, parent));
        break;
      }
    }
  }
  return changes;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function idOf(doc: Doc): string {
  return text(doc._id, '');
}

/** Compare one part and push its ops. */
function diffPart(
  part: SceneRestorePart,
  sceneId: string,
  live: Doc[],
  backup: Doc[],
  ops: GuardedOp[],
  tokenNames: RestoreDiff['tokenNames']
): PartCounts {
  const counts: PartCounts = { added: 0, removed: 0, moved: 0, changed: 0, unchanged: 0 };
  const name = SCENE_RESTORE_DOCUMENT[part];
  const liveById = new Map(live.map(d => [idOf(d), d]));
  const backupById = new Map(backup.map(d => [idOf(d), d]));

  for (const [id, doc] of backupById) {
    const now = liveById.get(id);
    if (!now) {
      counts.added += 1;
      ops.push({
        kind: 'create',
        documentName: name,
        parentUuid: `Scene.${sceneId}`,
        data: createData(part, doc),
        keepId: true,
      });
      if (part === 'tokens') tokenNames.added.push(text(doc.name, id));
      continue;
    }
    const changes = differingPaths(part, now, doc);
    if (changes.size === 0) {
      counts.unchanged += 1;
      continue;
    }
    const moved = [...changes.keys()].some(p => POSITION.has(p.split('.')[0] ?? ''));
    if (moved) counts.moved += 1;
    else counts.changed += 1;
    ops.push({
      kind: 'update',
      uuid: `Scene.${sceneId}.${name}.${id}`,
      changes: Object.fromEntries(changes),
    });
  }
  for (const [id, doc] of liveById) {
    if (backupById.has(id)) continue;
    counts.removed += 1;
    ops.push({ kind: 'delete', uuid: `Scene.${sceneId}.${name}.${id}` });
    if (part === 'tokens') tokenNames.removed.push(text(doc.name, id));
  }
  return counts;
}

/** Compare the chosen parts of a live scene with the backup copy of it. */
export function buildRestoreDiff(
  sceneId: string,
  parts: readonly SceneRestorePart[],
  live: Record<SceneRestorePart, Doc[]>,
  backup: Record<SceneRestorePart, Doc[]>
): RestoreDiff {
  const ops: GuardedOp[] = [];
  const tokenNames = { added: [] as string[], removed: [] as string[] };
  const zero = (): PartCounts => ({ added: 0, removed: 0, moved: 0, changed: 0, unchanged: 0 });
  const counts = {
    walls: zero(),
    lights: zero(),
    tiles: zero(),
    tokens: zero(),
  } satisfies Record<SceneRestorePart, PartCounts>;
  for (const part of SCENE_RESTORE_PARTS) {
    if (!parts.includes(part)) continue;
    counts[part] = diffPart(part, sceneId, live[part], backup[part], ops, tokenNames);
  }
  return { ops, counts, tokenNames };
}

/** "3 walls added, 1 light moved": the counts of one part in words, empty when nothing differs. */
export function describePart(part: SceneRestorePart, c: PartCounts): string {
  const noun = (n: number): string => `${n} ${part.replace(/s$/, '')}${n === 1 ? '' : 's'}`;
  const bits: string[] = [];
  if (c.added) bits.push(`${noun(c.added)} added back`);
  if (c.removed) bits.push(`${noun(c.removed)} removed`);
  if (c.moved) bits.push(`${noun(c.moved)} moved`);
  if (c.changed) bits.push(`${noun(c.changed)} changed`);
  return bits.join(', ');
}

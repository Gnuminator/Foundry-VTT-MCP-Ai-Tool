/**
 * Folding changes into the net ops of one undo (I-109, the pure half of the undo planner).
 *
 * The module checks every op of a plan against the document as it is when the plan is made, so an
 * undo of several changes can never replay them one after the other: two ops on one path would
 * both be checked against the same value. Instead every document gets ONE op that takes it back
 * to how it was before the oldest change in the set:
 *
 *   - created in the set (and still there): delete it; created and deleted in the set: nothing;
 *   - deleted in the set: create it again from the stored source (with its id), with the values of
 *     older updates in the set put back first;
 *   - otherwise: one update that restores, for each path, the `before` of the OLDEST change that
 *     touched it. Paths the journal knows changed but not from what (`unknownBefore`) stay as they are.
 */
import type { GuardedCreateOp, GuardedOp, GuardedUpdateOp, PathValue } from '@gnuminator/shared';

/** One recorded change to one document, from a journal record or an AI change's op result. */
export interface DocEvent {
  /** Epoch ms, and the position in the merged history (breaks ties). */
  t: number;
  order: number;
  /** The history item it belongs to (`act:<actionId>` or a changeId). */
  itemId: string;
  op: 'create' | 'update' | 'delete';
  uuid: string;
  documentName: string;
  parentUuid: string | null;
  name: string | null;
  /** update: values before and after (recorded paths only). */
  before?: PathValue[];
  after?: PathValue[];
  /** update: changed paths whose old value was never recorded. */
  unknownBefore?: string[];
  /** delete: the full source before deletion. */
  source?: Record<string, unknown>;
  /** create: `_stats.modifiedTime` just after the create. */
  modifiedTime?: number | null;
}

export type NetChange = NetDelete | NetCreate | NetUpdate;

/** Undo of a create. */
export interface NetDelete {
  kind: 'delete';
  uuid: string;
  documentName: string;
  name: string | null;
  /** The document was changed after it was created (inside the set or, for one item, later). */
  modifiedTime?: number | null;
}

/** Undo of a delete. */
export interface NetCreate {
  kind: 'create';
  /** The uuid the document had, and will have again (the id is kept). */
  uuid: string;
  documentName: string;
  name: string | null;
  parentUuid: string | null;
  data: Record<string, unknown>;
}

export interface NetPath {
  path: string;
  /** The value to restore (absent: remove the key). */
  before: PathValue;
  /** What the newest change in the set left there, when it was recorded. */
  after?: PathValue;
}

/** Undo of updates. */
export interface NetUpdate {
  kind: 'update';
  uuid: string;
  documentName: string;
  name: string | null;
  paths: NetPath[];
  /** Changed in the set, old value never recorded: left alone. */
  unrecorded: string[];
}

// ---------------------------------------------------------------------------
// Things

/**
 * The "thing" a document belongs to, by its uuid: the same walk up the parents the module uses for
 * `rootUuid`, stopping below a Scene. `Actor.a.Item.i` gives `Actor.a`, `Scene.s.Token.t.Actor.x.Item.i`
 * gives `Scene.s.Token.t`, a placeable on a scene gives itself, a Scene gives itself.
 */
export function rootOfUuid(uuid: string): string {
  const parts = uuid.split('.');
  if (parts[0] === 'Scene') return parts.slice(0, 4).join('.');
  if (parts[0] === 'Compendium') return uuid;
  return parts.slice(0, 2).join('.');
}

/** How deep a uuid sits: `Actor.a` is 1, `Actor.a.Item.i` is 2. */
function depthOf(uuid: string): number {
  return Math.ceil(uuid.split('.').length / 2);
}

// ---------------------------------------------------------------------------
// Paths

/** Set (or remove) the value at a dot path inside a plain object, in place. */
function setAtPath(target: Record<string, unknown>, value: PathValue): void {
  const keys = value.path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      if (!value.present) return;
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value.present) node[last] = structuredClone(value.value);
  else delete node[last];
}

function isBelow(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}.`);
}

/**
 * Drop paths that sit below another restored path: Foundry cannot set `ownership` and
 * `ownership.u1` in one update. The older value wins; when the lower path is the older one, its
 * value is put inside the higher path's value.
 */
function resolveNesting(entries: Map<string, { value: PathValue; t: number }>): void {
  for (const [path, mine] of [...entries]) {
    for (const [other, theirs] of [...entries]) {
      if (!isBelow(path, other) || !entries.has(path) || !entries.has(other)) continue;
      if (mine.t < theirs.t && theirs.value.present && isPlainObject(theirs.value.value)) {
        const merged = structuredClone(theirs.value.value);
        setAtPath(merged, { ...mine.value, path: path.slice(other.length + 1) });
        entries.set(other, { value: { ...theirs.value, value: merged }, t: mine.t });
      }
      entries.delete(path);
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Folding

function byTime(a: DocEvent, b: DocEvent): number {
  return a.t - b.t || a.order - b.order;
}

function foldUpdates(first: DocEvent, updates: DocEvent[]): NetUpdate {
  const restore = new Map<string, { value: PathValue; t: number }>();
  const newest = new Map<string, PathValue>();
  const unknown = new Set<string>();
  for (const event of updates) {
    for (const value of event.before ?? []) {
      if (!restore.has(value.path)) restore.set(value.path, { value, t: event.t });
    }
    for (const value of event.after ?? []) newest.set(value.path, value);
    for (const path of event.unknownBefore ?? []) unknown.add(path);
  }
  resolveNesting(restore);
  return {
    kind: 'update',
    uuid: first.uuid,
    documentName: first.documentName,
    name: [...updates].reverse().find(e => e.name)?.name ?? first.name,
    paths: [...restore].map(([path, { value }]): NetPath => {
      const after = newest.get(path);
      return { path, before: value, ...(after ? { after } : {}) };
    }),
    unrecorded: [...unknown].filter(path => !restore.has(path)),
  };
}

/**
 * One net change per document that ended up different, from the events of a set of changes (any
 * order). A document created and deleted inside the set, or only touched by its own create and
 * delete, needs nothing.
 */
export function foldEvents(events: readonly DocEvent[]): NetChange[] {
  const byDoc = new Map<string, DocEvent[]>();
  for (const event of [...events].sort(byTime)) {
    const list = byDoc.get(event.uuid);
    if (list) list.push(event);
    else byDoc.set(event.uuid, [event]);
  }
  const out: NetChange[] = [];
  for (const list of byDoc.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    const existedBefore = first.op !== 'create';
    const existsNow = last.op !== 'delete';
    const updates = list.filter(e => e.op === 'update');
    if (!existedBefore && !existsNow) continue;
    if (!existedBefore) {
      const created = first;
      out.push({
        kind: 'delete',
        uuid: created.uuid,
        documentName: created.documentName,
        name: created.name,
        ...(created.modifiedTime !== undefined ? { modifiedTime: created.modifiedTime } : {}),
      });
    } else if (!existsNow) {
      const deleted = list.find(e => e.op === 'delete');
      const source = deleted?.source;
      if (!deleted || !source) continue;
      const data = structuredClone(source);
      // Updates before the delete are undone first; the oldest value goes in last and wins.
      for (const event of updates.filter(e => byTime(e, deleted) < 0).reverse()) {
        for (const value of event.before ?? []) setAtPath(data, value);
      }
      out.push({
        kind: 'create',
        uuid: deleted.uuid,
        documentName: deleted.documentName,
        name: deleted.name,
        parentUuid: deleted.parentUuid,
        data,
      });
    } else if (updates.length > 0) {
      const net = foldUpdates(first, updates);
      if (net.paths.length > 0 || net.unrecorded.length > 0) out.push(net);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ops

/** The ops of a net change; `paths` is what is left of an update after the planner's checks. */
export function opOf(change: NetChange, paths?: PathValue[]): GuardedOp {
  switch (change.kind) {
    case 'delete':
      return { kind: 'delete', uuid: change.uuid };
    case 'create': {
      const op: GuardedCreateOp = {
        kind: 'create',
        documentName: change.documentName,
        data: change.data,
        keepId: true,
      };
      if (change.parentUuid) op.parentUuid = change.parentUuid;
      return op;
    }
    case 'update': {
      const op: GuardedUpdateOp = { kind: 'update', uuid: change.uuid, changes: {}, unset: [] };
      for (const value of paths ?? change.paths.map(p => p.before)) {
        if (value.present) op.changes[value.path] = value.value;
        else op.unset?.push(value.path);
      }
      return op;
    }
  }
}

/**
 * Deletes first (deepest first, so an item goes before its actor), then updates, then creates
 * (shallowest first, so a parent is back before its children). Stable inside each group.
 */
export function orderOps(ops: readonly GuardedOp[]): GuardedOp[] {
  const depth = (op: GuardedOp): number =>
    op.kind === 'create' ? (op.parentUuid ? depthOf(op.parentUuid) + 1 : 1) : depthOf(op.uuid);
  const deletes = ops.filter(op => op.kind === 'delete').sort((a, b) => depth(b) - depth(a));
  const updates = ops.filter(op => op.kind === 'update');
  const creates = ops.filter(op => op.kind === 'create').sort((a, b) => depth(a) - depth(b));
  return [...deletes, ...updates, ...creates];
}

import { MODULE_ID } from './constants.js';
import {
  CHANGE_JOURNAL_ACTION_GAP_MS,
  CHANGE_JOURNAL_DOCUMENTS,
  CHANGE_JOURNAL_MAX_LIMIT,
  CHANGE_JOURNAL_MAX_RECORD_BYTES,
  CHANGE_JOURNAL_RING,
  CHANGE_JOURNAL_VERSION,
  isIgnoredChangePath,
  type ChangeJournalOptions,
  type ChangeJournalResponse,
  type ChangeOp,
  type ChangeRecord,
  type ChangeWriteMode,
} from './change-journal-types.js';
import type { PathValue } from './data-access/guarded-write.js';

/**
 * ChangeJournal: the change journal recorder (I-109, undo for everything in
 * Foundry). A singleton like `playRecorder`. The contract is
 * `shared/src/change-journal.ts` (mirrored in `change-journal-types.ts`).
 *
 * Two halves, because Foundry's `preUpdate*` hooks only run in the browser
 * that makes a change while the `update*` hooks run everywhere:
 *
 * - The pre-hooks run on EVERY client (players too) and, when the change is
 *   this browser's own, stash a change group id and the values before into the
 *   operation's `options[MODULE_ID].journal`. Foundry carries custom options to
 *   the other clients (dnd5e relies on the same for `options.dnd5e.hp`).
 * - The post-hooks run on GM clients only (checked at call time): they build
 *   one `ChangeRecord` per changed document from the document, the `userId`
 *   argument and that stash, and keep the newest records in a ring buffer.
 *   The backend pulls them with `getChangeJournal` (GM-gated in `queries.ts`).
 *
 * Nothing here may break a game action: every hook handler is wrapped and a
 * failure only logs one console warning.
 */

// ---------------------------------------------------------------------------
// Narrow helpers (hook arguments are `any` at Foundry's boundary)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The fields of a Foundry document this file reads. */
interface DocLike {
  id?: unknown;
  uuid?: unknown;
  documentName?: unknown;
  name?: unknown;
  text?: unknown;
  parent?: unknown;
  _source?: unknown;
  _stats?: unknown;
  isToken?: unknown;
  token?: unknown;
  toObject?: unknown;
  pack?: unknown;
}

function asDoc(v: unknown): DocLike | null {
  return asRecord(v) as DocLike | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Foundry's deletion and replacement markers (`_del`, `_replace(...)` on v14). */
function isOperatorMarker(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  if (v === (globalThis as { _del?: unknown })._del) return true;
  const name = (v as { constructor?: { name?: unknown } }).constructor?.name;
  return name === 'ForcedDeletion' || name === 'ForcedReplacement';
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  try {
    if (typeof foundry !== 'undefined' && typeof foundry.utils?.deepClone === 'function') {
      return foundry.utils.deepClone(value);
    }
  } catch {
    // fall through to the JSON copy
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function randomId(): string {
  try {
    if (typeof foundry !== 'undefined' && typeof foundry.utils?.randomID === 'function') {
      return foundry.utils.randomID(16);
    }
  } catch {
    // fall through
  }
  return `cj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Drop Foundry's deletion (`-=key`) and replacement (`==key`) prefixes from every segment of a path. */
function plainPath(path: string): string {
  return path
    .split('.')
    .map(segment =>
      segment.startsWith('-=') || segment.startsWith('==') ? segment.slice(2) : segment
    )
    .join('.');
}

/**
 * The paths a change touches, ignored ones removed. Leaf paths of the change
 * (arrays and Foundry's operator markers count as leaves); a deletion or
 * replacement key records the whole key. With `recursive: false` Foundry
 * replaces each top-level key, so each top-level key is one path.
 */
export function changedPaths(changes: unknown, recursive: boolean): string[] {
  const source = asRecord(changes);
  if (!source) return [];
  const found = new Set<string>();
  if (!recursive) {
    for (const key of Object.keys(source)) {
      const top = key.split('.')[0];
      if (top) found.add(plainPath(top));
    }
  } else {
    const walk = (node: Record<string, unknown>, prefix: string): void => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const wholeKey = key.startsWith('-=') || key.startsWith('==');
        if (!wholeKey && isPlainObject(value) && !isOperatorMarker(value)) {
          // An empty object merges nothing.
          if (Object.keys(value).length > 0) walk(value, path);
        } else {
          found.add(plainPath(path));
        }
      }
    };
    walk(source, '');
  }
  return [...found].filter(path => path !== '' && !isIgnoredChangePath(path));
}

/** The value at a dot path of a document's source, with explicit absence. */
function readPath(source: Record<string, unknown>, path: string): PathValue {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) {
      return { path, present: false };
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node === undefined
    ? { path, present: false }
    : { path, present: true, value: cloneValue(node) };
}

/** True when `path` is `covering` or lies below it. */
function isCoveredBy(path: string, covering: readonly string[]): boolean {
  return covering.some(c => path === c || path.startsWith(`${c}.`));
}

function sourceOf(doc: DocLike): Record<string, unknown> {
  const source = asRecord(doc._source);
  if (source) return source;
  if (typeof doc.toObject === 'function') {
    return (doc as { toObject(source: boolean): Record<string, unknown> }).toObject(true);
  }
  return {};
}

// ---------------------------------------------------------------------------
// Document facts for a record
// ---------------------------------------------------------------------------

function nameOf(doc: DocLike): string | null {
  if (typeof doc.name === 'string') return doc.name;
  // A map note carries its label in `text`.
  return doc.documentName === 'Note' && typeof doc.text === 'string' && doc.text ? doc.text : null;
}

/** A synthetic (unlinked token) actor: its own `_stats` are the base actor's, not its own. */
function isSyntheticActor(doc: DocLike): boolean {
  return doc.documentName === 'Actor' && doc.isToken === true;
}

/**
 * A `_stats` time (server clock, so every GM browser agrees), or null. A
 * synthetic actor reads its token's delta instead of the base actor's stats.
 */
function statsTime(doc: DocLike, field: 'createdTime' | 'modifiedTime'): number | null {
  let holder: DocLike | null = doc;
  if (isSyntheticActor(doc)) holder = asDoc(asRecord(doc.token)?.delta);
  if (!holder) return null;
  const stats = asRecord(asRecord(holder._source)?._stats) ?? asRecord(holder._stats);
  return num(stats?.[field]) ?? null;
}

/** Walk up the parents and stop below a Scene or at the top (the "thing" undo groups by). */
function rootOf(doc: DocLike): DocLike {
  let node = doc;
  for (let step = 0; step < 12; step += 1) {
    const parent = asDoc(node.parent);
    if (!parent || parent.documentName === 'Scene') break;
    node = parent;
  }
  return node;
}

/** The id of the scene the document lives on, or null (a Scene itself lives on none). */
function sceneIdOf(doc: DocLike): string | null {
  let node = asDoc(doc.parent);
  for (let step = 0; node && step < 12; step += 1) {
    if (node.documentName === 'Scene') return str(node.id) ?? null;
    node = asDoc(node.parent);
  }
  return null;
}

const WRITE_MODES: readonly string[] = ['apply', 'undo', 'rollback'];

/** The guarded-write marker under the module id, when a guarded write made the change. */
function markerOf(options: unknown): { changeId?: string; changeMode?: ChangeWriteMode } {
  const ns = asRecord(asRecord(options)?.[MODULE_ID]);
  const changeId = str(ns?.changeId);
  const mode = str(ns?.changeMode);
  return {
    ...(changeId ? { changeId } : {}),
    ...(mode && WRITE_MODES.includes(mode) ? { changeMode: mode as ChangeWriteMode } : {}),
  };
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 200;

export class ChangeJournal {
  private readonly clientId = randomId();
  private seq = 0;
  private buffer: ChangeRecord[] = [];
  private hooksRegistered = false;
  private warned = false;
  /** This browser's current change group and when its last change happened. */
  private actionId: string | null = null;
  private lastChangeAt = 0;

  /**
   * Register the hooks once (safe to call more than once), for every covered
   * document type this core has. Pre-hooks act on any client; post-hooks only
   * on a GM client (checked when they run, so a role change is honoured).
   */
  registerHooks(): void {
    if (this.hooksRegistered) return;
    this.hooksRegistered = true;

    const on = (hook: string, fn: (...args: unknown[]) => void): void => {
      Hooks.on(hook, (...args: unknown[]) => {
        try {
          fn(...args);
        } catch (error) {
          // One warning is enough: a broken hook must never spam or break a game action.
          if (!this.warned) {
            this.warned = true;
            console.warn(`[${MODULE_ID}] ChangeJournal ${hook} handler failed:`, error);
          }
        }
      });
    };

    for (const name of CHANGE_JOURNAL_DOCUMENTS) {
      if (
        typeof CONFIG === 'undefined' ||
        (CONFIG as Record<string, unknown>)[name] === undefined
      ) {
        continue;
      }
      on(`preCreate${name}`, (_doc, _data, options, userId) => this.stashCreate(options, userId));
      on(`preUpdate${name}`, (doc, changes, options, userId) =>
        this.stashUpdate(doc, changes, options, userId)
      );
      on(`preDelete${name}`, (_doc, options, userId) => this.stashDelete(options, userId));
      on(`create${name}`, (doc, options, userId) =>
        this.record('create', doc, null, options, userId)
      );
      on(`update${name}`, (doc, changed, options, userId) =>
        this.record('update', doc, changed, options, userId)
      );
      on(`delete${name}`, (doc, options, userId) =>
        this.record('delete', doc, null, options, userId)
      );
    }
  }

  // -------------------------------------------------------------------------
  // Pre-hooks (every client): the stash
  // -------------------------------------------------------------------------

  /** True when this browser is the one making the change. */
  private isMine(userId: unknown): boolean {
    const own = game.user?.id;
    return typeof userId === 'string' && typeof own === 'string' && userId === own;
  }

  /** This browser's change group: a new one when the previous change is older than the gap. */
  private currentActionId(): string {
    const now = Date.now();
    if (this.actionId === null || now - this.lastChangeAt > CHANGE_JOURNAL_ACTION_GAP_MS) {
      this.actionId = randomId();
    }
    this.lastChangeAt = now;
    return this.actionId;
  }

  /**
   * The journal stash of this operation, made if needed. It sits under the
   * module id next to the guarded-write marker, which is left alone. A stash
   * that already has an actionId (an earlier document of the same operation)
   * keeps it.
   */
  private journalStash(options: unknown): NonNullable<ChangeJournalOptions['journal']> | null {
    const opts = asRecord(options);
    if (!opts) return null;
    let ns = asRecord(opts[MODULE_ID]);
    if (!ns) {
      ns = {};
      opts[MODULE_ID] = ns;
    }
    const journal = asRecord(ns.journal);
    if (journal && str(journal.actionId)) {
      this.lastChangeAt = Date.now();
      return journal as unknown as NonNullable<ChangeJournalOptions['journal']>;
    }
    const made = { actionId: this.currentActionId() };
    ns.journal = made;
    return made;
  }

  private stashCreate(options: unknown, userId: unknown): void {
    if (!this.isMine(userId)) return;
    this.journalStash(options);
  }

  private stashDelete(options: unknown, userId: unknown): void {
    if (!this.isMine(userId)) return;
    this.journalStash(options);
  }

  private stashUpdate(doc: unknown, changes: unknown, options: unknown, userId: unknown): void {
    if (!this.isMine(userId)) return;
    const d = asDoc(doc);
    const id = str(d?.id);
    const journal = this.journalStash(options);
    if (!d || !id || !journal) return;
    const recursive = asRecord(options)?.recursive !== false;
    const source = sourceOf(d);
    const before = changedPaths(changes, recursive).map(path => readPath(source, path));
    // One operation can update many documents: each keeps its own values.
    journal.before ??= {};
    journal.before[id] = before;
  }

  // -------------------------------------------------------------------------
  // Post-hooks (GM clients): the records
  // -------------------------------------------------------------------------

  private record(
    op: ChangeOp,
    doc: unknown,
    changed: unknown,
    options: unknown,
    userId: unknown
  ): void {
    if (game.user?.isGM !== true) return;
    const d = asDoc(doc);
    const uuid = str(d?.uuid);
    // A compendium edit is library upkeep, not a change at the table.
    if (!d || !uuid || str(d.pack)) return;
    const id = str(d.id);

    const serverTime = statsTime(d, op === 'create' ? 'createdTime' : 'modifiedTime');
    const t = serverTime ?? Date.now();
    const key = `${op}:${uuid}:${t}`;
    const stash = asRecord(asRecord(asRecord(options)?.[MODULE_ID])?.journal);
    const actionId = str(stash?.actionId) ?? `solo:${key}`;

    const author = typeof userId === 'string' ? game.users?.get(userId) : undefined;
    const root = rootOf(d);
    const parent = asDoc(d.parent);

    const record: ChangeRecord = {
      v: CHANGE_JOURNAL_VERSION,
      key,
      seq: 0,
      t,
      actionId,
      op,
      userId: typeof userId === 'string' ? userId : null,
      userName: str(author?.name) ?? null,
      userIsGM: author?.isGM === true,
      documentName: str(d.documentName) ?? '',
      uuid,
      parentUuid: str(parent?.uuid) ?? null,
      name: nameOf(d),
      rootUuid: str(root.uuid) ?? uuid,
      rootName: nameOf(root),
      sceneId: sceneIdOf(d),
    };

    if (op === 'update') {
      if (!this.addUpdateValues(record, d, id, changed, options, stash)) return;
      record.modifiedTime = serverTime;
    } else if (op === 'create') {
      record.modifiedTime = statsTime(d, 'modifiedTime');
    } else {
      record.data = cloneValue(
        typeof d.toObject === 'function'
          ? (d as { toObject(source: boolean): Record<string, unknown> }).toObject(true)
          : sourceOf(d)
      );
    }

    Object.assign(record, markerOf(options));
    this.push(this.capSize(record));
  }

  /**
   * Fill `before`, `after` and `unknownBefore` of an update record. Returns
   * false when no recorded path is left (an update of ignored paths only).
   */
  private addUpdateValues(
    record: ChangeRecord,
    doc: DocLike,
    id: string | undefined,
    changed: unknown,
    options: unknown,
    stash: Record<string, unknown> | null
  ): boolean {
    const stashBefore = id ? asRecord(stash?.before)?.[id] : undefined;
    const before: PathValue[] | undefined = Array.isArray(stashBefore)
      ? (stashBefore as PathValue[])
      : undefined;
    const stashPaths = (before ?? []).map(v => v.path);
    const recursive = asRecord(options)?.recursive !== false;
    const unknownBefore = changedPaths(changed, recursive).filter(
      path => !isCoveredBy(path, stashPaths)
    );
    const paths = [...stashPaths, ...unknownBefore];
    if (paths.length === 0) return false;

    const source = sourceOf(doc);
    if (before) record.before = cloneValue(before);
    record.after = paths.map(path => readPath(source, path));
    if (unknownBefore.length > 0) record.unknownBefore = unknownBefore;
    return true;
  }

  /** A record over the size cap keeps its metadata but drops its values. */
  private capSize(record: ChangeRecord): ChangeRecord {
    let size = 0;
    try {
      size = JSON.stringify(record).length;
    } catch {
      size = Number.POSITIVE_INFINITY;
    }
    if (size <= CHANGE_JOURNAL_MAX_RECORD_BYTES) return record;
    delete record.before;
    delete record.after;
    delete record.data;
    delete record.unknownBefore;
    record.oversize = true;
    return record;
  }

  private push(record: ChangeRecord): void {
    this.seq += 1;
    record.seq = this.seq;
    this.buffer.push(record);
    if (this.buffer.length > CHANGE_JOURNAL_RING) {
      this.buffer.splice(0, this.buffer.length - CHANGE_JOURNAL_RING);
    }
  }

  /** Module query `foundry-mcp-bridge.getChangeJournal` (GM-gated by the caller, like `getPlayRecords`). */
  getChangeJournal(
    data: { sinceSeq?: unknown; limit?: unknown } | undefined
  ): ChangeJournalResponse {
    const sinceSeqRaw = num(data?.sinceSeq);
    const sinceSeq = sinceSeqRaw !== undefined && sinceSeqRaw >= 0 ? Math.trunc(sinceSeqRaw) : 0;
    const requested = num(data?.limit) ?? DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.trunc(requested), 1), CHANGE_JOURNAL_MAX_LIMIT);
    const records = this.buffer.filter(r => r.seq > sinceSeq).slice(0, limit);
    return {
      success: true,
      clientId: this.clientId,
      records,
      oldestSeq: this.buffer[0]?.seq ?? 0,
      latestSeq: this.buffer[this.buffer.length - 1]?.seq ?? 0,
    };
  }
}

export const changeJournal = new ChangeJournal();

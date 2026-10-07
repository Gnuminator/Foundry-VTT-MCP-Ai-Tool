/**
 * The undo planner (I-109): turns "undo this change" into one guarded plan, for anyone's change.
 *
 * `id` is a change from `list-changes`: `act:<actionId>` (a player's or the GM's own action, from
 * the change journal) or an audit changeId (the AI's, any mode). Three scopes:
 *
 *   - `just-this`: only that change. Values that changed since are not overwritten: an amount (hit
 *     points, uses, currency, ...) is adjusted by this change's part (HP 10 -> 5 undone after a
 *     later 5 -> 3 gives 8), anything else stays and is listed.
 *   - `everything-since`: that change and every later change to the same things (an actor with its
 *     items and effects, a token, a scene object, a journal), all taken back to how they were
 *     before the first one.
 *   - `world-since`: everything at the table since then (a rewind; needs `rewindTable`).
 *
 * The set is folded into one op per document (`undo-fold.ts`), checked against how the documents
 * are now, and handed to `createPlan` as feature `change-undo`. Nothing is applied here: the caller
 * confirms with `apply-planned-change`. The resulting audit entry names what it undid (`undoes`), so
 * undoing it again is the redo, and `computeUndoState` makes the changes live again.
 */
import type { GuardedOp, OpSnapshot, PathValue } from '@gnuminator/shared';

import {
  labelOf,
  undoBlocker,
  type ChangeAction,
  type ChangeHistory,
  type UserNames,
} from '../change-history.js';
import type { FoundryClient } from '../foundry-client.js';
import type { AuditEntry, AuditLog } from '../vault/audit.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import type { GuardedWriteService, PlanView } from './service.js';
import {
  foldEvents,
  opOf,
  orderOps,
  rootOfUuid,
  type DocEvent,
  type NetChange,
  type NetUpdate,
} from './undo-fold.js';
import { actionKey, computeUndoState, UNDO_FEATURE, type UndoState } from './undo-state.js';
import { formatValue, samePathValue } from './values.js';

export { UNDO_FEATURE };
/** Most later changes a `just-this` plan view lists. */
export const MAX_LATER = 20;
/** Most ops one plan holds (the service's limit; checked first for a clear message). */
const MAX_PLAN_OPS = 200;

export const UNDO_SCOPES = ['just-this', 'everything-since', 'world-since'] as const;
export type UndoScope = (typeof UNDO_SCOPES)[number];

export interface UndoPlanRequest {
  /** `act:<actionId>` or a changeId, from `list-changes`. */
  id: string;
  scope?: UndoScope;
  /** Required for `world-since`: the GM means to rewind everything at the table. */
  rewindTable?: boolean;
}

/** A later change to the same thing, so a UI can offer "Everything since". */
export interface LaterChange {
  id: string;
  at: string;
  by: string;
  summary: string;
}

export interface UndoPlanView extends PlanView {
  scope: UndoScope;
  /** `just-this` only: later live changes to the same things, newest first (at most MAX_LATER). */
  later: LaterChange[];
  /** How many changes (history items) the plan undoes: what a UI names on the confirm button. */
  count: number;
}

export interface UndoPlannerOptions {
  /** `userNames` is optional: without it, ownership lines name users by id. */
  changeHistory: Pick<ChangeHistory, 'humanActions'> & Partial<Pick<ChangeHistory, 'userNames'>>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  audit: Pick<AuditLog, 'ring' | 'resultsWithDeleted'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  foundryClient: Pick<FoundryClient, 'query'>;
}

/** One change in the history, from either source, before its documents are looked at. */
interface Item {
  id: string;
  kind: 'human' | 'ai';
  /** Epoch ms of the first change. */
  t: number;
  by: string;
  summary: string;
  /** The things (`rootUuid`) it touches. */
  roots: string[];
  thingName: string | null;
  action?: ChangeAction;
  entry?: AuditEntry;
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function humanItem(action: ChangeAction): Item {
  const records = action.records.filter(r => !r.changeId);
  return {
    id: `act:${action.actionId}`,
    kind: 'human',
    t: action.t,
    by: action.userName ?? 'Unknown user',
    summary: action.summary,
    roots: distinct(records.map(r => r.rootUuid)),
    thingName: action.things[0]?.name ?? null,
    action,
  };
}

function aiItem(entry: AuditEntry): Item {
  const results = entry.results ?? [];
  const roots = distinct(results.map(r => rootOfUuid(r.uuid)));
  const root = results.find(r => r.uuid === roots[0]) ?? results[0];
  return {
    id: entry.changeId,
    kind: 'ai',
    t: Date.parse(entry.appliedAt),
    // An undo or redo a person asked for in a Foundry window is theirs, as the window shows it.
    by:
      entry.requestedBy && (entry.mode === 'undo' || entry.feature === UNDO_FEATURE)
        ? entry.requestedBy
        : 'AI',
    summary: entry.summary,
    roots,
    thingName: root?.name ?? null,
    entry,
  };
}

function laterOf(item: Item): LaterChange {
  return { id: item.id, at: new Date(item.t).toISOString(), by: item.by, summary: item.summary };
}

// ---------------------------------------------------------------------------
// Events: what each change did to each document

interface Collected {
  events: DocEvent[];
  notes: string[];
}

/** People's records as document events; records that cannot be put back are left out and said. */
function humanEvents(item: Item, out: Collected, nextOrder: () => number): void {
  for (const r of item.action?.records ?? []) {
    if (r.changeId) continue;
    const what = r.name ?? r.rootName ?? r.uuid;
    if (r.oversize) {
      out.notes.push(`Kept as it is: ${what} (the details of the change were too large to keep)`);
      continue;
    }
    if (r.op === 'delete' && !r.data) {
      out.notes.push(`Not restored: ${what} (its data was not kept)`);
      continue;
    }
    out.events.push({
      t: r.t,
      order: nextOrder(),
      itemId: item.id,
      op: r.op,
      uuid: r.uuid,
      documentName: r.documentName,
      parentUuid: r.parentUuid,
      name: r.name,
      ...(r.before ? { before: r.before } : {}),
      ...(r.after ? { after: r.after } : {}),
      ...(r.unknownBefore ? { unknownBefore: r.unknownBefore } : {}),
      ...(r.data ? { source: r.data } : {}),
      ...(r.modifiedTime !== undefined ? { modifiedTime: r.modifiedTime } : {}),
    });
  }
}

/** The module's own rules-version stamp, written along with a guarded write: not the GM's change. */
function isOwnStamp(path: string): boolean {
  return (
    path === 'flags.foundry-mcp-bridge.rules' || path.startsWith('flags.foundry-mcp-bridge.rules.')
  );
}

function aiEvents(
  item: Item,
  results: NonNullable<AuditEntry['results']>,
  out: Collected,
  nextOrder: () => number
): void {
  for (const r of results) {
    if (r.kind === 'delete' && !r.deleted) {
      out.notes.push(`Not restored: ${r.name ?? r.uuid} (its data was not kept)`);
      continue;
    }
    out.events.push({
      t: item.t,
      order: nextOrder(),
      itemId: item.id,
      op: r.kind,
      uuid: r.uuid,
      documentName: r.documentName,
      parentUuid: r.parentUuid,
      name: r.name,
      ...(r.before ? { before: r.before.filter(v => !isOwnStamp(v.path)) } : {}),
      ...(r.after ? { after: r.after.filter(v => !isOwnStamp(v.path)) } : {}),
      ...(r.deleted ? { source: r.deleted } : {}),
      ...(r.modifiedTime !== undefined ? { modifiedTime: r.modifiedTime } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Checking a net change against how the document is now

/**
 * Amounts that add up, so a later change on top can keep its part: hit points, temporary hit
 * points, uses (an item's and its activities'), spell slots, hit dice, currency, quantity,
 * experience and death saves. Codes and
 * positions (a door's state, ownership levels, x and y, disposition, the combat turn) are not
 * amounts: 2 + (0 - 1) would turn a locked door into an open one.
 */
const AMOUNT_PATH =
  /^system\.(attributes\.hp\.(value|temp)|attributes\.death\.(success|failure)|currency\.[a-z]+|quantity|uses\.(value|spent)|activities\.[A-Za-z0-9]+\.uses\.spent|spells\.[a-z0-9]+\.value|resources\.[a-z]+\.value|hd\.spent|details\.xp\.value)$/;

/** A path to adjust: a known amount, or a `.value` with a numeric `.max` beside it. */
function isAmountPath(path: string, valueAt: (path: string) => PathValue): boolean {
  if (AMOUNT_PATH.test(path)) return true;
  if (!path.endsWith('.value')) return false;
  const max = valueAt(`${path.slice(0, -'.value'.length)}.max`);
  return max.present && isNumber(max.value);
}

/** The new value for an amount another change touched since: this change's part is taken back. */
function adjustedNumber(
  net: NetUpdate['paths'][number],
  now: PathValue,
  valueAt: (path: string) => PathValue
): number | null {
  const { before, after } = net;
  if (!before.present || !after?.present || !now.present) return null;
  if (!isNumber(before.value) || !isNumber(after.value) || !isNumber(now.value)) return null;
  if (!isAmountPath(net.path, valueAt)) return null;
  let value = Math.max(0, now.value + (before.value - after.value));
  if (net.path.endsWith('.value')) {
    const max = valueAt(`${net.path.slice(0, -'.value'.length)}.max`);
    if (max.present && isNumber(max.value)) value = Math.min(value, max.value);
  }
  return value;
}

/** The paths of an update that are still worth writing, with a note for each one that is kept. */
function checkedPaths(
  net: NetUpdate,
  snapshot: OpSnapshot,
  justThis: boolean,
  notes: string[],
  users?: UserNames
): PathValue[] {
  const valueAt = (path: string): PathValue =>
    snapshot.values?.find(v => v.path === path) ?? { path, present: false };
  const who = net.name ?? net.uuid;
  const keep: PathValue[] = [];
  for (const p of net.paths) {
    const now = valueAt(p.path);
    if (justThis && p.after && !samePathValue(now, p.after)) {
      // Something changed it after this change: do not overwrite that.
      const adjusted = adjustedNumber(p, now, valueAt);
      if (adjusted === null) {
        notes.push(
          `Kept, changed later: ${who}: ${labelOf(p.path, users) ?? p.path} stays ${formatValue(now)}`
        );
      } else if (now.present && adjusted !== now.value) {
        keep.push({ path: p.path, present: true, value: adjusted });
      }
      continue;
    }
    if (!samePathValue(now, p.before)) keep.push(p.before);
  }
  return keep;
}

/** The probe op that reads the current values of an update's paths, and the `.max` next to a `.value`. */
function probeOf(net: NetChange): GuardedOp {
  if (net.kind !== 'update') return opOf(net);
  const changes: Record<string, unknown> = {};
  for (const p of net.paths) {
    changes[p.path] = p.before.present ? p.before.value : null;
    if (p.path.endsWith('.value')) changes[`${p.path.slice(0, -'.value'.length)}.max`] ??= null;
  }
  return { kind: 'update', uuid: net.uuid, changes };
}

// ---------------------------------------------------------------------------
// The planner

export class UndoPlanner {
  private readonly changeHistory: UndoPlannerOptions['changeHistory'];
  private readonly guardedWrites: UndoPlannerOptions['guardedWrites'];
  private readonly audit: UndoPlannerOptions['audit'];
  private readonly worldIds: UndoPlannerOptions['worldIds'];
  private readonly foundry: UndoPlannerOptions['foundryClient'];

  constructor(options: UndoPlannerOptions) {
    this.changeHistory = options.changeHistory;
    this.guardedWrites = options.guardedWrites;
    this.audit = options.audit;
    this.worldIds = options.worldIds;
    this.foundry = options.foundryClient;
  }

  /** Plan the undo; nothing is changed until the plan is applied with `apply-planned-change`. */
  async plan(request: UndoPlanRequest): Promise<UndoPlanView> {
    const scope = request.scope ?? 'just-this';
    if (!UNDO_SCOPES.includes(scope)) throw new Error(`Unknown undo scope: ${String(scope)}`);
    if (scope === 'world-since' && request.rewindTable !== true) {
      throw new Error(
        'Rewinding the table undoes every change at the table since then, not only one thing. Set rewindTable: true if that is what you want.'
      );
    }
    const worldId = await this.worldIds.current();
    const ring = await this.audit.ring(worldId);
    const state = computeUndoState(ring);
    const actions = await this.changeHistory.humanActions();
    const users = await this.changeHistory.userNames?.();

    const items = [...actions.map(humanItem), ...ring.filter(e => e.results?.length).map(aiItem)];
    items.sort((a, b) => a.t - b.t);
    const target = this.resolveTarget(request.id, items, ring, actions, state);
    const touches = (i: Item): boolean => i.roots.some(root => target.roots.includes(root));
    // Everything after the target, undone or not: an undone change and the undo that took it back
    // both lie after it and cancel out in the fold. Leaving out only the undone one would restore
    // the undo's "before" (the state after the change), not the state before the target.
    const since = items.filter(i => i.id !== target.id && i.t > target.t);
    // What the GM sees as later changes (the dialog, and the number adjustment of `just-this`).
    const touching = since.filter(i => !state.has(i.id) && touches(i));

    const notes: string[] = [];
    const chosen =
      scope === 'just-this' ? [] : scope === 'world-since' ? since : since.filter(touches);
    const skipped = chosen.filter(i => this.skipItem(i, notes));
    const set = [target, ...chosen.filter(i => !skipped.includes(i))];
    // A skipped change stays live, so the documents it wrote stay as they are: restoring an older
    // value there would take back its Foundry part while the history shows it live.
    const keptDocs = new Set(skipped.flatMap(i => (i.entry?.results ?? []).map(r => r.uuid)));

    const collected = await this.collect(worldId, set);
    notes.unshift(...collected.notes);
    const justThis = scope === 'just-this';
    // Left out before the fold, so a kept document inside one that comes back stays as it is too.
    const keptNames = new Map<string, string>();
    const events = collected.events.filter(e => {
      if (!keptDocs.has(e.uuid)) return true;
      keptNames.set(e.uuid, e.name ?? keptNames.get(e.uuid) ?? e.uuid);
      return false;
    });
    for (const name of keptNames.values()) {
      notes.push(`Kept as it is: ${name} (a change that is not undone wrote to it)`);
    }
    const { ops, resolved } = await this.resolveOps(
      foldEvents(events),
      justThis,
      justThis && touching.length > 0,
      notes,
      users
    );
    if (ops.length === 0) {
      const why = notes.length > 0 ? notes.join('; ') : 'everything is already as it was before';
      throw new Error(`There is nothing to undo: ${why}.`);
    }
    if (ops.length > MAX_PLAN_OPS) {
      throw new Error(
        `That would change ${ops.length} documents (a plan holds at most ${MAX_PLAN_OPS}). Undo a smaller part.`
      );
    }

    const pathLabels: Record<string, string> = {};
    for (const net of resolved) {
      if (net.kind !== 'update') continue;
      for (const p of net.paths) {
        const label = labelOf(p.path, users);
        if (label) pathLabels[p.path] = label;
      }
    }
    const view = await this.guardedWrites.createPlan({
      feature: UNDO_FEATURE,
      summary: this.summaryOf(scope, target, set.filter(i => !state.has(i.id)).length),
      ops,
      notes,
      pathLabels,
      undoes: this.undoes(set, items, ring, state),
      ...(scope === 'world-since' ? { risk: 'destructive' as const } : {}),
    });
    return {
      ...view,
      scope,
      // The changes the GM sees as live; an undone one and its undo cancel out.
      count: set.filter(i => !state.has(i.id)).length,
      later: justThis ? [...touching].reverse().slice(0, MAX_LATER).map(laterOf) : [],
    };
  }

  // -------------------------------------------------------------------------

  private resolveTarget(
    id: string,
    items: Item[],
    ring: AuditEntry[],
    actions: ChangeAction[],
    state: UndoState
  ): Item {
    const undone = state.get(id);
    if (id.startsWith('act:')) {
      const action = actions.find(a => `act:${a.actionId}` === id);
      if (!action) {
        throw new Error(
          `No change ${id} in the last days of history (it may be older than 7 days)`
        );
      }
      if (undone) throw new Error(`Change ${id} was already undone (${undone.undoneBy})`);
      const blocker = undoBlocker(action);
      if (blocker) throw new Error(`Change ${id} cannot be undone: ${blocker}`);
      return items.find(i => i.id === id) ?? humanItem(action);
    }
    const entry = ring.find(e => e.changeId === id);
    if (!entry) throw new Error(`No recorded change ${id}`);
    if (undone) throw new Error(`Change ${id} was already undone (${undone.undoneBy})`);
    if ((entry.vaultOps?.length ?? 0) > 0) {
      throw new Error(
        `Change ${id} also wrote to the AI Tool's own data, which this cannot put back: undo it with undo-change`
      );
    }
    if (!entry.results?.length) throw new Error(`Change ${id} has nothing to undo`);
    return aiItem(entry);
  }

  /** A later change that wrote to the AI Tool's own data cannot join a bigger undo: say so. */
  private skipItem(item: Item, notes: string[]): boolean {
    if ((item.entry?.vaultOps?.length ?? 0) === 0) return false;
    notes.push(
      `Not undone: "${item.summary}" also wrote to the AI Tool's own data (undo it with undo-change)`
    );
    return true;
  }

  private async collect(worldId: string, set: Item[]): Promise<Collected> {
    const out: Collected = { events: [], notes: [] };
    let order = 0;
    const nextOrder = (): number => (order += 1);
    for (const item of set) {
      if (item.action) humanEvents(item, out, nextOrder);
      else if (item.entry) {
        aiEvents(item, await this.audit.resultsWithDeleted(worldId, item.entry), out, nextOrder);
      }
    }
    return out;
  }

  /**
   * Look at the documents as they are now: drop what is already as it was (or gone), keep newer
   * values when one change is undone alone, and put the ops in an order the module can run.
   */
  private async resolveOps(
    folded: NetChange[],
    justThis: boolean,
    laterTouches: boolean,
    notes: string[],
    users?: UserNames
  ): Promise<{ ops: GuardedOp[]; resolved: NetChange[] }> {
    // A document inside one that is deleted goes with it.
    const deleted = folded.filter(n => n.kind === 'delete').map(n => n.uuid);
    const net = folded.filter(n => !deleted.some(parent => n.uuid.startsWith(`${parent}.`)));
    if (net.length === 0) return { ops: [], resolved: [] };
    if (net.length > MAX_PLAN_OPS) {
      throw new Error(
        `That would change ${net.length} documents (a plan holds at most ${MAX_PLAN_OPS}). Undo a smaller part.`
      );
    }
    const snapshots = unwrap<OpSnapshot[]>(
      await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops: net.map(probeOf) }),
      'Snapshot refused'
    );
    if (!Array.isArray(snapshots) || snapshots.length !== net.length) {
      throw new Error('Foundry returned an unexpected snapshot');
    }
    // A child cannot be created before its parent exists: when both come back in one plan, the
    // snapshot (taken before) would refuse the child, so it is left out and said.
    const recreated = new Set(net.filter(n => n.kind === 'create').map(n => n.uuid));

    const ops: GuardedOp[] = [];
    const changeOfOp = new Map<GuardedOp, NetChange>();
    const keep = (change: NetChange, op: GuardedOp): void => {
      ops.push(op);
      changeOfOp.set(op, change);
    };
    net.forEach((change, i) => {
      const snap = snapshots[i];
      const who = change.name ?? change.uuid;
      if (change.kind === 'create') {
        if (change.parentUuid && recreated.has(change.parentUuid)) {
          notes.push(`Not restored: ${who} (what it belonged to is restored in the same step)`);
        } else if (snap.idTaken) {
          if (justThis)
            throw new Error(`${who} cannot be restored: a document with its id exists again`);
          notes.push(`Skipped: ${who} exists again`);
        } else if (!snap.exists) {
          notes.push(`Not restored: ${who} (what it belonged to is gone)`);
        } else {
          for (const child of change.unrecorded ?? []) {
            const labels = child.paths.map(path => labelOf(path, users) ?? path).join(', ');
            notes.push(`Not recorded, kept: ${child.name ?? child.uuid}: ${labels}`);
          }
          keep(change, opOf(change));
        }
      } else if (!snap.exists) {
        // A document the set created is already gone (dnd5e removes Bloodied by itself): as wanted.
        if (change.kind !== 'delete') notes.push(`Skipped: ${who} no longer exists`);
      } else if (change.kind === 'delete') {
        const changedSince =
          isNumber(change.modifiedTime) && isNumber(snap.modifiedTime)
            ? change.modifiedTime !== snap.modifiedTime
            : !isNumber(snap.modifiedTime) && laterTouches;
        if (justThis && changedSince) notes.push(`${who}: later changes to it go with it`);
        keep(change, opOf(change));
      } else {
        const paths = checkedPaths(change, snap, justThis, notes, users);
        if (change.unrecorded.length > 0) {
          const labels = change.unrecorded.map(path => labelOf(path, users) ?? path).join(', ');
          notes.push(`Not recorded, kept: ${who}: ${labels}`);
        }
        if (paths.length > 0) keep(change, opOf(change, paths));
      }
    });
    const ordered = orderOps(ops);
    return { ops: ordered, resolved: ordered.map(op => changeOfOp.get(op) as NetChange) };
  }

  private summaryOf(scope: UndoScope, target: Item, count: number): string {
    const when = clock(target.t);
    if (scope === 'just-this') return `Undo: ${target.summary}`;
    if (scope === 'everything-since') {
      return `Undo since ${when}: ${plural(count, 'change')} on ${target.thingName ?? 'this thing'}`;
    }
    return `Rewind the table to ${when}: ${plural(count, 'change')}`;
  }

  /**
   * What the new audit entry says it undid: the set, plus what an undone undo in the set had
   * undone when that lies after the first change (the rewind goes past it, so it stays undone).
   * A live undo in the set is taken back, so its targets come back: they are not added.
   */
  private undoes(
    set: Item[],
    items: Item[],
    ring: AuditEntry[],
    state: UndoState
  ): { actions?: string[]; changes?: string[] } {
    const oldest = Math.min(...set.map(i => i.t));
    const timeOf = new Map(items.map(i => [i.id, i.t]));
    for (const entry of ring) timeOf.set(entry.changeId, Date.parse(entry.appliedAt));
    const targets = set
      .filter(i => state.has(i.id))
      .flatMap(i => [
        ...(i.entry?.undoOf ? [i.entry.undoOf] : []),
        ...(i.entry?.undoes?.changes ?? []),
        ...(i.entry?.undoes?.actions ?? []).map(actionKey),
      ]);
    const extra = targets.filter(id => (timeOf.get(id) ?? 0) > oldest);
    const ids = distinct([...set.map(i => i.id), ...extra]);
    const actionIds = ids.filter(id => id.startsWith('act:')).map(id => id.slice(4));
    const changeIds = ids.filter(id => !id.startsWith('act:'));
    return {
      ...(actionIds.length > 0 ? { actions: actionIds } : {}),
      ...(changeIds.length > 0 ? { changes: changeIds } : {}),
    };
  }
}

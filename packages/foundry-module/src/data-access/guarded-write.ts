/**
 * Guarded writes, module side (plan step 0.2).
 *
 * The backend owns plans, confirmation and the audit log (kept in the
 * off-Foundry vault, so previous values never sit in world data that every
 * client receives). This file is the part that must run inside Foundry:
 *
 * - `snapshotGuardedOps` reads the current state of everything a plan touches
 *   (for the diff at plan time, and as the expected state at apply time).
 * - `applyGuardedOps` applies a confirmed plan, or undoes an applied one, after
 *   re-checking every precondition: a GM client, the master "Allow Write
 *   Operations" setting, the feature's own switch (apply only), and that the
 *   documents still look exactly like the expected state (a conflict writes
 *   nothing). Actors and Items it touches get the 2014/2024 rules tag. A failed
 *   op rolls back the ops before it. Success is logged to the GM-only session
 *   feed as a `gm-change` event.
 *
 * Wire types mirror `shared/src/guarded-write.ts` (the module does not import
 * the shared package); `GUARDED_OP_KINDS` is compared in a test.
 */
import { MODULE_ID } from '../constants.js';
import { eventTracker } from '../session-events.js';
import { isFeatureEnabled, isKnownFeature } from '../guarded-features.js';
import { unsetKeyUpdate } from '../systems/core.js';
import {
  RULES_FLAG_PATH,
  rulesTagForCreate,
  rulesTagUpdateIfChanged,
  type RulesVersion,
} from '../systems/dnd5e/rules-version.js';

// ---------------------------------------------------------------------------
// Wire types (mirror of shared/src/guarded-write.ts)
// ---------------------------------------------------------------------------

export const GUARDED_OP_KINDS = ['update', 'create', 'delete'] as const;

/** Set values at dot paths (`changes`) and remove keys (`unset`) on one document. */
export interface GuardedUpdateOp {
  kind: 'update';
  uuid: string;
  changes: Record<string, unknown>;
  unset?: string[];
}

/** Create a document: top-level (`documentName` only) or embedded (`parentUuid`). */
export interface GuardedCreateOp {
  kind: 'create';
  documentName: string;
  parentUuid?: string;
  data: Record<string, unknown>;
  /** Keep `data._id` (used by undo to restore a deleted document). */
  keepId?: boolean;
}

export interface GuardedDeleteOp {
  kind: 'delete';
  uuid: string;
}

export type GuardedOp = GuardedUpdateOp | GuardedCreateOp | GuardedDeleteOp;

/** A value at a path; JSON cannot carry `undefined`, so absence is explicit. */
export interface PathValue {
  path: string;
  present: boolean;
  value?: unknown;
}

/** The state of one op's target. */
export interface OpSnapshot {
  /** update/delete: the target exists. create: the parent exists (always true top-level). */
  exists: boolean;
  documentName?: string;
  name?: string | null;
  /** update: current values of every path the op sets or unsets. */
  values?: PathValue[];
  /** delete: `_stats.modifiedTime`, compared when the expected snapshot has one. */
  modifiedTime?: number | null;
  /** create with keepId: a document with that id already exists. */
  idTaken?: boolean;
}

export interface GuardedApplyRequest {
  changeId: string;
  feature: string;
  mode: 'apply' | 'undo';
  summary: string;
  ops: GuardedOp[];
  expected: OpSnapshot[];
  /** GM choice for the rules tag when detection cannot tell 2014 from 2024. */
  rulesVersion?: RulesVersion;
}

export interface GuardedOpResult {
  index: number;
  kind: GuardedOp['kind'];
  /** Target uuid (update/delete) or the created document's uuid. */
  uuid: string;
  documentName: string;
  name: string | null;
  parentUuid: string | null;
  /** update: values before and after, including the rules tag path when added. */
  before?: PathValue[];
  after?: PathValue[];
  /** delete: full source data before deletion (for undo). */
  deleted?: Record<string, unknown>;
  /** create: `_stats.modifiedTime` of the new document (undo conflict check). */
  modifiedTime?: number | null;
}

export interface GuardedApplyResult {
  changeId: string;
  mode: 'apply' | 'undo';
  appliedAt: string;
  results: GuardedOpResult[];
}

/**
 * `guardedApplyOutcome({changeId})` (lane 1, PB-04): what happened to an apply
 * whose reply the backend never got. Local mirror of the shared
 * `GuardedApplyOutcome` / `GUARDED_OUTCOME_MEMORY` (the module does not import
 * the shared package; `guarded-write.contract.test.ts` compares the values).
 */
export const GUARDED_OUTCOME_MEMORY = 50;

export type GuardedApplyOutcome =
  | { changeId: string; status: 'in-progress' }
  | { changeId: string; status: 'applied'; result: GuardedApplyResult }
  | { changeId: string; status: 'failed'; error: string }
  | { changeId: string; status: 'unknown' };

/** Largest plan the module accepts in one apply. */
const MAX_OPS = 200;

/** The last {@link GUARDED_OUTCOME_MEMORY} applies, oldest first (Map keeps insertion order). */
const outcomes = new Map<string, GuardedApplyOutcome>();

function rememberOutcome(outcome: GuardedApplyOutcome): void {
  // Re-inserting moves a repeated changeId (for example an undo) to the newest slot.
  outcomes.delete(outcome.changeId);
  outcomes.set(outcome.changeId, outcome);
  while (outcomes.size > GUARDED_OUTCOME_MEMORY) {
    const oldest = outcomes.keys().next();
    if (oldest.done) break;
    outcomes.delete(oldest.value);
  }
}

/** What this browser knows about an apply (`unknown` after a reload or for a stranger). */
export function guardedApplyOutcome(data: unknown): GuardedApplyOutcome {
  const changeId = (data as { changeId?: unknown } | null | undefined)?.changeId;
  if (typeof changeId !== 'string' || !changeId) {
    throw new Error('Outcome request needs a changeId');
  }
  return outcomes.get(changeId) ?? { changeId, status: 'unknown' };
}

/** Test hook: forget every remembered outcome. */
export function resetGuardedOutcomes(): void {
  outcomes.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON-stable stringify (sorted keys), for equality of plain data. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function sameValue(a: PathValue | undefined, b: PathValue | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.present !== b.present) return false;
  return !a.present || stableStringify(a.value) === stableStringify(b.value);
}

/** The document's stored (source) data. */
function sourceOf(doc: FoundryDocument): Record<string, unknown> {
  return doc.toObject(true);
}

function readPath(source: Record<string, unknown>, path: string): PathValue {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) {
      return { path, present: false };
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node === undefined ? { path, present: false } : { path, present: true, value: node };
}

function modifiedTimeOf(source: Record<string, unknown>): number | null {
  const stats = source._stats as { modifiedTime?: unknown } | undefined;
  return typeof stats?.modifiedTime === 'number' ? stats.modifiedTime : null;
}

function nameOf(doc: FoundryDocument): string | null {
  const name = (doc as { name?: unknown }).name;
  if (typeof name === 'string') return name;
  // A map note carries its label in `text`, so the diff and Recent Changes can name it.
  const text = doc.documentName === 'Note' ? (doc as { text?: unknown }).text : undefined;
  return typeof text === 'string' && text ? text : null;
}

/** The parent document of an embedded one, for diff labels; undefined when there is none. */
function parentOf(
  doc: FoundryDocument | null
): { documentName: string; name: string | null } | undefined {
  if (!doc) return undefined;
  const documentName = (doc as { documentName?: unknown }).documentName;
  if (typeof documentName !== 'string') return undefined;
  return { documentName, name: nameOf(doc) };
}

function updatePaths(op: GuardedUpdateOp): string[] {
  return [...Object.keys(op.changes), ...(op.unset ?? [])];
}

function documentClassFor(documentName: string): FoundryDocumentClass<FoundryDocument> {
  const fromConfig = (CONFIG[documentName] as { documentClass?: unknown } | undefined)
    ?.documentClass;
  const cls = fromConfig ?? (globalThis as Record<string, unknown>)[documentName];
  if (!cls || typeof (cls as { create?: unknown }).create !== 'function') {
    throw new Error(`Unknown document type: ${documentName}`);
  }
  return cls as FoundryDocumentClass<FoundryDocument>;
}

function isRulesTagged(documentName: string): boolean {
  return documentName === 'Actor' || documentName === 'Item';
}

async function resolve(uuid: string): Promise<FoundryDocument | null> {
  if (typeof uuid !== 'string' || !uuid) return null;
  return fromUuid(uuid);
}

/** Existing embedded/top-level document with a given id, for keepId creates. */
async function findExistingForCreate(op: GuardedCreateOp): Promise<boolean> {
  const id = op.data._id;
  if (!op.keepId || typeof id !== 'string') return false;
  const uuid = op.parentUuid
    ? `${op.parentUuid}.${op.documentName}.${id}`
    : `${op.documentName}.${id}`;
  return (await resolve(uuid)) !== null;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** The label of a document about to be created (a map note's is its `text`). */
function createName(op: GuardedCreateOp): string | null {
  const label = op.documentName === 'Note' ? (op.data.text ?? op.data.name) : op.data.name;
  return typeof label === 'string' ? label : null;
}

async function snapshotOp(op: GuardedOp): Promise<OpSnapshot> {
  switch (op.kind) {
    case 'update': {
      const doc = await resolve(op.uuid);
      if (!doc) return { exists: false };
      const source = sourceOf(doc);
      return {
        exists: true,
        documentName: doc.documentName,
        name: nameOf(doc),
        values: updatePaths(op).map(path => readPath(source, path)),
      };
    }
    case 'delete': {
      const doc = await resolve(op.uuid);
      if (!doc) return { exists: false };
      const parent = parentOf((doc as { parent?: FoundryDocument | null }).parent ?? null);
      return {
        exists: true,
        documentName: doc.documentName,
        name: nameOf(doc),
        modifiedTime: modifiedTimeOf(sourceOf(doc)),
        ...(parent ? { parent } : {}),
      };
    }
    case 'create': {
      const parent = op.parentUuid ? await resolve(op.parentUuid) : null;
      const parentLabel = parentOf(parent);
      return {
        exists: op.parentUuid ? parent !== null : true,
        documentName: op.documentName,
        name: createName(op),
        idTaken: await findExistingForCreate(op),
        ...(parentLabel ? { parent: parentLabel } : {}),
      };
    }
  }
}

function validateOps(ops: unknown): GuardedOp[] {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('A plan needs at least one op');
  if (ops.length > MAX_OPS) throw new Error(`A plan may hold at most ${MAX_OPS} ops`);
  for (const op of ops as GuardedOp[]) {
    if (!op || !(GUARDED_OP_KINDS as readonly string[]).includes(op.kind)) {
      throw new Error('Unknown op kind');
    }
    if (op.kind === 'update') {
      if (typeof op.uuid !== 'string' || !op.changes || typeof op.changes !== 'object') {
        throw new Error('An update op needs uuid and changes');
      }
      if (updatePaths(op).some(p => !p || p.startsWith('_id') || p.includes('-='))) {
        throw new Error('An update op cannot touch _id or use -= keys (use unset)');
      }
    } else if (op.kind === 'delete') {
      if (typeof op.uuid !== 'string') throw new Error('A delete op needs uuid');
    } else if (typeof op.documentName !== 'string' || !op.data || typeof op.data !== 'object') {
      throw new Error('A create op needs documentName and data');
    }
  }
  return ops as GuardedOp[];
}

/** Current state of every op's target (plan-time diff, apply-time expectations). */
export async function snapshotGuardedOps(ops: unknown): Promise<OpSnapshot[]> {
  const valid = validateOps(ops);
  const snapshots: OpSnapshot[] = [];
  for (const op of valid) snapshots.push(await snapshotOp(op));
  return snapshots;
}

// ---------------------------------------------------------------------------
// Apply / undo
// ---------------------------------------------------------------------------

/** Why `current` does not match `expected`, or null when it does. */
function conflictReason(op: GuardedOp, expected: OpSnapshot, current: OpSnapshot): string | null {
  if (op.kind === 'create') {
    if (!current.exists) return 'the parent document no longer exists';
    if (current.idTaken) return 'a document with that id already exists';
    return null;
  }
  if (expected.exists !== current.exists) {
    return current.exists ? 'the document exists again' : 'the document no longer exists';
  }
  if (op.kind === 'delete') {
    if (
      expected.modifiedTime !== undefined &&
      expected.modifiedTime !== null &&
      expected.modifiedTime !== current.modifiedTime
    ) {
      return 'the document was modified since';
    }
    return null;
  }
  for (const path of updatePaths(op)) {
    const want = expected.values?.find(v => v.path === path);
    const have = current.values?.find(v => v.path === path);
    if (!sameValue(want, have)) return `"${path}" changed since`;
  }
  return null;
}

function requireWriteAccess(req: GuardedApplyRequest): void {
  if (!game.user?.isGM) throw new Error('Guarded writes run on a GM client only');
  let writesAllowed = false;
  try {
    writesAllowed = game.settings.get(MODULE_ID, 'allowWriteOperations') === true;
  } catch {
    writesAllowed = false;
  }
  if (!writesAllowed) throw new Error('Write operations are disabled in the module settings');
  if (req.mode === 'apply') {
    if (!isKnownFeature(req.feature)) {
      throw new Error(`Unknown feature "${req.feature}" (not installed in this module version)`);
    }
    if (!isFeatureEnabled(req.feature)) {
      throw new Error(`The "${req.feature}" feature is switched off in the module settings`);
    }
  }
}

interface Executed {
  op: GuardedOp;
  result: GuardedOpResult;
}

async function executeUpdate(
  op: GuardedUpdateOp,
  index: number,
  req: GuardedApplyRequest
): Promise<GuardedOpResult> {
  const doc = await resolve(op.uuid);
  if (!doc) throw new Error(`Document not found: ${op.uuid}`);
  const changes: Record<string, unknown> = { ...op.changes };
  if (req.mode === 'apply' && isRulesTagged(doc.documentName) && !(RULES_FLAG_PATH in changes)) {
    Object.assign(changes, rulesTagUpdateIfChanged(doc as Actor | Item, req.rulesVersion));
  }
  const unset = op.unset ?? [];
  const paths = [...Object.keys(changes), ...unset];
  const beforeSource = sourceOf(doc);
  const before = paths.map(path => readPath(beforeSource, path));
  const ownershipKeys = unset.map(ownershipKeyOf).filter((key): key is string => key !== null);
  const update: Record<string, unknown> = { ...changes };
  for (const path of unset) {
    if (ownershipKeyOf(path) === null) Object.assign(update, unsetKeyUpdate(path));
  }
  if (Object.keys(update).length > 0) await doc.update(update);
  await removeOwnershipKeys(doc, ownershipKeys);
  const afterSource = sourceOf(doc);
  return {
    index,
    kind: 'update',
    uuid: doc.uuid,
    documentName: doc.documentName,
    name: nameOf(doc),
    parentUuid: doc.parent?.uuid ?? null,
    before,
    after: paths.map(path => readPath(afterSource, path)),
  };
}

/** The user key of a single-key `ownership.<key>` path, or null for any other path. */
function ownershipKeyOf(path: string): string | null {
  return /^ownership\.([^.]+)$/.exec(path)?.[1] ?? null;
}

/**
 * Foundry 14 rejects a deletion of one `ownership.<userId>` key (neither the
 * ForcedDeletion marker nor `-=`; seen live, F5 L3): it logs "ownership: is
 * not a mapping of user IDs and document permission levels" and keeps the
 * entry, so undoing "give Player OBSERVER" left it. Such keys are never sent
 * as deletions; when one is present, replace the whole ownership map without
 * it, the way Foundry's own ownership dialog does (`recursive: false`). Only
 * the top-level `ownership` field, so nothing else can be replaced by accident.
 */
async function removeOwnershipKeys(doc: FoundryDocument, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const current = (sourceOf(doc) as { ownership?: Record<string, unknown> }).ownership;
  if (!current || !keys.some(key => key in current)) return;
  const ownership = { ...current };
  for (const key of keys) delete ownership[key];
  await doc.update({ ownership }, { diff: false, recursive: false });
}

async function executeCreate(
  op: GuardedCreateOp,
  index: number,
  req: GuardedApplyRequest
): Promise<GuardedOpResult> {
  const data = foundry.utils.deepClone(op.data);
  if (req.mode === 'apply' && isRulesTagged(op.documentName)) {
    const tag = rulesTagForCreate(data, req.rulesVersion);
    if (tag) {
      const flags = (data.flags ??= {}) as Record<string, Record<string, unknown>>;
      flags[MODULE_ID] = { ...(flags[MODULE_ID] ?? {}), rules: tag };
    }
  }
  const operation = op.keepId ? { keepId: true } : {};
  let created: FoundryDocument | undefined;
  if (op.parentUuid) {
    const parent = await resolve(op.parentUuid);
    if (!parent) throw new Error(`Parent not found: ${op.parentUuid}`);
    const docs = await parent.createEmbeddedDocuments(op.documentName, [data], operation);
    created = docs[0] as FoundryDocument | undefined;
  } else {
    created = await documentClassFor(op.documentName).create(data, operation);
  }
  if (!created) throw new Error(`Foundry did not create the ${op.documentName}`);
  return {
    index,
    kind: 'create',
    uuid: created.uuid,
    documentName: op.documentName,
    name: nameOf(created),
    parentUuid: op.parentUuid ?? null,
    modifiedTime: modifiedTimeOf(sourceOf(created)),
  };
}

async function executeDelete(op: GuardedDeleteOp, index: number): Promise<GuardedOpResult> {
  const doc = await resolve(op.uuid);
  if (!doc) throw new Error(`Document not found: ${op.uuid}`);
  const deleted = sourceOf(doc);
  const result: GuardedOpResult = {
    index,
    kind: 'delete',
    uuid: doc.uuid,
    documentName: doc.documentName,
    name: nameOf(doc),
    parentUuid: doc.parent?.uuid ?? null,
    deleted,
  };
  await doc.delete();
  return result;
}

/** The op that reverses an executed op (used for rollback here and undo in the backend). */
export function inverseOf(executed: GuardedOpResult): GuardedOp {
  switch (executed.kind) {
    case 'update': {
      const changes: Record<string, unknown> = {};
      const unset: string[] = [];
      for (const value of executed.before ?? []) {
        if (value.present) changes[value.path] = value.value;
        else unset.push(value.path);
      }
      return { kind: 'update', uuid: executed.uuid, changes, unset };
    }
    case 'create':
      return { kind: 'delete', uuid: executed.uuid };
    case 'delete': {
      const op: GuardedCreateOp = {
        kind: 'create',
        documentName: executed.documentName,
        data: executed.deleted ?? {},
        keepId: true,
      };
      if (executed.parentUuid) op.parentUuid = executed.parentUuid;
      return op;
    }
  }
}

async function rollback(done: Executed[]): Promise<string[]> {
  const failures: string[] = [];
  const undoReq: GuardedApplyRequest = {
    changeId: 'rollback',
    feature: 'rollback',
    mode: 'undo',
    summary: 'rollback',
    ops: [],
    expected: [],
  };
  for (const { result } of [...done].reverse()) {
    try {
      await executeOp(inverseOf(result), result.index, undoReq);
    } catch (error) {
      failures.push(
        `op ${result.index}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return failures;
}

function executeOp(
  op: GuardedOp,
  index: number,
  req: GuardedApplyRequest
): Promise<GuardedOpResult> {
  switch (op.kind) {
    case 'update':
      return executeUpdate(op, index, req);
    case 'create':
      return executeCreate(op, index, req);
    case 'delete':
      return executeDelete(op, index);
  }
}

/**
 * Apply (or undo) a confirmed plan. Throws before writing anything when a
 * precondition fails or the documents changed since the plan was made.
 */
export async function applyGuardedOps(request: unknown): Promise<GuardedApplyResult> {
  const req = request as GuardedApplyRequest;
  if (!req || typeof req.changeId !== 'string' || !req.changeId) {
    throw new Error('Apply request needs a changeId');
  }
  if (req.mode !== 'apply' && req.mode !== 'undo') throw new Error('mode must be apply or undo');
  if (typeof req.feature !== 'string') throw new Error('Apply request needs a feature');
  const ops = validateOps(req.ops);
  if (!Array.isArray(req.expected) || req.expected.length !== ops.length) {
    throw new Error('Apply request needs one expected snapshot per op');
  }
  requireWriteAccess(req);

  rememberOutcome({ changeId: req.changeId, status: 'in-progress' });
  try {
    const result = await runGuardedApply(req, ops);
    rememberOutcome({ changeId: req.changeId, status: 'applied', result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberOutcome({ changeId: req.changeId, status: 'failed', error: message });
    throw error;
  }
}

async function runGuardedApply(
  req: GuardedApplyRequest,
  ops: GuardedOp[]
): Promise<GuardedApplyResult> {
  // Conflict check: every target must still look like the expected state.
  const current = await snapshotGuardedOps(ops);
  const conflicts: string[] = [];
  ops.forEach((op, i) => {
    const reason = conflictReason(op, req.expected[i], current[i]);
    if (reason) conflicts.push(`op ${i} (${op.kind}): ${reason}`);
  });
  if (conflicts.length > 0) {
    throw new Error(`Conflict, nothing was written: ${conflicts.join('; ')}`);
  }

  const done: Executed[] = [];
  for (const [index, op] of ops.entries()) {
    try {
      done.push({ op, result: await executeOp(op, index, req) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failures = await rollback(done);
      const rolled =
        failures.length === 0
          ? `the ${done.length} earlier op(s) were rolled back`
          : `rollback incomplete: ${failures.join('; ')}`;
      throw new Error(`Op ${index} (${op.kind}) failed: ${message}; ${rolled}`);
    }
  }

  const appliedAt = new Date().toISOString();
  eventTracker.logSessionEvent('gm-change', gmChangeText(req.mode, req.summary), {
    details: {
      changeId: req.changeId,
      feature: req.feature,
      mode: req.mode,
      ops: ops.length,
      documents: done.map(d => d.result.uuid),
    },
  });
  return { changeId: req.changeId, mode: req.mode, appliedAt, results: done.map(d => d.result) };
}

/**
 * Feed text for a change. The backend names an undo "Undo: <summary>", so an
 * undo reads "Undid: <summary>", not "Undid: Undo: <summary>".
 */
function gmChangeText(mode: unknown, summary: unknown): string {
  const text = typeof summary === 'string' ? summary : '';
  if (mode === 'undo') return `Undid: ${text.replace(/^Undo:\s*/, '')}`.trim();
  return `Applied: ${text}`.trim();
}

/**
 * Put a GM-only `gm-change` event in the session feed for a change the backend
 * applied itself (vault-only plans), so the dashboard feed shows it too.
 */
export function logGmChange(data: unknown): { logged: true } {
  const d = (data ?? {}) as {
    changeId?: unknown;
    feature?: unknown;
    summary?: unknown;
    mode?: unknown;
  };
  if (typeof d.changeId !== 'string' || typeof d.feature !== 'string') {
    throw new Error('logGmChange needs changeId and feature');
  }
  eventTracker.logSessionEvent('gm-change', gmChangeText(d.mode, d.summary), {
    details: { changeId: d.changeId, feature: d.feature, mode: d.mode ?? 'apply', vault: true },
  });
  return { logged: true };
}

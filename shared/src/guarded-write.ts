/**
 * @module guarded-write
 *
 * Wire types of the guarded-write flow (plan step 0.2), spoken between the
 * backend (which owns plans, confirmation and the audit log in its vault) and
 * the Foundry module (which snapshots and executes, re-checking every
 * precondition). The module keeps its own copy of these types in
 * `packages/foundry-module/src/data-access/guarded-write.ts` (it does not
 * import this package); a test compares `GUARDED_OP_KINDS` between the two.
 *
 * Bridge methods (all `foundry-mcp-bridge.*`, GM-gated):
 *   - `snapshotGuardedOps({ops})`          -> `OpSnapshot[]`
 *   - `applyGuardedOps(GuardedApplyRequest)` -> `GuardedApplyResult`
 *   - `logGmChange({changeId, feature, summary, mode})` -> `{logged: true}`
 *   - `listGuardedFeatures()`              -> `GuardedFeatureState[]`
 */

export const GUARDED_OP_KINDS = ['update', 'create', 'delete'] as const;

export type GuardedOpKind = (typeof GUARDED_OP_KINDS)[number];

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

export type RulesVersion = '2014' | '2024';

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
  kind: GuardedOpKind;
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

/** One feature switch as `listGuardedFeatures` reports it. */
export interface GuardedFeatureState {
  id: string;
  name: string;
  hint: string;
  enabled: boolean;
}

/** `write` needs `confirm`; `destructive` (any delete) also needs `confirmDestructive`. */
export type GuardedRisk = 'write' | 'destructive';

/**
 * The op that reverses an executed op. The backend builds undo plans with it;
 * the module keeps an identical copy for mid-plan rollback (compared in a test).
 *
 * - update: restore every recorded `before` value; a path that was absent is unset.
 * - create: delete the created document.
 * - delete: re-create it from the stored source data, keeping its id.
 */
export function inverseGuardedOp(executed: GuardedOpResult): GuardedOp {
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

/**
 * The state an undo expects to find: what the apply left behind. A document
 * that changed since then makes the undo report a conflict instead of
 * clobbering the newer edit.
 */
export function expectedAfterApply(executed: GuardedOpResult): OpSnapshot {
  switch (executed.kind) {
    case 'update':
      return { exists: true, values: executed.after ?? [] };
    case 'create':
      return { exists: true, modifiedTime: executed.modifiedTime ?? null };
    case 'delete':
      return { exists: true, idTaken: false };
  }
}

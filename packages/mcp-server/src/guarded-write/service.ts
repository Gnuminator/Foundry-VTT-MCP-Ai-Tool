/**
 * Guarded writes, backend side (plan step 0.2, as built).
 *
 * The backend owns plans, confirmation and the audit log; the Foundry module
 * only snapshots and executes, re-checking every precondition itself.
 *
 * 1. `createPlan` validates the ops, snapshots their targets (Foundry ops via
 *    `snapshotGuardedOps`, vault ops from the vault files), builds a readable
 *    diff and keeps the plan in memory (15 minutes, capped). Deletes make a
 *    plan `destructive`.
 * 2. `applyPlan` needs `confirm` (and `confirmDestructive` for a destructive
 *    plan), refuses a plan made for another world, and applies it with the
 *    plan-time snapshot as the expected state, so anything that changed since
 *    is reported as a conflict and nothing is written. The result goes to the
 *    vault audit ring.
 * 3. `undo` builds the inverse ops from the audit entry and expects the state
 *    the apply left behind; a document edited since reports a conflict instead
 *    of being clobbered. Undo needs "Allow Write Operations" (checked by the
 *    module) but not the feature switch.
 *
 * Vault ops change GM-only JSON files in the vault (secret feature data). They
 * are gated by the feature switch read from Foundry (`listGuardedFeatures`;
 * unreachable Foundry means refused) and logged to the GM feed best effort.
 *
 * All applies and undos run one at a time.
 */
import { randomBytes } from 'crypto';

import {
  GUARDED_OP_KINDS,
  expectedAfterApply,
  inverseGuardedOp,
  type GuardedApplyRequest,
  type GuardedApplyResult,
  type GuardedFeatureState,
  type GuardedOp,
  type GuardedRisk,
  type OpSnapshot,
  type PathValue,
  type RulesVersion,
} from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';
import type { AuditEntry, AuditLog, VaultOpRecord } from '../vault/audit.js';
import { AUDIT_FILE, AUDIT_HISTORY_FILE } from '../vault/audit.js';
import { assertFileName } from '../vault/paths.js';
import type { VaultEnvelope, VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import {
  formatValue,
  parseDataPath,
  readDataPath,
  samePathValue,
  stableStringify,
  writeDataPath,
} from './values.js';

export const PLAN_TTL_MS = 15 * 60 * 1000;
export const MAX_PLANS = 100;
export const MAX_OPS = 200;

const FEATURE_ID = /^[a-z][a-z0-9-]{1,40}$/;
/** Vault files features may not write through vault ops. */
const RESERVED_VAULT_FILES = new Set([AUDIT_FILE, AUDIT_HISTORY_FILE]);

/** Set a value at a dot path in a GM vault file (`gm/<file>`). */
export interface VaultSetOp {
  kind: 'vault-set';
  file: string;
  path: string;
  value: unknown;
}

/** Remove the value at a dot path in a GM vault file. */
export interface VaultDeleteOp {
  kind: 'vault-delete';
  file: string;
  path: string;
}

export type VaultOp = VaultSetOp | VaultDeleteOp;

export interface PlanInput {
  feature: string;
  summary: string;
  /** Foundry document ops (at least one of `ops` / `vaultOps`). */
  ops?: GuardedOp[];
  /** GM vault ops. With `ops` too, both parts are applied and undone together. */
  vaultOps?: VaultOp[];
  rulesVersion?: RulesVersion;
  /**
   * Raise the plan to destructive (second confirmation) even without deletes,
   * e.g. for a reveal that cannot be taken back at the table.
   */
  risk?: 'destructive';
}

/** Where a change is written. */
export type ChangeTarget = 'foundry' | 'vault' | 'mixed';

export interface DiffLine {
  op: number;
  kind: string;
  /** Document uuid, or `gm/<file>` for vault ops. */
  target: string;
  /** Readable target, e.g. `Actor "Ireena"`. */
  label: string;
  path?: string;
  before?: PathValue;
  after?: PathValue;
  text: string;
}

/** What tools return for a plan. */
export interface PlanView {
  planId: string;
  feature: string;
  summary: string;
  target: ChangeTarget;
  risk: GuardedRisk;
  worldId: string;
  createdAt: string;
  expiresAt: string;
  diff: DiffLine[];
  /** The confirmation this plan needs, for the caller's UI. */
  requires: { confirm: true; confirmDestructive: boolean };
}

interface StoredPlan extends PlanView {
  ops: GuardedOp[];
  expected: OpSnapshot[];
  vaultOps: VaultOp[];
  vaultExpected: PathValue[];
  rulesVersion?: RulesVersion;
  createdMs: number;
}

export interface ConfirmFlags {
  confirm?: boolean;
  confirmDestructive?: boolean;
}

export interface AppliedChange {
  changeId: string;
  planId: string | null;
  feature: string;
  summary: string;
  target: ChangeTarget;
  mode: 'apply' | 'undo';
  risk: GuardedRisk;
  appliedAt: string;
  undoOf?: string;
  diff: string[];
  documents?: string[];
}

/** A row of `list-recent-changes`. */
export interface RecentChange extends AppliedChange {
  undoneBy?: string;
  undoneAt?: string;
  canUndo: boolean;
}

export interface GuardedWriteServiceOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  audit: AuditLog;
  logger: Logger;
  now?: () => number;
  ttlMs?: number;
  maxPlans?: number;
  /**
   * Called after an apply or undo was recorded in the audit log. A throwing
   * listener is caught and logged; it never breaks the apply/undo.
   */
  onRecorded?: (worldId: string, changeId: string) => void;
}

function newId(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}-${randomBytes(4).toString('hex')}`;
}

function unwrap<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function validateFoundryOps(ops: unknown): GuardedOp[] {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('A plan needs at least one op');
  if (ops.length > MAX_OPS) throw new Error(`A plan may hold at most ${MAX_OPS} ops`);
  for (const op of ops as GuardedOp[]) {
    if (!op || !(GUARDED_OP_KINDS as readonly string[]).includes(op.kind)) {
      throw new Error(`Unknown op kind: ${JSON.stringify((op as { kind?: unknown })?.kind)}`);
    }
  }
  return ops as GuardedOp[];
}

function validateVaultOps(ops: unknown): VaultOp[] {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('A plan needs at least one op');
  if (ops.length > MAX_OPS) throw new Error(`A plan may hold at most ${MAX_OPS} ops`);
  for (const op of ops as VaultOp[]) {
    if (op?.kind !== 'vault-set' && op?.kind !== 'vault-delete') {
      throw new Error(`Unknown vault op kind: ${JSON.stringify((op as { kind?: unknown })?.kind)}`);
    }
    assertFileName(op.file);
    if (!op.file.endsWith('.json')) throw new Error(`Vault ops write .json files: ${op.file}`);
    if (RESERVED_VAULT_FILES.has(op.file)) throw new Error(`Reserved vault file: ${op.file}`);
    parseDataPath(op.path);
    if (op.kind === 'vault-set' && op.value === undefined) {
      throw new Error(`vault-set needs a value (${op.file} ${op.path})`);
    }
  }
  return ops as VaultOp[];
}

/** The value a vault op leaves at its path. */
function vaultTarget(op: VaultOp): PathValue {
  return op.kind === 'vault-set'
    ? { path: op.path, present: true, value: op.value }
    : { path: op.path, present: false };
}

/** A checked vault write: the files as read, and their new data. */
interface PreparedVaultWrite {
  current: Map<string, VaultEnvelope | null>;
  simulated: Map<string, unknown>;
}

function describeTarget(snapshot: OpSnapshot, fallback: string): string {
  const type = snapshot.documentName ?? 'Document';
  return snapshot.name ? `${type} "${snapshot.name}"` : `${type} ${fallback}`;
}

/** Diff lines for Foundry ops; throws when a target is missing. */
function foundryDiff(ops: GuardedOp[], snapshots: OpSnapshot[]): DiffLine[] {
  const lines: DiffLine[] = [];
  ops.forEach((op, i) => {
    const snap = snapshots[i];
    if (!snap) throw new Error(`No snapshot for op ${i}`);
    if (op.kind === 'update') {
      if (!snap.exists) throw new Error(`Op ${i}: document not found: ${op.uuid}`);
      const label = describeTarget(snap, op.uuid);
      const paths: Array<[string, PathValue]> = [
        ...Object.entries(op.changes).map(([path, value]): [string, PathValue] => [
          path,
          { path, present: true, value },
        ]),
        ...(op.unset ?? []).map((path): [string, PathValue] => [path, { path, present: false }]),
      ];
      for (const [path, after] of paths) {
        const before = snap.values?.find(v => v.path === path) ?? { path, present: false };
        lines.push({
          op: i,
          kind: 'update',
          target: op.uuid,
          label,
          path,
          before,
          after,
          text: `${label}: ${path}: ${formatValue(before)} → ${formatValue(after)}`,
        });
      }
    } else if (op.kind === 'create') {
      if (!snap.exists) throw new Error(`Op ${i}: parent not found: ${String(op.parentUuid)}`);
      if (snap.idTaken) throw new Error(`Op ${i}: a document with that id already exists`);
      const name = typeof op.data.name === 'string' ? ` "${op.data.name}"` : '';
      const where = op.parentUuid ? ` in ${op.parentUuid}` : '';
      const label = `${op.documentName}${name}`;
      lines.push({
        op: i,
        kind: 'create',
        target: op.parentUuid ?? op.documentName,
        label,
        text: `Create ${label}${where}`,
      });
    } else {
      if (!snap.exists) throw new Error(`Op ${i}: document not found: ${op.uuid}`);
      const label = describeTarget(snap, op.uuid);
      lines.push({
        op: i,
        kind: 'delete',
        target: op.uuid,
        label,
        text: `Delete ${label} (${op.uuid})`,
      });
    }
  });
  return lines;
}

export class GuardedWriteService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly foundry: Pick<FoundryClient, 'query'>;
  private readonly worldIds: Pick<WorldIdResolver, 'current'>;
  private readonly store: VaultStore;
  private readonly audit: AuditLog;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPlans: number;
  private readonly onRecorded: GuardedWriteServiceOptions['onRecorded'];
  private lock: Promise<unknown> = Promise.resolve();

  constructor(options: GuardedWriteServiceOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.audit = options.audit;
    this.logger = options.logger.child({ component: 'GuardedWriteService' });
    this.now = options.now ?? ((): number => Date.now());
    this.ttlMs = options.ttlMs ?? PLAN_TTL_MS;
    this.maxPlans = options.maxPlans ?? MAX_PLANS;
    this.onRecorded = options.onRecorded;
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  async createPlan(input: PlanInput): Promise<PlanView> {
    if (!input || typeof input.feature !== 'string' || !FEATURE_ID.test(input.feature)) {
      throw new Error(`Invalid feature id: ${JSON.stringify(input?.feature)}`);
    }
    if (typeof input.summary !== 'string' || !input.summary.trim()) {
      throw new Error('A plan needs a summary');
    }
    if (input.ops === undefined && input.vaultOps === undefined) {
      throw new Error('A plan needs Foundry ops, vault ops, or both');
    }
    if (input.rulesVersion !== undefined && !['2014', '2024'].includes(input.rulesVersion)) {
      throw new Error(`Unknown rules version: ${String(input.rulesVersion)}`);
    }
    if (input.risk !== undefined && input.risk !== 'destructive') {
      throw new Error(`Unknown risk override: ${String(input.risk)}`);
    }
    const ops = input.ops === undefined ? [] : validateFoundryOps(input.ops);
    const vaultOps = input.vaultOps === undefined ? [] : validateVaultOps(input.vaultOps);
    const worldId = await this.worldIds.current();
    const createdMs = this.now();

    const diff: DiffLine[] = [];
    let expected: OpSnapshot[] = [];
    if (ops.length > 0) {
      expected = unwrap<OpSnapshot[]>(
        await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops }),
        'Snapshot refused'
      );
      if (!Array.isArray(expected) || expected.length !== ops.length) {
        throw new Error('Foundry returned an unexpected snapshot');
      }
      diff.push(...foundryDiff(ops, expected));
    }
    const vaultExpected: PathValue[] = [];
    for (const [i, op] of vaultOps.entries()) {
      const current = await this.store.read(worldId, 'gm', op.file);
      // Earlier ops of this plan on the same file count as already applied.
      const simulated = vaultOps
        .slice(0, i)
        .filter(prev => prev.file === op.file)
        .reduce<unknown>((data, prev) => writeDataPath(data, vaultTarget(prev)), current?.data);
      const before = readDataPath(simulated, op.path);
      if (op.kind === 'vault-delete' && !before.present) {
        throw new Error(`Vault op ${i}: nothing to delete at ${op.file} ${op.path}`);
      }
      const after = vaultTarget(op);
      vaultExpected.push(before);
      const target = `gm/${op.file}`;
      diff.push({
        op: ops.length + i,
        kind: op.kind,
        target,
        label: target,
        path: op.path,
        before,
        after,
        text: `${target}: ${op.path}: ${formatValue(before)} → ${formatValue(after)}`,
      });
    }

    const deletes =
      ops.some(op => op.kind === 'delete') || vaultOps.some(op => op.kind === 'vault-delete');
    const risk: GuardedRisk = deletes || input.risk === 'destructive' ? 'destructive' : 'write';
    const target: ChangeTarget =
      ops.length > 0 && vaultOps.length > 0 ? 'mixed' : ops.length > 0 ? 'foundry' : 'vault';
    const plan: StoredPlan = {
      planId: newId('plan', createdMs),
      feature: input.feature,
      summary: input.summary.trim(),
      target,
      risk,
      worldId,
      createdAt: new Date(createdMs).toISOString(),
      expiresAt: new Date(createdMs + this.ttlMs).toISOString(),
      diff,
      requires: { confirm: true, confirmDestructive: risk === 'destructive' },
      ops,
      expected,
      vaultOps,
      vaultExpected,
      createdMs,
      ...(input.rulesVersion ? { rulesVersion: input.rulesVersion } : {}),
    };

    this.prune();
    while (this.plans.size >= this.maxPlans) {
      const oldest = [...this.plans.values()].sort((a, b) => a.createdMs - b.createdMs)[0];
      if (!oldest) break;
      this.plans.delete(oldest.planId);
    }
    this.plans.set(plan.planId, plan);
    return this.view(plan);
  }

  /** A plan that is still pending. */
  getPlan(planId: string): PlanView {
    return this.view(this.requirePlan(planId));
  }

  /** Pending plans, newest first. */
  listPlans(): PlanView[] {
    this.prune();
    return [...this.plans.values()]
      .sort((a, b) => b.createdMs - a.createdMs)
      .map(p => this.view(p));
  }

  // -------------------------------------------------------------------------
  // Apply / undo
  // -------------------------------------------------------------------------

  applyPlan(planId: string, flags: ConfirmFlags): Promise<AppliedChange> {
    return this.exclusive(async () => {
      const plan = this.requirePlan(planId);
      if (flags.confirm !== true) {
        throw new Error('Applying a planned change needs confirm: true');
      }
      if (plan.risk === 'destructive' && flags.confirmDestructive !== true) {
        throw new Error('This change deletes data; it needs confirmDestructive: true');
      }
      const worldId = await this.worldIds.current();
      if (worldId !== plan.worldId) {
        throw new Error(`This plan was made for world "${plan.worldId}", not "${worldId}"`);
      }
      const changeId = newId('chg', this.now());
      const applied = await this.applyChange(worldId, changeId, plan);
      this.plans.delete(plan.planId);
      return applied;
    });
  }

  undo(changeId: string, flags: ConfirmFlags): Promise<AppliedChange> {
    return this.exclusive(async () => {
      if (flags.confirm !== true) throw new Error('Undoing a change needs confirm: true');
      const worldId = await this.worldIds.current();
      const entry = await this.audit.get(worldId, changeId);
      if (!entry) throw new Error(`No recorded change ${changeId} in world "${worldId}"`);
      if (entry.mode !== 'apply')
        throw new Error('An undo cannot be undone; plan the change again');
      if (entry.undoneBy)
        throw new Error(`Change ${changeId} was already undone (${entry.undoneBy})`);
      const undoId = newId('chg', this.now());
      return this.undoChange(worldId, undoId, entry);
    });
  }

  async listRecentChanges(limit = 20): Promise<RecentChange[]> {
    const worldId = await this.worldIds.current();
    const entries = await this.audit.list(worldId, Math.min(Math.max(limit, 1), 500));
    return entries.map(e => ({
      ...this.appliedView(e),
      ...(e.undoneBy ? { undoneBy: e.undoneBy } : {}),
      ...(e.undoneAt ? { undoneAt: e.undoneAt } : {}),
      canUndo: e.mode === 'apply' && !e.undoneBy,
    }));
  }

  // -------------------------------------------------------------------------

  private async applyChange(
    worldId: string,
    changeId: string,
    plan: StoredPlan
  ): Promise<AppliedChange> {
    const records: VaultOpRecord[] = plan.vaultOps.map((op, i) => ({
      file: op.file,
      path: op.path,
      before: plan.vaultExpected[i],
      after: vaultTarget(op),
    }));
    // Vault part: feature switch + conflict check before anything is written.
    let vault: PreparedVaultWrite | null = null;
    if (records.length > 0) {
      await this.requireFeatureEnabled(plan.feature);
      vault = await this.prepareVaultWrite(
        worldId,
        records,
        r => r.before,
        r => r.after
      );
    }
    let foundry: GuardedApplyResult | null = null;
    if (plan.ops.length > 0) {
      foundry = await this.executeInFoundry({
        changeId,
        feature: plan.feature,
        mode: 'apply',
        summary: plan.summary,
        ops: plan.ops,
        expected: plan.expected,
        ...(plan.rulesVersion ? { rulesVersion: plan.rulesVersion } : {}),
      });
    }
    if (vault) await this.commitVaultOrRollBack(worldId, vault, foundry, plan.feature);

    const entry: AuditEntry = {
      changeId,
      planId: plan.planId,
      feature: plan.feature,
      summary: plan.summary,
      risk: plan.risk,
      target: plan.target,
      mode: 'apply',
      appliedAt: foundry?.appliedAt ?? new Date(this.now()).toISOString(),
      diff: plan.diff.map(d => d.text),
      ...(foundry ? { results: foundry.results } : {}),
      ...(records.length > 0 ? { vaultOps: records } : {}),
      ...(plan.rulesVersion ? { rulesVersion: plan.rulesVersion } : {}),
    };
    await this.record(worldId, entry, () => this.audit.append(worldId, entry));
    this.notifyRecorded(worldId, entry.changeId);
    // A Foundry apply logs its own gm-change event; vault-only changes do it here.
    if (!foundry) await this.logGmChange(entry);
    return this.appliedView(entry);
  }

  private async undoChange(
    worldId: string,
    undoId: string,
    entry: AuditEntry
  ): Promise<AppliedChange> {
    const results = [...(await this.audit.resultsWithDeleted(worldId, entry))].reverse();
    const records = [...(entry.vaultOps ?? [])].reverse();
    if (results.length === 0 && records.length === 0) {
      throw new Error(`Change ${entry.changeId} has nothing to undo`);
    }
    const summary = `Undo: ${entry.summary}`;
    const vault =
      records.length > 0
        ? await this.prepareVaultWrite(
            worldId,
            records,
            r => r.after,
            r => r.before
          )
        : null;
    let foundry: GuardedApplyResult | null = null;
    if (results.length > 0) {
      foundry = await this.executeInFoundry({
        changeId: undoId,
        feature: entry.feature,
        mode: 'undo',
        summary,
        ops: results.map(inverseGuardedOp),
        expected: results.map(expectedAfterApply),
      });
    }
    if (vault) await this.commitVaultOrRollBack(worldId, vault, foundry, entry.feature);

    const undoEntry: AuditEntry = {
      changeId: undoId,
      planId: null,
      feature: entry.feature,
      summary,
      risk: entry.risk,
      target: entry.target,
      mode: 'undo',
      appliedAt: foundry?.appliedAt ?? new Date(this.now()).toISOString(),
      diff: entry.diff.map(line => `undone: ${line}`),
      undoOf: entry.changeId,
      ...(foundry ? { results: foundry.results } : {}),
      ...(records.length > 0
        ? { vaultOps: records.map(r => ({ ...r, before: r.after, after: r.before })) }
        : {}),
    };
    await this.record(worldId, undoEntry, () => this.audit.recordUndo(worldId, undoEntry));
    this.notifyRecorded(worldId, undoEntry.changeId);
    if (!foundry) await this.logGmChange(undoEntry);
    return this.appliedView(undoEntry);
  }

  private notifyRecorded(worldId: string, changeId: string): void {
    if (!this.onRecorded) return;
    try {
      this.onRecorded(worldId, changeId);
    } catch (error) {
      this.logger.warn('onRecorded listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Write the prepared vault part. If that fails after the Foundry part was
   * written, reverse the Foundry part so the change is all or nothing.
   */
  private async commitVaultOrRollBack(
    worldId: string,
    vault: PreparedVaultWrite,
    foundry: GuardedApplyResult | null,
    feature: string
  ): Promise<void> {
    try {
      await this.commitVaultWrite(worldId, vault);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!foundry) throw error;
      const done = [...foundry.results].reverse();
      try {
        await this.executeInFoundry({
          changeId: `${foundry.changeId}-rollback`,
          feature,
          mode: 'undo',
          summary: 'Roll back (vault write failed)',
          ops: done.map(inverseGuardedOp),
          expected: done.map(expectedAfterApply),
        });
      } catch (rollbackError) {
        throw new Error(
          `The vault write failed (${message}) and the Foundry part could not be rolled back: ${
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }`
        );
      }
      throw new Error(`The vault write failed (${message}); the Foundry part was rolled back`);
    }
  }

  private async executeInFoundry(request: GuardedApplyRequest): Promise<GuardedApplyResult> {
    const result = unwrap<GuardedApplyResult>(
      await this.foundry.query('foundry-mcp-bridge.applyGuardedOps', request),
      'Foundry refused the change'
    );
    if (!result || !Array.isArray(result.results) || result.changeId !== request.changeId) {
      throw new Error('Foundry returned an unexpected apply result');
    }
    return result;
  }

  /**
   * Check every record's expected value (nothing is written on a conflict) and
   * compute the new file contents. Runs inside the service lock, and only this
   * service writes `gm/` feature files.
   */
  private async prepareVaultWrite(
    worldId: string,
    records: VaultOpRecord[],
    expectedOf: (r: VaultOpRecord) => PathValue,
    targetOf: (r: VaultOpRecord) => PathValue
  ): Promise<PreparedVaultWrite> {
    const conflicts: string[] = [];
    const current = new Map<string, VaultEnvelope | null>();
    for (const record of records) {
      if (!current.has(record.file)) {
        current.set(record.file, await this.store.read(worldId, 'gm', record.file));
      }
    }
    // Replay in order so several ops on one path compare against the right value.
    const simulated = new Map<string, unknown>(
      [...current].map(([file, envelope]) => [file, envelope?.data])
    );
    // After a conflict in a file, later ops on it are only reported, not replayed.
    const blocked = new Set<string>();
    for (const record of records) {
      const have = readDataPath(simulated.get(record.file), record.path);
      if (!samePathValue(have, expectedOf(record))) {
        conflicts.push(`${record.file} ${record.path} changed since`);
        blocked.add(record.file);
        continue;
      }
      if (blocked.has(record.file)) continue;
      try {
        simulated.set(record.file, writeDataPath(simulated.get(record.file), targetOf(record)));
      } catch (error) {
        conflicts.push(
          `${record.file} ${record.path}: ${error instanceof Error ? error.message : String(error)}`
        );
        blocked.add(record.file);
      }
    }
    if (conflicts.length > 0) {
      throw new Error(`Conflict, nothing was written: ${conflicts.join('; ')}`);
    }
    return { current, simulated };
  }

  private async commitVaultWrite(worldId: string, vault: PreparedVaultWrite): Promise<void> {
    for (const [file, before] of vault.current) {
      await this.store.update(worldId, 'gm', file, before?.schema ?? 1, envelope => {
        if (stableStringify(envelope?.data) !== stableStringify(before?.data)) {
          throw new Error(`${file} changed during the write`);
        }
        return vault.simulated.get(file) ?? {};
      });
    }
  }

  private async requireFeatureEnabled(feature: string): Promise<void> {
    let features: GuardedFeatureState[];
    try {
      features = unwrap<GuardedFeatureState[]>(
        await this.foundry.query('foundry-mcp-bridge.listGuardedFeatures'),
        'Feature list refused'
      );
    } catch (error) {
      throw new Error(
        `Cannot check the "${feature}" switch in Foundry, so the change was refused: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    const state = Array.isArray(features) ? features.find(f => f.id === feature) : undefined;
    if (!state) throw new Error(`Unknown feature "${feature}" (not installed in the module)`);
    if (state.enabled !== true) {
      throw new Error(`The "${feature}" feature is switched off in the module settings`);
    }
  }

  private async logGmChange(entry: AuditEntry): Promise<void> {
    try {
      await this.foundry.query('foundry-mcp-bridge.logGmChange', {
        changeId: entry.changeId,
        feature: entry.feature,
        summary: entry.summary,
        mode: entry.mode,
      });
    } catch (error) {
      this.logger.warn('Could not log the change to the GM feed', {
        changeId: entry.changeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Write the audit entry; a failure here means the change happened unrecorded. */
  private async record(
    worldId: string,
    entry: AuditEntry,
    write: () => Promise<AuditEntry>
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Change applied but not recorded in the audit log', {
        worldId,
        changeId: entry.changeId,
        error: message,
      });
      throw new Error(
        `Change ${entry.changeId} was ${entry.mode === 'undo' ? 'undone' : 'applied'} but could not be recorded in the vault audit log (so it cannot be undone from here): ${message}`
      );
    }
  }

  private appliedView(entry: AuditEntry): AppliedChange {
    const documents = entry.results?.map(r => r.uuid);
    return {
      changeId: entry.changeId,
      planId: entry.planId,
      feature: entry.feature,
      summary: entry.summary,
      target: entry.target,
      mode: entry.mode,
      risk: entry.risk,
      appliedAt: entry.appliedAt,
      ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
      diff: entry.diff,
      ...(documents ? { documents } : {}),
    };
  }

  private requirePlan(planId: string): StoredPlan {
    this.prune();
    const plan = typeof planId === 'string' ? this.plans.get(planId) : undefined;
    if (!plan) throw new Error(`No pending plan ${String(planId)} (plans expire after 15 minutes)`);
    return plan;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, plan] of this.plans) {
      if (plan.createdMs + this.ttlMs <= now) this.plans.delete(id);
    }
  }

  private view(plan: StoredPlan): PlanView {
    return {
      planId: plan.planId,
      feature: plan.feature,
      summary: plan.summary,
      target: plan.target,
      risk: plan.risk,
      worldId: plan.worldId,
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt,
      diff: plan.diff,
      requires: plan.requires,
    };
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.then(task, task);
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

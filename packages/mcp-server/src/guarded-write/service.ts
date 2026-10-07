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
 *    module, and here for vault ops) but not the feature switch.
 *
 * Vault ops change GM-only JSON files in the vault (secret feature data). They
 * are gated by "Allow Write Operations" and the feature switch, both read from
 * Foundry (`listGuardedFeatures`; unreachable Foundry means refused), and
 * logged to the GM feed best effort.
 *
 * All applies and undos run one at a time.
 */
import { randomBytes } from 'crypto';

import {
  GUARDED_OP_KINDS,
  expectedAfterApply,
  inverseGuardedOp,
  type GuardedApplyOutcome,
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
import { AUDIT_FILE, AUDIT_HISTORY_FILE, AUDIT_RING_SIZE } from '../vault/audit.js';
import { assertFileName } from '../vault/paths.js';
import type { VaultEnvelope, VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import { computeUndoState, redoFeatures, UNDO_FEATURE, type UndoState } from './undo-state.js';
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
/** A Foundry apply may take long (big batches); the default 10 s query timeout is too short. */
export const APPLY_TIMEOUT_MS = 120_000;
/** After a lost answer, ask the module how the apply went this often (PB-04) ... */
export const OUTCOME_POLL_INTERVAL_MS = 5_000;
/** ... and give up after this long. */
export const OUTCOME_DEADLINE_MS = 120_000;
/** The longest an apply or undo waits for its recorded-change listeners before it answers. */
export const LISTENER_WAIT_MS = 5_000;
/** Most players a plan's "show it now" may name. */
export const MAX_SHOW_USERS = 50;
/** Start of the diff text of a "show it now" line; an undo's diff leaves such lines out. */
export const SHOW_DIFF_PREFIX = 'Show it now:';
/** How long "show it now" waits for Foundry (it runs inside the guarded-write lock). */
export const SHOW_TIMEOUT_MS = 15_000;

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
  /**
   * Readable names for update paths the caller knows better than the bridge, e.g.
   * `{ "ownership.abc123": "ownership for Player" }` (F5 L3). Used in the diff text, which
   * Recent Changes and the undo keep.
   */
  pathLabels?: Record<string, string>;
  /**
   * "Show it now" (I-110): after a successful apply, pop this journal page (or journal) up on the
   * players' screens through Foundry's Show Players. `users` are Foundry user ids; empty means every
   * player who can see it. Undo takes back the change, never the popup.
   */
  showToPlayers?: { uuid: string; users: string[] };
  /**
   * The undo planner (I-109): the journal actions and audit changes this plan undoes. Carried onto
   * the audit entry the apply records, so the history can tell what is undone.
   */
  undoes?: { actions?: string[]; changes?: string[] };
  /**
   * Extra plain lines for the diff (kind `note`), for things the ops do not show: what an undo kept
   * on purpose, what it could not restore. They are part of the diff text the audit entry keeps.
   */
  notes?: string[];
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
  showToPlayers?: { uuid: string; users: string[] };
  undoes?: { actions?: string[]; changes?: string[] };
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
  /** Who asked, for a change made from a GM's window in Foundry or the dashboard. Absent for Claude. */
  requestedBy?: string;
  /** An undo made with plan-undo-changes: the people's actions and AI changes it took back. */
  undoes?: { actions?: string[]; changes?: string[] };
  diff: string[];
  documents?: string[];
  /** Only for an apply whose plan asked to show the page: whether the popup went out. */
  shown?: { ok: true; users: string[] } | { ok: false; error: string };
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
  /** Timeout of the apply query (default 120 s). */
  applyTimeoutMs?: number;
  /** How often to ask for the outcome after a lost answer (default 5 s). */
  outcomePollIntervalMs?: number;
  /** How long to keep asking (default 120 s). */
  outcomeDeadlineMs?: number;
  /** How long an apply or undo waits for its listeners (default 5 s; they go on after that). */
  listenerWaitMs?: number;
}

/**
 * A feature's own check before one of its changes is undone: the reason the undo would destroy
 * something the generic snapshot cannot see (a page the GM edited, a copy players already have),
 * or null to go ahead. A throwing guard refuses too.
 */
export type RecordedListener = (worldId: string, changeId: string) => void | Promise<void>;

export type UndoGuard = (worldId: string, entry: AuditEntry) => Promise<string | null>;

/** Errors that mean "no answer arrived", as opposed to Foundry refusing the change. */
function isLostAnswer(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /query timeout|connection closed|not connected/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function validateShowToPlayers(show: unknown): { uuid: string; users: string[] } {
  const { uuid, users } = (show ?? {}) as { uuid?: unknown; users?: unknown };
  if (
    typeof uuid !== 'string' ||
    !uuid ||
    !(uuid.includes('JournalEntryPage') || uuid.startsWith('JournalEntry.'))
  ) {
    throw new Error('showToPlayers needs the uuid of a journal page or journal');
  }
  if (
    !Array.isArray(users) ||
    users.length > MAX_SHOW_USERS ||
    users.some(u => typeof u !== 'string' || !u)
  ) {
    throw new Error(`showToPlayers users must be a list of at most ${MAX_SHOW_USERS} user ids`);
  }
  return { uuid, users: [...(users as string[])] };
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

/** Readable names for the document paths live-play changes touch (F5, D-082). */
const PATH_LABELS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^system\.attributes\.hp\.value$/, (): string => 'HP'],
  [/^system\.attributes\.hp\.temp$/, (): string => 'temp HP'],
  [/^system\.attributes\.hp\.tempmax$/, (): string => 'max HP bonus'],
  [/^system\.attributes\.exhaustion$/, (): string => 'exhaustion'],
  [
    /^system\.attributes\.death\.(success|failure)$/,
    (m): string => (m[1] === 'success' ? 'death save successes' : 'death save failures'),
  ],
  [/^system\.attributes\.travel\.pace$/, (): string => 'travel pace'],
  [
    /^system\.spells\.(spell\d|pact)\.value$/,
    (m): string => `${m[1] === 'pact' ? 'pact' : `level ${String(m[1]).slice(5)}`} slots`,
  ],
  [/^system\.resources\.(primary|secondary|tertiary)\.value$/, (m): string => `${m[1]} resource`],
  [/^environment\.darknessLevel$/, (): string => 'darkness'],
  [/^environment\.darknessLock$/, (): string => 'darkness lock'],
  [/^environment\.globalLight\.enabled$/, (): string => 'global light'],
  [/^system\.currency\.(pp|gp|ep|sp|cp)$/, (m): string => String(m[1])],
  [/^ownership\.default$/, (): string => 'default ownership'],
  [/^ownership\.([A-Za-z0-9]+)$/, (m): string => `ownership for user ${m[1]}`],
  [/^(x|y)$/, (m): string => `position ${m[1]}`],
  [/^(hidden|elevation|rotation|name|disposition)$/, (m): string => String(m[1])],
];

/** The readable name of a document path, or null when it has none (the raw path is shown). */
export function pathLabel(path: string): string | null {
  for (const [re, label] of PATH_LABELS) {
    const m = path.match(re);
    if (m) return label(m);
  }
  return null;
}

/** `Actor "Wolf 2": HP 11 → 5` for a known path, else `Actor "Wolf 2": path: 11 → 5`. */
function updateText(
  label: string,
  path: string,
  before: PathValue,
  after: PathValue,
  labels?: Record<string, string>
): string {
  const named = labels?.[path] ?? pathLabel(path);
  const change = `${formatValue(before)} → ${formatValue(after)}`;
  return named ? `${label}: ${named} ${change}` : `${label}: ${path}: ${change}`;
}

/** `Actor "Wolf 2"`, `the encounter` for a combat (it has no name), or null without a parent. */
function parentText(snapshot: OpSnapshot): string | null {
  const parent = snapshot.parent;
  if (!parent) return null;
  if (parent.name) return `${parent.documentName} "${parent.name}"`;
  return parent.documentName === 'Combat' ? 'the encounter' : null;
}

/** Diff lines for Foundry ops; throws when a target is missing. */
function foundryDiff(
  ops: GuardedOp[],
  snapshots: OpSnapshot[],
  labels?: Record<string, string>
): DiffLine[] {
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
          text: updateText(label, path, before, after, labels),
        });
      }
    } else if (op.kind === 'create') {
      if (!snap.exists) throw new Error(`Op ${i}: parent not found: ${String(op.parentUuid)}`);
      if (snap.idTaken) throw new Error(`Op ${i}: a document with that id already exists`);
      // A map note carries its label in `text`, not `name`.
      const named = op.documentName === 'Note' ? (op.data.text ?? op.data.name) : op.data.name;
      const name = typeof named === 'string' && named ? ` "${named}"` : '';
      const parent = parentText(snap);
      const where = parent ? ` on ${parent}` : op.parentUuid ? ` in ${op.parentUuid}` : '';
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
        text: parentText(snap)
          ? `Delete ${label} from ${parentText(snap)}`
          : `Delete ${label} (${op.uuid})`,
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
  private readonly recordedListeners: RecordedListener[] = [];
  private readonly undoGuards = new Map<string, UndoGuard>();
  private readonly applyTimeoutMs: number;
  private readonly outcomePollIntervalMs: number;
  private readonly outcomeDeadlineMs: number;
  private readonly listenerWaitMs: number;
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
    this.applyTimeoutMs = options.applyTimeoutMs ?? APPLY_TIMEOUT_MS;
    this.outcomePollIntervalMs = options.outcomePollIntervalMs ?? OUTCOME_POLL_INTERVAL_MS;
    this.outcomeDeadlineMs = options.outcomeDeadlineMs ?? OUTCOME_DEADLINE_MS;
    this.listenerWaitMs = options.listenerWaitMs ?? LISTENER_WAIT_MS;
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
    const showToPlayers =
      input.showToPlayers === undefined ? undefined : validateShowToPlayers(input.showToPlayers);
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
      diff.push(...foundryDiff(ops, expected, input.pathLabels));
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

    if (showToPlayers) {
      const who =
        showToPlayers.users.length === 0
          ? 'every player who can see it'
          : showToPlayers.users.length === 1
            ? '1 player'
            : `${showToPlayers.users.length} players`;
      diff.push({
        op: ops.length + vaultOps.length,
        kind: 'show',
        target: showToPlayers.uuid,
        label: diff.find(d => d.target === showToPlayers.uuid)?.label ?? showToPlayers.uuid,
        text: `${SHOW_DIFF_PREFIX} pops the page up for ${who} (Foundry's Show Players; Undo cannot take this back)`,
      });
    }

    for (const note of input.notes ?? []) {
      if (typeof note !== 'string' || !note.trim()) continue;
      diff.push({
        op: ops.length + vaultOps.length,
        kind: 'note',
        target: '',
        label: '',
        text: note.trim(),
      });
    }

    // Removing a status effect (an ActiveEffect, e.g. Prone) is everyday play, not destructive:
    // it needs one confirm (F5, D-082). Any other delete raises the plan to destructive.
    const deletes =
      ops.some((op, i) => op.kind === 'delete' && expected[i]?.documentName !== 'ActiveEffect') ||
      vaultOps.some(op => op.kind === 'vault-delete');
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
      ...(showToPlayers ? { showToPlayers } : {}),
      ...(input.undoes ? { undoes: input.undoes } : {}),
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

  /** `requestedBy`: the person who asked, from a GM's window in Foundry; absent for the control channel (Claude or the dashboard); recorded on the apply's audit entry. */
  applyPlan(planId: string, flags: ConfirmFlags, requestedBy?: string): Promise<AppliedChange> {
    return this.exclusive(async () => {
      const plan = this.requirePlan(planId);
      if (flags.confirm !== true) {
        throw new Error('Applying a planned change needs confirm: true');
      }
      if (plan.risk === 'destructive' && flags.confirmDestructive !== true) {
        // Destructive = deletes data, or cannot be taken back at the table (a reveal).
        throw new Error(
          'This change is destructive (it deletes data or cannot be taken back); it needs confirmDestructive: true'
        );
      }
      const worldId = await this.worldIds.current();
      if (worldId !== plan.worldId) {
        throw new Error(`This plan was made for world "${plan.worldId}", not "${worldId}"`);
      }
      const changeId = newId('chg', this.now());
      const applied = await this.applyChange(worldId, changeId, plan, requestedBy);
      this.plans.delete(plan.planId);
      return applied;
    });
  }

  /**
   * Also call `listener` after every recorded apply or undo (like the `onRecorded` option). The
   * apply or undo answers once a returned promise settles, so a caller that reads right after
   * sees what the listener wrote; a failing listener is logged, never breaks the change.
   */
  addRecordedListener(listener: RecordedListener): void {
    this.recordedListeners.push(listener);
  }

  /** Run `guard` before any change of `feature` is undone (one guard per feature). */
  setUndoGuard(feature: string, guard: UndoGuard): void {
    this.undoGuards.set(feature, guard);
  }

  /** `requestedBy`: the person who asked, from a GM's window in Foundry; absent for the control channel (Claude or the dashboard); recorded on the undo's audit entry. */
  undo(changeId: string, flags: ConfirmFlags, requestedBy?: string): Promise<AppliedChange> {
    return this.exclusive(async () => {
      if (flags.confirm !== true) throw new Error('Undoing a change needs confirm: true');
      const worldId = await this.worldIds.current();
      const entry = await this.audit.get(worldId, changeId);
      if (!entry) throw new Error(`No recorded change ${changeId} in world "${worldId}"`);
      // An undo entry can be undone too: that is the redo (its inverse puts the change back).
      const ring = await this.audit.ring(worldId);
      const undone = computeUndoState(ring).get(changeId);
      if (undone) throw new Error(`Change ${changeId} was already undone (${undone.undoneBy})`);
      // A redo puts the original change back: its feature's switch must be on.
      await this.requireRedoSwitches(ring, [changeId]);
      const guard = this.undoGuards.get(entry.feature);
      const reason = guard ? await guard(worldId, entry) : null;
      if (reason) throw new Error(`Conflict, nothing was written: ${reason}`);
      const undoId = newId('chg', this.now());
      return this.undoChange(worldId, undoId, entry, requestedBy);
    });
  }

  /** What is undone in the current world (see `computeUndoState`). */
  async undoState(): Promise<UndoState> {
    return computeUndoState(await this.audit.ring(await this.worldIds.current()));
  }

  async listRecentChanges(limit = 20): Promise<RecentChange[]> {
    const worldId = await this.worldIds.current();
    const ring = await this.audit.ring(worldId);
    const state = computeUndoState(ring);
    const shown = ring.slice(-Math.min(Math.max(limit, 1), AUDIT_RING_SIZE)).reverse();
    return shown.map(e => {
      const undone = state.get(e.changeId);
      return {
        ...this.appliedView(e),
        ...(undone ? { undoneBy: undone.undoneBy, undoneAt: undone.undoneAt } : {}),
        canUndo: !undone && ((e.results?.length ?? 0) > 0 || (e.vaultOps?.length ?? 0) > 0),
      };
    });
  }

  // -------------------------------------------------------------------------

  private async applyChange(
    worldId: string,
    changeId: string,
    plan: StoredPlan,
    requestedBy?: string
  ): Promise<AppliedChange> {
    const records: VaultOpRecord[] = plan.vaultOps.map((op, i) => ({
      file: op.file,
      path: op.path,
      before: plan.vaultExpected[i],
      after: vaultTarget(op),
    }));
    // A planned undo that takes back an undo redoes the original change: its switch must be on.
    if (plan.feature === UNDO_FEATURE && (plan.undoes?.changes?.length ?? 0) > 0) {
      await this.requireRedoSwitches(await this.audit.ring(worldId), plan.undoes?.changes ?? []);
    }
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
      ...(requestedBy ? { requestedBy } : {}),
      ...(foundry ? { results: foundry.results } : {}),
      ...(records.length > 0 ? { vaultOps: records } : {}),
      ...(plan.rulesVersion ? { rulesVersion: plan.rulesVersion } : {}),
      ...(plan.undoes ? { undoes: plan.undoes } : {}),
    };
    await this.record(worldId, entry, () => this.audit.append(worldId, entry));
    await this.notifyRecorded(worldId, entry.changeId);
    // A Foundry apply logs its own gm-change event; vault-only changes do it here.
    if (!foundry) await this.logGmChange(entry);
    const shown = plan.showToPlayers ? await this.showToPlayers(plan.showToPlayers) : undefined;
    return { ...this.appliedView(entry), ...(shown ? { shown } : {}) };
  }

  /** Pop the page up on the players' screens (I-110). Never throws: the change is already applied. */
  private async showToPlayers(show: {
    uuid: string;
    users: string[];
  }): Promise<NonNullable<AppliedChange['shown']>> {
    try {
      unwrap<unknown>(
        await this.foundry.query(
          'foundry-mcp-bridge.showJournalPage',
          { uuid: show.uuid, userIds: show.users },
          { timeoutMs: SHOW_TIMEOUT_MS }
        ),
        'Show refused'
      );
      return { ok: true, users: show.users };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Show it now failed after the change was applied', {
        uuid: show.uuid,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  private async undoChange(
    worldId: string,
    undoId: string,
    entry: AuditEntry,
    requestedBy?: string
  ): Promise<AppliedChange> {
    const results = [...(await this.audit.resultsWithDeleted(worldId, entry))].reverse();
    const records = [...(entry.vaultOps ?? [])].reverse();
    if (results.length === 0 && records.length === 0) {
      throw new Error(`Change ${entry.changeId} has nothing to undo`);
    }
    const summary = `Undo: ${entry.summary}`;
    if (records.length > 0) await this.requireFeatureEnabled(entry.feature, true);
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
      diff: entry.diff
        .filter(line => !line.startsWith(SHOW_DIFF_PREFIX))
        .map(line => `undone: ${line}`),
      undoOf: entry.changeId,
      ...(requestedBy ? { requestedBy } : {}),
      ...(foundry ? { results: foundry.results } : {}),
      ...(records.length > 0
        ? { vaultOps: records.map(r => ({ ...r, before: r.after, after: r.before })) }
        : {}),
    };
    await this.record(worldId, undoEntry, () => this.audit.recordUndo(worldId, undoEntry));
    await this.notifyRecorded(worldId, undoEntry.changeId);
    if (!foundry) await this.logGmChange(undoEntry);
    return this.appliedView(undoEntry);
  }

  private async notifyRecorded(worldId: string, changeId: string): Promise<void> {
    const listeners = [...(this.onRecorded ? [this.onRecorded] : []), ...this.recordedListeners];
    const warn = (error: unknown): void =>
      this.logger.warn('onRecorded listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    const pending: Array<Promise<void>> = [];
    for (const listener of listeners) {
      try {
        const result: unknown = listener(worldId, changeId);
        if (result instanceof Promise) pending.push((result as Promise<void>).catch(warn));
      } catch (error) {
        warn(error);
      }
    }
    if (pending.length === 0) return;
    // Inside the guarded-write lock: a slow listener must never stall every other change.
    let timer: NodeJS.Timeout | undefined;
    const capped = new Promise<'late'>(resolve => {
      timer = setTimeout(() => resolve('late'), this.listenerWaitMs);
    });
    const outcome = await Promise.race([Promise.all(pending).then(() => 'done' as const), capped]);
    clearTimeout(timer);
    if (outcome === 'late') {
      this.logger.warn('onRecorded listeners still running; the change answers without them', {
        changeId,
        waitedMs: this.listenerWaitMs,
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
    let response: unknown;
    try {
      response = await this.foundry.query('foundry-mcp-bridge.applyGuardedOps', request, {
        timeoutMs: this.applyTimeoutMs,
      });
    } catch (error) {
      if (!isLostAnswer(error)) throw error;
      // The apply may still have run in Foundry: ask the module how it went (PB-04).
      this.logger.warn('Apply answer lost, asking Foundry for the outcome', {
        changeId: request.changeId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.awaitApplyOutcome(request);
    }
    return this.checkApplyResult(
      unwrap<GuardedApplyResult>(response, 'Foundry refused the change'),
      request
    );
  }

  private checkApplyResult(
    result: GuardedApplyResult | null | undefined,
    request: GuardedApplyRequest
  ): GuardedApplyResult {
    if (!result || !Array.isArray(result.results) || result.changeId !== request.changeId) {
      throw new Error('Foundry returned an unexpected apply result');
    }
    return result;
  }

  /**
   * Poll `guardedApplyOutcome` until the module knows how the apply ended, also
   * across a reconnect. `applied` returns the result as if the apply had
   * answered, so the audit entry and undo are written.
   */
  private async awaitApplyOutcome(request: GuardedApplyRequest): Promise<GuardedApplyResult> {
    const started = Date.now();
    const giveUp = (): never => {
      const seconds = Math.round((Date.now() - started) / 1000);
      const message = `The change may or may not have been applied in Foundry (no answer within ${seconds} s). Check Foundry before planning it again.`;
      this.logger.error(message, { changeId: request.changeId });
      throw new Error(message);
    };
    for (;;) {
      await sleep(this.outcomePollIntervalMs);
      let outcome: GuardedApplyOutcome | null = null;
      try {
        const response = unwrap<GuardedApplyOutcome | null>(
          await this.foundry.query('foundry-mcp-bridge.guardedApplyOutcome', {
            changeId: request.changeId,
          }),
          'Outcome check refused'
        );
        outcome = response && typeof response === 'object' ? response : null;
      } catch (error) {
        // The link is down or the module cannot answer: try again on the next tick.
        this.logger.debug('Outcome check failed', {
          changeId: request.changeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (outcome?.status === 'applied') {
        this.logger.info('Apply outcome recovered: applied', { changeId: request.changeId });
        return this.checkApplyResult(outcome.result, request);
      }
      if (outcome?.status === 'failed') {
        throw new Error(outcome.error || 'Foundry refused the change');
      }
      if (outcome?.status === 'unknown') giveUp();
      if (Date.now() - started >= this.outcomeDeadlineMs) giveUp();
    }
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

  /**
   * Vault writes never reach Foundry, so the module cannot refuse them: check its switches here.
   * An apply needs "Allow Write Operations" and the feature switch; an undo (`undo: true`) only
   * "Allow Write Operations", like a Foundry undo.
   */
  /**
   * Whether the GM switched on "apply without confirming" for a feature (live play, F5): the
   * caller of a plan tool then applies the plan at once. False when the switch is off, the
   * feature or "Allow Write Operations" is off, or Foundry cannot be asked.
   */
  async autoApplyEnabled(feature: string): Promise<boolean> {
    try {
      const features = unwrap<GuardedFeatureState[]>(
        await this.foundry.query('foundry-mcp-bridge.listGuardedFeatures'),
        'Feature list refused'
      );
      const list = Array.isArray(features) ? features : [];
      if (list.some(f => f.writesAllowed === false)) return false;
      const state = list.find(f => f.id === feature);
      return state?.enabled === true && state.autoApply === true;
    } catch {
      return false;
    }
  }

  /** A redo must respect the switches of the changes it brings back (see `redoFeatures`). */
  private async requireRedoSwitches(ring: AuditEntry[], ids: readonly string[]): Promise<void> {
    const check = redoFeatures(ring, ids);
    if (check.refusal) {
      throw new Error(
        `Its feature switches cannot be checked: ${check.refusal}. Nothing was written.`
      );
    }
    for (const feature of check.features) await this.requireFeatureEnabled(feature);
  }

  private async requireFeatureEnabled(feature: string, undo = false): Promise<void> {
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
    const list = Array.isArray(features) ? features : [];
    // Every feature carries the same writesAllowed; a module before 0.19.0 sends none (allowed).
    if (list.some(f => f.writesAllowed === false)) {
      throw new Error('Write operations are disabled in the module settings');
    }
    if (undo) return;
    const state = list.find(f => f.id === feature);
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
      ...(entry.requestedBy ? { requestedBy: entry.requestedBy } : {}),
      ...(entry.undoes ? { undoes: entry.undoes } : {}),
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

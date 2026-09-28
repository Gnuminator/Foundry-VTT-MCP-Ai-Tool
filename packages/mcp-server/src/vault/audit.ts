/**
 * Audit ring of applied guarded changes, kept in the vault (`gm/audit.json`).
 *
 * Each entry records what a change did, with the previous values needed to
 * undo it. The ring holds the newest {@link AUDIT_RING_SIZE} entries. Large
 * deleted-document snapshots go to `backups/<changeId>.json` so the ring stays
 * small; dropping an entry from the ring deletes its backup too.
 */
import type { GuardedOpResult, GuardedRisk, PathValue, RulesVersion } from '@gnuminator/shared';

import type { VaultStore } from './store.js';

export const AUDIT_FILE = 'audit.json';
export const AUDIT_SCHEMA = 1;
export const AUDIT_RING_SIZE = 500;
/** Deleted-document snapshots above this size (JSON chars, per entry) go to backups/. */
export const AUDIT_INLINE_DELETED_LIMIT = 16_384;

/** One value changed in a vault JSON file. */
export interface VaultOpRecord {
  file: string;
  path: string;
  before: PathValue;
  after: PathValue;
}

export interface AuditEntry {
  changeId: string;
  /** The plan the change came from (null for undo entries). */
  planId: string | null;
  feature: string;
  summary: string;
  risk: GuardedRisk;
  /** Where the change was written. */
  target: 'foundry' | 'vault' | 'mixed';
  mode: 'apply' | 'undo';
  appliedAt: string;
  /** Readable diff lines, as shown when the change was confirmed. */
  diff: string[];
  rulesVersion?: RulesVersion;
  /** undo entries: the change they reverted. */
  undoOf?: string;
  /** apply entries that were undone. */
  undoneBy?: string;
  undoneAt?: string;
  /** foundry: per-op results from the module (before/after, deleted data). */
  results?: GuardedOpResult[];
  /** foundry: `backups/<file>` holding the deleted snapshots moved out of `results`. */
  backupRef?: string;
  /** vault: previous and new values. */
  vaultOps?: VaultOpRecord[];
}

interface AuditData {
  entries: AuditEntry[];
}

interface DeletedBackup {
  changeId: string;
  /** Op index -> deleted document source. */
  deleted: Record<string, Record<string, unknown>>;
}

function backupFileFor(changeId: string): string {
  return `${changeId}.json`;
}

export class AuditLog {
  constructor(private readonly store: VaultStore) {}

  /** Add an entry (moving big deleted snapshots to backups/ first). */
  async append(worldId: string, entry: AuditEntry): Promise<AuditEntry> {
    const stored = await this.externalizeDeleted(worldId, entry);
    const dropped: AuditEntry[] = [];
    await this.store.update<AuditData>(worldId, 'gm', AUDIT_FILE, AUDIT_SCHEMA, current => {
      const entries = [...(current?.data.entries ?? []), stored];
      if (entries.length > AUDIT_RING_SIZE) {
        dropped.push(...entries.splice(0, entries.length - AUDIT_RING_SIZE));
      }
      return { entries };
    });
    await this.removeBackups(worldId, dropped);
    return stored;
  }

  /**
   * Record an undo: append `undoEntry` and mark the original as undone, in one
   * write.
   */
  async recordUndo(worldId: string, undoEntry: AuditEntry): Promise<AuditEntry> {
    if (!undoEntry.undoOf) throw new Error('An undo entry needs undoOf');
    const stored = await this.externalizeDeleted(worldId, undoEntry);
    const dropped: AuditEntry[] = [];
    await this.store.update<AuditData>(worldId, 'gm', AUDIT_FILE, AUDIT_SCHEMA, current => {
      const entries = (current?.data.entries ?? []).map(e =>
        e.changeId === undoEntry.undoOf
          ? { ...e, undoneBy: stored.changeId, undoneAt: stored.appliedAt }
          : e
      );
      entries.push(stored);
      if (entries.length > AUDIT_RING_SIZE) {
        dropped.push(...entries.splice(0, entries.length - AUDIT_RING_SIZE));
      }
      return { entries };
    });
    await this.removeBackups(worldId, dropped);
    return stored;
  }

  /** Newest first. */
  async list(worldId: string, limit = 50): Promise<AuditEntry[]> {
    const envelope = await this.store.read<AuditData>(worldId, 'gm', AUDIT_FILE);
    const entries = envelope?.data.entries ?? [];
    return entries.slice(-Math.max(1, limit)).reverse();
  }

  async get(worldId: string, changeId: string): Promise<AuditEntry | null> {
    const envelope = await this.store.read<AuditData>(worldId, 'gm', AUDIT_FILE);
    return envelope?.data.entries.find(e => e.changeId === changeId) ?? null;
  }

  /** The entry's results with deleted snapshots read back from backups/. */
  async resultsWithDeleted(worldId: string, entry: AuditEntry): Promise<GuardedOpResult[]> {
    const results = entry.results ?? [];
    if (!entry.backupRef) return results;
    const backup = await this.store.read<DeletedBackup>(worldId, 'backups', entry.backupRef);
    if (!backup) {
      throw new Error(`The backup of change ${entry.changeId} is missing (${entry.backupRef})`);
    }
    return results.map(r => {
      const deleted = backup.data.deleted[String(r.index)];
      return deleted ? { ...r, deleted } : r;
    });
  }

  // -------------------------------------------------------------------------

  private async externalizeDeleted(worldId: string, entry: AuditEntry): Promise<AuditEntry> {
    const results = entry.results ?? [];
    const deleted: Record<string, Record<string, unknown>> = {};
    for (const r of results) if (r.deleted) deleted[String(r.index)] = r.deleted;
    if (Object.keys(deleted).length === 0) return entry;
    if (JSON.stringify(deleted).length <= AUDIT_INLINE_DELETED_LIMIT) return entry;

    const backupRef = backupFileFor(entry.changeId);
    const backup: DeletedBackup = { changeId: entry.changeId, deleted };
    await this.store.write(worldId, 'backups', backupRef, backup);
    return {
      ...entry,
      backupRef,
      results: results.map(r => {
        if (!r.deleted) return r;
        const { deleted: _moved, ...rest } = r;
        return rest;
      }),
    };
  }

  private async removeBackups(worldId: string, dropped: AuditEntry[]): Promise<void> {
    for (const entry of dropped) {
      if (entry.backupRef) await this.store.remove(worldId, 'backups', entry.backupRef);
    }
  }
}

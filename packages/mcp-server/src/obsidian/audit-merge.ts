/**
 * Merge the append-only change history (`gm/audit-log.jsonl`, shared contract
 * 2) with the audit ring (`gm/audit.json`, 500 entries) for the Changes/
 * notes (docs/OBSIDIAN-PLAN.md, O2 item 5).
 *
 * Union by `changeId`. The ring wins for `undoneBy`/`undoneAt` on an id
 * present in both (it is updated in place when a change is undone, so it is
 * authoritative). For a jsonl-only apply entry, `undoneBy`/`undoneAt` are
 * derived from a jsonl undo line whose `undoOf` names it.
 */

export interface ChangeEntry {
  changeId: string;
  feature: string;
  summary: string;
  risk: string;
  target: string;
  mode: 'apply' | 'undo';
  appliedAt: string;
  diff: string[];
  undoOf?: string;
  undoneBy?: string;
  undoneAt?: string;
}

/** One line of `gm/audit-log.jsonl` (shared contract 2: no results/vaultOps/backupRef). */
interface RawHistoryLine {
  v: 1;
  changeId: string;
  planId: string | null;
  feature: string;
  summary: string;
  risk: string;
  target: string;
  mode: 'apply' | 'undo';
  appliedAt: string;
  diff: string[];
  rulesVersion?: unknown;
  undoOf?: string;
}

function isRawHistoryLine(value: unknown): value is RawHistoryLine {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RawHistoryLine>;
  return (
    typeof v.changeId === 'string' &&
    typeof v.feature === 'string' &&
    typeof v.summary === 'string' &&
    typeof v.risk === 'string' &&
    typeof v.target === 'string' &&
    (v.mode === 'apply' || v.mode === 'undo') &&
    typeof v.appliedAt === 'string' &&
    Array.isArray(v.diff)
  );
}

function fromHistoryLine(entry: RawHistoryLine): ChangeEntry {
  return {
    changeId: entry.changeId,
    feature: entry.feature,
    summary: entry.summary,
    risk: entry.risk,
    target: entry.target,
    mode: entry.mode,
    appliedAt: entry.appliedAt,
    diff: entry.diff,
    ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
  };
}

/** Minimal shape of a ring entry this module needs (see `vault/audit.ts`). */
export interface RingChangeEntry {
  changeId: string;
  feature: string;
  summary: string;
  risk: string;
  target: string;
  mode: 'apply' | 'undo';
  appliedAt: string;
  diff: string[];
  undoOf?: string;
  undoneBy?: string;
  undoneAt?: string;
}

function fromRingEntry(entry: RingChangeEntry): ChangeEntry {
  return {
    changeId: entry.changeId,
    feature: entry.feature,
    summary: entry.summary,
    risk: entry.risk,
    target: entry.target,
    mode: entry.mode,
    appliedAt: entry.appliedAt,
    diff: entry.diff,
    ...(entry.undoOf ? { undoOf: entry.undoOf } : {}),
    ...(entry.undoneBy ? { undoneBy: entry.undoneBy } : {}),
    ...(entry.undoneAt ? { undoneAt: entry.undoneAt } : {}),
  };
}

/** Merge the ring's entries with the raw (unvalidated) lines read from the
 * jsonl history file. Malformed jsonl lines are skipped. */
export function mergeChangeHistory(
  ringEntries: RingChangeEntry[],
  jsonlValues: unknown[]
): ChangeEntry[] {
  const jsonl = jsonlValues.filter(isRawHistoryLine);
  const undoOf = new Map<string, RawHistoryLine>();
  for (const entry of jsonl) {
    if (entry.mode === 'undo' && entry.undoOf) undoOf.set(entry.undoOf, entry);
  }

  const byId = new Map<string, ChangeEntry>();
  for (const entry of jsonl) {
    const undo = entry.mode === 'apply' ? undoOf.get(entry.changeId) : undefined;
    const base = fromHistoryLine(entry);
    byId.set(
      entry.changeId,
      undo ? { ...base, undoneBy: undo.changeId, undoneAt: undo.appliedAt } : base
    );
  }
  // The ring wins on an id present in both: its own undo status replaces
  // whatever the jsonl scan derived.
  for (const entry of ringEntries) {
    byId.set(entry.changeId, fromRingEntry(entry));
  }
  return [...byId.values()];
}

/**
 * What is undone (I-109): derived from the audit entries, never stored per change.
 *
 * An audit entry that undid something says so: a legacy undo entry names the change in `undoOf`;
 * an undo-planner entry lists the audit changes and the journal actions it undid in `undoes`. An
 * entry that was itself undone (the redo) no longer counts, so the things it undid are live again.
 * Walking the entries newest first settles every chain: an entry is live unless a live newer entry
 * marked it undone, and only a live entry marks its targets.
 *
 * Keys of the result: an audit changeId, or `act:<actionId>` for a person's change from the
 * change journal (the same id the change list uses).
 */
import type { AuditEntry } from '../vault/audit.js';

export interface UndoMark {
  /** The changeId of the live entry that undid it. */
  undoneBy: string;
  /** When that entry was applied (ISO). */
  undoneAt: string;
}

export type UndoState = Map<string, UndoMark>;

/** The key the change list and `computeUndoState` use for a journal action. */
export function actionKey(actionId: string): string {
  return `act:${actionId}`;
}

/**
 * `entries` in ring order, oldest first (what `AuditLog.ring` returns). The newest entry comes
 * first by `appliedAt`; entries with the same time keep their ring order, later is newer.
 */
export function computeUndoState(entries: readonly AuditEntry[]): UndoState {
  const ordered = entries
    .map((entry, ring) => ({ entry, ring, at: Date.parse(entry.appliedAt) }))
    .sort((a, b) => {
      const byTime = (Number.isFinite(b.at) ? b.at : 0) - (Number.isFinite(a.at) ? a.at : 0);
      return byTime !== 0 ? byTime : b.ring - a.ring;
    });
  const state: UndoState = new Map();
  for (const { entry } of ordered) {
    if (state.has(entry.changeId)) continue; // undone by a live newer entry: it undoes nothing
    const mark = { undoneBy: entry.changeId, undoneAt: entry.appliedAt };
    const targets = [
      ...(entry.undoOf ? [entry.undoOf] : []),
      ...(entry.undoes?.changes ?? []),
      ...(entry.undoes?.actions ?? []).map(actionKey),
    ];
    for (const target of targets) if (!state.has(target)) state.set(target, mark);
  }
  return state;
}

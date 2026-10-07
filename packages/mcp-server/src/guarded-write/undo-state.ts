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

/** The feature of an undo-planner entry (I-109). */
export const UNDO_FEATURE = 'change-undo';

/**
 * The features whose changes come back when the audit changes `ids` are undone together: undoing
 * an undo is a redo, and a redo must respect the original feature's switch. Undoing a feature's
 * undo entry redoes that feature; undoing an undo-planner entry redoes the AI changes it undid.
 * A change whose undo is undone in the same step cancels out and needs no switch.
 */
export function redoFeatures(ring: readonly AuditEntry[], ids: readonly string[]): string[] {
  const byId = new Map(ring.map(e => [e.changeId, e]));
  const inSet = new Set(ids);
  const features = new Set<string>();
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (entry.feature !== UNDO_FEATURE) {
      if (entry.mode === 'undo' && !(entry.undoOf && inSet.has(entry.undoOf))) {
        features.add(entry.feature);
      }
      continue;
    }
    if (entry.mode !== 'apply') continue;
    for (const undone of entry.undoes?.changes ?? []) {
      const original = byId.get(undone);
      if (!original || inSet.has(undone)) continue;
      if (original.mode === 'apply' && original.feature !== UNDO_FEATURE) {
        features.add(original.feature);
      }
    }
  }
  return [...features];
}

/** The key the change list and `computeUndoState` use for a journal action. */
export function actionKey(actionId: string): string {
  return `act:${actionId}`;
}

/**
 * `entries` in ring order, oldest first (what `AuditLog.ring` returns), walked newest first by
 * that order. Not by `appliedAt`: an AI entry carries the GM browser's clock and a person's undo
 * may carry another, so a redo could sort before its undo; the ring is the order they happened.
 */
export function computeUndoState(entries: readonly AuditEntry[]): UndoState {
  const state: UndoState = new Map();
  for (const entry of [...entries].reverse()) {
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

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

/** Deepest undo chain `redoFeatures` follows (a real chain is a handful of links). */
const MAX_UNDO_LINKS = 50;

export interface RedoCheck {
  /** The features whose switches must be on. */
  features: string[];
  /** A change on the way has left the ring, so what comes back is not known: refuse. */
  unknown: boolean;
}

/** An original change (a feature's own apply), as opposed to an entry that undid others. */
function isOriginal(entry: AuditEntry): boolean {
  return entry.mode === 'apply' && entry.feature !== UNDO_FEATURE;
}

/** The audit changes an undo entry took back (people's actions need no switch). */
function targetsOf(entry: AuditEntry): string[] {
  if (entry.mode === 'undo') return entry.undoOf ? [entry.undoOf] : [];
  return entry.undoes?.changes ?? [];
}

/**
 * The features whose changes come back when the audit changes `ids` are undone together: undoing
 * an undo is a redo, and a redo must respect the original feature's switch. The undo links are
 * followed all the way down: undoing an entry re-applies what it undid, and re-applying an undo
 * takes its targets back again. Each original change is counted +1 when it comes back and -1 when
 * it is taken back, so a change and its undo in the same step cancel out and need no switch.
 */
export function redoFeatures(ring: readonly AuditEntry[], ids: readonly string[]): RedoCheck {
  const byId = new Map(ring.map(e => [e.changeId, e]));
  const net = new Map<string, { feature: string; n: number }>();
  const always = new Set<string>();
  let unknown = false;
  // `sign` +1: the change at `id` is put back (re-applied); -1: it is taken back (undone).
  const walk = (id: string, sign: 1 | -1, via: AuditEntry | null, depth: number): void => {
    const entry = byId.get(id);
    if (!entry || depth > MAX_UNDO_LINKS) {
      // A legacy undo carries its original's feature: require that switch, to be safe.
      if (via && via.feature !== UNDO_FEATURE) always.add(via.feature);
      else unknown = true;
      return;
    }
    if (isOriginal(entry)) {
      const seen = net.get(id) ?? { feature: entry.feature, n: 0 };
      seen.n += sign;
      net.set(id, seen);
      return;
    }
    // An undo entry: taking it back re-applies its targets, putting it back takes them back.
    for (const target of targetsOf(entry)) walk(target, sign === -1 ? 1 : -1, entry, depth + 1);
  };
  for (const id of ids) walk(id, -1, null, 0);
  for (const { feature, n } of net.values()) if (n > 0) always.add(feature);
  return { features: [...always], unknown };
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

import type { GuardedOp } from '@gnuminator/shared';

/** The feature the journal's undo and redo plans run under; their stored stamps are never fresh. */
const UNDO_FEATURE = 'change-undo';

/**
 * Why a timed effect op's `start` stamp no longer fits, or null. Only a timed op is checked (it
 * sets a duration value) and only when its stamp names a fight, round and turn: that fight must
 * still be at that round and turn. Untimed revives and journal undo or redo plans are not checked.
 */
export function staleStamp(op: GuardedOp, mode: string, feature = ''): string | null {
  if (mode !== 'apply' || feature === UNDO_FEATURE) return null;
  let raw: unknown = null;
  let timed: unknown = null;
  if (op.kind === 'create') {
    raw = op.data?.start;
    timed = (op.data?.duration as { value?: unknown } | undefined)?.value;
  } else if (op.kind === 'update') {
    raw = op.changes?.start;
    timed = op.changes?.['duration.value'];
  }
  if (timed === null || timed === undefined) return null;
  if (!raw || typeof raw !== 'object') return null;
  const { combat, round, turn } = raw as { combat?: unknown; round?: unknown; turn?: unknown };
  if (typeof combat !== 'string' || typeof round !== 'number' || typeof turn !== 'number') {
    return null;
  }
  const live = (
    game.combats as unknown as { get?(id: string): { round?: number; turn?: number } | undefined }
  )?.get?.(combat);
  if (!live) return 'the fight this effect was timed against is gone; plan it again';
  if (live.round !== round || live.turn !== turn) {
    return 'the turn moved since the plan was made, so the timing would run short; plan it again';
  }
  return null;
}

import type { GuardedOp } from '@gnuminator/shared';

/**
 * Why an effect op's `start` stamp no longer fits, or null. Only a stamp that names a fight, round
 * and turn is checked: that fight must still be at that round and turn.
 */
export function staleStamp(op: GuardedOp, mode: string): string | null {
  if (mode !== 'apply') return null;
  const raw =
    op.kind === 'create' ? op.data?.start : op.kind === 'update' ? op.changes?.start : null;
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

/**
 * The Prone effect dnd5e adds with an AI change that drops a hero to 0 HP, and the extra deletes
 * that let `undo-change` take it off together with the hit points.
 */

import {
  errorMessage,
  unwrapBridgeReply,
  type ChangeRecord,
  type GuardedOp,
  type GuardedOpResult,
  type OpSnapshot,
} from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';

/** Where the status effects dnd5e created with an AI change are found (the change history). */
export type BatchRiderSource = (changeId: string) => Promise<Array<{ uuid: string }>>;

/**
 * The Prone effect dnd5e created by itself with an AI change: an ActiveEffect create with dnd5e's
 * own fixed id (`dnd5eprone000000`). dnd5e takes Unconscious and Bloodied off again when the hit
 * points come back but leaves Prone, so the undo removes it. With `ai` (the AI change's own
 * records) it also needs that change to have dropped the same actor to 0 HP: a Prone the GM sets
 * by hand a moment after some other AI write is not the change's.
 */
export function isBatchRider(r: ChangeRecord, ai?: readonly ChangeRecord[]): boolean {
  // A real drop: the hit points were above 0 before (a second change that leaves a hero at 0 did
  // not make dnd5e add Prone, so it does not claim the first change's Prone).
  const hp = 'system.attributes.hp.value';
  const dropped = (a: ChangeRecord): boolean =>
    a.rootUuid === r.rootUuid &&
    (a.after ?? []).some(v => v.path === hp && v.value === 0) &&
    !(a.before ?? []).some(v => v.path === hp && v.value === 0);
  return (
    (!ai || ai.some(dropped)) &&
    r.op === 'create' &&
    r.documentName === 'ActiveEffect' &&
    /\.ActiveEffect\.dnd5eprone0{6}$/.test(r.uuid)
  );
}

/**
 * Deletes for the riders of this AI change that are still there. Best effort: no source, nothing
 * found or a failed read leaves the undo as it was. A rider already gone (someone stood the hero
 * up) is left out; the others are expected as they are now.
 */
export async function riderUndoOps(
  source: BatchRiderSource | null,
  foundry: Pick<FoundryClient, 'query'>,
  logger: Logger,
  entry: { changeId: string; mode: string; results?: readonly GuardedOpResult[] }
): Promise<{ ops: GuardedOp[]; expected: OpSnapshot[]; lines: string[] }> {
  const none = { ops: [], expected: [], lines: [] };
  if (!source || entry.mode === 'undo') return none;
  try {
    const known = new Set((entry.results ?? []).map(r => r.uuid));
    const ops: GuardedOp[] = (await source(entry.changeId))
      .filter(r => !known.has(r.uuid))
      .map(r => ({ kind: 'delete', uuid: r.uuid }));
    if (ops.length === 0) return none;
    const snapshots = unwrapBridgeReply<OpSnapshot[]>(
      await foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops }),
      'Snapshot refused'
    );
    if (!Array.isArray(snapshots) || snapshots.length !== ops.length) return none;
    const live = ops.flatMap((op, i) => (snapshots[i]?.exists ? [{ op, snap: snapshots[i] }] : []));
    const lines = live.map(() => 'Also removed: Prone (dnd5e added it with the change)');
    return { ops: live.map(l => l.op), expected: live.map(l => l.snap), lines };
  } catch (error) {
    logger.warn('Undo could not look for the Prone dnd5e added', { error: errorMessage(error) });
    return none;
  }
}

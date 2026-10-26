// Reordering the handout queue (David test 2). The bridge keeps the queue ordered by when a page
// was queued and has no move call, so a move re-queues the moved page and everything after it, in
// the new order, with plain unqueue and queue calls (no plan, nothing changes in Foundry). Queueing
// an already queued page keeps its place, so each one is unqueued first.

/** The fields a re-queue needs (a QueuedPage on the Handouts drawer). */
export interface QueueRow {
  uuid: string;
  exists: boolean;
  sceneId: string | null;
  players?: string[];
}

/**
 * The rows to unqueue and queue again, in this order, to swap row `index` with the one above it;
 * null when there is nothing to move (the first row) or a row that would have to be re-queued no
 * longer exists (the bridge refuses to queue a deleted page, so it would be lost).
 */
export function moveUpPlan<T extends QueueRow>(queue: readonly T[], index: number): T[] | null {
  if (index < 1 || index >= queue.length) return null;
  const tail = [queue[index - 1], ...queue.slice(index + 1)];
  if (tail.some(q => !q.exists)) return null;
  return tail;
}

/** The queue call arguments that put a row back with its scene and players. */
export function requeueArgs(q: QueueRow): Record<string, unknown> {
  return {
    action: 'queue',
    pageUuid: q.uuid,
    ...(q.sceneId ? { sceneId: q.sceneId } : {}),
    ...(q.players && q.players.length > 0 ? { players: q.players } : {}),
  };
}

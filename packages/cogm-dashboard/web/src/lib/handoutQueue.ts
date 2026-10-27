// Reordering the handout queue (David test 2). The bridge keeps the queue ordered by when a page
// was queued and has a `move` action on plan-page-reveal (no plan, nothing changes in Foundry) that
// puts a page at a new place in one write.

/** Whether a row at place `from` can move to place `to` in a queue of `length` rows. */
export function canMoveTo(length: number, from: number, to: number): boolean {
  return (
    Number.isInteger(from) && from >= 0 && from < length && to >= 0 && to < length && from !== to
  );
}

/** The place the arrow at `from` moves a row to. */
export const moveTarget = (from: number, direction: 'up' | 'down'): number =>
  direction === 'up' ? from - 1 : from + 1;

/**
 * A per-world counter of mirror changes. The pump bumps it when a cycle wrote, moved or trashed a
 * note; the export reads it to skip the Atlas rebuild (and its full vault scan) when nothing the
 * Atlas is built from has changed since the last build.
 */
const generations = new Map<string, number>();

export function bumpMirrorGeneration(worldId: string): void {
  generations.set(worldId, (generations.get(worldId) ?? 0) + 1);
}

/** Bump the counter when a cycle wrote, trashed or moved a note; returns whether it did. */
export function noteMirrorWrites(worldId: string, ...counts: number[]): boolean {
  const changed = counts.reduce((sum, n) => sum + n, 0) > 0;
  if (changed) bumpMirrorGeneration(worldId);
  return changed;
}

export function mirrorGeneration(worldId: string): number {
  return generations.get(worldId) ?? 0;
}

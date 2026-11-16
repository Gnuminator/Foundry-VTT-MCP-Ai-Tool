/**
 * Which fight the combat strip, End combat, the turn and initiative tools and the combatant picker
 * mean (one rule for all of them, so they never disagree).
 *
 * This browser's live combat (`game.combat`, the one viewed on its scene) when it has one. A fight
 * started on the dashboard can belong to a scene this GM browser does not view, where `game.combat`
 * is null: then a started fight (round 1 or later) wins over an encounter nobody began, and of
 * those the newest by creation time (Foundry's collection order is not creation order after a
 * reload), else the last in the collection.
 */

interface CombatLike {
  round?: number;
  _stats?: { createdTime?: number | null; modifiedTime?: number | null };
}

function createdAt(combat: CombatLike): number {
  const t = combat._stats?.createdTime ?? combat._stats?.modifiedTime;
  return typeof t === 'number' ? t : -1;
}

/** The fight to act on, or undefined when the world has none. */
export function resolveCombat<T extends CombatLike>(): T | undefined {
  const live = (game as unknown as { combat?: T | null }).combat;
  if (live) return live;
  const all = Array.from((game.combats ?? []) as Iterable<T>);
  const started = all.filter(c => typeof c.round === 'number' && c.round >= 1);
  const pool = started.length > 0 ? started : all;
  let best: T | undefined;
  for (const c of pool) {
    // `>=` keeps the later one in collection order when times tie or are missing.
    if (best === undefined || createdAt(c) >= createdAt(best)) best = c;
  }
  return best;
}

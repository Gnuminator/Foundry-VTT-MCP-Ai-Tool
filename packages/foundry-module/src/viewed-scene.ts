/**
 * The scene a read or a token write should act on: `game.scenes.current` (the one on the canvas),
 * else `game.scenes.active`. A client running core `noCanvas` (the Pi's Assistant GM, the only
 * bridge client there) has no canvas, so `current` is null while `active` is still set.
 */
export function viewedScene<T>(
  scenes: { current?: T | null; active?: T | null } | null | undefined
): T | undefined {
  return scenes?.current ?? scenes?.active ?? undefined;
}

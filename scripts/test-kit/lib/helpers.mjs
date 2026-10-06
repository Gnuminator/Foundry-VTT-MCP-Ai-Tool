/**
 * Small helpers scenarios share. Not part of the locked contract: a scenario may use them or
 * write its own.
 */
import { KitAssertion } from './errors.mjs';

/**
 * Calls `fn` until it returns a truthy value, or fails with a KitAssertion when the time is up.
 * Use it where the bridge needs a moment to catch up (the play log, the player view).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{label: string, timeoutMs?: number, intervalMs?: number}} opts
 * @returns {Promise<T>}
 */
export async function waitFor(fn, { label, timeoutMs = 20000, intervalMs = 1000 }) {
  const until = Date.now() + timeoutMs;
  /** @type {T | undefined} */
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) {
      throw new KitAssertion(`timed out after ${timeoutMs} ms waiting for ${label}`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

/**
 * dnd5e's short size codes, by the long names the compendium listing uses.
 * @type {Record<string, string>}
 */
export const SIZE_CODES = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
};

/**
 * The monster a manifest cell holds.
 * @param {import('./contract.mjs').KitManifest} kit
 * @param {string} cell
 */
export function monsterOf(kit, cell) {
  const monster = kit.monsters.find(m => m.cell === cell);
  if (!monster) throw new KitAssertion(`the kit manifest has no monster in cell "${cell}"`);
  return monster;
}

/**
 * The first matching entry of a list result that may be an array or sit under a key.
 * @param {any} result
 * @param {string} key
 * @returns {any[]}
 */
export function listOf(result, key) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.[key]) ? result[key] : [];
}

/**
 * The kit heroes that were built (no build error, an actor).
 * @param {import('./contract.mjs').KitManifest} kit
 */
export function builtHeroes(kit) {
  return kit.heroes.filter(h => h.actorId && !h.buildError);
}

/**
 * The kit heroes that stand on the kit scene, in manifest order. Scenarios that fight use these.
 * @param {import('./contract.mjs').KitManifest} kit
 */
export function tokenHeroes(kit) {
  return builtHeroes(kit).filter(h => h.tokenId);
}

/**
 * The hero the kit gave to the player user (the manifest row with an owner and a token).
 * @param {import('./contract.mjs').KitManifest} kit
 */
export function playerHero(kit) {
  const hero = tokenHeroes(kit).find(h => h.owner);
  if (!hero) throw new KitAssertion('the kit manifest has no player hero with a token');
  return hero;
}

/**
 * A Combat created already begun (round 1, as plan-combat-change start makes it, and as an undo of
 * End combat re-creates it) makes Foundry 14's `Combat#_onCreate` run `_manageTurnEvents` before the
 * Combat has a `previous` state, so `#triggerTurnEvents` reads `previous.round` of undefined and
 * every client logs "Cannot read properties of undefined (reading 'round')".
 *
 * `_onCreate` runs on every client, so the guard wraps the Combat document class on each of them.
 * It gives a begun Combat that has no `previous` yet the state of a fight that has not begun
 * (round 0), so the start of round and turn events fire the way Combat#startCombat fires them.
 */
import { MODULE_ID } from './constants.js';

interface CombatLike {
  round?: number;
  started?: boolean;
  previous?: unknown;
}

type OnCreate = (this: CombatLike, ...args: unknown[]) => unknown;

const GUARDED = Symbol.for(`${MODULE_ID}.combatCreateGuard`);

/** What `previous` holds before a fight has begun. */
export const UNSTARTED_STATE = Object.freeze({
  round: 0,
  turn: null,
  tokenId: null,
  combatantId: null,
});

/** Wrap `_onCreate` on the class's prototype once. Returns false when it cannot be wrapped. */
export function guardCombatCreate(documentClass: unknown): boolean {
  const proto = (documentClass as { prototype?: Record<PropertyKey, unknown> } | undefined)
    ?.prototype;
  const original = proto?._onCreate;
  if (!proto || typeof original !== 'function') return false;
  if ((original as unknown as Record<symbol, unknown>)[GUARDED]) return true;
  const wrapped: OnCreate = function (this: CombatLike, ...args: unknown[]) {
    if (!this.previous && Number(this.round ?? 0) > 0) {
      this.previous = { ...UNSTARTED_STATE };
    }
    return (original as OnCreate).apply(this, args);
  };
  (wrapped as unknown as Record<symbol, unknown>)[GUARDED] = true;
  proto._onCreate = wrapped;
  return true;
}

/** Install the guard on the world's Combat class. */
export function installCombatCreateGuard(): boolean {
  const cls = (globalThis as { CONFIG?: { Combat?: { documentClass?: unknown } } }).CONFIG?.Combat
    ?.documentClass;
  return guardCombatCreate(cls);
}

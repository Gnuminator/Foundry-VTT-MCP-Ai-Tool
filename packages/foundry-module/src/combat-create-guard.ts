/**
 * A Combat created already begun (round 1, as plan-combat-change start makes it, and as an undo of
 * End combat re-creates it) makes Foundry 14's `Combat#_onCreate` run `_manageTurnEvents` before the
 * Combat has a `previous` state, so `#triggerTurnEvents` reads `previous.round` of undefined and
 * every client logs "Cannot read properties of undefined (reading 'round')".
 *
 * `_onCreate` runs on every client, so the guard wraps the Combat document class on each of them.
 * It gives a begun Combat that has no `previous` yet the state of a fight that has not begun
 * (round 0), so the start of round and first turn events fire (Combat#startCombat's `combatStart`
 * hook and encounter recoveries are not part of this). A guarded undo or rollback gets its own
 * current state as `previous`, so nothing replays.
 */
import { MODULE_ID } from './constants.js';

interface CombatLike {
  round?: number;
  started?: boolean;
  previous?: unknown;
  current?: object;
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
  // When the class only inherits `_onCreate`, look it up on the parent prototype on every call, so
  // a patch registered on the parent after ready is not skipped. A class with its own `_onCreate`
  // keeps the one captured here (a later patch of that same slot replaces the guard itself).
  const inherited = !Object.prototype.hasOwnProperty.call(proto, '_onCreate');
  const resolve = (): OnCreate => {
    const parent = inherited ? Object.getPrototypeOf(proto) : null;
    const current = (parent as Record<PropertyKey, unknown> | null)?._onCreate;
    return (typeof current === 'function' ? current : original) as OnCreate;
  };
  const wrapped: OnCreate = function (this: CombatLike, ...args: unknown[]) {
    if (!this.previous && Number(this.round ?? 0) > 0) {
      // A guarded undo or rollback re-creates an ended fight at its old round: nothing is
      // replayed then (no round or turn events, no dnd5e recoveries), only the error goes.
      const ns = (args[1] as Record<string, { changeMode?: unknown } | undefined> | null)?.[
        MODULE_ID
      ];
      const restore = ns?.changeMode === 'undo' || ns?.changeMode === 'rollback';
      this.previous = restore && this.current ? { ...this.current } : { ...UNSTARTED_STATE };
    }
    return resolve().apply(this, args);
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

/**
 * Actor ownership with undo (F5 L3, D-082): `plan-ownership-change` (admin set)
 * plans who owns which actor as a guarded change: an update of
 * `ownership.<userId>` on each actor, applied with `apply-planned-change` and
 * reverted with `undo-change` (back to the old level, or to the default when
 * the user had no entry). Replaces assign-actor-ownership and
 * remove-actor-ownership.
 */

/** The guarded feature switch ("AI Tool: Ownership (writes)"), on by default. */
export const OWNERSHIP_FEATURE_ID = 'ownership';

/** What `plan-ownership-change` can do. */
export const OWNERSHIP_ACTIONS = ['assign', 'remove'] as const;
export type OwnershipAction = (typeof OWNERSHIP_ACTIONS)[number];

/** Foundry's ownership levels by name (CONST.DOCUMENT_OWNERSHIP_LEVELS). */
export const OWNERSHIP_LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } as const;
export type OwnershipLevelName = keyof typeof OWNERSHIP_LEVELS;

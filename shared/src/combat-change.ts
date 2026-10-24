/**
 * Combat start and end with undo (David's GM test, 2026-10-23): `plan-combat-change` goes
 * through plan, confirm and undo like damage and scene dressing do.
 *
 * Flow:
 * - The bridge tool `plan-combat-change` (play set) sends a {@link CombatChangeRequest} to the
 *   module's read-only `planCombatChange` query. The module builds generic guarded ops on the
 *   Combat document; nothing is written there.
 * - The bridge stores the ops as a guarded plan (feature `live-play`, the same switch as damage
 *   and conditions); `apply-planned-change` applies it and `undo-change` reverts it, so every
 *   change shows in Recent Changes.
 * - `start` creates the Combat with its combatants (a plain write; undo deletes it again).
 * - `end` deletes the Combat, so its plan is destructive and never applies without confirming;
 *   undo re-creates the fight from the stored source data (round, turn and combatants).
 *
 * GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const COMBAT_PLAN_QUERY = 'planCombatChange';

/** What `plan-combat-change` can do. */
export const COMBAT_CHANGE_ACTIONS = ['start', 'end'] as const;
export type CombatChangeAction = (typeof COMBAT_CHANGE_ACTIONS)[number];

/**
 * Start a fight on the viewed scene (or `sceneId`): a new Combat with a combatant for each token.
 * Without `tokenIds` the module takes the player characters and every Hostile token (Neutral
 * and Friendly tokens stay out); the dashboard's picker sends the ids the GM ticked. Initiative
 * is not rolled: that is the usual next step (roll-initiative-for-npcs). The combat is created
 * already begun (round 1, turn 0) without Foundry's combatStart hook, so effects that start with
 * combat do not fire.
 * Undo deletes the new Combat.
 */
export interface CombatStartRequest {
  action: 'start';
  tokenIds?: string[];
  sceneId?: string;
}

/** End the fight: delete the Combat (the active one unless `combatId` names another). */
export interface CombatEndRequest {
  action: 'end';
  combatId?: string;
}

export type CombatChangeRequest = CombatStartRequest | CombatEndRequest;

/** The module's answer: the ops of one plan plus a summary. */
export interface CombatChangePlan {
  summary: string;
  ops: GuardedOp[];
  /** end: the Combat that goes. Not set for start (the Combat does not exist yet). */
  combatId?: string;
  /** start: the combatants, in order. */
  combatants?: string[];
  /** start: tokens left out, each with the reason. */
  skipped?: string[];
  /** What Undo does not bring back; shown beside the plan. */
  warning?: string;
}

/** What `plan-combat-change` returns beside the guarded plan. */
export interface CombatChangePlanResult {
  combatId?: string;
  combatants?: string[];
  skipped?: string[];
  warning?: string;
  /** The GM switched on "apply without confirming"; never true when the plan deletes. */
  autoApply: boolean;
}

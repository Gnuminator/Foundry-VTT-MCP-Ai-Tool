/**
 * Live play changes with undo (F5, D-082): damage, healing, temporary hit
 * points, conditions and resources go through plan, confirm and undo instead
 * of writing at once.
 *
 * Flow:
 * - The bridge tool `plan-actor-change` (play set) sends a
 *   {@link LiveActorRequest} to the module's read-only `planLiveChange` query.
 *   The module builds the ops inside Foundry, where dnd5e runs: damage and
 *   healing are a dry run of dnd5e's `applyDamage`, stopped in the
 *   `dnd5e.preApplyDamage` hook, so resistances, vulnerabilities, immunities
 *   and temporary hit points count. Ops are the generic guarded `update`,
 *   `create` and `delete`.
 * - The bridge stores the ops as a guarded plan (feature
 *   {@link LIVE_PLAY_FEATURE_ID}, on by default); `apply-planned-change`
 *   applies it and `undo-change` reverts it.
 * - When the GM switched on "apply without confirming" for live play, the plan
 *   says so ({@link LiveActorPlanResult.autoApply}) and the caller applies it at
 *   once (the dashboard skips its confirm window, Claude skips asking). The
 *   apply itself is unchanged, so the dashboard's GM Actions switch and the
 *   feature switch still hold.
 *
 * GM only: the preview shows exact hit points.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const LIVE_PLAN_QUERY = 'planLiveChange';

/** The guarded feature switch ("AI Tool: Live play (writes)"), on by default. */
export const LIVE_PLAY_FEATURE_ID = 'live-play';

/** What `plan-actor-change` can do. */
export const LIVE_ACTOR_ACTIONS = [
  'damage',
  'healing',
  'temp-hp',
  'condition',
  'resource',
  'clear-conditions',
] as const;
export type LiveActorAction = (typeof LIVE_ACTOR_ACTIONS)[number];

/** One `plan-actor-change` request as the module's `planLiveChange` query takes it. */
export interface LiveActorRequest {
  scope: 'actor';
  action: LiveActorAction;
  /** Token names or ids on the current scene (preferred), else actor names or ids. */
  targets: string[];
  /** damage, healing, temp-hp: the amount (0 or more). */
  amount?: number;
  /** damage: a dnd5e damage type key (fire, slashing...); omitted = untyped. */
  damageType?: string;
  /** damage: 2 for a critical hit, 0.5 for half. */
  multiplier?: number;
  /** damage: skip the target's resistances, vulnerabilities and immunities. */
  ignoreResistance?: boolean;
  /** condition: a status id or name (prone, poisoned, exhaustion...). */
  condition?: string;
  /** condition: on (default) or off. */
  active?: boolean;
  /** condition "exhaustion": the level to set (default one more, or 0 when off). */
  level?: number;
  /** clear-conditions: names or ids to remove; omitted = only expired effects. */
  conditions?: string[];
  /** resource: spell level ("spell3"), "pact", a class resource label or key, or an item name. */
  resource?: string;
  /** resource: the new current value (0 to max). */
  value?: number;
}

/** What one target looks like after the change (or why it is skipped). */
export interface LiveTargetPreview {
  /** The token or actor name. */
  target: string;
  /** The actor changed (a synthetic actor for an unlinked token). */
  actorUuid: string;
  /** A readable line, e.g. "Wolf 2: 12 fire damage (resisted, 6 taken), HP 11 to 5". */
  line: string;
  /** Set when this target needs no change (already prone, immune...). */
  skipped?: boolean;
}

/** The module's answer: the ops of one plan plus a preview per target. */
export interface LiveChangePlan {
  summary: string;
  ops: GuardedOp[];
  targets: LiveTargetPreview[];
}

/** What `plan-actor-change` returns: the guarded plan plus the preview. */
export interface LiveActorPlanResult {
  targets: LiveTargetPreview[];
  /**
   * The GM switched on "apply without confirming" for live play: apply this plan
   * at once (apply-planned-change) without asking. Only ever true for a plan of
   * risk "write".
   */
  autoApply: boolean;
}

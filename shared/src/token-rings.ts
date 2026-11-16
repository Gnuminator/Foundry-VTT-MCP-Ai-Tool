/**
 * Dynamic token rings by default (I-093): turn Foundry's dynamic token ring on, or off again, on
 * the prototype tokens of the world's actors as one guarded bulk change under the feature
 * `token-rings`. The dnd5e system draws the damage flash, the turn gradient and the defeated
 * colour itself once a ring is enabled.
 *
 * Flow:
 * - The bridge tool `plan-token-rings` (admin set) sends a {@link TokenRingsPlanRequest} to the
 *   module's read-only `planTokenRings` query. The module builds one generic guarded `update` op
 *   per actor (`prototypeToken.ring.enabled`); nothing is written there.
 * - The bridge stores the ops as a guarded plan; `apply-planned-change` applies it and
 *   `undo-change` reverts it. A plan holds at most `TOKEN_RINGS_BATCH` actors; the reply says how
 *   many are left, and a new plan picks up where the last one stopped.
 * - Tokens already placed on scenes keep their own copy of the ring setting; only tokens placed
 *   from now on take the new default. A second plan (`tokens: 'placed'`) turns the ring on for
 *   the tokens already placed: one `ring.enabled` update per token document on the scenes, so
 *   unlinked tokens, which keep their own copy, are covered too.
 *
 * GM only.
 */
import type { GuardedOp } from './guarded-write.js';

/** The guarded feature id and its world-setting switch (`feature.token-rings.enabled`). */
export const TOKEN_RINGS_FEATURE_ID = 'token-rings';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const TOKEN_RINGS_PLAN_QUERY = 'planTokenRings';

/** The most actors one plan touches (the guarded-write plan cap is 200 ops). */
export const TOKEN_RINGS_BATCH = 150;

export const TOKEN_RINGS_ACTIONS = ['enable', 'disable'] as const;
export type TokenRingsAction = (typeof TOKEN_RINGS_ACTIONS)[number];

export const TOKEN_RINGS_ACTOR_TYPES = ['all', 'npc', 'character'] as const;
export type TokenRingsActorType = (typeof TOKEN_RINGS_ACTOR_TYPES)[number];

/** `actors`: the default token of each actor. `placed`: the tokens already placed on scenes. */
export const TOKEN_RINGS_TARGETS = ['actors', 'placed'] as const;
export type TokenRingsTarget = (typeof TOKEN_RINGS_TARGETS)[number];

export interface TokenRingsPlanRequest {
  action: TokenRingsAction;
  /** What to change; default `actors`. */
  tokens?: TokenRingsTarget;
  /** With tokens `placed`: only the scenes with these names (case insensitive); default all. */
  scenes?: string[];
  /** Which actors: all (default; characters and NPCs), only NPCs, or only characters. */
  actorType?: TokenRingsActorType;
  /** Only the actors with these names (case insensitive). */
  names?: string[];
}

/** The module's answer: the ops of one plan. */
export interface TokenRingsPlan {
  summary: string;
  ops: GuardedOp[];
  /** Actors in this plan. */
  count: number;
  /** Actors that match but are not in this plan (ask again after applying it). */
  remaining: number;
  /** Matching actors that are already in the wanted state, left out. */
  alreadyDone: number;
  /** Requested names that matched nothing (empty when all matched). */
  unmatched: string[];
}

/** What `plan-token-rings` returns beside the guarded plan. */
export interface TokenRingsPlanResult {
  count: number;
  remaining: number;
  alreadyDone: number;
  unmatched: string[];
  /** Never auto applied. */
  autoApply: false;
}

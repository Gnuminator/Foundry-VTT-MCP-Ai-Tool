/**
 * NPC turn assistant (I-125, ships off): `plan-npc-turn` (play set) reads the combat and the
 * monster whose turn it is, and plans that turn's movement as one guarded plan.
 *
 * Flow:
 * - The tool sends an {@link NpcTurnRequest} to the module's read-only `planNpcTurn` query. With
 *   no `moveTo` the reply holds only the {@link NpcTurnContext} (the NPC, its speed and attacks,
 *   the targets with distance and AC), so Claude can choose; with `moveTo` the module also
 *   validates the square (inside the speed, free, in the scene) and returns the guarded ops.
 * - The bridge stores the ops as a guarded plan (feature {@link NPC_TURN_FEATURE_ID}, off by
 *   default); `apply-planned-change` applies it and `undo-change` puts the token back.
 * - The attack is not part of the plan: a roll cannot be undone. The reply names the attack step
 *   (`use-npc-activity`, then `plan-actor-change` for the damage, which is undoable).
 *
 * GM only: the context shows exact hit points.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const NPC_TURN_QUERY = 'planNpcTurn';

/** The guarded feature switch ("AI Tool: NPC turn assistant (writes)"), off by default. */
export const NPC_TURN_FEATURE_ID = 'npc-turn';

/** `plan-npc-turn` parameters as the module's `planNpcTurn` query takes them. */
export interface NpcTurnRequest {
  /** Token name or id of the NPC. Default: the combatant whose turn it is. */
  token?: string;
  /** Plan moving the NPC's token to this grid square (its top-left square). */
  moveTo?: { gridX: number; gridY: number };
  /** The attack or action Claude intends to use (checked against the NPC's items). */
  itemName?: string;
  /** Token name or id of the intended target (checked for reach after the move). */
  target?: string;
  /** Why this turn (shown in the plan summary). */
  reason?: string;
}

/** One item the NPC can use. */
export interface NpcTurnAction {
  name: string;
  /** dnd5e activity types on the item (attack, save, utility...). */
  activityTypes: string[];
  /** Reach or range in the scene's units; null when the item gives none. */
  rangeFt: number | null;
  /** Long range, for a ranged attack; null otherwise. */
  longRangeFt: number | null;
  /** True for a melee reach (the item has no range value but a reach, or is a melee weapon). */
  melee: boolean;
}

/** One possible target. */
export interface NpcTurnTarget {
  tokenId: string;
  name: string;
  gridX: number;
  gridY: number;
  /** Distance from the NPC where it stands, in the scene's units (5 per square, diagonals count 1). */
  distance: number;
  /** Distance from the planned square, when a move is planned. */
  distanceAfterMove?: number;
  ac: number | null;
  hp: { value: number | null; max: number | null } | null;
  conditions: string[];
}

/** What the NPC and the table look like at the start of its turn. */
export interface NpcTurnContext {
  round: number;
  token: { id: string; name: string; gridX: number; gridY: number };
  actor: { id: string; name: string };
  /** Walking speed in the scene's units; null when the actor has none. */
  speed: number | null;
  units: string;
  /** Squares the scene uses per move unit (distance per square). */
  squareSize: number;
  actions: NpcTurnAction[];
  targets: NpcTurnTarget[];
  /** Always set: the path is a straight count of squares, walls and difficult terrain are not checked. */
  notes: string[];
}

/** The module's answer. `ops` and `summary` are set only when a move was asked for. */
export interface NpcTurnPlan {
  context: NpcTurnContext;
  summary?: string;
  ops?: GuardedOp[];
  /** Readable lines, one per step of the turn. */
  steps: string[];
  /** The attack step, spelled out for the existing tools; null when no attack was named. */
  attack: {
    itemName: string;
    target: string;
    targetAC: number | null;
    inReach: boolean;
    rollWith: string;
    damageWith: string;
  } | null;
}

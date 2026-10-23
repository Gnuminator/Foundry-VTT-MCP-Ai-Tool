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
 * - The rolls are not part of the plan: a roll cannot be undone. The reply names the steps
 *   (`use-npc-activity`, `roll-saving-throws` for a save-based action). Claude rolls first, then
 *   calls `plan-npc-turn` again with the move and `results` (the damage each target takes, read
 *   from the rolls): one guarded plan holds the move and every hit point change, so one confirm
 *   covers the turn and one undo puts it back.
 * - A legendary action (an activity with legendary activation) is planned on another creature's
 *   turn only, within the legendary actions left.
 *
 * GM only: the context shows exact hit points.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const NPC_TURN_QUERY = 'planNpcTurn';

/** The guarded feature switch ("AI Tool: NPC turn assistant (writes)"), off by default. */
export const NPC_TURN_FEATURE_ID = 'npc-turn';

/** One attack of the turn: the item and the token it is aimed at. */
export interface NpcTurnAttackRequest {
  itemName: string;
  target: string;
  /** The activity on the item (an item can hold an attack, a save and more). Default: its attack, else its first. */
  activity?: string;
}

/** Damage one target takes this turn, from the rolls Claude already made. */
export interface NpcTurnDamage {
  /** Token name or id of the creature that takes it. */
  target: string;
  /** The damage the roll reported (a critical hit's dice are already doubled). */
  amount: number;
  /** dnd5e damage type (slashing, fire...), so resistance and immunity apply. */
  damageType?: string;
  /** 0.5 for half damage on a successful save, 0 for none. Default 1. */
  multiplier?: number;
}

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
  /** Several attacks in one turn (a multiattack), each checked on its own; with `itemName` it adds to it. */
  attacks?: NpcTurnAttackRequest[];
  /** The damage the rolls dealt, planned together with the move as one change. */
  results?: NpcTurnDamage[];
  /** Plan a Dash: the move may use twice the speed. */
  dash?: boolean;
  /** Why this turn (shown in the plan summary). */
  reason?: string;
}

/** One activity of an item (dnd5e 6 items hold several: an attack, a save, a utility). */
export interface NpcTurnActivity {
  name: string;
  /** attack, save, damage, utility, heal, cast... */
  type: string;
  /** Legendary actions it costs; null when it is not a legendary action. */
  legendaryCost: number | null;
  /** A save-based activity: the save, its DC and what a success does to the damage. */
  save: { abilities: string[]; dc: number | null; onSave: string | null } | null;
  /** True when the activity deals damage. */
  damage: boolean;
}

/** One item the NPC can use. */
export interface NpcTurnAction {
  name: string;
  /** dnd5e activity types on the item (attack, save, utility...). */
  activityTypes: string[];
  /** Every activity on the item (absent from an older module). */
  activities?: NpcTurnActivity[];
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
  /** Concentrating on a spell (a hit may break it). */
  concentrating: boolean;
  prone: boolean;
  /** At 0 hit points already. */
  down: boolean;
  /**
   * The square to attack it from: the cheapest one the NPC can walk to this turn where
   * `engageWith` reaches it. Null when it cannot be reached this turn.
   */
  engage: { gridX: number; gridY: number; cost: number } | null;
  /** Higher is the better target for this NPC; `reasons` says why. */
  score: number;
  reasons: string[];
}

/** What the NPC and the table look like at the start of its turn. */
export interface NpcTurnContext {
  round: number;
  token: { id: string; name: string; gridX: number; gridY: number };
  actor: { id: string; name: string };
  /** Walking speed in the scene's units; null when the actor has none. */
  speed: number | null;
  /** What the NPC may walk this turn: the speed, doubled by a Dash. */
  moveLimit: number | null;
  units: string;
  /** Squares the scene uses per move unit (distance per square). */
  squareSize: number;
  actions: NpcTurnAction[];
  /** The text of the NPC's Multiattack feature, when it has one (how many attacks, with what). */
  multiattack: string | null;
  /** The action the `engage` squares were worked out for. */
  engageWith: string | null;
  targets: NpcTurnTarget[];
  /** The target the scores favour; null when there is none. */
  suggested: { tokenId: string; name: string; reasons: string[] } | null;
  /** Legendary actions: the pool the NPC has; null when it has none. */
  legendary?: { max: number; spent: number; value: number } | null;
  /** True when it is this NPC's own turn (a legendary action is then refused). */
  ownTurn?: boolean;
  /** What was and was not checked (walls, terrain, levels, grid rules). */
  notes: string[];
}

/** One attack of the turn, spelled out for the existing tools. */
export interface NpcTurnAttack {
  itemName: string;
  target: string;
  targetAC: number | null;
  inReach: boolean;
  /** A melee attack with a wall or closed door between the NPC (after the move) and the target. */
  blockedByWall: boolean;
  rollWith: string;
  damageWith: string;
  /** The activity used (absent from an older module). */
  activity?: string;
  /** attack: roll to hit; save: the targets roll a save; other: no roll to hit or save. */
  kind?: 'attack' | 'save' | 'other';
  /** A save-based activity: the save and DC the target rolls against. */
  save?: { abilities: string[]; dc: number | null; onSave: string | null };
  /** Legendary actions this costs, when it is one. */
  legendaryCost?: number;
  /** A save-based activity: how to roll the target's save. */
  saveWith?: string;
}

/** The module's answer. `ops` and `summary` are set only when a move was asked for. */
export interface NpcTurnPlan {
  context: NpcTurnContext;
  summary?: string;
  ops?: GuardedOp[];
  /** Readable lines, one per step of the turn. */
  steps: string[];
  /** The first attack step, spelled out for the existing tools; null when no attack was named. */
  attack: NpcTurnAttack | null;
  /** Every attack named, in order (a multiattack has several). */
  attacks: NpcTurnAttack[];
  /** The squares the NPC walks through, start first; set when a move was planned. */
  path?: Array<{ gridX: number; gridY: number }>;
  /** What the move costs in the scene's units (terrain and diagonals counted). */
  moveCost?: number;
}

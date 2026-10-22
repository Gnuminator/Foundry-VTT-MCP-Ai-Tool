/**
 * Paper sync (Paper nights A, `Design/Paper and Foundry nights.md`): after a night played on
 * paper, `plan-paper-sync` (play set) writes the numbers on one paper sheet back into Foundry as
 * one guarded plan per character.
 *
 * Flow:
 * - The tool sends a {@link PaperSyncRequest} to the module's read-only `planPaperSync` query. The
 *   module compares the absolute values on the sheet with the actor and builds guarded ops for the
 *   fields that differ (the generic `update`, `create` and `delete`, the same ones the
 *   `plan-actor-change` planner emits). Nothing is written.
 * - The bridge stores the ops as a guarded plan (feature {@link PAPER_SYNC_FEATURE_ID}, off by
 *   default, never auto-applied); `apply-planned-change` applies it and `undo-change` reverts it.
 *   A removed item (quantity 0) makes the plan destructive: the second confirm.
 * - Every value is absolute ("HP 18", never "minus 12"): the paper sheet at the end of the night
 *   wins over Foundry. A value above the maximum is refused, so a misread "8" for "3" is caught
 *   before the GM sees the diff. The whole request is refused when any field is wrong.
 *
 * What it never touches: XP (the campaign uses milestones), level, class and max HP. A level-up
 * happens on the sheet in Foundry, outside the sync.
 *
 * The request and plan types are shared by the "After a paper night" form (item B) and the sheet
 * photo prompt (item E): both build a {@link PaperSyncRequest} and show a {@link PaperSyncPlan}.
 *
 * GM only: the plan shows exact hit points.
 */
import type { GuardedOp } from './guarded-write.js';

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const PAPER_SYNC_QUERY = 'planPaperSync';

/** The guarded feature switch ("AI Tool: Paper sync (writes)"), off by default, no auto-apply. */
export const PAPER_SYNC_FEATURE_ID = 'paper-sync';

/** Spell slot levels on a sheet, plus the pact magic slots. */
export const PAPER_SYNC_SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'pact'] as const;
export type PaperSyncSlotKey = (typeof PAPER_SYNC_SLOT_KEYS)[number];

/** The five coins of a dnd5e sheet. */
export const PAPER_SYNC_COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
export type PaperSyncCoin = (typeof PAPER_SYNC_COINS)[number];

/** Hit dice left of one class. `class` may be left out when the character has only one. */
export interface PaperSyncHitDice {
  class?: string;
  left: number;
}

/** A class resource (Ki Points, Channel Divinity, ...) or an item with uses, current value. */
export interface PaperSyncResource {
  name: string;
  value: number;
}

/**
 * One inventory line: the item on the sheet (by name or id) or a compendium item to add (by
 * uuid), and the quantity now. Quantity 0 removes the item (destructive).
 */
export interface PaperSyncInventoryLine {
  item?: string;
  /** A compendium item uuid: adds the item with this quantity (or sets it when the character has it). */
  uuid?: string;
  quantity: number;
}

/**
 * The fields a paper sheet can bring back. Every field is optional; only fields that differ from
 * Foundry become ops. A key not listed here (xp, level, class, max HP) is refused.
 */
export interface PaperSyncRequest {
  /** The character: actor name or id (a player character). */
  actor: string;
  /** Current hit points, 0 to the maximum. */
  hp?: number;
  /** Temporary hit points (0 or more). */
  tempHp?: number;
  /** Spell slots left per level (`"1"` to `"9"`) and `"pact"`. */
  slots?: Partial<Record<PaperSyncSlotKey, number>>;
  /** Hit dice left per class. */
  hitDice?: PaperSyncHitDice[];
  /** Class resources and item uses left. */
  resources?: PaperSyncResource[];
  /** Coins now. */
  coins?: Partial<Record<PaperSyncCoin, number>>;
  /** Exhaustion level, 0 to 6. */
  exhaustion?: number;
  /** The conditions the character has now, exactly (an empty list clears them all). */
  conditions?: string[];
  inspiration?: boolean;
  /** Reset the death saves (successes and failures to 0). */
  resetDeathSaves?: boolean;
  /** Item quantities now; 0 removes the item. */
  inventory?: PaperSyncInventoryLine[];
}

/** The request keys, in the order the form and the paper strip list them. */
export const PAPER_SYNC_FIELDS = [
  'hp',
  'tempHp',
  'slots',
  'hitDice',
  'resources',
  'coins',
  'exhaustion',
  'conditions',
  'inspiration',
  'resetDeathSaves',
  'inventory',
] as const;
export type PaperSyncField = (typeof PAPER_SYNC_FIELDS)[number];

/** One field the plan changes. */
export interface PaperSyncChange {
  field: PaperSyncField;
  /** What changes, e.g. "Level 2 spell slots", "gp", "Rope". */
  label: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  /** A readable line, e.g. "gp 112 to 87". */
  line: string;
}

/** The module's answer: ops of one plan plus what changes and what already matched. */
export interface PaperSyncPlan {
  summary: string;
  ops: GuardedOp[];
  actor: { name: string; uuid: string };
  changes: PaperSyncChange[];
  /** Fields on the sheet that already match Foundry (no op), e.g. "HP already 18". */
  unchanged: string[];
  /** Something to check that did not stop the plan (e.g. an item that could not be matched twice). */
  warnings: string[];
}

/** What `plan-paper-sync` returns: the guarded plan plus the field list. */
export interface PaperSyncPlanResult {
  actor: PaperSyncPlan['actor'];
  changes: PaperSyncChange[];
  unchanged: string[];
  warnings: string[];
  /** Always false: paper sync never applies without the GM's confirm. */
  autoApply: false;
}

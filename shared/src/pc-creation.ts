/**
 * Player-character creation (Backlog pc-creation-tool): Claude builds a character-type actor with
 * items copied from compendium packs, through one guarded write (plan, confirm, undo).
 *
 * The module's read-only `planPcCreation` query turns one {@link PcCreationRequest} into a single
 * guarded `create` op for the Actor with its items inlined (container contents get their
 * `system.container` link), so an undo is one delete. Nothing is written by the query.
 *
 * Advancement does not run: a class, subclass, species or background item is copied as it is, so
 * the features it would grant are added by id, like any other item.
 */
import type { GuardedOp } from './guarded-write.js';

/** The guarded feature id and its world-setting switch (`feature.pc-creation.enabled`). */
export const PC_CREATION_FEATURE_ID = 'pc-creation';

/** Module query name (prefixed with the module id on the wire). GM client only, read-only. */
export const PC_CREATION_QUERY = 'planPcCreation';

/** One item to copy onto the new character. */
export interface PcCreationItem {
  /** A compendium item uuid (`Compendium.<pack>.Item.<id>`); a container brings its contents. */
  uuid: string;
  /** Equipment: worn or wielded. */
  equipped?: boolean;
  /** Spell: prepared. */
  prepared?: boolean;
  /** Stack size for a physical item. */
  quantity?: number;
}

export interface PcCreationRequest {
  name: string;
  /** The player who owns the character: Foundry user name or id (not a GM). Default: no owner. */
  owner?: string;
  /** Up to 200 items, container contents included. */
  items?: PcCreationItem[];
}

/** The module's answer: one plan plus what the planner worked out. */
export interface PcCreationPlan {
  summary: string;
  ops: GuardedOp[];
  actor: { name: string; owner: string | null };
  /** Every item that will be on the sheet (container contents included). */
  items: { name: string; type: string; equipped?: boolean; prepared?: boolean; inside?: string }[];
  warnings: string[];
}

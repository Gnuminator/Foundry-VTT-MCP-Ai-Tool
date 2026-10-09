/**
 * Reply of the bridge query `foundry-mcp-bridge.getCharacterEntity` (`get-character-entity`):
 * one item of a character with its dnd5e 6 details, or one active effect, in full. The module
 * builds it (`data-access/item-entity.ts`); the tool flattens it for the model.
 */

import type { SheetUses } from './character-sheet.js';
import type { CharacterItem } from './types.js';

/** One activity (attack, save, damage, heal, cast, utility...) as its labels show it. */
export interface ActivitySummary {
  id: string;
  name: string;
  type: string;
  activation?: string;
  range?: string;
  target?: string;
  toHit?: string;
  save?: string;
  damage?: string;
  uses?: SheetUses;
}

/** The dnd5e 6 details of an item, read from the live item (derived values already computed). */
export interface ItemEntityDetails {
  /** Spell level (0 for cantrips). */
  level?: number;
  /** Spell school key ("evo"). */
  school?: string;
  rarity?: string;
  quantity?: number;
  equipped?: boolean;
  /** "required" or "optional" when the item can be attuned. */
  attunement?: string;
  attuned?: boolean;
  uses?: SheetUses;
  activities?: ActivitySummary[];
}

/** `getCharacterEntity`: one item (with its dnd5e 6 details) or one effect, in full. */
export type CharacterEntityResult =
  | {
      success: true;
      entityType: 'item';
      entity: CharacterItem & ItemEntityDetails & { description: string };
    }
  | { success: true; entityType: 'effect'; entity: Record<string, unknown> };

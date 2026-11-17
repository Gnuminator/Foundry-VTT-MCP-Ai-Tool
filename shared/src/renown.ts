/**
 * Factions and renown contract (dnd5e 6.1, D-146).
 *
 * dnd5e 6.1 adds optional renown tracking (world setting "Renown Scores"):
 * - `faction` actors: `system.members` (`{ uuid, rank, role }`), `system.ranks` (id to
 *   `{ name, renown }`, the renown needed for the rank) and `system.type.value` (a category).
 * - `renown` items on characters and groups: `system.modifiers`, a list of `{ faction, value }`
 *   where `faction` is the faction actor's identifier. An actor's renown with a faction is the
 *   sum of its renown items' modifiers for that identifier.
 *
 * Flow: the module's `getRenownState` query (GM client, read only) reads the faction actors and
 * every actor's renown items. The bridge tool `get-renown` returns that state; the tool
 * `plan-renown-change` turns one action into a guarded plan (feature `party`, the same switch as
 * the party panel): `adjust` and `set` create or update a renown item named
 * {@link RENOWN_ADJUSTMENT_PREFIX} + the faction, `set-member` updates a faction's member list.
 * Undo reverts each one.
 */

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const RENOWN_STATE_QUERY = 'getRenownState';

/** Name prefix of the renown items the AI Tool creates (one per faction and actor). */
export const RENOWN_ADJUSTMENT_PREFIX = 'Renown adjustment: ';

export const RENOWN_ACTIONS = ['adjust', 'set', 'set-member'] as const;
export type RenownAction = (typeof RENOWN_ACTIONS)[number];

export interface RenownRank {
  id: string;
  name: string;
  /** The renown needed to hold the rank; null when the rank sets none. */
  renown: number | null;
}

export interface RenownFactionMember {
  uuid: string;
  /** The member actor's name; null when the actor cannot be found. */
  name: string | null;
  /** The rank id (a key of the faction's ranks), or an empty string. */
  rank: string;
  role: string;
}

/** One actor's renown with one faction. */
export interface RenownScore {
  /** The faction identifier, as in the renown items' modifiers. */
  faction: string;
  /** The faction actor's name; the identifier when no faction actor has it. */
  factionName: string;
  value: number;
  /** The highest rank whose renown the value reaches; null without ranks. */
  rank: string | null;
}

export interface RenownModifier {
  faction: string;
  value: number;
}

export interface RenownItem {
  itemId: string;
  uuid: string;
  name: string;
  modifiers: RenownModifier[];
}

/** An actor (character or group) that holds renown items. */
export interface RenownHolder {
  actorId: string;
  uuid: string;
  name: string;
  type: string;
  scores: RenownScore[];
  items: RenownItem[];
}

export interface RenownFaction {
  actorId: string;
  uuid: string;
  name: string;
  identifier: string;
  /** The faction category (label), if one is set. */
  category: string | null;
  ranks: RenownRank[];
  members: RenownFactionMember[];
}

export interface RenownState {
  /** The dnd5e world setting "Renown Scores" is on. */
  enabled: boolean;
  factions: RenownFaction[];
  holders: RenownHolder[];
  /** Characters and NPCs: the actors dnd5e lets into a faction. */
  creatures: { actorId: string; name: string }[];
  /** Things the scan could not read. */
  warnings: string[];
}

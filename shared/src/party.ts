/**
 * Party panel contract (idea I-079; plan in the vault note
 * `Design/Batch E-lite plan.md`, agreed 2026-09-30).
 *
 * Flow:
 * - The module's `getPartyState` query runs on the GM client and reads the
 *   dnd5e 6 group actors (`type: "group"`): members, travel pace, the current
 *   encounter and, per member, the numbers a GM glances at (HP, AC, passive
 *   Perception, conditions, exhaustion, hit dice). It also builds the chat
 *   card data of a party rest request the way dnd5e's own group sheet does.
 *   Read only.
 * - The bridge tool `get-party` (play set) returns that state; the tool
 *   `plan-party-change` turns one action into a guarded plan (feature
 *   {@link PARTY_FEATURE_ID}): `pace` updates the group's travel pace,
 *   `add-to-combat` creates combatants (or a new encounter) for the members'
 *   tokens, `rest-request` posts the rest request card. Undo reverts each one
 *   (for a rest request it removes the card while nobody has used it; once a
 *   player rested from it, undo reports a conflict and the GM deletes the card).
 * - The dashboard's Party drawer shows the state and runs the three actions
 *   through plan, confirm and apply (D-077: the table works without AI).
 *
 * GM only: the state shows hidden tokens and exact HP.
 */

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const PARTY_STATE_QUERY = 'getPartyState';

/** The guarded feature switch ("AI Tool: Party (writes)"). */
export const PARTY_FEATURE_ID = 'party';

/** dnd5e 6 rest types a party rest request can ask for. */
export const PARTY_REST_TYPES = ['short', 'long'] as const;
export type PartyRestType = (typeof PARTY_REST_TYPES)[number];

export interface PartyHitPoints {
  value: number;
  max: number;
  temp: number;
}

/** A token of a member on the encounter's scene (or the active scene). */
export interface PartyMemberToken {
  tokenId: string;
  name: string;
  hidden: boolean;
  /** Already a combatant of the current encounter. */
  inCombat: boolean;
}

export interface PartyMember {
  actorId: string;
  uuid: string;
  name: string;
  /** Actor type: `character`, `npc`, `vehicle`, ... */
  type: string;
  /** Character level; null for anything without one. */
  level: number | null;
  hp: PartyHitPoints | null;
  ac: number | null;
  passivePerception: number | null;
  /** Exhaustion level (0 when none). */
  exhaustion: number;
  /** Hit dice left and total; null when the actor has none. */
  hitDice: { value: number; max: number } | null;
  /** Death saves, only while the member is at 0 HP. */
  deathSaves: { success: number; failure: number } | null;
  /** Active conditions and status effects, as labels. */
  conditions: string[];
  inspiration: boolean;
  tokens: PartyMemberToken[];
}

export interface PartyPace {
  /** `slow`, `normal` or `fast` (keys of `CONFIG.DND5E.travelPace`). */
  value: string;
  label: string;
  /** A member is slowed, so the party moves at slow pace whatever is set. */
  slowed: boolean;
}

/** Chat message data for a party rest request card (dnd5e `type: "request"`). */
export type PartyRestCard = Record<string, unknown>;

export interface PartyGroup {
  actorId: string;
  uuid: string;
  name: string;
  /** The world's primary party (dnd5e setting `primaryParty`). */
  primary: boolean;
  /** Average character level (dnd5e `system.level`). */
  level: number;
  pace: PartyPace | null;
  members: PartyMember[];
  /** Rest request cards by rest type, built by the module with dnd5e's own labels. */
  restCards: Partial<Record<PartyRestType, PartyRestCard>>;
}

export interface PartyEncounter {
  combatId: string;
  uuid: string;
  round: number;
  started: boolean;
}

export interface PartyState {
  /** Primary party first, then the other groups by name. */
  groups: PartyGroup[];
  /** Travel paces to choose from (value and localized label). */
  paceOptions: { value: string; label: string }[];
  /** The scene member tokens are read from: the encounter's scene, else the active scene. */
  scene: { sceneId: string; name: string } | null;
  /** The GM's current encounter, if any. */
  encounter: PartyEncounter | null;
  /** Things the scan could not read (missing dnd5e, broken actors). */
  warnings: string[];
}

/**
 * "My character" (I-096): the read-only sheet of a character a player owns, as the Foundry
 * module projects it (an allowlist of dnd5e fields, nothing GM-only) for the dashboard's `/me`
 * page. The module query `characterSheet` returns {@link CharacterSheetsResult}; the bridge
 * reaches it through the control method `character_sheet` (never an MCP tool).
 *
 * Every field is what the player already sees on their own sheet in Foundry. An unidentified
 * item shows its unidentified name and description only.
 */

/** Module query name. */
export const CHARACTER_SHEET_QUERY = 'characterSheet';

export interface SheetClass {
  name: string;
  levels: number;
  subclass: string | null;
  /** Hit die, e.g. "d10". */
  hitDie: string | null;
}

export interface SheetAbility {
  key: string;
  label: string;
  score: number;
  mod: number;
  save: number;
  saveProficient: boolean;
}

export interface SheetSkill {
  key: string;
  label: string;
  ability: string;
  total: number;
  passive: number;
  /** 0, 0.5 (half), 1 (proficient) or 2 (expertise). */
  proficiency: number;
}

export interface SheetSlot {
  /** 1 to 9, or 0 for pact magic. */
  level: number;
  value: number;
  max: number;
  pact: boolean;
}

export interface SheetUses {
  value: number;
  max: number;
  recovery: string | null;
}

export interface SheetItem {
  id: string;
  name: string;
  type: string;
  quantity: number;
  equipped: boolean;
  attuned: boolean;
  /** "required" or "optional" when the item can be attuned, else null. */
  attunement: string | null;
  uses: SheetUses | null;
  /** Weapons: attack bonus as shown on the sheet, e.g. "+5". */
  attack: string | null;
  /** Weapons: damage as shown on the sheet, e.g. "1d8 + 3 slashing". */
  damage: string | null;
  /** Plain text, at most 600 characters. */
  description: string;
}

export interface SheetSpell {
  id: string;
  name: string;
  level: number;
  school: string | null;
  prepared: boolean;
  castingTime: string | null;
  range: string | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  /** Components, e.g. "V, S, M". */
  components: string;
  material: string | null;
}

export interface SheetFeature {
  id: string;
  name: string;
  /** class, subclass, race (species), background, feat or other. */
  kind: string;
  uses: SheetUses | null;
  description: string;
}

export interface CharacterSheet {
  id: string;
  name: string;
  level: number;
  classes: SheetClass[];
  species: string | null;
  background: string | null;
  alignment: string | null;
  xp: number | null;
  size: string | null;
  ac: number | null;
  hp: { value: number; max: number; temp: number };
  hitDice: { value: number; max: number };
  deathSaves: { success: number; failure: number };
  exhaustion: number;
  inspiration: boolean;
  proficiencyBonus: number | null;
  initiative: number | null;
  speed: Record<string, number>;
  speedUnits: string | null;
  senses: string[];
  abilities: SheetAbility[];
  skills: SheetSkill[];
  passivePerception: number | null;
  conditions: string[];
  concentration: string | null;
  spellcasting: { ability: string | null; dc: number | null; attack: number | null };
  slots: SheetSlot[];
  spells: SheetSpell[];
  features: SheetFeature[];
  inventory: SheetItem[];
  currency: Record<string, number>;
  languages: string[];
  armorProficiencies: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  personality: { traits: string; ideals: string; bonds: string; flaws: string; appearance: string };
}

export interface CharacterSheetsResult {
  userId: string;
  userName: string;
  sheets: CharacterSheet[];
}

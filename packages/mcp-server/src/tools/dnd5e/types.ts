/** Reply and argument shapes the dnd5e add-feature responses read (bridge replies are untyped). */

export interface ActorRef {
  id: string;
  name: string;
}

/** The bridge's reply to the single-item modes (passive, save, attack, attack-with-save, aura). */
export interface FeatureResult {
  actor: ActorRef;
  item: ActorRef;
}

export interface DamagePartValue {
  number: number;
  denomination: number;
  type: string;
}

export interface PassiveParams {
  sourceRules: string;
  sourceBook: string;
}

export interface SaveParams {
  damageParts: DamagePartValue[];
  areaType: string;
  areaSize?: number | undefined;
  areaUnits: string;
  saveDC: number;
  saveAbility: string;
  halfOnSave: boolean;
  activationType: string;
}

export interface AttackParams {
  attackBonus: number;
  damageParts: DamagePartValue[];
  attackType: string;
  reachFt?: number | undefined;
  rangeFt?: number | undefined;
  longRangeFt?: number | undefined;
  effectiveAbility: string;
  weaponClass: string;
}

export interface AttackWithSaveParams extends AttackParams {
  saveDamageParts: DamagePartValue[];
  saveDC: number;
  saveAbility: string;
  saveOnSave: string;
}

export interface AuraParams {
  damageParts: DamagePartValue[];
  areaSize: number;
  areaUnits: string;
  areaType: string;
  affectsType: string;
  activationType: string;
}

export interface SpellcastingResult {
  actor: ActorRef;
  spellcasting: { slots: Record<string, unknown> & { pact: { max: number; level: number } } };
  warnings: string[];
}

export interface SpellcastingParams {
  spellcastingClass: string;
  spellcastingLevel: number;
  effectiveAbility: string;
}

/** The bridge's reply to the spells mode. */
export interface SpellsResult {
  actor: ActorRef;
  added: Array<{ name: string; packId: string; packLabel: string; itemId: string }>;
  skipped: Array<{ name: string; reason: string }>;
  notFound: string[];
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
}

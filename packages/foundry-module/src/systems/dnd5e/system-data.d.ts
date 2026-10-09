/**
 * dnd5e 6 shapes of `actor.system` and `item.system`: augments the empty `FoundryActorSystem` and
 * `FoundryItemSystem` interfaces that `types/foundry-v14.d.ts` declares, so the core types stay
 * system-agnostic.
 *
 * Checked against the installed dnd5e 6.0.5 bundle; the trailing numbers are line numbers in its
 * `dnd5e.mjs`. Shapes are the prepared ones (what `actor.system` holds after prepareData), not
 * `_source`:
 *   - SetField values are `Set<string>` (traits.*.value, properties, damage.types, ...).
 *   - `uses.max`, `duration.value`, `range.value` and `target.*.count/size` are formula strings in
 *     `_source` and numbers after prepareData when non-empty.
 *   - `abilities.*.save`, `skills.*`, `tools.*`, `attributes.init`, `.death` and `.concentration` are
 *     RollConfigField objects in 6.0 (`{ roll: { bonus, min, max, mode } }` plus derived numbers).
 *   - Every top-level key is optional: actor types (character, npc, vehicle, group, encounter) and
 *     item types differ, and the module reads them through one union. Narrow on `document.type`.
 *   - Derived fields (prepareBaseData / prepareDerivedData) carry a `derived` comment.
 */

declare global {
  // ---------------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------------

  /** FormulaField (4566): a dice or number formula, stored as a string. */
  type Dnd5eFormula = string;

  /** dnd5e `Proficiency` instance on prepared roll data (8706). */
  interface Dnd5eProficiency {
    /** 0, 0.5, 1 or 2 */
    multiplier: number; // 8720
    /** Flat proficiency bonus after the multiplier. */
    readonly flat: number; // 8745
    readonly term: number | string; // 8772
  }

  /** D20RollModificationField (9333): per-roll advantage mode and bonus. */
  interface Dnd5eD20RollMods {
    bonus?: Dnd5eFormula; // 9339
    min?: number | null; // 9342
    max?: number | null; // 9345
    /** AdvantageModeField (9137): -1 disadvantage, 0 normal, 1 advantage. */
    mode?: number; // 9348
  }

  /** SourceField (5552). `label`, `value`, `slug`, `bookPlaceholder` are set in SourceField.prepareData. */
  interface Dnd5eSource {
    book?: string; // 5555
    page?: string; // 5556
    custom?: string; // 5557
    license?: string; // 5558
    revision?: number; // 5559
    /** "2014" or "2024"; initial follows the world rules setting. */
    rules?: string; // 5560
    /** derived */ label?: string; // 5584
    /** derived */ value?: string; // 5591
    /** derived */ slug?: string; // 5592
    /** derived */ bookPlaceholder?: string; // 5581
  }

  /** MovementField (5467). Since 6.0 speeds live in `speeds`; `walk` etc. on this object are shims (5525). */
  interface Dnd5eMovement {
    bonus?: Dnd5eFormula; // 5470
    /** persisted: false, initial 1 */ multiplier?: number; // 5471
    special?: string; // 5474
    /** FormulaField strings in source, numbers after prepareMovement. */
    speeds?: Partial<Record<'walk' | 'burrow' | 'climb' | 'fly' | 'jump' | 'swim', number>> &
      Record<string, number | undefined>; // 5475
    units?: string | null; // 5478
    hover?: boolean; // 5481
    ignoredDifficultTerrain?: Set<string>; // 5482
    /** Deprecated 6.0 shims for `speeds.*` (removed in 7.0). Prefer `speeds`. */
    walk?: number; // 5525
    burrow?: number;
    climb?: number;
    fly?: number;
    swim?: number;
    /** derived */ max?: number; // 10110
    /** derived: walk speed after reductions */ speed?: number; // 10128
    /** derived */ slowed?: boolean; // 10131
    /** derived: speeds granted by the species item */ fromSpecies?: Record<string, number>; // 10164
  }

  /** SensesField (9452). Since 6.0 ranges live in `ranges`; `darkvision` etc. here are shims (9503). */
  interface Dnd5eSenses {
    ranges?: Partial<
      Record<'blindsight' | 'darkvision' | 'tremorsense' | 'truesight', number | null>
    > &
      Record<string, number | null | undefined>; // 9455
    units?: string | null; // 9459
    special?: string; // 9462
    /** Shims for `ranges.*` (getter; the setter logs a deprecation). */
    blindsight?: number | null; // 9503
    darkvision?: number | null;
    tremorsense?: number | null;
    truesight?: number | null;
  }

  /** SimpleTraitField (11658): languages, ci, weaponProf, armorProf. */
  interface Dnd5eSimpleTrait {
    value?: Set<string>; // 11661
    custom?: string; // 11662
  }

  /** DamageTraitField (11675): di, dr, dv. */
  interface Dnd5eDamageTrait extends Dnd5eSimpleTrait {
    bypasses?: Set<string>; // 11678
  }

  /** CreatureTypeField (83649). On characters `details.type` is derived from the species item. */
  interface Dnd5eCreatureType {
    value?: string; // 83652
    subtype?: string; // 83653
    /** Missing on the species item and the character variant (`swarm: false`). */
    swarm?: string; // 83654
    custom?: string; // 83655
    /** derived (non-enumerable getter): formatted "Humanoid (elf)" */
    readonly label?: string; // 83668
    /** derived (non-enumerable getter): the CONFIG.DND5E.creatureTypes entry */
    readonly config?: unknown; // 83674
  }

  /** CurrencyTemplate (10961): CONFIG.DND5E.currencies keys. */
  interface Dnd5eCurrency {
    pp?: number; // 52419
    gp?: number; // 52425
    ep?: number; // 52431
    sp?: number; // 52437
    cp?: number; // 52443
    [denomination: string]: number | undefined;
  }

  // ---------------------------------------------------------------------------
  // Actor building blocks
  // ---------------------------------------------------------------------------

  /** Shared shape of `abilities.*.attack|check|save` (RollConfigField, 9424; prepared in prepareAbilities, 11305). */
  interface Dnd5eAbilityRoll {
    roll?: Dnd5eD20RollMods; // 9435
    /** derived */ bonus?: number; // 11336, 11345, 11355
    /** derived: the total modifier for this roll (6.0: `save` is an object, no longer a number) */
    value?: number; // 11337, 11346, 11356
    /** derived (check and save only) */ prof?: Dnd5eProficiency; // 11325, 11327
  }

  /** `abilities.<key>` (CommonTemplate, 11025). Keys str, dex, con, int, wis, cha (+ hon, san in some variants, 50392). */
  interface Dnd5eAbility {
    value: number; // 11026
    /** Save proficiency, 0 or 1 (source); prepareAbilities can raise it. */
    proficient?: number; // 11030
    /** Maximum score; null in source, set to CONFIG.DND5E.maxAbilityScore when not finite (derived). */
    max?: number | null; // 11034
    attack?: Dnd5eAbilityRoll; // 11039
    check?: Dnd5eAbilityRoll; // 11046
    save?: Dnd5eAbilityRoll; // 11053
    /** derived */ mod: number; // 11308
    /** derived: spell/ability DC = 8 + mod + prof + bonus */ dc?: number; // 11359
    /** derived: true when merged from an original actor (wild shape) */ merged?: boolean;
  }

  interface Dnd5eAbilities {
    str?: Dnd5eAbility;
    dex?: Dnd5eAbility;
    con?: Dnd5eAbility;
    int?: Dnd5eAbility;
    wis?: Dnd5eAbility;
    cha?: Dnd5eAbility;
    [key: string]: Dnd5eAbility | undefined;
  }

  /** `skills.<key>` (CreatureTemplate, 83767; derived in prepareSkill, 83953). Keys: acr ani arc ath dec his ins itm inv med nat prc prf per rel slt ste sur. */
  interface Dnd5eSkill {
    ability: string; // RollConfigField ability field, 9429
    roll?: Dnd5eD20RollMods;
    bonuses?: { passive?: Dnd5eFormula }; // 83769
    /** Proficiency multiplier 0, 0.5, 1, 2. Source value; rewritten to prof.multiplier in prepareSkill. */
    value: number; // 83774
    /** derived: same number as `value` after prepare */ proficient?: number; // 83994
    /** derived */ prof?: Dnd5eProficiency; // 83978
    /** derived: proficiency multiplier as stored on the actor */ effectValue?: number; // 83987
    /** derived: bonuses without ability mod or proficiency */ bonus?: number; // 83992
    /** derived: ability modifier */ mod?: number; // 83993
    /** derived: check total */ total?: number; // 83995
    /** derived: passive score, e.g. passive Perception = skills.prc.passive */ passive?: number; // 84019
    /** derived */ merged?: boolean;
  }

  /** `tools.<key>` (CreatureTemplate, 83782; derived in prepareTools, 84033). */
  interface Dnd5eTool {
    ability: string;
    roll?: Dnd5eD20RollMods;
    value: number; // 83785
    /** derived */ prof?: Dnd5eProficiency;
    /** derived */ effectValue?: number;
    /** derived */ bonus?: number;
    /** derived */ mod?: number;
    /** derived */ total?: number; // 84052
  }

  /** `spells.spell1..spell9` and `spells.pact` (CreatureTemplate, 83792; slots prepared by the spellcasting models, 91772 / 91853). */
  interface Dnd5eSpellSlot {
    value: number; // 83793
    /** Manual max slots; null/absent means use the class progression. */
    override?: number | null; // 83796
    /** derived: max slots */ max?: number; // 91782, 91859
    /** derived: slot level (pact slots: the pact level) */ level?: number; // 91783, 91858
    /** derived */ label?: string; // 91857
    /** derived: spellcasting model key, "spell" or "pact" (or a custom key) */ type?: string; // 91860
  }

  interface Dnd5eSpellSlots {
    spell1?: Dnd5eSpellSlot;
    spell2?: Dnd5eSpellSlot;
    spell3?: Dnd5eSpellSlot;
    spell4?: Dnd5eSpellSlot;
    spell5?: Dnd5eSpellSlot;
    spell6?: Dnd5eSpellSlot;
    spell7?: Dnd5eSpellSlot;
    spell8?: Dnd5eSpellSlot;
    spell9?: Dnd5eSpellSlot;
    pact?: Dnd5eSpellSlot;
    [key: string]: Dnd5eSpellSlot | undefined;
  }

  /** AC (AttributesFields.armorClass, 9571). `value` is derived (prepareArmorClass, 9888). */
  interface Dnd5eArmorClass {
    /** Flat AC, used when no armor formula applies (natural armor on NPCs). */
    flat?: number; // 9590
    /** Fixed override; when finite it wins over every formula. */
    override?: number | null; // 9599
    /** Enabled base formulas (unarmored, armored, mage, draconic, natural, ...). */
    calcs?: Set<string>; // 9583
    formulas?: Array<{
      armored: boolean | null;
      formula: string;
      label: string;
      shielded: boolean | null;
    }>; // 9595
    /** derived: final AC */ value: number; // 9888
    /** derived: formula id that won (persisted: false; Vehicle persists it, initial "flat", 11890) */ calc?: string; // 9582
    /** derived */ formula?: string; // 9594
    /** derived */ label?: string; // 9796, 9870
    /** derived */ base?: number; // 9576
    /** derived */ armor?: number; // 9573
    /** derived */ shield?: number; // 9603
    /** derived */ bonus?: number; // 9579
    /** derived */ min?: number; // 9596
    /** derived */ cover?: number; // 9587
    /** derived: dex contribution after armor clamp */ dex?: number; // 9849
    /** derived: ability mods clamped by the equipped armor */ clamped?: Record<string, number>; // 9845
    equippedArmor?: Item; // 9825
    equippedShield?: Item; // 9839
  }

  /** HP (AttributesFields.hitPoints, 9614 + per-type extras). */
  interface Dnd5eHitPoints {
    /** null in source on NPCs/vehicles until set */ value: number | null; // 9622
    /** Characters: manual override of the calculated max (84127). NPC/vehicle: the stored max. */
    max: number | null; // 9617
    /** null once cleared (no `nullable: false`); dnd5e reads it as `parseInt(hp.temp) || 0` (43518) */ temp:
      | number
      | null; // 9618
    tempmax: number | null; // 9619
    /** Damage threshold (NPC, vehicle) */ dt?: number; // 9616
    /** Mishap threshold (vehicle only) */ mt?: number; // 11894
    /** HP percentage that counts as bloodied (character, NPC; persisted: false) */ bloodied?: number; // 84123, 85259
    /** NPC hit point formula, e.g. "10d8 + 20" */ formula?: Dnd5eFormula; // 85263
    /** Character HP bonuses */ bonuses?: { level?: Dnd5eFormula; overall?: Dnd5eFormula }; // 84131
    /** derived: max + tempmax */ effectiveMax?: number; // 10013
    /** derived: effectiveMax - value */ damage?: number; // 10015
    /** derived */ pct?: number; // 10016
  }

  /** attributes.init (RollConfigField, 9673; prepareInitiative, 10026). */
  interface Dnd5eInitiative {
    /** Ability key used for initiative; blank means CONFIG.DND5E.defaultAbilities.initiative */
    ability?: string; // 9429
    roll?: Dnd5eD20RollMods; // 9435
    /** derived: ability mod */ mod?: number; // 10034
    /** derived: proficiency applied to initiative */ prof?: Dnd5eProficiency; // 10042
    /** derived: initiative modifier total */ total?: number; // 10063
    /** derived: passive initiative score */ score?: number; // 10066
  }

  /** attributes.death (RollConfigField on character and npc, 84136 / 85265). */
  interface Dnd5eDeathSaves {
    ability?: string;
    roll?: Dnd5eD20RollMods;
    success: number; // 84138
    failure: number; // 84141
  }

  /** attributes.concentration (RollConfigField, 9704). */
  interface Dnd5eConcentration {
    ability?: string;
    roll?: Dnd5eD20RollMods;
    limit?: number; // 9706
    /** derived: concentration save bonus */ save?: number; // 9904
  }

  /** Character `attributes.hd` is a HitDice instance (83439, built in prepareBaseData 84235); NPC `hd` is a plain object (85254). */
  interface Dnd5eHitDice {
    /** derived: unspent hit dice */ value: number; // 83467, 85642
    /** derived: total hit dice */ max: number; // 83481, 85560
    /** derived */ pct?: number; // 83579, 85643
    /** NPC only (source): hit dice spent */ spent?: number; // 85255
    /** NPC only (derived): the die size as a NUMBER (8 for d8), from hp.formula (85561). Characters have no `denomination`. */
    denomination?: number;
    /** Character only (derived getters on HitDice) */
    readonly bySize?: Record<string, number>; // 83589
    readonly smallest?: string; // 83511
    readonly largest?: string; // 83545
    readonly smallestAvailable?: string; // 83521
    readonly largestAvailable?: string; // 83555
  }

  /** attributes.encumbrance (9635; the module does not read it). */
  interface Dnd5eEncumbrance {
    bonuses?: Record<string, Dnd5eFormula | undefined>;
    multipliers?: Record<string, Dnd5eFormula | undefined>;
    /** derived */ value?: number; // 9966
    /** derived */ max?: number; // 9972
    /** derived */ pct?: number;
    /** derived */ thresholds?: { encumbered: number; heavilyEncumbered: number; maximum: number };
    /** derived */ encumbered?: boolean;
  }

  /** TravelField (5646), used by group and vehicle `attributes.travel`. */
  interface Dnd5eTravel {
    /** Not on vehicles (11943 passes `pace: false`). */
    pace?: string; // 5649
    paces?: Record<string, number | string | undefined>; // 5653
    speeds?: Record<string, number | string | undefined>; // 5656
    time?: number; // 5659
    units?: string | null;
  }

  /** `attributes` (AttributesFields.common + creature + per-type extras). Union over character, npc, vehicle, group. */
  interface Dnd5eAttributes {
    ac?: Dnd5eArmorClass; // 9634
    /** Vehicle only: actions per turn */
    actions?: {
      max: number;
      spent: number;
      stations: boolean;
      thresholds?: Record<string, number | undefined>;
    }; // 11898
    /** Creatures: attunement slots; `value` is derived (persisted: false) */
    attunement?: { max: number; value: number }; // 9688
    /** Vehicle only */
    capacity?: { cargo?: { value?: number; units: string }; creature: string }; // 11925
    concentration?: Dnd5eConcentration; // 9704
    death?: Dnd5eDeathSaves; // 84136, 85265 (character, npc)
    encumbrance?: Dnd5eEncumbrance; // 9635
    /** Creatures: exhaustion level; derived from the exhaustion effect in prepareExhaustionLevel */
    exhaustion?: number; // 9701, 9993
    /** Character: HitDice instance. NPC: plain object. Absent on vehicles and groups. */
    hd?: Dnd5eHitDice; // 84235, 85254
    hp?: Dnd5eHitPoints; // 84121, 85257, 11892
    init?: Dnd5eInitiative; // 9673
    /** Character only */
    inspiration?: boolean; // 84146
    loyalty?: { value: number | null }; // 9710
    movement?: Dnd5eMovement; // 9676
    piety?: { value: number | null }; // 84147 (character)
    /** NPC and vehicle */
    price?: { value: number | null; denomination: string }; // 85275, 11934
    /** derived: proficiency bonus. Character: from level (84242). NPC: from CR, null when CR is null (85585). Vehicle: 0 (12113). */
    prof?: number | null;
    quality?: { value: number }; // 11940 (vehicle)
    senses?: Dnd5eSenses; // 9694
    /**
     * Spellcasting numbers. attack/dc/mod/abilityLabel are derived in prepareSpellcastingAbility (10186);
     * `level` is the NPC caster level (source, 85279).
     */
    spell?: { attack?: number; dc?: number; mod?: number; abilityLabel?: string; level?: number }; // 9695
    /** Ability key the creature casts with ("int", "wis", "cha", or "" for none) */
    spellcasting?: string; // 9700
    travel?: Dnd5eTravel; // 84801, 11943
  }

  /** `details` (DetailsField.common + creature + per-type extras). */
  interface Dnd5eDetails {
    biography?: { value?: string; public?: string }; // 11564
    alignment?: string; // 11579 (creatures)
    ideal?: string; // 11580
    bond?: string; // 11582
    flaw?: string; // 11583
    /** Character: derived sum of class levels (11581 persisted: false; 84238). NPC: class levels only; use `cr` for the stat block. */
    level?: number;
    /** Character only: 1 to 4, derived */ tier?: number; // 84296
    /**
     * Species. LocalDocumentField (11459): the species Item when it resolves, else the stored id
     * string (fallback: true), or null.
     */
    race?: Item | string | null; // 11584
    /** Character only: background Item, or the stored id string, or null */
    background?: Item | string | null; // 84160
    /** Character only: id of the original class item */ originalClass?: string; // 84163
    /** Character: XP. NPC: derived from CR (85576). Group: group XP. */
    xp?: {
      value?: number | null;
      /** derived */ max?: number;
      /** derived */ min?: number;
      /** derived */ pct?: number;
      /** derived */ boonsEarned?: number;
    }; // 84164, 84246
    appearance?: string; // 84169
    trait?: string; // 84170
    gender?: string; // 84171
    eyes?: string;
    height?: string;
    faith?: string;
    hair?: string;
    skin?: string;
    age?: string;
    weight?: string; // 84178
    /** Characters: derived from the species item (84277). NPC: stored. Vehicle: a plain string such as "water" (11953). */
    type?: Dnd5eCreatureType | string; // 85288, 84277, 11953
    /** NPC only. Challenge rating as a NUMBER (null = no CR). 6.0 has no `cr.value`. */
    cr?: number | null; // 85296
    /** NPC only */
    habitat?: { value?: Array<{ type: string; subtype?: string }>; custom?: string }; // 85289
    /** NPC only */
    treasure?: { value?: Set<string> }; // 85299
  }

  /** `traits` (TraitsField.common + creature + per-type extras). */
  interface Dnd5eTraits {
    /** Actor size key: "tiny", "sm", "med", "lg", "huge", "grg". A string, NOT `{ value }`. */
    size?: string; // 11701, vehicle 11965
    di?: Dnd5eDamageTrait; // 11702
    dr?: Dnd5eDamageTrait; // 11703
    dv?: Dnd5eDamageTrait; // 11704
    dm?: { amount?: Record<string, Dnd5eFormula | undefined>; bypasses?: Set<string> }; // 11705
    ci?: Dnd5eSimpleTrait; // 11717
    languages?: Dnd5eSimpleTrait & {
      communication?: Record<string, { units: string; value: number }>; // 11730
      /** derived (prepareLanguages, 11748) */
      labels?: { languages: string[]; ranged: string[] };
    }; // 11729
    weaponProf?: Dnd5eSimpleTrait & { mastery?: { value?: Set<string>; bonus?: Set<string> } }; // 84183 (character)
    armorProf?: Dnd5eSimpleTrait; // 84189 (character)
    /** NPC only */ important?: boolean; // 85332
    /** Vehicle only */
    weight?: { value?: number; units: string }; // 11966
    keel?: { value?: number; units: string }; // 11972
    beam?: { value?: number; units: string }; // 11978
    dimensions?: string; // 11984
  }

  /** `resources.primary|secondary|tertiary` on characters (makeResourceField, 84437). */
  interface Dnd5eCharacterResource {
    value: number | null; // 84439 (NumberField, nullable by default)
    max: number | null; // 84440
    sr: boolean; // 84441
    lr: boolean; // 84442
    label: string; // 84443
  }

  /** `resources.legact|legres` on NPCs (85304, 85312). Since 5.x the stored field is `spent`; `value` is derived. */
  interface Dnd5eLegendaryCounter {
    max: number; // 85305
    spent: number; // 85308
    /** derived: max - spent (85654). Writing `.value` is converted to `.spent` in _preUpdate (85686). */
    value?: number;
    /** derived: true (85579) */ lr?: boolean;
    /** derived, legact only: the stat-block intro text (85656) */ label?: string;
  }

  interface Dnd5eResources {
    primary?: Dnd5eCharacterResource; // 84192 (character)
    secondary?: Dnd5eCharacterResource; // 84193
    tertiary?: Dnd5eCharacterResource; // 84194
    legact?: Dnd5eLegendaryCounter; // 85304 (npc)
    legres?: Dnd5eLegendaryCounter; // 85312 (npc)
    lair?: { value: boolean; initiative: number | null; inside?: boolean }; // 85320 (npc)
  }

  /** Group member entry. Group: `{ actor }` (84810, the actor resolved from the stored id). Encounter: `{ uuid, quantity }` (84556). */
  interface Dnd5eGroupMember {
    actor?: Actor | null; // 84811
    uuid?: string; // 84557
    quantity?: { value?: number; formula?: Dnd5eFormula }; // 84558
  }

  // ---------------------------------------------------------------------------
  // actor.system
  // ---------------------------------------------------------------------------

  /**
   * Union of the dnd5e 6.0.5 actor system models: character (CharacterData, 84092), npc (NPCData,
   * 85225), vehicle (VehicleData, 11867), group (GroupData, 84796) and encounter (EncounterData,
   * 84552). Every top-level key is optional because the types differ; narrow on `actor.type`.
   */
  interface FoundryActorSystem {
    abilities?: Dnd5eAbilities; // 11025 (character, npc, vehicle)
    attributes?: Dnd5eAttributes; // 84118 (character), 85251 (npc), 11886 (vehicle), 84800 (group)
    /** Character only */
    bastion?: { name: string; description: string }; // 84153
    /** Creatures only */
    bonuses?: { spell?: { dc?: Dnd5eFormula } }; // 83722
    /** Vehicle only (passenger rows are not read by the module) */
    cargo?: { crew?: Array<Record<string, unknown>>; passengers?: Array<Record<string, unknown>> }; // 11986
    /** persisted: false: condition levels, e.g. exhaustion */
    conditions?: Record<string, number>; // 11064
    /** Vehicle only: actor UUIDs */
    crew?: { max: number | null; value: string[] }; // 11947
    currency?: Dnd5eCurrency; // 10965 (character, npc, vehicle, group, encounter)
    /** Group and encounter only */
    description?: { full: string; summary: string }; // 84465
    details?: Dnd5eDetails; // 84157 (character), 85285 (npc), 11951 (vehicle), 84805 (group)
    /** Vehicle only: actor UUIDs */
    draft?: { value: string[] }; // 11955
    /** Character only */
    favorites?: Array<{ type: string; id: string; sort: number }>; // 84196
    /** Group: `{ actor }` rows (84810). Encounter: `{ uuid, quantity }` rows (84556). */
    members?: Dnd5eGroupMember[];
    /** Vehicle only: actor UUIDs */
    passengers?: { max: number | null; value: string[] }; // 11958
    /** Group only */
    primaryVehicle?: Actor | null; // 84813
    resources?: Dnd5eResources; // 84191 (character), 85303 (npc)
    /** Creatures only */
    rolls?: {
      ability?: {
        check?: Dnd5eD20RollMods;
        save?: Dnd5eD20RollMods;
        skill?: Dnd5eD20RollMods;
        tool?: Dnd5eD20RollMods;
      };
      attack?: Dnd5eD20RollMods &
        Partial<Record<'msak' | 'mwak' | 'rsak' | 'rwak', Dnd5eD20RollMods>>;
      damage?: Partial<Record<'msak' | 'mwak' | 'rsak' | 'rwak', { bonus?: Dnd5eFormula }>>;
    }; // 83727
    /** derived (prepareEmbeddedData / ActorDataModel, 10914): scale values by class identifier */
    scale?: Record<string, Record<string, unknown>>;
    /** Creatures only. Keys: acr ani arc ath dec his ins itm inv med nat prc prf per rel slt ste sur. */
    skills?: Record<string, Dnd5eSkill | undefined>; // 83767
    /** NPC and vehicle only (character has no top-level `source`; the source lives on items) */
    source?: Dnd5eSource; // 85328, 11962
    /** Creatures only */
    spells?: Dnd5eSpellSlots; // 83792
    /** Creatures only */
    tools?: Record<string, Dnd5eTool | undefined>; // 83782
    traits?: Dnd5eTraits; // 84180 (character), 85329 (npc), 11963 (vehicle)

    // Model getters (not data): present only on the matching actor type.
    readonly isCharacter?: true; // 84212
    readonly isNPC?: true; // 85417
    readonly isVehicle?: true; // 12001
    readonly isGroup?: true; // 84478
    readonly isCreature?: true; // 83837
    /** Group only: the pace the party actually travels at (85001). */
    getTravelPace?(): {
      pace: { slowed: boolean; available: boolean; label?: string; value: string };
      paces: Record<string, number | string | undefined>;
    };
    /** NPC only: the legendary-action blurb (85736). */
    getLegendaryActionsDescription?(name?: string): string;
  }

  // ---------------------------------------------------------------------------
  // Item building blocks
  // ---------------------------------------------------------------------------

  /** ItemTypeField (30987): `item.system.type` on equipment, weapon, consumable, tool, loot, feat, container-less types. */
  interface Dnd5eItemType {
    value?: string; // 30990
    /** Missing on equipment, weapon and tool (they pass `subtype: false`). */
    subtype?: string; // 30993
    /** Missing on consumable, loot and feat (`baseItem: false`). */
    baseItem?: string; // 30996
    /** derived (e.g. 31282 equipment, 90931 weapon) */ label?: string;
  }

  /** UsesField (14280). `value` and `label` are derived in UsesField.prepareData (14307). */
  interface Dnd5eUses {
    /** Uses spent (source). Since dnd5e 4 this replaced `value`. */
    spent?: number; // 14283
    /** Formula string in source, number after prepare when non-empty. */
    max?: number | string; // 14284
    recovery?: Array<{
      /** "lr", "sr", "day", "dawn", "dusk", "recharge", "turnStart", ... or "@scale.<class>.<id>" */
      period: string;
      /** "recoverAll", "loseAll", "formula" */
      type: string;
      formula?: Dnd5eFormula;
    }>; // 14285
    /** derived: remaining uses, 0 when max is empty */ value?: number; // 14309
    /** derived: stat-block text such as "3/Day" */ label?: string; // 14332
    /** Consumables only: destroy the item when the last use is spent */
    autoDestroy?: boolean; // 88725
  }

  /** ActivationField (16425). On items only spells carry it; other item types use `activities[n].activation`. */
  interface Dnd5eActivation {
    type?: string; // 16428
    value?: number | null; // 16429
    condition?: string; // 16430
    /** Activity-level only */ override?: boolean; // 20011
  }

  /** DurationField (16505). */
  interface Dnd5eDuration {
    value?: number | string | null; // 16508
    units?: string; // 16509
    expiry?: string | null; // 16510
    special?: string; // 16511
    /** Activity-level only */ concentration?: boolean; // 20027
    /** Activity-level only */ override?: boolean; // 20028
  }

  /** RangeField (16607) on spells and activities; weapons use their own `{ value, long, reach, units }` (90530). */
  interface Dnd5eRange {
    value?: number | string | null; // 16610, weapon 90531
    units?: string; // 16611, weapon 90534
    special?: string; // 16612
    /** Weapons only */ long?: number | null; // 90532
    /** Weapons only */ reach?: number | null; // 90533
    /** Activity-level only */ override?: boolean; // 20033
  }

  /** TargetField (16681). */
  interface Dnd5eTarget {
    template?: {
      count?: number | string | null; // 16685
      contiguous?: boolean;
      stationary?: boolean;
      type?: string; // 16688
      size?: number | string | null; // 16689
      width?: number | string | null;
      height?: number | string | null;
      units?: string; // 16692
    };
    affects?: { count?: number | string | null; type?: string; choice?: boolean; special?: string }; // 16694
    /** Activity-level only */ override?: boolean; // 20036
    /** Activity-level only */ prompt?: boolean; // 20037
  }

  /** DamageData (19525): one damage part. 6.0 shape; v3 `parts` tuples are gone. `formula` is a getter. */
  interface Dnd5eDamagePart {
    number?: number | null; // 19534
    denomination?: number | null; // 19535
    bonus?: Dnd5eFormula; // 19536
    types?: Set<string>; // 19537
    custom?: { enabled: boolean; formula: Dnd5eFormula }; // 19538
    modifiers?: Set<string>; // 19542
    scaling?: { mode: string; number: number | null; formula: Dnd5eFormula }; // 19543
    readonly formula?: string; // 19559
  }

  /** An activity (BaseActivityData, 19986) plus the per-type blocks the module can meet. */
  interface Dnd5eActivity {
    _id: string; // 20003
    /** "attack", "save", "damage", "heal", "utility", "check", "cast", "enchant", "forward", "order", "summon", "teleport", "transform" */
    type: string; // 20004
    name?: string; // 20007
    img?: string; // 20008
    sort?: number; // 20009
    activation?: Dnd5eActivation; // 20010
    consumption?: {
      scaling?: { allowed: boolean; max?: Dnd5eFormula };
      spellSlot?: boolean;
      targets?: Array<Record<string, unknown>>;
    }; // 20014
    description?: { chatFlavor?: string; value?: string }; // 20022
    duration?: Dnd5eDuration; // 20026
    effects?: Array<Record<string, unknown>>; // 20030
    range?: Dnd5eRange; // 20032
    target?: Dnd5eTarget; // 20035
    uses?: Dnd5eUses; // 20039
    /** attack activity (20960) */
    attack?: {
      ability?: string;
      /** derived */ abilities?: Set<string>;
      bonus?: Dnd5eFormula;
      critical?: { threshold?: number | null };
      flat?: boolean;
      type?: { value?: string; classification?: string };
    };
    /** attack (20973), damage (23404), save (37866) activities */
    damage?: {
      critical?: { allow?: boolean; bonus?: Dnd5eFormula };
      includeBase?: boolean;
      onSave?: string;
      parts?: Dnd5eDamagePart[];
    };
    /** save activity (37873) */
    save?: {
      ability?: Set<string>;
      bonus?: Dnd5eFormula;
      dc?: { bonus?: Dnd5eFormula; calculation?: string; formula?: Dnd5eFormula };
      visible?: boolean;
    };
    /** check activity (23154) */
    check?: { ability?: string; associated?: Set<string>; bonus?: Dnd5eFormula; visible?: boolean };
    /** heal activity (36932) */
    healing?: Dnd5eDamagePart;
    /** utility activity (42092) */
    roll?: { formula?: Dnd5eFormula; name?: string; prompt?: boolean; visible?: boolean };
    // Methods of the activity classes (ActivityMixin); signatures are loose on purpose.
    use?(usage?: unknown, dialog?: unknown, message?: unknown): Promise<unknown>;
    rollAttack?(config?: unknown, dialog?: unknown, message?: unknown): Promise<unknown>;
    rollDamage?(config?: unknown, dialog?: unknown, message?: unknown): Promise<unknown>;
  }

  /** ActivityCollection (28431): a Collection with type lookups. */
  interface Dnd5eActivityCollection extends FoundryCollection<Dnd5eActivity> {
    getByType(type: string): Dnd5eActivity[]; // 28468
    getByTypes(...types: string[]): Generator<Dnd5eActivity>; // 28479
  }

  /** One advancement entry (BaseAdvancementData, 24521); `configuration` and `value` depend on `type`. */
  interface Dnd5eAdvancement {
    _id: string; // 24537
    type: string; // 24538
    configuration: Record<string, unknown>; // 24542
    value: Record<string, unknown>; // 24544
    level?: number; // 24545
    name?: string; // 24546
    hint?: string; // 24547
    img?: string; // 24548
    classRestriction?: string; // 24549
  }

  /** SpellcastingField (28073) on class and subclass items. */
  interface Dnd5eClassSpellcasting {
    /** Progression key: "none", "full", "half", "third", "pact", "artificer", ... */
    progression: string; // 28076
    /** Casting ability key */ ability: string; // 28082
    preparation?: {
      formula?: Dnd5eFormula; // 28084
      /** derived: spells currently counted as prepared (reset in prepareBaseData, 29092) */ value?: number;
      /** derived: maximum prepared spells (28102) */ max?: number;
    };
    /** derived: spellcasting model key such as "spell" or "pact" (28105) */ type?: string;
    /** derived: whether the model uses slots (28106) */ slots?: boolean;
    /** derived (28110) */ levels?: number;
    /** derived: spell attack bonus (28119) */ attack?: number;
    /** derived: spell save DC (28121) */ save?: number;
  }

  // ---------------------------------------------------------------------------
  // item.system
  // ---------------------------------------------------------------------------

  /**
   * Union of the dnd5e 6.0.5 item system models: weapon (90496), equipment (31032), consumable
   * (88699), tool (90249), loot (89718), container (29988), spell (33842), feat (89289), class
   * (28908), subclass (90100), race (89885), background (88576), facility (89012). There is no
   * "armor" item type (armor is `equipment`); "backpack" is the legacy container type.
   * Every top-level key is optional; narrow on `item.type`.
   */
  interface FoundryItemSystem {
    // ---- shared by most types -------------------------------------------------
    /** All types except background/class/subclass/race/loot/container: the activity collection (v4+). */
    activities?: Dnd5eActivityCollection; // 30404
    /** Class, subclass, race, background, feat. A Collection (not an array) since 5.0. */
    advancement?: FoundryCollection<Dnd5eAdvancement>; // 28202
    description?: { value?: string | null; chat?: string | null }; // 28295
    /** Slug used by class/subclass/spell links; the Item5e#identifier getter falls back to the slugged name. */
    identifier?: string; // 28299
    source?: Dnd5eSource; // 28300

    // ---- physical items (weapon, equipment, consumable, tool, loot, container) ------
    /** Id of the container item this one sits in, or null */
    container?: string | null; // 29503
    quantity?: number; // 29506 (container: fixed to 1, 30016)
    weight?: { value: number; units: string }; // 29509
    price?: { value: number; denomination: string; /** derived (29734) */ valueInGP?: number }; // 29517
    /** Set of rarity keys (6.0: replaces the v5 string `rarity`). */
    rarities?: Set<string>; // 29525
    /** derived getter: the first of `rarities` ("" when mundane). Not present in `_source` or in a compendium index. */
    readonly rarity?: string; // 29630
    identified?: boolean; // 29397
    unidentified?: { name?: string; description?: string }; // 29398
    /** Equippable types (weapon, equipment, consumable, tool, container): "", "required" or "optional" (v5 numbers are migrated) */
    attunement?: string; // 29240
    attuned?: boolean; // 29241
    equipped?: boolean; // 29242
    /** derived getter on equippable items: magic bonus applies (attuned if required, and has "mgc") */
    readonly magicAvailable?: boolean; // 29298
    /** derived getter on items with activities */
    readonly hasLimitedUses?: boolean; // 30469
    /** Magic bonus formula (weapon 90524, consumable 88721). Equipment keeps it in `armor.magicalBonus`. */
    magicalBonus?: Dnd5eFormula;
    /** Mountable types (equipment, weapon): vehicle crew/cover/hp/speed */
    cover?: number; // 30946 (feat 89305)
    crew?: { max?: number; value: string[] }; // 30947
    hp?: {
      conditions?: string;
      dt?: number;
      max?: number;
      value?: number;
      /** derived */ pct?: number;
    }; // 30951
    speed?: { conditions?: string; units: string; value?: number }; // 30957

    // ---- type, properties --------------------------------------------------------
    type?: Dnd5eItemType; // 30987 (equipment 31059, weapon 90536, consumable 88723, tool 90273, loot 89735, feat 89318)
    /** Weapon, equipment, consumable, tool, loot, container, class, spell (components), feat: Set of property keys ("mgc", "ver", "vocal", "concentration", "ritual", ...). */
    properties?: Set<string>; // 31057, 90526, 88722, 90272, 89734, 30015, 28937, 33870, 89316

    // ---- uses / damage ---------------------------------------------------------------
    uses?: Dnd5eUses; // 30408 (consumable adds autoDestroy, 88724)
    /**
     * Weapon: base + versatile + bonus (90519). Consumable: base + bonus + replace (88716).
     * Other types with activities carry only the derived `bonus` (30405).
     */
    damage?: {
      base?: Dnd5eDamagePart; // 90520, 88717
      versatile?: Dnd5eDamagePart; // 90522
      /** derived (persisted: false) */ bonus?: Dnd5eFormula; // 90521, 88718, 30406
      replace?: boolean; // 88719
    };

    // ---- weapon -------------------------------------------------------------------------
    ammunition?: { type?: string }; // 90513
    /** Weapon: `{ value }`. Equipment: `{ value, magicalBonus, dex }`. `value` is derived on equipment (adds magicalBonus, 31281). */
    armor?: { value?: number | null; magicalBonus?: Dnd5eFormula; dex?: number | null }; // 31049, 90516
    mastery?: string; // 90525
    /** Weapon, equipment: 0 or 1 (null = automatic). Tool: 0, 0.5, 1, 2 (90269). */
    proficient?: number | null; // 90527, 31054
    /** Equipment: minimum Strength */ strength?: number; // 31058

    // ---- spell -----------------------------------------------------------------------------
    /** Spell: casting ability override. Tool: default ability for checks (90266). */
    ability?: string; // 33858
    /** Spell only. Other types carry activation on their activities. */
    activation?: Dnd5eActivation; // 33859
    duration?: Dnd5eDuration; // 33860
    /** Spell level 0..9 (cantrip = 0). Facility: facility level (89044). Written as a plain number, not `{ value }`. */
    level?: number; // 33861
    materials?: { value: string; consumed: boolean; cost: number; supply: number }; // 33862
    /**
     * 2024-style spell preparation (6.0): the spellcasting model key: "spell", "pact", "innate",
     * "atwill", "ritual" (CONFIG.DND5E.spellcasting, 53444). Replaces v5 `preparation.mode`.
     */
    method?: string; // 33868
    /** 0 unprepared, 1 prepared, 2 always prepared (CONFIG.DND5E.spellPreparationStates, 53512). Replaces v5 `preparation.prepared`. */
    prepared?: number; // 33869
    /** Spell and weapon: range block (weapon variant: value/long/reach/units). */
    range?: Dnd5eRange; // 33871, 90530
    /** Spell school key: "abj", "con", "div", "enc", "evo", "ill", "nec", "trs" */
    school?: string; // 33872
    /** Spell: "class:<identifier>" or "subclass:<identifier>" of the source item (replaces v5 `sourceClass`, migrated at 34244). */
    sourceItem?: string; // 33873
    target?: Dnd5eTarget; // 33874

    // ---- feat ---------------------------------------------------------------------------------
    crewed?: boolean; // 89306
    enchant?: { max?: Dnd5eFormula; period?: string }; // 89307
    prerequisites?: { items?: Set<string>; level?: number | null; repeatable?: boolean }; // 89311
    requirements?: string | null; // 89317

    // ---- class / subclass / race / background ----------------------------------------------------
    /** Class: hit dice. `denomination` is "d8" (the v5 `hitDice` string); `spent` replaces `hitDiceUsed`. */
    hd?: {
      additional?: Dnd5eFormula;
      denomination?: string;
      spent?: number;
      /** derived */ max?: number;
      /** derived */ value?: number;
    }; // 28924, 29112
    /** Class: class level. */
    levels?: number; // 28932
    primaryAbility?: { value?: Set<string>; all?: boolean }; // 28933
    /** Class and subclass */
    spellcasting?: Dnd5eClassSpellcasting; // 28938, 90117
    /** Class: derived 1..4 */ tier?: number; // 29101
    /** Class: derived */ isOriginalClass?: boolean; // 29108
    /** Subclass: identifier of the parent class */
    classIdentifier?: string; // 90114
    /** Race: movement and senses use the same fields as actors; type has no swarm. */
    movement?: Dnd5eMovement; // 89899
    senses?: Dnd5eSenses; // 89903
    /** Class, background: starting equipment rows and wealth formula */
    startingEquipment?: Array<Record<string, unknown>>; // 28582
    wealth?: Dnd5eFormula; // 28583

    // ---- tool --------------------------------------------------------------------------------------
    bonus?: Dnd5eFormula; // 90267
    chatFlavor?: string; // 90268

    // ---- container ---------------------------------------------------------------------------------
    capacity?: {
      count?: number;
      volume?: { value?: number; units: string };
      weight?: { value?: number; units: string };
    }; // 30004

    // ---- facility (bastions; the module does not read these) -----------------------------------------
    building?: Record<string, unknown>; // 89025
    craft?: Record<string, unknown>; // 89029
    defenders?: Record<string, unknown>; // 89033
    hirelings?: Record<string, unknown>; // 89040
    progress?: Record<string, unknown>; // 89046
    trade?: Record<string, unknown>; // 89053
  }
}

export {};

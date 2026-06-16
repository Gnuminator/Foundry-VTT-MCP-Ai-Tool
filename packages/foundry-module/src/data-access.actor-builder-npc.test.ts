/**
 * Characterization tests for the NPC STAT-BLOCK half of the `actor-builder`
 * domain of `FoundryDataAccess` — building / populating an NPC combat stat
 * block. Driven through the Phase 9 Foundry-mock harness (in-memory).
 *
 * Methods pinned here (the "build the stat block" theme):
 *   - createNpcActor             — create the NPC + abilities/AC/HP/movement/
 *                                  senses/skills/traits
 *   - addAttackToActor           — weapon attack item (single attack activity)
 *   - addAttackWithSaveToActor   — weapon with attack + save activities
 *   - addAuraToActor             — automatic-damage aura/emanation feat
 *   - addPassiveFeatureToActor   — pure-description feat (no activities)
 *   - addSaveFeatureToActor      — save feat (single save activity + area)
 *   - addFeaturesFromCompendium  — import monster/class FEATURES from packs
 *
 * Ceded to the sibling net (`data-access.actor-builder-items.test.ts`):
 *   - useItem, useNpcActivity (item use/roll, not stat-block building)
 *   - setActorSpellcasting, addSpellsToActor (spellcasting)
 *   - (equipment/items/currency adders, if any)
 *
 * The assertions are the spec: they pin the current behaviour (success-path
 * return shapes, the embedded Item creates with their key fields, error
 * strings, and the dnd5e-version / source-rules / missing-source branches) so
 * the later from-scratch rewrite can be verified to parity.
 *
 * Local workarounds (never editing the shared harness):
 *   - The non-dnd5e system guard is exercised by overriding `game.system.id`
 *     after `world.install()`.
 *   - The 2024-source-rules branch in addAttackToActor is exercised purely by
 *     the `sourceRules: '2024'` input field (no global override needed).
 *   - `findActorByIdentifier` does a substring name match as a last resort, so
 *     actor names per test are distinct to keep resolution deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeActor, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A full, valid createNpcActor payload; override only the fields a test cares about. */
function npcData(overrides: Record<string, any> = {}): any {
  return {
    name: 'Goblin Sentry',
    creatureType: 'humanoid',
    creatureSubtype: 'goblinoid',
    size: 'small',
    alignment: 'Neutral Evil',
    cr: '1/4',
    hpAverage: 7,
    hpFormula: '2d6',
    acMode: 'default',
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    savingThrows: [],
    walkSpeed: 30,
    flySpeed: 0,
    swimSpeed: 0,
    climbSpeed: 0,
    burrowSpeed: 0,
    hover: false,
    darkvision: 60,
    blindsight: 0,
    tremorsense: 0,
    truesight: 0,
    specialSenses: '',
    skills: [],
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    languages: ['common', 'goblin'],
    languagesCustom: '',
    biography: 'A small wary goblin.',
    sourceBook: 'MM',
    sourcePage: '166',
    sourceRules: '2014',
    ...overrides,
  };
}

/** Register an existing actor the *add* methods can resolve by name, and return it. */
function addTargetActor(name: string, items: any[] = []): any {
  return world.addActor({ name, type: 'npc', system: {}, items });
}

/** Add a base + (optional) extra damage parts. */
function dmg(number: number, denomination: number, type: string): any {
  return { number, denomination, type };
}

// ===========================================================================
// createNpcActor
// ===========================================================================

describe('FoundryDataAccess — createNpcActor', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.createNpcActor(npcData())).rejects.toThrow(
      'createNpcActor requires D&D 5e. Current system: "pf2e".'
    );
  });

  it('throws when an NPC of the same name already exists', async () => {
    world.addActor({ name: 'Dup NPC', type: 'npc' });
    await expect(da.createNpcActor(npcData({ name: 'Dup NPC' }))).rejects.toThrow(
      /^NPC "Dup NPC" already exists \(id: /
    );
  });

  it('does NOT block when a character (non-npc) shares the name', async () => {
    world.addActor({ name: 'Hero Twin', type: 'character' });
    const result = await da.createNpcActor(npcData({ name: 'Hero Twin' }));
    expect(result.success).toBe(true);
    expect(result.actor.name).toBe('Hero Twin');
  });

  it('creates the actor and returns the structured result with a formatted CR', async () => {
    const result = await da.createNpcActor(npcData({ name: 'Result NPC', cr: '1/4' }));

    expect(result.success).toBe(true);
    expect(result.actor.name).toBe('Result NPC');
    expect(typeof result.actor.id).toBe('string');
    // CR 1/4 → 0.25 → formatted back to "1/4"
    expect(result.actor.cr).toBe('1/4');
    // a folder id is created via getOrCreateFolder (Foundry MCP Creatures)
    expect(result.actor.folder).not.toBeNull();
    expect(result.warnings).toEqual([]);

    // the actor is now resolvable in the world as an npc
    const created = world.actors.getName('Result NPC');
    expect(created).toBeTruthy();
    expect(created!.type).toBe('npc');
  });

  it('writes the full stat block onto system (abilities/AC/HP/movement/senses/traits/skills)', async () => {
    await da.createNpcActor(
      npcData({
        name: 'Stat Block NPC',
        size: 'large',
        cr: 5,
        hpAverage: 45,
        hpFormula: '6d10+12',
        acMode: 'flat',
        acValue: 17,
        abilities: { str: 18, dex: 12, con: 16, int: 6, wis: 11, cha: 9 },
        savingThrows: ['str', 'con'],
        walkSpeed: 40,
        flySpeed: 60,
        hover: true,
        darkvision: 120,
        truesight: 30,
        specialSenses: 'keen smell',
        skills: [
          { skill: 'Perception', proficiency: 'proficient' },
          { skill: 'Stealth', proficiency: 'expert' },
        ],
        damageImmunities: ['fire'],
        damageResistances: ['cold'],
        conditionImmunities: ['frightened'],
        languages: ['draconic'],
        languagesCustom: 'understands Common',
      })
    );

    const sys = world.actors.getName('Stat Block NPC')!.system;

    // abilities + saving-throw proficiency flags
    expect(sys.abilities.str).toEqual({ value: 18, proficient: 1 });
    expect(sys.abilities.con).toEqual({ value: 16, proficient: 1 });
    expect(sys.abilities.dex).toEqual({ value: 12, proficient: 0 });

    // AC: flat mode keeps calc:'flat' + flat value
    expect(sys.attributes.ac).toEqual({ calc: 'flat', flat: 17 });

    // HP
    expect(sys.attributes.hp).toEqual({
      value: 45,
      max: 45,
      temp: 0,
      tempmax: 0,
      formula: '6d10+12',
    });

    // movement
    expect(sys.attributes.movement).toEqual({
      walk: 40,
      fly: 60,
      swim: 0,
      climb: 0,
      burrow: 0,
      units: 'ft',
      hover: true,
      special: '',
    });

    // senses
    expect(sys.attributes.senses).toEqual({
      darkvision: 120,
      blindsight: 0,
      tremorsense: 0,
      truesight: 30,
      units: 'ft',
      special: 'keen smell',
    });

    // details: CR normalized to a float, creature type/subtype, source block
    expect(sys.details.cr).toBe(5);
    expect(sys.details.type).toEqual({ value: 'humanoid', subtype: 'goblinoid' });
    expect(sys.details.source).toEqual({
      revision: 1,
      rules: '2014',
      book: 'MM',
      page: '166',
      custom: '',
      license: '',
    });

    // traits: size mapped via NPC_SIZE_MAP (large → 'lg')
    expect(sys.traits.size).toBe('lg');
    expect(sys.traits.di).toEqual({ value: ['fire'], custom: '', bypasses: [] });
    expect(sys.traits.dr).toEqual({ value: ['cold'], custom: '', bypasses: [] });
    expect(sys.traits.ci).toEqual({ value: ['frightened'], custom: '' });
    expect(sys.traits.languages).toEqual({
      value: ['draconic'],
      custom: 'understands Common',
      communication: {},
    });

    // skills: proficient → 1, expert → 2, keyed by NPC_SKILL_MAP abbreviations
    expect(sys.skills).toEqual({ prc: { value: 1 }, ste: { value: 2 } });
  });

  it('default AC mode omits the flat value (calc: default only)', async () => {
    await da.createNpcActor(npcData({ name: 'Default AC NPC', acMode: 'default', acValue: 99 }));
    const sys = world.actors.getName('Default AC NPC')!.system;
    expect(sys.attributes.ac).toEqual({ calc: 'default' });
  });

  it('maps an unknown size to medium (med) default', async () => {
    await da.createNpcActor(npcData({ name: 'Weird Size NPC', size: 'colossal' }));
    const sys = world.actors.getName('Weird Size NPC')!.system;
    expect(sys.traits.size).toBe('med');
  });

  it('collects soft-validation warnings for unknown damage types and conditions (does NOT block)', async () => {
    const result = await da.createNpcActor(
      npcData({
        name: 'Warned NPC',
        damageImmunities: ['fire', 'sonic'], // 'sonic' is not canonical
        conditionImmunities: ['frightened', 'cursed'], // 'cursed' is not canonical
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      'Unknown damage type "sonic" in damageImmunities — verify it matches dnd5e system values',
      'Unknown condition "cursed" in conditionImmunities — verify it matches dnd5e system values',
    ]);
  });

  it('formats integer CR back to a whole-number string', async () => {
    const result = await da.createNpcActor(npcData({ name: 'CR Ten NPC', cr: '10' }));
    expect(result.actor.cr).toBe('10');
    expect(world.actors.getName('CR Ten NPC')!.system.details.cr).toBe(10);
  });
});

// ===========================================================================
// addAttackToActor
// ===========================================================================

describe('FoundryDataAccess — addAttackToActor', () => {
  function attackData(overrides: Record<string, any> = {}): any {
    return {
      actorIdentifier: 'Atk Target',
      featureName: 'Longsword',
      description: 'A sharp blade.',
      attackType: 'melee',
      reachFt: 5,
      attackBonus: 5,
      weaponClass: 'martialM',
      properties: ['ver'],
      damageParts: [dmg(1, 8, 'slashing')],
      activationType: 'action',
      sourceRules: '2014',
      sourceBook: 'PHB',
      sourcePage: '149',
      equipped: true,
      ...overrides,
    };
  }

  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.addAttackToActor(attackData())).rejects.toThrow(
      'addAttackToActor requires the dnd5e game system'
    );
  });

  it('throws when the actor is not found', async () => {
    await expect(
      da.addAttackToActor(attackData({ actorIdentifier: 'No Such Actor' }))
    ).rejects.toThrow('Actor not found: "No Such Actor"');
  });

  it('throws when an item of the same name already exists (case-insensitive)', async () => {
    addTargetActor('Atk Target', [makeActor({ name: 'longsword' })]);
    await expect(da.addAttackToActor(attackData({ featureName: 'Longsword' }))).rejects.toThrow(
      'An item named "Longsword" already exists on actor "Atk Target". Remove or rename it first.'
    );
  });

  it('creates a weapon item and returns the success shape with no warnings (2014 melee)', async () => {
    const actor = addTargetActor('Atk Target');
    const result = await da.addAttackToActor(attackData());

    expect(result.success).toBe(true);
    expect(result.actor).toEqual({ id: actor.id, name: 'Atk Target' });
    expect(result.item.name).toBe('Longsword');
    expect(result.item.type).toBe('weapon');
    expect(typeof result.item.id).toBe('string');
    expect(result.warnings).toEqual([]);

    // the weapon was embedded onto the actor
    const created = actor.items.getName('Longsword');
    expect(created.type).toBe('weapon');
    const sys = created.system;
    // melee range from reachFt
    expect(sys.range).toEqual({ value: 5, long: null, units: 'ft' });
    // 2014: classification 'weapon', no mastery field, no activity.attack.ability
    expect(sys.mastery).toBeUndefined();
    expect(sys.type).toEqual({ value: 'martialM', baseItem: '' });
    expect(sys.equipped).toBe(true);
    expect(sys.proficient).toBe(1);
    // base damage is damageParts[0]
    expect(sys.damage.base).toMatchObject({ types: ['slashing'], number: 1, denomination: 8 });

    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.type).toBe('attack');
    expect(activity.attack.type).toEqual({ value: 'melee', classification: 'weapon' });
    // 2014: the base activity literal carries ability: '' and the 2024-only
    // abilityField spread is empty, so ability stays the literal empty string.
    expect(activity.attack.ability).toBe('');
    // attackBonus > 0 → string bonus
    expect(activity.attack.bonus).toBe('5');
    expect(activity.damage.includeBase).toBe(true);
    // only damageParts[1+] go in the activity (none here)
    expect(activity.damage.parts).toEqual([]);
  });

  it('ranged attack uses rangeFt/longRangeFt for the system range object', async () => {
    addTargetActor('Atk Target');
    const result = await da.addAttackToActor(
      attackData({
        featureName: 'Longbow',
        attackType: 'ranged',
        rangeFt: 150,
        longRangeFt: 600,
        properties: [],
        damageParts: [dmg(1, 8, 'piercing')],
      })
    );
    const sys = world.actors.getName('Atk Target')!.items.getName('Longbow').system;
    expect(sys.range).toEqual({ value: 150, long: 600, units: 'ft' });
    expect(result.warnings).toEqual([]);
  });

  it('2024 source rules adds the mastery field and an activity.attack.ability', async () => {
    addTargetActor('Atk Target');
    await da.addAttackToActor(
      attackData({ featureName: 'Maul', sourceRules: '2024', effectiveAbility: 'str' })
    );
    const sys = world.actors.getName('Atk Target')!.items.getName('Maul').system;
    expect(sys.mastery).toBe('');
    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.attack.type.classification).toBe('');
    expect(activity.attack.ability).toBe('str');
  });

  it('extra damage parts beyond the first go into the activity damage.parts', async () => {
    addTargetActor('Atk Target');
    await da.addAttackToActor(
      attackData({
        featureName: 'Flame Tongue',
        damageParts: [dmg(1, 8, 'slashing'), dmg(2, 6, 'fire')],
      })
    );
    const sys = world.actors.getName('Atk Target')!.items.getName('Flame Tongue').system;
    expect(sys.damage.base).toMatchObject({ types: ['slashing'], number: 1, denomination: 8 });
    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.damage.parts).toEqual([
      {
        types: ['fire'],
        number: 2,
        denomination: 6,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      },
    ]);
  });

  it('collects warnings for unknown damage types and weapon properties (does NOT block)', async () => {
    addTargetActor('Atk Target');
    const result = await da.addAttackToActor(
      attackData({
        featureName: 'Odd Weapon',
        damageParts: [dmg(1, 6, 'sonic')], // unknown damage type
        properties: ['wibble'], // unknown property
      })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      'Unknown damage type "sonic" — verify it matches dnd5e system values',
      'Unknown weapon property "wibble" — verify it matches dnd5e system values',
    ]);
  });

  it('attackBonus of 0 produces an empty bonus string', async () => {
    addTargetActor('Atk Target');
    await da.addAttackToActor(attackData({ featureName: 'Zero Bonus', attackBonus: 0 }));
    const sys = world.actors.getName('Atk Target')!.items.getName('Zero Bonus').system;
    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.attack.bonus).toBe('');
  });
});

// ===========================================================================
// addAttackWithSaveToActor
// ===========================================================================

describe('FoundryDataAccess — addAttackWithSaveToActor', () => {
  function awsData(overrides: Record<string, any> = {}): any {
    return {
      actorIdentifier: 'AWS Target',
      featureName: 'Frost Brand',
      description: 'A chilling weapon.',
      attackType: 'melee',
      reachFt: 5,
      attackBonus: 7,
      weaponClass: 'martialM',
      properties: ['mgc'],
      damageParts: [dmg(1, 8, 'slashing')],
      saveDamageParts: [dmg(2, 6, 'cold')],
      saveAbility: 'con',
      saveDC: 15,
      saveOnSave: 'half',
      activationType: 'action',
      sourceRules: '2014',
      ...overrides,
    };
  }

  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.addAttackWithSaveToActor(awsData())).rejects.toThrow(
      'addAttackWithSaveToActor requires the dnd5e game system'
    );
  });

  it('throws when the actor is not found', async () => {
    await expect(
      da.addAttackWithSaveToActor(awsData({ actorIdentifier: 'Ghost' }))
    ).rejects.toThrow('Actor not found: "Ghost"');
  });

  it('throws on a duplicate item name (case-insensitive)', async () => {
    addTargetActor('AWS Target', [makeActor({ name: 'frost brand' })]);
    await expect(da.addAttackWithSaveToActor(awsData())).rejects.toThrow(
      'An item named "Frost Brand" already exists on actor "AWS Target". Remove or rename it first.'
    );
  });

  it('creates a weapon with TWO activities (attack sort 0, save sort 1) and returns the success shape', async () => {
    const actor = addTargetActor('AWS Target');
    const result = await da.addAttackWithSaveToActor(awsData());

    expect(result.success).toBe(true);
    expect(result.actor).toEqual({ id: actor.id, name: 'AWS Target' });
    expect(result.item).toMatchObject({ name: 'Frost Brand', type: 'weapon' });
    expect(result.warnings).toEqual([]);

    const sys = actor.items.getName('Frost Brand').system;
    const activities = Object.values(sys.activities);
    expect(activities).toHaveLength(2);

    const attack = activities.find(a => a.type === 'attack');
    const save = activities.find(a => a.type === 'save');
    expect(attack.sort).toBe(0);
    expect(save.sort).toBe(1);

    // attack: base damage in system.damage.base, activity parts = damageParts[1+] (empty here)
    expect(sys.damage.base).toMatchObject({ types: ['slashing'], number: 1, denomination: 8 });
    expect(attack.damage.parts).toEqual([]);
    expect(attack.attack.bonus).toBe('7');
    expect(attack.attack.type).toEqual({ value: 'melee', classification: 'weapon' });

    // save: ALL saveDamageParts (independent of base), onSave honoured, save block built
    expect(save.damage.onSave).toBe('half');
    expect(save.damage.parts).toEqual([
      {
        types: ['cold'],
        number: 2,
        denomination: 6,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      },
    ]);
    expect(save.save).toEqual({ ability: ['con'], dc: { calculation: '', formula: '15' } });
    expect(save.target.affects).toEqual({
      count: '1',
      type: 'creature',
      choice: false,
      special: '',
    });
  });

  it('deduplicates the same unknown damage type appearing in both groups', async () => {
    addTargetActor('AWS Target');
    const result = await da.addAttackWithSaveToActor(
      awsData({
        featureName: 'Weird Save Weapon',
        damageParts: [dmg(1, 8, 'sonic')],
        saveDamageParts: [dmg(2, 6, 'sonic')],
      })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      'Unknown damage type "sonic" — verify it matches dnd5e system values',
    ]);
  });

  it('saveOnSave defaults to none when omitted', async () => {
    addTargetActor('AWS Target');
    await da.addAttackWithSaveToActor(awsData({ featureName: 'No OnSave', saveOnSave: undefined }));
    const sys = world.actors.getName('AWS Target')!.items.getName('No OnSave').system;
    const save = Object.values(sys.activities).find(a => a.type === 'save');
    expect(save.damage.onSave).toBe('none');
  });

  it('2024 source rules adds mastery + activity ability on the attack activity', async () => {
    addTargetActor('AWS Target');
    await da.addAttackWithSaveToActor(
      awsData({ featureName: 'Modern Brand', sourceRules: '2024', effectiveAbility: 'dex' })
    );
    const sys = world.actors.getName('AWS Target')!.items.getName('Modern Brand').system;
    expect(sys.mastery).toBe('');
    const attack = Object.values(sys.activities).find(a => a.type === 'attack');
    expect(attack.attack.ability).toBe('dex');
    expect(attack.attack.type.classification).toBe('');
  });
});

// ===========================================================================
// addAuraToActor
// ===========================================================================

describe('FoundryDataAccess — addAuraToActor', () => {
  function auraData(overrides: Record<string, any> = {}): any {
    return {
      actorIdentifier: 'Aura Target',
      featureName: 'Frigid Aura',
      description: 'Cold radiates outward.',
      activationType: 'action',
      damageParts: [dmg(2, 6, 'cold')],
      areaType: 'emanation',
      areaSize: 10,
      areaUnits: 'ft',
      affectsType: 'creature',
      sourceRules: '2014',
      ...overrides,
    };
  }

  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.addAuraToActor(auraData())).rejects.toThrow(
      'addAuraToActor requires the dnd5e game system'
    );
  });

  it('throws when the actor is not found', async () => {
    await expect(da.addAuraToActor(auraData({ actorIdentifier: 'Nobody' }))).rejects.toThrow(
      'Actor not found: "Nobody"'
    );
  });

  it('throws on a duplicate item name (case-insensitive)', async () => {
    addTargetActor('Aura Target', [makeActor({ name: 'frigid aura' })]);
    await expect(da.addAuraToActor(auraData())).rejects.toThrow(
      'An item named "Frigid Aura" already exists on actor "Aura Target". Remove or rename it first.'
    );
  });

  it('creates a damage-type feat activity, mapping emanation → radius, and returns success', async () => {
    const actor = addTargetActor('Aura Target');
    const result = await da.addAuraToActor(auraData());

    expect(result.success).toBe(true);
    expect(result.actor).toEqual({ id: actor.id, name: 'Aura Target' });
    expect(result.item).toMatchObject({ name: 'Frigid Aura', type: 'feat' });
    expect(result.warnings).toEqual([]);

    const created = actor.items.getName('Frigid Aura');
    expect(created.type).toBe('feat');
    expect(created.img).toBe('systems/dnd5e/icons/svg/items/feature.svg');

    const sys = created.system;
    // identifier slugified from the name
    expect(sys.identifier).toBe('frigid-aura');
    expect(sys.type).toEqual({ value: 'monster', subtype: '' });

    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.type).toBe('damage');
    // emanation → radius, size stringified
    expect(activity.target.template.type).toBe('radius');
    expect(activity.target.template.size).toBe('10');
    expect(activity.target.template.units).toBe('ft');
    expect(activity.target.affects.type).toBe('creature');
    expect(activity.damage.critical).toEqual({ allow: false });
    expect(activity.damage.parts).toEqual([
      {
        types: ['cold'],
        number: 2,
        denomination: 6,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      },
    ]);
    // damage activity has no save / no attack block
    expect(activity.save).toBeUndefined();
    expect(activity.attack).toBeUndefined();
  });

  it('keeps a non-emanation areaType verbatim (e.g. sphere)', async () => {
    addTargetActor('Aura Target');
    await da.addAuraToActor(auraData({ featureName: 'Sphere Aura', areaType: 'sphere' }));
    const sys = world.actors.getName('Aura Target')!.items.getName('Sphere Aura').system;
    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.target.template.type).toBe('sphere');
  });

  it('collects a warning for an unknown damage type (does NOT block)', async () => {
    addTargetActor('Aura Target');
    const result = await da.addAuraToActor(
      auraData({ featureName: 'Odd Aura', damageParts: [dmg(1, 6, 'sonic')] })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      'Unknown damage type "sonic" — verify it matches dnd5e system values',
    ]);
  });

  it('defaults activationType/areaUnits/affectsType/sourceRules when omitted', async () => {
    addTargetActor('Aura Target');
    await da.addAuraToActor({
      actorIdentifier: 'Aura Target',
      featureName: 'Default Aura',
      damageParts: [dmg(1, 6, 'fire')],
      areaType: 'emanation',
      areaSize: 5,
    });
    const sys = world.actors.getName('Aura Target')!.items.getName('Default Aura').system;
    expect(sys.source.rules).toBe('2014');
    const activity = Object.values(sys.activities)[0] as any;
    expect(activity.activation.type).toBe('action');
    expect(activity.target.template.units).toBe('ft');
    expect(activity.target.affects.type).toBe('creature');
  });
});

// ===========================================================================
// addPassiveFeatureToActor
// ===========================================================================

describe('FoundryDataAccess — addPassiveFeatureToActor', () => {
  function passiveData(overrides: Record<string, any> = {}): any {
    return {
      actorIdentifier: 'Passive Target',
      featureName: 'Keen Senses',
      description: 'Advantage on Perception.',
      sourceRules: '2014',
      sourceBook: 'MM',
      sourcePage: '10',
      ...overrides,
    };
  }

  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.addPassiveFeatureToActor(passiveData())).rejects.toThrow(
      'addPassiveFeatureToActor requires the dnd5e game system'
    );
  });

  it('throws when the actor is not found', async () => {
    await expect(
      da.addPassiveFeatureToActor(passiveData({ actorIdentifier: 'Nope' }))
    ).rejects.toThrow('Actor not found: "Nope"');
  });

  it('throws on a duplicate item name (case-insensitive)', async () => {
    addTargetActor('Passive Target', [makeActor({ name: 'keen senses' })]);
    await expect(da.addPassiveFeatureToActor(passiveData())).rejects.toThrow(
      'An item named "Keen Senses" already exists on actor "Passive Target". Remove or rename it first.'
    );
  });

  it('creates a feat with NO activities and returns the success shape (no warnings field)', async () => {
    const actor = addTargetActor('Passive Target');
    const result = await da.addPassiveFeatureToActor(passiveData());

    expect(result).toEqual({
      success: true,
      actor: { id: actor.id, name: 'Passive Target' },
      item: {
        id: actor.items.getName('Keen Senses').id,
        name: 'Keen Senses',
        type: 'feat',
      },
    });
    expect(result).not.toHaveProperty('warnings');

    const created = actor.items.getName('Keen Senses');
    expect(created.type).toBe('feat');
    expect(created.img).toBe('systems/dnd5e/icons/svg/items/feature.svg');
    expect(created.system.activities).toEqual({});
    expect(created.system.identifier).toBe('keen-senses');
    expect(created.system.description).toEqual({ value: 'Advantage on Perception.', chat: '' });
    expect(created.system.source).toEqual({
      revision: 1,
      rules: '2014',
      custom: '',
      book: 'MM',
      page: '10',
      license: '',
    });
  });

  it('defaults description/sourceRules/book/page when omitted', async () => {
    addTargetActor('Passive Target');
    await da.addPassiveFeatureToActor({
      actorIdentifier: 'Passive Target',
      featureName: 'Bare Feature',
    });
    const sys = world.actors.getName('Passive Target')!.items.getName('Bare Feature').system;
    expect(sys.description).toEqual({ value: '', chat: '' });
    expect(sys.source).toEqual({
      revision: 1,
      rules: '2014',
      custom: '',
      book: '',
      page: '',
      license: '',
    });
  });
});

// ===========================================================================
// addSaveFeatureToActor
// ===========================================================================

describe('FoundryDataAccess — addSaveFeatureToActor', () => {
  function saveData(overrides: Record<string, any> = {}): any {
    return {
      actorIdentifier: 'Save Target',
      featureName: 'Breath Weapon',
      description: 'Exhales a cone of fire.',
      activationType: 'action',
      saveAbility: 'dex',
      saveDC: 16,
      damageParts: [dmg(6, 6, 'fire')],
      halfOnSave: true,
      areaType: 'cone',
      areaSize: 30,
      areaUnits: 'ft',
      affectsType: 'creature',
      ...overrides,
    };
  }

  it('throws when the system is not dnd5e (actor must exist first — guard is after lookup)', async () => {
    // Unlike the other add* methods, this one resolves the actor BEFORE the
    // system guard, so the actor must be present to reach the guard branch.
    addTargetActor('Save Target');
    (globalThis as any).game.system.id = 'pf2e';
    await expect(da.addSaveFeatureToActor(saveData())).rejects.toThrow(
      'addSaveFeatureToActor requires D&D 5e. Current system: "pf2e".'
    );
  });

  it('throws when the actor is not found (lookup happens before the system guard)', async () => {
    await expect(
      da.addSaveFeatureToActor(saveData({ actorIdentifier: 'Missing Actor' }))
    ).rejects.toThrow('Actor not found: "Missing Actor"');
  });

  it('throws when a feature of the same name already exists (exact name, any type)', async () => {
    const target = addTargetActor('Save Target', [
      makeActor({ id: 'feat-x', name: 'Breath Weapon' }),
    ]);
    await expect(da.addSaveFeatureToActor(saveData())).rejects.toThrow(
      `Feature "Breath Weapon" already exists on actor "${target.name}" (id: feat-x). ` +
        'Use a different name or remove the existing feature first.'
    );
  });

  it('creates a save feat with a single save activity (area + damage + save block) and returns success', async () => {
    const actor = addTargetActor('Save Target');
    const result = await da.addSaveFeatureToActor(saveData());

    expect(result).toEqual({
      success: true,
      item: { id: actor.items.getName('Breath Weapon').id, name: 'Breath Weapon' },
      actor: { id: actor.id, name: 'Save Target' },
    });

    const created = actor.items.getName('Breath Weapon');
    expect(created.type).toBe('feat');
    expect(created.system.identifier).toBe('breath-weapon');
    expect(created.system.source).toEqual({ revision: 1, rules: '2024' });

    const activity = Object.values(created.system.activities)[0] as any;
    expect(activity.type).toBe('save');
    // damage: half on save honoured
    expect(activity.damage.onSave).toBe('half');
    expect(activity.damage.parts).toEqual([
      {
        custom: { enabled: false, formula: '' },
        number: 6,
        denomination: 6,
        bonus: '',
        types: ['fire'],
        scaling: { mode: '', number: 1 },
      },
    ]);
    // save block
    expect(activity.save).toEqual({
      ability: ['dex'],
      dc: { calculation: '', formula: '16' },
    });
    // area template: cone kept verbatim, size stringified, units honoured
    expect(activity.target.template.type).toBe('cone');
    expect(activity.target.template.size).toBe('30');
    expect(activity.target.template.units).toBe('ft');
    expect(activity.target.affects.type).toBe('creature');
  });

  it('halfOnSave false → onSave "none"', async () => {
    addTargetActor('Save Target');
    await da.addSaveFeatureToActor(saveData({ featureName: 'No Half', halfOnSave: false }));
    const created = world.actors.getName('Save Target')!.items.getName('No Half');
    const activity = Object.values(created.system.activities)[0] as any;
    expect(activity.damage.onSave).toBe('none');
  });

  it('maps an emanation areaType to radius for the template', async () => {
    addTargetActor('Save Target');
    await da.addSaveFeatureToActor(
      saveData({ featureName: 'Radial Burst', areaType: 'emanation', areaSize: 15 })
    );
    const created = world.actors.getName('Save Target')!.items.getName('Radial Burst');
    const activity = Object.values(created.system.activities)[0] as any;
    expect(activity.target.template.type).toBe('radius');
    expect(activity.target.template.size).toBe('15');
  });
});

// ===========================================================================
// addFeaturesFromCompendium — importing monster/class FEATURES into a stat block
// ===========================================================================

describe('FoundryDataAccess — addFeaturesFromCompendium', () => {
  it('throws when the system is not dnd5e', async () => {
    (globalThis as any).game.system.id = 'pf2e';
    await expect(
      da.addFeaturesFromCompendium({ actorIdentifier: 'X', featureNames: ['Multiattack'] })
    ).rejects.toThrow('addFeaturesFromCompendium requires the dnd5e game system');
  });

  it('throws when the actor is not found', async () => {
    await expect(
      da.addFeaturesFromCompendium({ actorIdentifier: 'Ghost', featureNames: ['Multiattack'] })
    ).rejects.toThrow('Actor not found: "Ghost"');
  });

  it('throws when no valid packs are available (default packs missing)', async () => {
    addTargetActor('Feat Target');
    // default packs dnd5e.monsterfeatures / dnd5e.classfeatures are not registered
    await expect(
      da.addFeaturesFromCompendium({
        actorIdentifier: 'Feat Target',
        featureNames: ['Multiattack'],
      })
    ).rejects.toThrow('No valid compendium packs available');
  });

  it('imports a found feature (toObject → strip _id → embed) and returns the added entry', async () => {
    const actor = addTargetActor('Feat Target');
    world.addPack({
      id: 'dnd5e.monsterfeatures',
      label: 'Monster Features',
      type: 'Item',
      documents: [makeActor({ id: 'mf1', name: 'Multiattack', type: 'feat' })],
    });

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Feat Target',
      featureNames: ['Multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures'],
    });

    expect(result.actor).toEqual({ id: actor.id, name: 'Feat Target' });
    expect(result.notFound).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      name: 'Multiattack',
      packId: 'dnd5e.monsterfeatures',
      packLabel: 'Monster Features',
    });
    expect(typeof result.added[0].itemId).toBe('string');

    // the feature is embedded on the actor; the returned itemId is the embedded id
    const embedded = actor.items.getName('Multiattack');
    expect(embedded).toBeTruthy();
    expect(embedded.id).toBe(result.added[0].itemId);
  });

  it('reports notFound for a feature absent from all packs', async () => {
    addTargetActor('Feat Target');
    world.addPack({
      id: 'dnd5e.monsterfeatures',
      label: 'Monster Features',
      type: 'Item',
      documents: [makeActor({ id: 'mf1', name: 'Multiattack', type: 'feat' })],
    });

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Feat Target',
      featureNames: ['Nonexistent Feature'],
      compendiumPacks: ['dnd5e.monsterfeatures'],
    });

    expect(result.added).toEqual([]);
    expect(result.notFound).toEqual(['Nonexistent Feature']);
  });

  it('deduplicates case-insensitive input names (skipped: duplicate in input)', async () => {
    addTargetActor('Feat Target');
    world.addPack({
      id: 'dnd5e.monsterfeatures',
      label: 'Monster Features',
      type: 'Item',
      documents: [makeActor({ id: 'mf1', name: 'Multiattack', type: 'feat' })],
    });

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Feat Target',
      featureNames: ['Multiattack', 'multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.skipped).toEqual([{ name: 'multiattack', reason: 'duplicate in input' }]);
  });

  it('skips a feature already on the actor (name-only, any item type)', async () => {
    addTargetActor('Feat Target', [makeActor({ name: 'Multiattack', type: 'feat' })]);
    world.addPack({
      id: 'dnd5e.monsterfeatures',
      label: 'Monster Features',
      type: 'Item',
      documents: [makeActor({ id: 'mf1', name: 'Multiattack', type: 'feat' })],
    });

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Feat Target',
      featureNames: ['Multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures'],
    });

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([{ name: 'Multiattack', reason: 'already on actor' }]);
  });

  it('warns about a missing pack and an Actor-typed pack, then errors if none remain', async () => {
    addTargetActor('Feat Target');
    world.addPack({
      id: 'world.actorpack',
      label: 'Actor Pack',
      type: 'Actor',
      documents: [makeActor({ id: 'a1', name: 'Multiattack', type: 'feat' })],
    });

    await expect(
      da.addFeaturesFromCompendium({
        actorIdentifier: 'Feat Target',
        featureNames: ['Multiattack'],
        compendiumPacks: ['does.not.exist', 'world.actorpack'],
      })
    ).rejects.toThrow('No valid compendium packs available');
  });

  it('first-pack-wins across multiple valid packs', async () => {
    addTargetActor('Feat Target');
    world.addPack({
      id: 'dnd5e.monsterfeatures',
      label: 'Monster Features',
      type: 'Item',
      documents: [makeActor({ id: 'mf1', name: 'Multiattack', type: 'feat' })],
    });
    world.addPack({
      id: 'dnd5e.classfeatures',
      label: 'Class Features',
      type: 'Item',
      documents: [makeActor({ id: 'cf1', name: 'Multiattack', type: 'feat' })],
    });

    const result = await da.addFeaturesFromCompendium({
      actorIdentifier: 'Feat Target',
      featureNames: ['Multiattack'],
      compendiumPacks: ['dnd5e.monsterfeatures', 'dnd5e.classfeatures'],
    });

    expect(result.added).toHaveLength(1);
    expect(result.added[0].packId).toBe('dnd5e.monsterfeatures');
  });
});

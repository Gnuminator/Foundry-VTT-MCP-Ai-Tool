/**
 * The fake's monster compendium: the 11 creatures the real SRD kit picks (same names, challenge
 * ratings, types and sizes) plus decoys the builder must skip (a creature in another pack, a
 * leveled id, a creature that lacks the trait a cell needs). Only what the kit reads.
 */

/** The pack the kit matrix draws from (data/smoke-matrix.json). */
export const MONSTER_PACK = 'dnd5e.actors24';

/**
 * @typedef {object} FakeCreature
 * @property {string} id
 * @property {string} name
 * @property {string} pack
 * @property {number} cr
 * @property {string} type
 * @property {string} size        long name: tiny, small, medium, large, huge
 * @property {number} hp
 * @property {string[]} items     item names; the first is a weapon
 * @property {number} [fly]       flying speed
 * @property {string[]} [dr]      damage resistances
 * @property {boolean} [legendary]
 * @property {number} [legres]    legendary resistance uses
 * @property {boolean} [lair]
 * @property {number} [swim]
 * @property {number} [burrow]
 * @property {number} [climb]
 * @property {boolean} [hover]
 * @property {boolean} [regen]    a Regeneration feature (text only)
 * @property {boolean} [recharge] a Breath Weapon with a recharge 5 to 6
 * @property {boolean} [shape]    a Shapechanger feature
 * @property {boolean} [spells]   a Spellcasting feature and one spell
 * @property {boolean} [statBlock] a creature a spell makes: no challenge rating
 */

/** @param {string} id @param {string} name @param {number} cr @param {string} type @param {string} size @param {number} hp @param {Partial<FakeCreature>} [more] @returns {FakeCreature} */
function creature(id, name, cr, type, size, hp, more = {}) {
  return {
    id,
    name,
    pack: MONSTER_PACK,
    cr,
    type,
    size,
    hp,
    items: ['Strike', 'Multiattack'],
    ...more,
  };
}

/** @type {FakeCreature[]} */
export const CREATURES = [
  creature('mmBaboon00000000', 'Baboon', 0, 'beast', 'small', 3),
  creature('mmAnimatedFlying', 'Animated Flying Sword', 0.25, 'construct', 'small', 14, {
    fly: 50,
  }),
  creature('mmAnimatedArmor0', 'Animated Armor', 1, 'construct', 'medium', 33),
  creature('mmAnkylosaurus00', 'Ankylosaurus', 3, 'beast', 'huge', 68),
  creature('mmAboleth0000000', 'Aboleth', 10, 'aberration', 'large', 150),
  creature('mmGhast000000000', 'Ghast', 2, 'undead', 'medium', 36),
  creature('mmApe00000000000', 'Ape', 0.5, 'beast', 'medium', 19, { items: ['Fist', 'Rock'] }),
  creature('mmBat00000000000', 'Bat', 0, 'beast', 'tiny', 1, { fly: 30 }),
  creature('mmAirElemental00', 'Air Elemental', 5, 'elemental', 'large', 90, {
    dr: ['lightning', 'thunder'],
  }),
  creature('mmAllosaurus0000', 'Allosaurus', 2, 'beast', 'large', 51),
  creature('mmAdultBlackDrag', 'Adult Black Dragon', 14, 'dragon', 'huge', 195, {
    legendary: true,
    fly: 80,
  }),
  // The odd mechanics of the monster scenarios. Their names sort after every creature the builder
  // picks, so the 11 cells keep their picks.
  creature('mmTroll000000000', 'Troll', 5, 'giant', 'large', 84, { regen: true, items: ['Bite'] }),
  creature('mmUmberHulk00000', 'Umber Hulk', 5, 'monstrosity', 'large', 93, {
    burrow: 25,
    climb: 25,
  }),
  creature('mmVampire0000000', 'Vampire', 13, 'undead', 'medium', 144, {
    legendary: true,
    legres: 3,
    lair: true,
    shape: true,
    regen: true,
    spells: true,
  }),
  creature('mmWaterElemental', 'Water Elemental', 5, 'elemental', 'large', 114, { swim: 90 }),
  creature('mmYoungRedDragon', 'Young Red Dragon', 10, 'dragon', 'large', 178, {
    fly: 80,
    recharge: true,
    lair: true,
  }),
  creature('mmZephyrHover000', 'Zephyr Wisp', 1, 'elemental', 'small', 20, {
    fly: 40,
    hover: true,
  }),
  // A creature a spell makes: no challenge rating.
  creature('mmZSpiritualWeap', 'Spiritual Weapon', 0, 'beast', 'small', 1, { statBlock: true }),
  // Decoys: each must be passed over by the builder.
  creature('mmAardvark000000', 'Aardvark', 0, 'beast', 'small', 2, { pack: 'dnd5e.monsters' }),
  creature('mmBanditLv2', 'Bandit Lv2', 0.5, 'humanoid', 'medium', 11),
  creature('mmBandit0000000', 'Bandit', 0.5, 'humanoid', 'medium', 11),
];

/** dnd5e's short size codes by long name. */
export const SIZE_CODE = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
};

/** @param {string} id @param {string} pack */
export function findCreature(pack, id) {
  return CREATURES.find(c => c.pack === pack && c.id === id) ?? null;
}

/**
 * The compendium entry as `get-compendium-item` returns it (only the fields the kit reads).
 * @param {FakeCreature} c
 */
export function compendiumEntry(c) {
  const resist = { value: c.dr ?? [], custom: '', bypasses: [] };
  const none = { value: [], custom: '', bypasses: [] };
  return {
    id: c.id,
    name: c.name,
    type: 'npc',
    pack: { id: c.pack, label: c.pack === MONSTER_PACK ? 'Actors' : 'Monsters (SRD)' },
    system: {
      identifier: c.name.toLowerCase().replace(/ /g, '-'),
      attributes: { hp: { value: c.hp, max: c.hp }, movement: { fly: c.fly ?? 0 } },
      // Prepared data turns the trait sets into {}: the builder must read fullData instead.
      traits: {
        size: SIZE_CODE[/** @type {keyof typeof SIZE_CODE} */ (c.size)],
        dr: { value: {} },
      },
    },
    items: c.items.map((name, i) => ({
      id: `${c.id.slice(0, 6)}item${i}`,
      name,
      type: i === 0 ? 'weapon' : 'feat',
    })),
    effects: [],
    fullData: {
      name: c.name,
      type: 'npc',
      system: {
        details: { cr: c.cr, type: { value: c.type } },
        traits: {
          size: SIZE_CODE[/** @type {keyof typeof SIZE_CODE} */ (c.size)],
          dr: resist,
          di: none,
          dv: none,
        },
        attributes: {
          hp: { value: c.hp, max: c.hp },
          movement: { speeds: { fly: c.fly ?? 0 } },
        },
      },
    },
    mode: 'full',
  };
}

/**
 * The odd-mechanic items of a creature, as inspectFeatures reports them (a weapon first, then the
 * features its odd traits need). Ids are `<actor id>.<identifier>`.
 * @param {FakeCreature} c
 * @param {string} actorId
 * @returns {import('../features.mjs').FeatureItem[]}
 */
export function monsterItems(c, actorId) {
  /** @type {import('../features.mjs').FeatureItem[]} */
  const items = [];
  const add = (
    /** @type {string} */ name,
    /** @type {string} */ type,
    /** @type {any} */ o = {}
  ) => {
    const identifier = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    items.push({
      id: `${actorId}.${identifier}`,
      name,
      type,
      identifier,
      sourceUuid: null,
      equipped: false,
      uses: o.uses ?? null,
      activities: (o.activities ?? []).map((/** @type {any} */ a, /** @type {number} */ i) => ({
        id: `act${i}`,
        type: a.type,
        name: a.name ?? '',
        activation: a.activation ?? 'action',
        activationValue: a.activationValue ?? null,
        canUse: a.canUse ?? true,
        consumption: a.consumption ?? [],
      })),
      effects: [],
    });
  };
  if (!c.statBlock) {
    add(c.items[0], 'weapon', { activities: [{ type: 'attack' }] });
    for (const name of c.items.slice(1)) {
      add(name, 'feat', { activities: name === 'Multiattack' ? [{ type: 'utility' }] : [] });
    }
  } else {
    add('Force Strike', 'feat', { activities: [{ type: 'attack' }] });
  }
  if (c.legendary) {
    for (const name of ['Tail Sweep', 'Wing Attack']) {
      add(name, 'feat', {
        activities: [
          {
            type: 'utility',
            activation: 'legendary',
            activationValue: 1,
            consumption: [{ type: 'attribute', target: 'resources.legact.value', value: '1' }],
          },
        ],
      });
    }
  }
  if (c.legendary) {
    // No consumption target: the system spends the pool through the action consumption.
    add('Wing Buffet', 'feat', {
      activities: [{ type: 'utility', activation: 'legendary', activationValue: 1 }],
    });
  }
  if (c.legres) {
    add('Legendary Resistance', 'feat', {
      activities: [
        {
          type: 'utility',
          activation: 'special',
          consumption: [{ type: 'attribute', target: 'resources.legres.value', value: '1' }],
        },
      ],
    });
  }
  if (c.regen) add('Regeneration', 'feat');
  if (c.shape) add('Shapechanger', 'feat', { activities: [{ type: 'utility' }] });
  if (c.recharge) {
    add('Breath Weapon', 'feat', {
      uses: {
        max: 1,
        spent: 0,
        recovery: [{ period: 'recharge', type: 'recoverAll', formula: '5' }],
      },
      activities: [{ type: 'save', consumption: [{ type: 'itemUses', target: '', value: '1' }] }],
    });
  }
  if (c.spells) {
    add('Spellcasting', 'feat', { activities: [{ type: 'cast' }] });
    add('Detect Magic', 'spell', { activities: [{ type: 'utility' }] });
  }
  return items;
}

/** The legendary, resistance and lair pools of a creature. @param {FakeCreature} c */
export function monsterResources(c) {
  return {
    legact: c.legendary ? { max: 3, spent: 0 } : null,
    legres: c.legres ? { max: c.legres, spent: 0 } : null,
    lair: c.lair ? { value: true, initiative: null, inside: false } : null,
  };
}

/** The armor class of a fake creature (a dragon has more, a spell's creature has none). @param {FakeCreature} c */
export const monsterAc = c => (c.statBlock ? 0 : c.type === 'dragon' ? 18 : 12);

/**
 * The creature as listMonsters returns it (see GM_ACTIONS.listMonsters).
 * @param {FakeCreature} c
 */
export function monsterRow(c) {
  const items = monsterItems(c, c.id);
  const activities = items.flatMap(i => i.activities);
  const isDragon = c.type === 'dragon';
  return {
    packId: c.pack,
    id: c.id,
    uuid: `Compendium.${c.pack}.Actor.${c.id}`,
    name: c.name,
    cr: c.statBlock ? null : c.cr,
    creatureType: c.statBlock ? 'custom' : c.type,
    size: SIZE_CODE[/** @type {keyof typeof SIZE_CODE} */ (c.size)],
    book: 'Fake SRD',
    rules: '2024',
    hp: c.hp,
    ac: monsterAc(c),
    movement: {
      walk: 30,
      fly: c.fly ?? 0,
      swim: c.swim ?? 0,
      burrow: c.burrow ?? 0,
      climb: c.climb ?? 0,
      hover: c.hover ?? false,
      units: 'ft',
    },
    senses: {
      darkvision: isDragon ? 120 : 0,
      blindsight: 0,
      tremorsense: 0,
      truesight: 0,
      special: false,
    },
    languages: c.type === 'humanoid' || isDragon ? ['Common'] : [],
    resist: { dr: c.dr ?? [], di: [], dv: [], ci: [], dm: false },
    spell: {
      spells: c.spells ? 1 : 0,
      ability: c.spells ? 'cha' : 'int',
      innate: false,
      dc: c.spells ? 15 : 10,
    },
    legact: c.legendary ? 3 : 0,
    legres: c.legres ?? 0,
    lair: c.lair ?? false,
    items: items.length,
    activities: activities.length,
    odd: {
      regeneration: c.regen ?? false,
      shapechanger: c.shape ?? false,
      damageThreshold: false,
      multiattack: !c.statBlock && c.items.includes('Multiattack'),
      innateSpellcasting: false,
      recharge: c.recharge ? 1 : 0,
      summon: 0,
      transform: 0,
      legendaryActivities: activities.filter(a => a.activation === 'legendary').length,
      lairActivities: 0,
    },
  };
}

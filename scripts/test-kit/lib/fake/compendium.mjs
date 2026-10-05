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

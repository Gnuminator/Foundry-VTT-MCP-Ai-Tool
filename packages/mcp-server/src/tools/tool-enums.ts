/** Fixed value lists shared by tool input schemas, so Claude sees a choice, not a free string. */

/** dnd5e item types a character can carry (search-character-items), plus active effects. */
const CHARACTER_ITEM_TYPES = [
  'spell',
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'container',
  'feat',
  'class',
  'subclass',
  'background',
  'race',
  'effect',
  'facility',
] as const;

const CHARACTER_ITEM_CATEGORIES = ['cantrip', 'prepared', 'equipped'] as const;

const ACTOR_KINDS = ['character', 'npc', 'vehicle', 'group', 'encounter'] as const;

/** Ready-made schema properties for character.ts. */
export const ACTOR_KIND_PROP = {
  type: 'string',
  enum: [...ACTOR_KINDS],
  description: 'Optional filter by character type.',
};

export const CHARACTER_ITEM_TYPE_PROP = {
  type: 'string',
  enum: [...CHARACTER_ITEM_TYPES],
  description:
    'Filter by dnd5e item type: equipment covers armor and shields, feat is features, race is species, effect is active effects. Leave empty to search all types.',
};

export const CHARACTER_ITEM_CATEGORY_PROP = {
  type: 'string',
  enum: [...CHARACTER_ITEM_CATEGORIES],
  description:
    'Additional category filter. For spells: "cantrip" or "prepared". For weapons and equipment: "equipped".',
};

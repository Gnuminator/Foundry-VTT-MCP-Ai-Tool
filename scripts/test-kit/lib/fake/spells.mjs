/**
 * The fake's spells: a small spell compendium (the pack `dnd5e.spells24`) with the SRD spells the
 * deep checks name and a few more for the broad pass, and the fake's twins of the GM actions
 * `listSpells` and `exerciseSpell`. The numbers are the 2024 SRD numbers; the fake does not
 * simulate dnd5e, so a clean fake run proves the plumbing (the scenarios, the judging and the
 * report), not the rules. A test breaks something by naming a quirk in `world.faults.spellQuirks`
 * ("<spell name>" -> throws, noCard, noSlot, wrongSlot, drift, refuse, badData, skip, noActivity).
 */
import { FAKE_CLASSES } from './classes.mjs';
import { ToolFailure } from './state.mjs';

/** The only pack the fake has spells in. */
export const FAKE_SPELL_PACK = 'dnd5e.spells24';

/** @param {string} name */
const idOf = name =>
  `fakeSpl${name
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 9)
    .padEnd(9, '0')}`;

/** @param {string} id */
export const spellUuid = id => `Compendium.${FAKE_SPELL_PACK}.Item.${id}`;

const NO_TEMPLATE = { type: '', size: '', width: '', height: '', units: '' };
const area = (/** @type {string} */ type, /** @type {string} */ size, width = '') => ({
  type,
  size,
  width,
  height: '',
  units: 'ft',
});
const part = (
  /** @type {number} */ number,
  /** @type {number} */ denomination,
  /** @type {string} */ type,
  bonus = '',
  scalingNumber = 1
) => ({
  number,
  denomination,
  bonus,
  types: [type],
  custom: '',
  scaling: { mode: 'whole', number: scalingNumber, formula: '' },
});

/**
 * @typedef {object} FakeSpell
 * @property {string} id
 * @property {string} name
 * @property {number} level
 * @property {string} school
 * @property {boolean} ritual
 * @property {boolean} concentration
 * @property {string[]} activities    activity types
 * @property {string} template        the area shape the index shows
 * @property {any} facts              what exerciseSpell reports as `facts`
 */

/**
 * @param {string} name
 * @param {number} level
 * @param {Record<string, any>} [o]  type, activation, template, save, attack, damage, healing, effects, summon,
 *   concentration, ritual, count
 * @returns {FakeSpell}
 */
function spell(name, level, o = {}) {
  const template = o.template ?? NO_TEMPLATE;
  return {
    id: idOf(name),
    name,
    level,
    school: o.school ?? 'evo',
    ritual: !!o.ritual,
    concentration: !!o.concentration,
    activities: o.noActivity ? [] : [o.type ?? 'utility'],
    template: template.type,
    facts: {
      type: o.type ?? 'utility',
      name: '',
      activation: 'action',
      itemActivation: o.itemActivation ?? 'action',
      consumesSlot: level > 0,
      concentration: !!o.concentration,
      range: { value: '', units: 'ft' },
      duration: { value: '', units: 'inst' },
      target: {
        type: 'creature',
        count: o.count ?? '',
        resolvedCount: o.resolvedCount ?? null,
        template,
      },
      save: o.save ?? null,
      attack: o.attack ?? null,
      damage: o.damage ?? [],
      healing: o.healing ?? [],
      effects: o.effects ?? [],
      summon: o.summon ?? null,
    },
  };
}

const save = (/** @type {string} */ ability, onSave = 'half') => ({
  ability: [ability],
  dc: null,
  calc: 'spellcasting',
  onSave,
});

/** @type {FakeSpell[]} */
export const FAKE_SPELLS = [
  spell('Light', 0, { school: 'evo' }),
  spell('Comprehend Languages', 1, { school: 'div', ritual: true, noActivity: true }),
  spell('Fire Bolt', 0, {
    type: 'attack',
    attack: { type: 'ranged', classification: 'spell' },
    damage: [part(1, 10, 'fire')],
  }),
  spell('Shocking Grasp', 0, {
    type: 'attack',
    attack: { type: 'melee', classification: 'spell' },
    damage: [part(1, 8, 'lightning')],
  }),
  spell('Burning Hands', 1, {
    type: 'save',
    save: save('dex'),
    damage: [part(3, 6, 'fire')],
    template: area('cone', '15'),
  }),
  spell('Thunderwave', 1, {
    type: 'save',
    save: save('con'),
    damage: [part(2, 8, 'thunder')],
    template: area('cube', '15'),
  }),
  spell('Magic Missile', 1, {
    type: 'damage',
    damage: [part(1, 4, 'force', '1', 0)],
    count: '2 + @item.level',
    resolvedCount: 3,
  }),
  spell('Cure Wounds', 1, {
    type: 'heal',
    school: 'abj',
    healing: [part(2, 8, 'healing', '@mod', 2)],
  }),
  spell('False Life', 1, { type: 'heal', school: 'nec', healing: [part(2, 4, 'temphp', '4', 0)] }),
  spell('Shield', 1, {
    type: 'utility',
    school: 'abj',
    itemActivation: 'reaction',
    effects: [
      {
        name: 'Imperceptible Barrier',
        statuses: [],
        changes: [{ key: 'system.attributes.ac.bonus', value: '5', type: 'add' }],
      },
    ],
  }),
  spell('Mage Armor', 1, {
    school: 'abj',
    effects: [
      {
        name: 'Mage Armor',
        statuses: [],
        changes: [{ key: 'system.attributes.ac.calc', value: 'mage', type: 'override' }],
      },
    ],
  }),
  spell('Bless', 1, {
    school: 'enc',
    concentration: true,
    effects: [
      {
        name: 'Blessed',
        statuses: [],
        changes: [
          { key: 'system.bonuses.mwak.attack', value: '1d4', type: 'add' },
          { key: 'system.bonuses.abilities.save', value: '1d4', type: 'add' },
        ],
      },
    ],
  }),
  spell('Detect Magic', 1, {
    school: 'div',
    concentration: true,
    ritual: true,
    template: area('radius', '30'),
  }),
  spell('Hex', 1, { type: 'utility', school: 'enc', concentration: true }),
  spell('Misty Step', 2, { type: 'teleport', school: 'con', itemActivation: 'bonus' }),
  spell('Hold Person', 2, {
    type: 'save',
    school: 'enc',
    concentration: true,
    save: save('wis', ''),
    effects: [{ name: 'Paralyzed', statuses: ['paralyzed'], changes: [] }],
  }),
  spell('Flaming Sphere', 2, {
    type: 'summon',
    concentration: true,
    summon: {
      mode: '',
      profiles: [{ id: 'prof0001', uuid: 'Compendium.dnd5e.actors24.Actor.fakeSphere', count: '' }],
    },
  }),
  spell('Fireball', 3, {
    type: 'save',
    save: save('dex'),
    damage: [part(8, 6, 'fire')],
    template: area('sphere', '20'),
  }),
  spell('Lightning Bolt', 3, {
    type: 'save',
    save: save('dex'),
    damage: [part(8, 6, 'lightning')],
    template: area('line', '100', '5'),
  }),
  spell('Wall of Fire', 4, {
    type: 'save',
    concentration: true,
    save: save('dex'),
    damage: [part(5, 8, 'fire')],
    template: area('wall', '60', '1'),
  }),
  spell('Cone of Cold', 5, {
    type: 'save',
    save: save('con'),
    damage: [part(8, 8, 'cold')],
    template: area('cone', '60'),
  }),
  spell('Chain Lightning', 6, {
    type: 'save',
    save: save('dex'),
    damage: [part(10, 8, 'lightning')],
  }),
  spell('Teleport', 7, { type: 'teleport', school: 'con' }),
  spell('Mind Blank', 8, { school: 'abj' }),
  spell('Wish', 9, { school: 'con' }),
];

/** Every fake spell is findable by uuid. @param {string} uuid */
export const findSpell = uuid => FAKE_SPELLS.find(s => spellUuid(s.id) === uuid);

/**
 * The fake's listSpells.
 * @param {any} _w
 * @param {{packIds: string[]}} args
 */
export function fakeListSpells(_w, args) {
  const entries = [];
  /** @type {string[]} */
  const missing = [];
  for (const packId of args.packIds ?? []) {
    if (packId !== FAKE_SPELL_PACK) {
      missing.push(packId);
      continue;
    }
    for (const s of FAKE_SPELLS) {
      entries.push({
        packId,
        id: s.id,
        uuid: spellUuid(s.id),
        name: s.name,
        level: s.level,
        school: s.school,
        rules: '2024',
        book: 'SRD',
        ritual: s.ritual,
        concentration: s.concentration,
        activities: s.activities,
        template: s.template,
        hints: [],
      });
    }
  }
  return { entries, missing };
}

/** The Region shape the system makes for an area type. */
const REGION_SHAPES = /** @type {Record<string, string>} */ ({
  sphere: 'circle',
  cylinder: 'circle',
  cone: 'cone',
  line: 'line',
  wall: 'line',
  cube: 'rectangle',
  square: 'rectangle',
});

/** Where the effects' paths read the same value in the actor (the system maps old keys to new ones). */
const READ_ALIASES = /** @type {Record<string, string>} */ ({
  'system.rolls.attack.mwak.bonus': 'system.bonuses.mwak.attack',
  'system.rolls.ability.save.bonus': 'system.bonuses.abilities.save',
});

const AC_PATH = 'system.attributes.ac.value';

/** The number in a damage bonus text ("4", "@mod"). @param {string} bonus @param {number} mod */
const bonusNumber = (bonus, mod) => (bonus === '@mod' ? mod : Number(bonus) || 0);

/**
 * The fake's exerciseSpell. It never changes the world, so there is nothing to restore; a quirk
 * ("<spell name>") makes a cast misbehave for a test. The actor's slots start full.
 * @param {import('./state.mjs').World} w
 * @param {any} args
 */
export function fakeExerciseSpell(w, args) {
  const actor = w.actors.get(args.actorId);
  if (!actor || !actor.sheet?.features)
    throw new ToolFailure(`exerciseSpell: no actor ${args.actorId}`);
  const k = FAKE_CLASSES.find(c => c.identifier === actor.sheet.classes[0].identifier);
  const prof = actor.sheet.features.prof;
  const abilityKey = k?.spell?.ability ?? 'int';
  const abilityMod = actor.sheet.abilities[abilityKey]?.mod ?? 0;
  const caster = {
    ability: abilityKey,
    abilityMod,
    attack: prof + abilityMod,
    dc: 8 + prof + abilityMod,
    mod: abilityMod,
    prof,
    level: actor.level,
  };
  /** @type {Record<string, {value: number, max: number, level: number}>} */
  const slots = {};
  for (const [key, s] of Object.entries(actor.sheet.spells ?? {})) {
    const slot = /** @type {any} */ (s);
    slots[key] = {
      value: slot.max,
      max: slot.max,
      level: key === 'pact' ? slot.level : Number(key.slice(5)),
    };
  }
  for (const [key, n] of Object.entries(args.slots ?? {})) {
    const have = slots[key] ?? { value: 0, max: 0, level: Number(key.slice(5)) };
    slots[key] = { ...have, value: Number(n), max: Math.max(have.max, Number(n)) };
  }
  /** @type {string[]} */
  let concentrating = [];
  let drifted = false;

  /** @param {any} spec */
  const cast = spec => {
    const s = findSpell(String(spec.uuid));
    if (!s) throw new ToolFailure(`exerciseSpell: no spell ${spec.uuid}`);
    const quirk = w.faults.spellQuirks.get(s.name) ?? '';
    /** @type {any} */
    const facts = JSON.parse(JSON.stringify(s.facts));
    if (facts.save) facts.save.dc = caster.dc;
    if (quirk === 'badData') {
      facts.target.template.size = '1';
      if (facts.damage[0]) facts.damage[0].number += 1;
    }
    const method = spec.scroll ? '' : (spec.as ?? 'spell');
    const key =
      spec.slot ??
      (method === 'pact' ? 'pact' : method === 'spell' && s.level > 0 ? `spell${s.level}` : null);
    const out = /** @type {any} */ ({
      uuid: spec.uuid,
      name: spec.scroll ? `Spell Scroll: ${s.name}` : s.name,
      itemId: `itm${s.id}`,
      level: s.level,
      school: s.school,
      properties: [],
      method,
      activities: [{ type: s.activities[0], name: '' }],
      activityIndex: 0,
      facts,
      slotKey: key,
      ok: false,
      threw: null,
      notes: [],
      chatCard: false,
      spells: {},
      scaling: 0,
      extraItems: 0,
      effects: [],
      concentrating,
      itemLeft: !spec.scroll,
      itemUses: { spent: spec.scroll ? 1 : null, max: spec.scroll ? 1 : null, quantity: null },
    });
    if (quirk === 'noActivity' || !s.activities.length) {
      out.noActivities = true;
      return out;
    }
    if (quirk === 'skip') {
      out.skipped = 'a transform activity asks which form to take';
      return out;
    }
    if (quirk === 'drift') drifted = true;
    if (quirk === 'throws') {
      out.threw = 'Cannot read properties of undefined (reading "system")';
      return out;
    }
    if (
      key &&
      /^spell[1-9]$/.test(key) &&
      facts.consumesSlot &&
      !spec.noForce &&
      !(slots[key]?.value > 0)
    ) {
      slots[key] = { value: 2, max: 2, level: Number(key.slice(5)) };
      out.slotForced = true;
    }
    const slot = key ? slots[key] : undefined;
    out.slotBefore = slot ? { ...slot } : null;
    const needsSlot =
      facts.consumesSlot && s.level > 0 && (method === 'spell' || method === 'pact');
    if (quirk === 'refuse' || (needsSlot && !(slot && slot.value > 0))) {
      out.notes.push({ level: 'error', message: 'You have no spell slots of that level left' });
      out.slotAfter = out.slotBefore;
      return out;
    }
    out.ok = true;
    out.chatCard = quirk !== 'noCard';
    if (needsSlot && slot && quirk !== 'noSlot') {
      const taken = quirk === 'wrongSlot' ? (key === 'spell1' ? 'spell2' : 'spell1') : key;
      const from = slots[/** @type {string} */ (taken)];
      if (from) {
        out.spells[/** @type {string} */ (taken)] = { before: from.value, after: from.value - 1 };
        from.value -= 1;
      }
    }
    out.slotAfter = slot ? { ...slot } : null;
    if (slot && slot.level > s.level) out.scaling = slot.level - s.level;
    // Concentration: one at a time.
    if (facts.concentration && spec.concentration !== false) {
      concentrating = [`Concentrating: ${s.name}`];
      out.effects.push({ name: concentrating[0], statuses: ['concentrating'], changes: [] });
    }
    out.concentrating = concentrating;
    if (out.scaling) {
      out.scaled = JSON.parse(JSON.stringify(facts));
      if (facts.target.resolvedCount !== null)
        out.scaled.target.resolvedCount = 2 + s.level + out.scaling;
    }
    /** @param {any[]} parts */
    const rollParts = parts =>
      parts.map(p => {
        let n = p.number;
        if (s.level === 0)
          n += Number(actor.level >= 5) + Number(actor.level >= 11) + Number(actor.level >= 17);
        else n += p.scaling.number * out.scaling;
        const total = Math.floor((n * (p.denomination + 1)) / 2) + bonusNumber(p.bonus, abilityMod);
        return {
          formula: `${n}d${p.denomination}${p.bonus ? ` + ${p.bonus}` : ''}`,
          total,
          dice: [{ n, f: p.denomination }],
          types: p.types,
        };
      });
    /** @type {any} */
    const rolled = {};
    for (const kind of spec.rolls ?? []) {
      if (kind === 'attack') {
        const bonus = prof + abilityMod + (quirk === 'badData' ? 1 : 0);
        rolled.attack = {
          formula: `1d20 + ${bonus}`,
          total: 10 + bonus,
          dice: [{ n: 1, f: 20 }],
          types: [],
          d20: 10,
          bonus,
        };
      } else if (kind === 'damage') rolled.damage = rollParts((out.scaled ?? facts).damage);
      else if (kind === 'heal') rolled.heal = rollParts((out.scaled ?? facts).healing);
    }
    if (Object.keys(rolled).length) out.rolled = rolled;
    if (spec.applyTemp && rolled.heal?.[0])
      out.hp = { value: actor.hp.value, temp: rolled.heal[0].total };
    if (spec.apply) {
      const effects = facts.effects.filter(
        (/** @type {any} */ e) => !spec.effectName || e.name === spec.effectName
      );
      const baseAc = actor.sheet.features.ac.value;
      let ac = baseAc;
      /** @type {Record<string, any>} */
      const during = {};
      for (const e of effects) {
        for (const c of e.changes) {
          if (c.key === 'system.attributes.ac.bonus') ac += Number(c.value);
          if (c.key === 'system.attributes.ac.calc' && c.value === 'mage')
            ac = 13 + (actor.sheet.abilities.dex?.mod ?? 0);
          during[c.key] = { value: c.value };
        }
      }
      for (const [alias, real] of Object.entries(READ_ALIASES)) {
        if (during[real]) during[alias] = during[real];
      }
      const keep = (/** @type {Record<string, any>} */ all) =>
        Object.fromEntries(
          [AC_PATH, ...(spec.read ?? [])].map(p => [p, all[p] ?? { value: null }])
        );
      out.applied = {
        count: effects.length,
        statuses: [...new Set(effects.flatMap((/** @type {any} */ e) => e.statuses))],
        before: {
          [AC_PATH]: { value: baseAc },
          ...Object.fromEntries(
            (spec.read ?? []).map((/** @type {string} */ p) => [p, { value: null }])
          ),
        },
        during: keep({ ...during, [AC_PATH]: { value: ac } }),
      };
    }
    if (spec.region) {
      const t = facts.target.template;
      const shape = REGION_SHAPES[t.type] ?? null;
      out.region = {
        templateType: t.type,
        size: t.size,
        shapeType: shape,
        created: shape ? 1 : 0,
        shapes: shape ? [shape] : [],
      };
    }
    if (spec.summon) {
      const sum = facts.summon;
      out.summoned = { placed: 0, tokens: [] };
      if (!sum) out.summoned.skipped = 'the spell has no summon activity';
      else if (sum.mode) out.summoned.skipped = `summon mode "${sum.mode}" asks for a creature`;
      else {
        out.summoned.placed = 1;
        out.summoned.tokens = [s.name];
      }
    }
    return out;
  };

  const casts = (args.casts ?? []).map(cast);
  return {
    casts,
    caster,
    error: null,
    restored: !drifted,
    drift: drifted ? ['item spell'] : [],
  };
}

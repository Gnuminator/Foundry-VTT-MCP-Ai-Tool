/**
 * The deep spell checks: about thirty rule checks, each on a spell of the 2024 SRD (public rules
 * text; a licensed profile that has the same spell is judged against the same table). One check is
 * one or two casts on a kit hero, then the numbers are compared with the rules written down here.
 * A number the imported data gets wrong is CONTENT; a number the data has right and the system gets
 * wrong is SYSTEM. The hero is put back after every call by the GM action (exerciseSpell).
 */
import { bad, throwKind, refusalOfCast } from './spells.mjs';

/** @typedef {import('./spells.mjs').Problem} Problem */
/** @typedef {import('./spells.mjs').SpellEntry} SpellEntry */
/** @typedef {import('./spells.mjs').CastResponse} CastResponse */
/**
 * @typedef {{hero: any, facts: any}} Who a kit hero and what inspectFeatures says about it
 *
 * @typedef {object} SpellCtx what a deep check can use
 * @property {(name: string) => SpellEntry | undefined} find
 * @property {(level: number) => Promise<Who | null>} caster       a caster with natural slots of that level, else any caster
 * @property {(level: number) => Promise<Who | null>} heroAtLevel  a hero of exactly that character level
 * @property {(classId: string) => Promise<Who | null>} byClass
 * @property {() => Promise<Who | null>} unarmored                 a hero with no armor or shield
 * @property {(who: Who, args: object) => Promise<CastResponse>} exercise
 *
 * @typedef {object} SpellOutcome
 * @property {Problem[]} problems
 * @property {string[]} notes
 * @property {string} [skip]  why the check could not run
 *
 * @typedef {object} SpellCheck
 * @property {string} id
 * @property {string} title
 * @property {string[]} spells  SRD spell names the check needs; it is skipped when the profile lacks one
 * @property {(ctx: SpellCtx) => Promise<SpellOutcome>} run
 */

const AC = 'system.attributes.ac.value';

/**
 * Looks at one cast response and says whether the cast can be judged; pushes the problem when not.
 * @param {Problem[]} problems
 * @param {CastResponse} res
 * @param {string} label
 * @param {number} [index]
 * @returns {any | null} the cast, or null
 */
function usable(problems, res, label, index = 0) {
  const cast = res.casts?.[index];
  if (res.error) bad(problems, 'KIT', 'the GM action failed', `${label}: ${res.error}`);
  else if (!cast) bad(problems, 'KIT', 'the GM action returned no cast', label);
  else if (cast.noActivities) bad(problems, 'CONTENT', 'the spell has no activity', label);
  else if (cast.threw)
    bad(problems, throwKind(cast.threw), 'the cast threw', `${label}: ${cast.threw}`);
  else if (!cast.ok) {
    const text =
      (cast.notes ?? [])
        .filter((/** @type {any} */ n) => n.level === 'error')
        .map((/** @type {any} */ n) => n.message)
        .join(' / ') || 'no message';
    const refusal = refusalOfCast(text, cast);
    bad(problems, refusal.kind, 'the system refused the cast', `${label}: ${text}${refusal.note}`);
  } else {
    if (res.restored === false)
      bad(
        problems,
        'KIT',
        'the hero was not put back',
        `${label}: ${(res.drift ?? []).slice(0, 3).join(', ')}`
      );
    return cast;
  }
  return null;
}

/** The dice of a roll as text, "8d6". @param {{dice: Array<{n: number, f: number}>} | undefined} roll */
const diceText = roll => (roll?.dice ?? []).map(d => `${d.n}d${d.f}`).join(' + ') || 'none';

/** The number of dice of one size in a roll. @param {any} roll @param {number} faces */
const diceCount = (roll, faces) =>
  (roll?.dice ?? []).filter((/** @type {any} */ d) => d.f === faces).reduce((n, d) => n + d.n, 0);

/**
 * Compares a number with the rules; `kind` says whose fault a difference is.
 * @param {Problem[]} problems
 * @param {import('./spells.mjs').Problem['kind']} kind
 * @param {string} what
 * @param {unknown} got
 * @param {unknown} want
 * @param {string} [extra]
 */
function expectEqual(problems, kind, what, got, want, extra = '') {
  if (got !== want) bad(problems, kind, what, `got ${got}, the rules say ${want}${extra}`);
}

/** The first of the cast's damage parts. @param {any} cast */
const part = cast => cast.facts?.damage?.[0];

/**
 * A check that is one cast and a list of comparisons.
 * @param {{id: string, title: string, spells: string[], who: (ctx: SpellCtx) => Promise<Who | null>, none?: string,
 *   cast: (entries: SpellEntry[]) => object, judge: (a: {cast: any, res: CastResponse, who: Who, problems: Problem[], notes: string[]}) => void}} o
 * @returns {SpellCheck}
 */
function oneCast(o) {
  return {
    id: o.id,
    title: o.title,
    spells: o.spells,
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const who = await o.who(ctx);
      if (!who) return { ...out, skip: o.none ?? 'no hero for this check' };
      const entries = /** @type {SpellEntry[]} */ (o.spells.map(n => ctx.find(n)));
      const res = await ctx.exercise(who, o.cast(entries));
      const cast = usable(out.problems, res, o.spells.join(' + '));
      if (cast) o.judge({ cast, res, who, problems: out.problems, notes: out.notes });
      return out;
    },
  };
}

/**
 * An area check: the data says the shape and size, and the Region the system would build exists.
 * @param {{id: string, title: string, spell: string, type: string, size: string, shape: string}} o
 */
function areaCheck(o) {
  return oneCast({
    id: o.id,
    title: o.title,
    spells: [o.spell],
    who: ctx => ctx.caster(0),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, region: true }] }),
    judge({ cast, problems, notes }) {
      const t = cast.facts.target.template;
      expectEqual(problems, 'CONTENT', `${o.spell} area shape`, t.type, o.type);
      expectEqual(
        problems,
        'CONTENT',
        `${o.spell} area size`,
        `${t.size} ${t.units}`,
        `${o.size} ft`
      );
      const region = cast.region;
      if (!region || !region.created) {
        bad(
          problems,
          'SYSTEM',
          `${o.spell} template`,
          `no Region could be made from the ${t.type} template (shape type ${region?.shapeType ?? 'none'})`
        );
      } else if (!region.shapes.includes(o.shape)) {
        bad(
          problems,
          'SYSTEM',
          `${o.spell} template`,
          `the Region has shapes ${region.shapes.join(', ')}, expected ${o.shape}`
        );
      }
      notes.push(`${t.type} ${t.size} ${t.units} -> Region ${region?.shapes?.join(',') ?? 'none'}`);
    },
  });
}

/** The caster's own spell attack bonus (proficiency plus the casting ability), from the rules. @param {CastResponse} res */
const ruleAttack = res => (res.caster?.prof ?? 0) + (res.caster?.abilityMod ?? 0);

/**
 * A spell attack check.
 * @param {{id: string, title: string, spell: string, kind: string}} o
 */
function attackCheck(o) {
  return oneCast({
    id: o.id,
    title: o.title,
    spells: [o.spell],
    who: ctx => ctx.caster(0),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, rolls: ['attack', 'damage'] }] }),
    judge({ cast, res, problems, notes }) {
      expectEqual(problems, 'CONTENT', `${o.spell} attack type`, cast.facts.attack?.type, o.kind);
      const roll = cast.rolled?.attack;
      if (!roll) {
        bad(problems, 'SYSTEM', `${o.spell} attack roll`, cast.rolled?.attackError ?? 'no roll');
        return;
      }
      const want = ruleAttack(res);
      expectEqual(
        problems,
        'SYSTEM',
        `${o.spell} attack bonus`,
        roll.bonus,
        want,
        ` (proficiency ${res.caster?.prof} + ability ${res.caster?.abilityMod}; the actor says ${res.caster?.attack})`
      );
      if (!(roll.d20 >= 1 && roll.d20 <= 20))
        bad(problems, 'SYSTEM', `${o.spell} attack die`, `the d20 came out ${roll.d20}`);
      notes.push(`bonus ${roll.bonus}, rule ${want}`);
    },
  });
}

/**
 * Casts a spell at a higher slot and judges the scaled numbers with `judgeScaled`.
 * @param {{id: string, title: string, spell: string, slot: string, rolls: string[], judgeScaled: (a: {cast: any, problems: Problem[], notes: string[]}) => void}} o
 */
function upcastCheck(o) {
  return oneCast({
    id: o.id,
    title: o.title,
    spells: [o.spell],
    who: ctx => ctx.caster(Number(o.slot.slice(5))),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, slot: o.slot, rolls: o.rolls }] }),
    judge({ cast, problems, notes }) {
      const level = Number(o.slot.slice(5));
      expectEqual(problems, 'SYSTEM', `${o.spell} scaling`, cast.scaling, level - cast.level);
      const taken = Object.keys(cast.spells ?? {});
      if (taken.length !== 1 || taken[0] !== o.slot)
        bad(
          problems,
          'SYSTEM',
          `${o.spell} slot`,
          `slots that changed: ${taken.join(', ') || 'none'}, expected ${o.slot}`
        );
      o.judgeScaled({ cast, problems, notes });
    },
  });
}

/** @type {SpellCheck[]} */
export const DEEP_SPELL_CHECKS = [
  // 1-2. Spell attack rolls.
  attackCheck({
    id: 'attack-ranged',
    title: 'Fire Bolt: a ranged spell attack adds proficiency and the casting ability',
    spell: 'Fire Bolt',
    kind: 'ranged',
  }),
  attackCheck({
    id: 'attack-melee',
    title: 'Shocking Grasp: a melee spell attack adds proficiency and the casting ability',
    spell: 'Shocking Grasp',
    kind: 'melee',
  }),

  // 3. The save DC.
  oneCast({
    id: 'save-dc',
    title: 'Burning Hands: the save DC is 8 + proficiency + the casting ability',
    spells: ['Burning Hands'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid }] }),
    judge({ cast, res, problems, notes }) {
      const save = cast.facts.save;
      if (!save?.ability?.includes('dex'))
        bad(
          problems,
          'CONTENT',
          'Burning Hands save',
          `the save is ${save?.ability?.join(',') ?? 'missing'}, the rules say dex`
        );
      const want = 8 + (res.caster?.prof ?? 0) + (res.caster?.abilityMod ?? 0);
      expectEqual(
        problems,
        'SYSTEM',
        'Burning Hands save DC',
        save?.dc ?? null,
        want,
        ` (the actor says ${res.caster?.dc})`
      );
      notes.push(`DC ${save?.dc}, rule ${want}`);
    },
  }),

  // 4. A save for half damage.
  oneCast({
    id: 'save-half',
    title: 'Fireball: 8d6 fire, a Dexterity save for half damage',
    spells: ['Fireball'],
    who: ctx => ctx.caster(3),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, rolls: ['damage'] }] }),
    judge({ cast, problems, notes }) {
      const d = part(cast);
      expectEqual(problems, 'CONTENT', 'Fireball dice', `${d?.number}d${d?.denomination}`, '8d6');
      expectEqual(problems, 'CONTENT', 'Fireball damage type', d?.types?.join(','), 'fire');
      expectEqual(problems, 'CONTENT', 'Fireball on a save', cast.facts.save?.onSave, 'half');
      if (!cast.facts.save?.ability?.includes('dex'))
        bad(
          problems,
          'CONTENT',
          'Fireball save',
          `the save is ${cast.facts.save?.ability?.join(',')}, the rules say dex`
        );
      const roll = cast.rolled?.damage?.[0];
      if (!roll)
        bad(problems, 'SYSTEM', 'Fireball damage roll', cast.rolled?.damageError ?? 'no roll');
      else {
        expectEqual(problems, 'SYSTEM', 'Fireball rolled dice', diceText(roll), '8d6');
        if (roll.total < 8 || roll.total > 48)
          bad(problems, 'SYSTEM', 'Fireball damage total', `${roll.total} is outside 8 to 48`);
        notes.push(`rolled ${roll.total}`);
      }
    },
  }),

  // 5. A save that negates, with a condition applied (and removed by the restore).
  oneCast({
    id: 'save-negates',
    title: 'Hold Person: a Wisdom save, no damage, the paralyzed condition on a failure',
    spells: ['Hold Person'],
    who: ctx => ctx.caster(2),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, apply: true, effectName: 'Paralyzed' }] }),
    judge({ cast, res, problems, notes }) {
      if (!cast.facts.save?.ability?.includes('wis'))
        bad(
          problems,
          'CONTENT',
          'Hold Person save',
          `the save is ${cast.facts.save?.ability?.join(',')}, the rules say wis`
        );
      if (cast.facts.damage.length)
        bad(
          problems,
          'CONTENT',
          'Hold Person damage',
          'the spell has a damage part, the rules give none'
        );
      if (!cast.facts.effects.some((/** @type {any} */ e) => e.statuses.includes('paralyzed')))
        bad(problems, 'CONTENT', 'Hold Person effect', 'no effect carries the paralyzed condition');
      if (!cast.applied?.statuses?.includes('paralyzed'))
        bad(
          problems,
          'SYSTEM',
          'Hold Person condition',
          `after applying the effect the statuses are ${cast.applied?.statuses?.join(',') || 'none'}`
        );
      notes.push(`statuses ${cast.applied?.statuses?.join(',')}; restored ${res.restored}`);
    },
  }),

  // 6-10. Area templates.
  areaCheck({
    id: 'template-sphere',
    title: 'Fireball: a 20 ft sphere makes a circle Region',
    spell: 'Fireball',
    type: 'sphere',
    size: '20',
    shape: 'circle',
  }),
  areaCheck({
    id: 'template-cone',
    title: 'Burning Hands: a 15 ft cone makes a cone Region',
    spell: 'Burning Hands',
    type: 'cone',
    size: '15',
    shape: 'cone',
  }),
  areaCheck({
    id: 'template-line',
    title: 'Lightning Bolt: a 100 ft line makes a line Region',
    spell: 'Lightning Bolt',
    type: 'line',
    size: '100',
    shape: 'line',
  }),
  areaCheck({
    id: 'template-cube',
    title: 'Thunderwave: a 15 ft cube makes a rectangle Region',
    spell: 'Thunderwave',
    type: 'cube',
    size: '15',
    shape: 'rectangle',
  }),
  areaCheck({
    id: 'template-wall',
    title: 'Wall of Fire: a wall of 60 ft makes a line Region',
    spell: 'Wall of Fire',
    type: 'wall',
    size: '60',
    shape: 'line',
  }),

  // 11-13. Concentration.
  oneCast({
    id: 'concentration-begin',
    title: 'Bless: casting begins concentration (one effect) and takes a 1st level slot',
    spells: ['Bless'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid }] }),
    judge({ cast, problems, notes }) {
      if (!cast.facts.concentration)
        bad(problems, 'CONTENT', 'Bless concentration', 'the activity does not need concentration');
      expectEqual(problems, 'SYSTEM', 'Bless concentration effects', cast.concentrating?.length, 1);
      expectEqual(
        problems,
        'SYSTEM',
        'Bless slot',
        cast.slotAfter?.value,
        (cast.slotBefore?.value ?? 0) - 1
      );
      notes.push(`concentrating: ${cast.concentrating?.join(', ')}`);
    },
  }),
  {
    id: 'concentration-replace',
    title: 'A second concentration spell ends the first (Bless, then Hold Person)',
    spells: ['Bless', 'Hold Person'],
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const who = await ctx.caster(2);
      if (!who) return { ...out, skip: 'no caster hero' };
      const [a, b] = ['Bless', 'Hold Person'].map(n => /** @type {SpellEntry} */ (ctx.find(n)));
      const res = await ctx.exercise(who, { casts: [{ uuid: a.uuid }, { uuid: b.uuid }] });
      const first = usable(out.problems, res, 'Bless', 0);
      const second = usable(out.problems, res, 'Hold Person', 1);
      if (first && second) {
        expectEqual(
          out.problems,
          'SYSTEM',
          'concentration effects after the second spell',
          second.concentrating?.length,
          1
        );
        if (second.concentrating?.[0] && second.concentrating[0] === first.concentrating?.[0])
          bad(
            out.problems,
            'SYSTEM',
            'concentration replaced',
            'the effect of the first spell is still the one concentrated on'
          );
        out.notes.push(`${first.concentrating?.join(',')} -> ${second.concentrating?.join(',')}`);
      }
      return out;
    },
  },
  oneCast({
    id: 'concentration-none',
    title: 'Magic Missile: an instant spell does not begin concentration',
    spells: ['Magic Missile'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid }] }),
    judge({ cast, problems }) {
      expectEqual(
        problems,
        'SYSTEM',
        'Magic Missile concentration effects',
        cast.concentrating?.length ?? 0,
        0
      );
    },
  }),

  // 14-16. Upcasting: more dice, more targets, more healing at a higher slot.
  upcastCheck({
    id: 'upcast-dice',
    title: 'Burning Hands at a 3rd level slot: 5d6 (one more die per level)',
    spell: 'Burning Hands',
    slot: 'spell3',
    rolls: ['damage'],
    judgeScaled({ cast, problems, notes }) {
      const roll = cast.rolled?.damage?.[0];
      if (!roll)
        return void bad(
          problems,
          'SYSTEM',
          'Burning Hands damage roll',
          cast.rolled?.damageError ?? 'no roll'
        );
      expectEqual(problems, 'SYSTEM', 'Burning Hands dice at level 3', diceText(roll), '5d6');
      notes.push(`rolled ${diceText(roll)}`);
    },
  }),
  upcastCheck({
    id: 'upcast-targets',
    title: 'Magic Missile at a 3rd level slot: 5 darts instead of 3, each 1d4 + 1',
    spell: 'Magic Missile',
    slot: 'spell3',
    rolls: ['damage'],
    judgeScaled({ cast, problems, notes }) {
      expectEqual(
        problems,
        'CONTENT',
        'Magic Missile darts at level 1',
        cast.facts.target.resolvedCount,
        3
      );
      expectEqual(
        problems,
        'SYSTEM',
        'Magic Missile darts at level 3',
        cast.scaled?.target?.resolvedCount,
        5
      );
      const roll = cast.rolled?.damage?.[0];
      if (roll) expectEqual(problems, 'SYSTEM', 'Magic Missile dart dice', diceText(roll), '1d4');
      notes.push(
        `darts ${cast.facts.target.resolvedCount} -> ${cast.scaled?.target?.resolvedCount}`
      );
    },
  }),
  upcastCheck({
    id: 'upcast-heal',
    title: 'Cure Wounds at a 3rd level slot: 6d8 (2d8 more per level)',
    spell: 'Cure Wounds',
    slot: 'spell3',
    rolls: ['heal'],
    judgeScaled({ cast, problems, notes }) {
      const roll = cast.rolled?.heal?.[0];
      if (!roll)
        return void bad(
          problems,
          'SYSTEM',
          'Cure Wounds heal roll',
          cast.rolled?.healError ?? 'no roll'
        );
      expectEqual(problems, 'SYSTEM', 'Cure Wounds dice at level 3', diceText(roll), '6d8');
      notes.push(`rolled ${diceText(roll)}`);
    },
  }),

  // 17-18. Healing and temporary hit points.
  oneCast({
    id: 'heal-roll',
    title: 'Cure Wounds: 2d8 plus the casting ability, a healing roll',
    spells: ['Cure Wounds'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, rolls: ['heal'] }] }),
    judge({ cast, res, problems, notes }) {
      const part0 = cast.facts.healing?.[0];
      expectEqual(
        problems,
        'CONTENT',
        'Cure Wounds dice',
        `${part0?.number}d${part0?.denomination}`,
        '2d8'
      );
      const roll = cast.rolled?.heal?.[0];
      if (!roll)
        return void bad(
          problems,
          'SYSTEM',
          'Cure Wounds heal roll',
          cast.rolled?.healError ?? 'no roll'
        );
      expectEqual(problems, 'SYSTEM', 'Cure Wounds rolled dice', diceText(roll), '2d8');
      const mod = res.caster?.abilityMod ?? 0;
      if (roll.total < 2 + mod || roll.total > 16 + mod)
        bad(
          problems,
          'SYSTEM',
          'Cure Wounds total',
          `${roll.total} is outside ${2 + mod} to ${16 + mod}`
        );
      if (!roll.types.includes('healing'))
        bad(
          problems,
          'SYSTEM',
          'Cure Wounds type',
          `the roll type is ${roll.types.join(',') || 'none'}`
        );
      notes.push(`rolled ${roll.total} (mod ${mod})`);
    },
  }),
  oneCast({
    id: 'temp-hp',
    title: 'False Life: a 2d4 + 4 healing roll of temporary hit points, applied to the caster',
    spells: ['False Life'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, rolls: ['heal'], applyTemp: true }] }),
    judge({ cast, problems, notes }) {
      const h = cast.facts.healing?.[0];
      if (!h?.types?.includes('temphp'))
        bad(
          problems,
          'CONTENT',
          'False Life healing type',
          `the type is ${h?.types?.join(',') ?? 'missing'}, the rules say temporary hit points`
        );
      const roll = cast.rolled?.heal?.[0];
      if (!roll)
        return void bad(
          problems,
          'SYSTEM',
          'False Life heal roll',
          cast.rolled?.healError ?? 'no roll'
        );
      expectEqual(problems, 'SYSTEM', 'False Life rolled dice', diceText(roll), '2d4');
      if (roll.total < 6 || roll.total > 12)
        bad(problems, 'SYSTEM', 'False Life total', `${roll.total} is outside 6 to 12 (2d4 + 4)`);
      expectEqual(problems, 'SYSTEM', 'False Life temporary hit points', cast.hp?.temp, roll.total);
      notes.push(`temp ${cast.hp?.temp} from a roll of ${roll.total}`);
    },
  }),

  // 19. Teleport.
  oneCast({
    id: 'teleport',
    title: 'Misty Step: a teleport activity, cast with a 2nd level slot',
    spells: ['Misty Step'],
    who: ctx => ctx.caster(2),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid }] }),
    judge({ cast, problems }) {
      expectEqual(problems, 'CONTENT', 'Misty Step activity', cast.facts.type, 'teleport');
      expectEqual(
        problems,
        'SYSTEM',
        'Misty Step slot',
        cast.slotAfter?.value,
        (cast.slotBefore?.value ?? 0) - 1
      );
      if (!cast.chatCard) bad(problems, 'SYSTEM', 'Misty Step card', 'no chat card');
    },
  }),

  // 20-22. Effects on the caster: a reaction, an armor formula, bonus dice.
  oneCast({
    id: 'reaction-shield',
    title: 'Shield: a reaction that adds 5 to Armor Class',
    spells: ['Shield'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, apply: true }] }),
    judge({ cast, problems, notes }) {
      expectEqual(problems, 'CONTENT', 'Shield activation', cast.facts.itemActivation, 'reaction');
      const was = cast.applied?.before?.[AC]?.value;
      const now = cast.applied?.during?.[AC]?.value;
      if (typeof was !== 'number' || typeof now !== 'number')
        return void bad(
          problems,
          'KIT',
          'Shield Armor Class',
          `could not read Armor Class (${was}, ${now})`
        );
      expectEqual(problems, 'SYSTEM', 'Shield Armor Class change', now - was, 5);
      notes.push(`AC ${was} -> ${now}`);
    },
  }),
  oneCast({
    id: 'mage-armor',
    title: 'Mage Armor: Armor Class 13 + Dexterity for a hero with no armor',
    spells: ['Mage Armor'],
    who: ctx => ctx.unarmored(),
    none: 'no hero without armor in this kit',
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, apply: true }] }),
    judge({ cast, who, problems, notes }) {
      const now = cast.applied?.during?.[AC]?.value;
      const want = 13 + (who.facts.abilities?.dex?.mod ?? 0);
      expectEqual(
        problems,
        'SYSTEM',
        'Mage Armor Armor Class',
        now,
        want,
        ` (Dexterity modifier ${who.facts.abilities?.dex?.mod})`
      );
      notes.push(`AC ${cast.applied?.before?.[AC]?.value} -> ${now}`);
    },
  }),
  oneCast({
    id: 'bless-effects',
    title: 'Bless: +1d4 to attack rolls and saving throws while it lasts',
    spells: ['Bless'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({
      casts: [
        {
          uuid: e.uuid,
          apply: true,
          read: [
            'system.rolls.attack.mwak.bonus',
            'system.rolls.ability.save.bonus',
            'system.bonuses.mwak.attack',
            'system.bonuses.abilities.save',
          ],
        },
      ],
    }),
    judge({ cast, problems, notes }) {
      const keys = cast.facts.effects.flatMap((/** @type {any} */ e) =>
        e.changes.map((/** @type {any} */ c) => `${c.key}=${c.value}`)
      );
      if (!keys.some((/** @type {string} */ k) => /mwak.attack=1d4/.test(k)))
        bad(
          problems,
          'CONTENT',
          'Bless attack bonus',
          `no change adds 1d4 to melee weapon attacks (${keys.length} changes)`
        );
      const during = cast.applied?.during ?? {};
      const has = (/** @type {string[]} */ paths) =>
        paths.some(p => String(during[p]?.value ?? '').includes('1d4'));
      if (!has(['system.rolls.attack.mwak.bonus', 'system.bonuses.mwak.attack']))
        bad(
          problems,
          'SYSTEM',
          'Bless attack bonus',
          'the actor has no 1d4 attack bonus while the effect is on'
        );
      if (!has(['system.rolls.ability.save.bonus', 'system.bonuses.abilities.save']))
        bad(
          problems,
          'SYSTEM',
          'Bless save bonus',
          'the actor has no 1d4 saving throw bonus while the effect is on'
        );
      notes.push(`${keys.length} changes`);
    },
  }),

  // 23-24. Rituals and cantrips take no slot.
  {
    id: 'ritual-no-slot',
    title: 'Detect Magic: cast normally it takes a 1st level slot, cast as a ritual it takes none',
    spells: ['Detect Magic'],
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const who = await ctx.caster(1);
      if (!who) return { ...out, skip: 'no caster hero' };
      const e = /** @type {SpellEntry} */ (ctx.find('Detect Magic'));
      if (!e.ritual)
        bad(out.problems, 'CONTENT', 'Detect Magic ritual', 'the spell lacks the ritual property');
      const res = await ctx.exercise(who, {
        casts: [
          { uuid: e.uuid, as: 'spell' },
          { uuid: e.uuid, as: 'ritual' },
        ],
      });
      const normal = usable(out.problems, res, 'Detect Magic (normal)', 0);
      const ritual = usable(out.problems, res, 'Detect Magic (ritual)', 1);
      if (normal)
        expectEqual(
          out.problems,
          'SYSTEM',
          'normal cast slot',
          normal.slotAfter?.value,
          (normal.slotBefore?.value ?? 0) - 1
        );
      if (ritual) {
        const taken = Object.keys(ritual.spells ?? {});
        if (taken.length)
          bad(
            out.problems,
            'SYSTEM',
            'ritual cast slot',
            `a ritual cast changed ${taken.join(', ')}`
          );
        out.notes.push(
          `normal took ${Object.keys(normal?.spells ?? {}).join(',') || 'nothing'}, ritual took ${taken.join(',') || 'nothing'}`
        );
      }
      return out;
    },
  },
  oneCast({
    id: 'cantrip-no-slot',
    title: 'Fire Bolt: a cantrip takes no slot',
    spells: ['Fire Bolt'],
    who: ctx => ctx.caster(0),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid }] }),
    judge({ cast, problems }) {
      const taken = Object.keys(cast.spells ?? {});
      if (taken.length)
        bad(problems, 'SYSTEM', 'cantrip slot', `a cantrip changed ${taken.join(', ')}`);
      expectEqual(problems, 'CONTENT', 'Fire Bolt level', cast.level, 0);
    },
  }),

  // 25. Cantrip damage by character level.
  {
    id: 'cantrip-scaling',
    title: 'Fire Bolt: 1d10 at level 1, 2d10 at 5, 3d10 at 11, 4d10 at 17',
    spells: ['Fire Bolt'],
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const e = /** @type {SpellEntry} */ (ctx.find('Fire Bolt'));
      const tried = [];
      for (const [level, dice] of [
        [1, 1],
        [5, 2],
        [11, 3],
        [17, 4],
      ]) {
        const who = await ctx.heroAtLevel(level);
        if (!who) continue;
        const res = await ctx.exercise(who, { casts: [{ uuid: e.uuid, rolls: ['damage'] }] });
        const cast = usable(out.problems, res, `Fire Bolt at level ${level}`);
        if (!cast) continue;
        const roll = cast.rolled?.damage?.[0];
        if (!roll) {
          bad(
            out.problems,
            'SYSTEM',
            `Fire Bolt damage at level ${level}`,
            cast.rolled?.damageError ?? 'no roll'
          );
          continue;
        }
        tried.push(`${level}: ${diceText(roll)}`);
        expectEqual(
          out.problems,
          'SYSTEM',
          `Fire Bolt dice at level ${level}`,
          diceCount(roll, 10),
          dice
        );
      }
      if (!tried.length)
        return { ...out, skip: 'no hero of level 1, 5, 11 or 17 in this kit size' };
      out.notes.push(tried.join('; '));
      return out;
    },
  },

  // 26. Pact Magic.
  oneCast({
    id: 'pact-slot',
    title: 'Hex cast with Pact Magic: takes a pact slot and casts at the pact slot level',
    spells: ['Hex'],
    who: async ctx => {
      const w = await ctx.byClass('warlock');
      return w && (w.facts.spells?.pact?.max ?? 0) > 0 ? w : null;
    },
    none: 'no warlock hero with pact slots in this kit',
    cast: ([e]) => ({
      casts: [{ uuid: e.uuid, as: 'pact', slot: 'pact', activityType: 'utility' }],
    }),
    judge({ cast, problems, notes }) {
      expectEqual(
        problems,
        'SYSTEM',
        'pact slot taken',
        cast.slotAfter?.value,
        (cast.slotBefore?.value ?? 0) - 1
      );
      const taken = Object.keys(cast.spells ?? {});
      if (taken.length !== 1 || taken[0] !== 'pact')
        bad(
          problems,
          'SYSTEM',
          'pact slot only',
          `slots that changed: ${taken.join(', ') || 'none'}`
        );
      const level = cast.slotBefore?.level ?? 0;
      expectEqual(problems, 'SYSTEM', 'pact slot level', cast.scaling, level - cast.level);
      notes.push(`pact level ${level}, scaling ${cast.scaling}`);
    },
  }),

  // 27-28. Which slot, and no slot left.
  oneCast({
    id: 'slot-choice',
    title: 'Cure Wounds with a 2nd level slot takes the 2nd level slot and not the 1st',
    spells: ['Cure Wounds'],
    who: ctx => ctx.caster(2),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, slot: 'spell2' }] }),
    judge({ cast, problems }) {
      const taken = Object.keys(cast.spells ?? {});
      if (taken.length !== 1 || taken[0] !== 'spell2')
        bad(
          problems,
          'SYSTEM',
          'slot choice',
          `slots that changed: ${taken.join(', ') || 'none'}, expected spell2`
        );
    },
  }),
  {
    id: 'no-slot-refused',
    title: 'Burning Hands with no 1st level slot left is refused and posts nothing',
    spells: ['Burning Hands'],
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const who = await ctx.caster(1);
      if (!who) return { ...out, skip: 'no caster hero' };
      const e = /** @type {SpellEntry} */ (ctx.find('Burning Hands'));
      const res = await ctx.exercise(who, {
        slots: { spell1: 0 },
        casts: [{ uuid: e.uuid, noForce: true }],
      });
      const cast = res.casts?.[0];
      if (res.error || !cast) {
        bad(out.problems, 'KIT', 'the GM action failed', res.error ?? 'no cast');
        return out;
      }
      if (cast.threw) bad(out.problems, 'SYSTEM', 'the cast threw', cast.threw);
      else if (cast.ok)
        bad(
          out.problems,
          'SYSTEM',
          'cast with no slot',
          'the system let the cast through with no 1st level slot left'
        );
      else if (cast.chatCard)
        bad(out.problems, 'SYSTEM', 'refused cast card', 'a refused cast still posted a chat card');
      if (
        !cast.threw &&
        !cast.ok &&
        !(cast.notes ?? []).some((/** @type {any} */ n) => n.level === 'error')
      )
        bad(out.problems, 'SYSTEM', 'refusal message', 'the system refused without saying why');
      if (Object.keys(cast.spells ?? {}).length)
        bad(
          out.problems,
          'SYSTEM',
          'refused cast slots',
          `a refused cast changed ${Object.keys(cast.spells).join(', ')}`
        );
      if (res.restored === false)
        bad(out.problems, 'KIT', 'the hero was not put back', (res.drift ?? []).join(', '));
      out.notes.push((cast.notes ?? []).map((/** @type {any} */ n) => n.message).join(' / '));
      return out;
    },
  },

  // 29. Summons, in a check of their own: placed, then cleaned up.
  {
    id: 'summon-placed',
    title: 'Flaming Sphere: the summon is placed on the scene and cleaned up again',
    spells: ['Flaming Sphere'],
    async run(ctx) {
      /** @type {SpellOutcome} */
      const out = { problems: [], notes: [] };
      const who = await ctx.caster(2);
      if (!who) return { ...out, skip: 'no caster hero' };
      const e = /** @type {SpellEntry} */ (ctx.find('Flaming Sphere'));
      const res = await ctx.exercise(who, { casts: [{ uuid: e.uuid, summon: true }] });
      const cast = usable(out.problems, res, 'Flaming Sphere');
      if (!cast) return out;
      if (cast.summoned?.skipped) return { ...out, skip: cast.summoned.skipped };
      if (!(cast.summoned?.placed >= 1))
        bad(out.problems, 'SYSTEM', 'summon placed', 'the summon activity placed no token');
      out.notes.push(
        `placed ${cast.summoned?.tokens?.join(', ')}; the scene and the world were put back: ${res.restored}`
      );
      return out;
    },
  },

  // 30. A spell scroll.
  oneCast({
    id: 'scroll',
    title: 'A Fireball scroll: cast from the scroll, takes no slot, uses the scroll up',
    spells: ['Fireball'],
    who: ctx => ctx.caster(3),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, scroll: { level: 3 } }] }),
    judge({ cast, problems, notes }) {
      const taken = Object.keys(cast.spells ?? {});
      if (taken.length)
        bad(problems, 'SYSTEM', 'scroll slot', `casting from a scroll changed ${taken.join(', ')}`);
      if (!cast.chatCard) bad(problems, 'SYSTEM', 'scroll card', 'no chat card');
      const used = !cast.itemLeft || (cast.itemUses?.spent ?? 0) >= 1;
      if (!used)
        bad(problems, 'SYSTEM', 'scroll used up', 'the scroll is still there with no use spent');
      notes.push(
        `scroll left: ${cast.itemLeft}, uses ${cast.itemUses?.spent}/${cast.itemUses?.max}`
      );
    },
  }),

  // 31. A spell that cannot miss.
  oneCast({
    id: 'auto-hit-damage',
    title: 'Magic Missile: a damage activity (no attack, no save), 1d4 + 1 force',
    spells: ['Magic Missile'],
    who: ctx => ctx.caster(1),
    cast: ([e]) => ({ casts: [{ uuid: e.uuid, rolls: ['damage'] }] }),
    judge({ cast, problems, notes }) {
      expectEqual(problems, 'CONTENT', 'Magic Missile activity', cast.facts.type, 'damage');
      const d = part(cast);
      expectEqual(problems, 'CONTENT', 'Magic Missile damage type', d?.types?.join(','), 'force');
      const roll = cast.rolled?.damage?.[0];
      if (!roll)
        return void bad(
          problems,
          'SYSTEM',
          'Magic Missile damage roll',
          cast.rolled?.damageError ?? 'no roll'
        );
      if (roll.total < 2 || roll.total > 5)
        bad(
          problems,
          'SYSTEM',
          'Magic Missile dart',
          `a dart rolled ${roll.total}, 1d4 + 1 gives 2 to 5`
        );
      notes.push(`dart ${roll.formula} = ${roll.total}`);
    },
  }),
];

/**
 * Runs one deep check: skipped when the profile lacks one of its spells, and a check that throws is
 * a KIT problem (the check is broken, not the content).
 * @param {SpellCheck} check
 * @param {SpellCtx} ctx
 * @returns {Promise<SpellOutcome>}
 */
export async function runSpellCheck(check, ctx) {
  const missing = check.spells.filter(name => !ctx.find(name));
  if (missing.length)
    return { problems: [], notes: [], skip: `no example in this profile: ${missing.join(', ')}` };
  try {
    return await check.run(ctx);
  } catch (e) {
    return {
      problems: [
        {
          kind: 'KIT',
          what: 'the check could not run',
          evidence: e instanceof Error ? e.message : String(e),
        },
      ],
      notes: [],
    };
  }
}

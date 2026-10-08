/**
 * The player-character-creation scenario's helpers: what a level-1 character sheet holds (read on
 * the GM page), the class spell list from the system's registry, and the judge that turns both into
 * problems. The judge is pure, so the unit tests cover it without Foundry.
 */

/** The Player role (CONST.USER_ROLES.PLAYER). */
export const PLAYER_ROLE = 1;

/**
 * What a new character holds, read on the GM page.
 * @typedef {{
 *   name: string, ownership: Record<string, number>, level: number,
 *   classes: Array<{identifier: string, levels: number, hitDie: number, firstLevelHp: unknown}>,
 *   species: string[], backgrounds: string[],
 *   hp: {value: number, max: number}, conMod: number, ac: number, gp: number,
 *   items: Array<{name: string, type: string}>,
 *   spells: Array<{name: string, identifier: string, level: number}>,
 *   armor: Array<{name: string, equipped: boolean}>
 * }} Sheet
 */

/**
 * @param {import('playwright-core').Page} page  the GM page
 * @param {string} actorId
 * @returns {Promise<Sheet>}
 */
export function readSheet(page, actorId) {
  return page.evaluate(id => {
    const a = game.actors.get(id);
    if (!a) throw new Error(`no actor ${id}`);
    const items = [...a.items];
    const armorTypes = ['light', 'medium', 'heavy'];
    return {
      name: a.name,
      ownership: { ...a.ownership },
      level: a.system.details.level,
      classes: items
        .filter(i => i.type === 'class')
        .map(i => ({
          identifier: i.system.identifier,
          levels: i.system.levels,
          hitDie: Number(String(i.system.hd?.denomination ?? '').replace(/^d/, '')) || 0,
          // The HitPoints advancement's answer for level 1: 'max' (a first level always takes the most).
          firstLevelHp:
            i.system.advancement?.find?.(adv => adv.type === 'HitPoints')?.value?.['1'] ?? null,
        })),
      species: items.filter(i => i.type === 'race').map(i => i.name),
      backgrounds: items.filter(i => i.type === 'background').map(i => i.name),
      hp: { value: a.system.attributes.hp.value, max: a.system.attributes.hp.max },
      conMod: a.system.abilities.con.mod,
      ac: a.system.attributes.ac?.value ?? 0,
      gp: a.system.currency?.gp ?? 0,
      items: items.map(i => ({ name: i.name, type: i.type })),
      spells: items
        .filter(i => i.type === 'spell')
        .map(i => ({ name: i.name, identifier: i.system.identifier, level: i.system.level })),
      armor: items
        .filter(i => i.type === 'equipment' && armorTypes.includes(i.system.type?.value))
        .map(i => ({ name: i.name, equipped: !!i.system.equipped })),
    };
  }, actorId);
}

/**
 * The spell identifiers on a class's spell list (the system's registry merges every module's lists),
 * or null when the class has none. The registry fills itself after the world loads, so it is
 * asked again for a few seconds.
 * @param {import('playwright-core').Page} page
 * @param {string} classIdentifier
 * @returns {Promise<string[] | null>}
 */
export function spellListOf(page, classIdentifier) {
  return page.evaluate(async id => {
    const reg = globalThis.dnd5e?.registry?.spellLists;
    if (!reg) return null;
    for (let i = 0; i < 20; i += 1) {
      const list = reg.forType('class', id);
      if (list) return [...list.identifiers];
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }, classIdentifier);
}

/**
 * The checks on one new character. Problems fail the step; notes are only reported.
 * @param {{sheet: Sheet, playerId: string, classIdentifier: string, planned: string[],
 *   spellList: string[] | null, pumpErrors?: string[]}} o
 * @returns {{problems: Array<{what: string, evidence: string}>, notes: string[]}}
 */
export function judgeSheet({
  sheet,
  playerId,
  classIdentifier,
  planned,
  spellList,
  pumpErrors = [],
}) {
  /** @type {Array<{what: string, evidence: string}>} */
  const problems = [];
  const notes = [];
  const bad = (/** @type {string} */ what, /** @type {string} */ evidence) =>
    problems.push({ what, evidence });

  if (sheet.ownership[playerId] !== 3) {
    bad('the player does not own the character', `ownership ${JSON.stringify(sheet.ownership)}`);
  }
  if (sheet.level !== 1) bad('the character is not level 1', `level ${sheet.level}`);
  const cls = sheet.classes;
  if (cls.length !== 1 || cls[0].identifier !== classIdentifier || cls[0].levels !== 1) {
    bad(
      `the character does not have exactly one level of ${classIdentifier}`,
      cls.map(c => `${c.identifier} ${c.levels}`).join(', ') || 'no class'
    );
  }
  if (sheet.species.length !== 1)
    bad('the character has no species', sheet.species.join(', ') || 'none');
  if (sheet.backgrounds.length !== 1)
    bad('the character has no background', sheet.backgrounds.join(', ') || 'none');
  const hitDie = cls[0]?.hitDie ?? 0;
  if (hitDie) {
    // The total can be higher (the Tough feat, a species trait), never lower.
    const least = Math.max(1, hitDie + sheet.conMod);
    if (sheet.hp.max < least)
      bad(
        'hit points at level 1',
        `max ${sheet.hp.max}, at least d${hitDie} + Con ${sheet.conMod} = ${least}`
      );
    if (cls[0].firstLevelHp !== 'max')
      bad(
        'level 1 does not take the full hit die',
        `HitPoints advancement level 1: ${JSON.stringify(cls[0].firstLevelHp)}`
      );
    if (sheet.hp.value !== sheet.hp.max)
      bad(
        'the character does not start at full hit points',
        `${sheet.hp.value} of ${sheet.hp.max}`
      );
  }
  const names = new Set(sheet.items.map(i => i.name));
  const missing = planned.filter(n => !names.has(n));
  if (missing.length) bad('planned starting equipment is not on the sheet', missing.join(', '));
  if (spellList) {
    const allowed = new Set(spellList);
    const off = sheet.spells.filter(s => !allowed.has(s.identifier));
    if (off.length)
      bad(
        `spells that are not on the ${classIdentifier} spell list`,
        `${off.length} of ${sheet.spells.length}: ${off.map(s => s.name).join(', ')}`
      );
  }
  for (const e of pumpErrors) bad('an advancement answer failed', e);

  if (sheet.armor.length && !sheet.armor.some(a => a.equipped)) {
    notes.push(
      `the starting armor arrives unequipped (${sheet.armor.map(a => a.name).join(', ')}; AC ${sheet.ac}): the player equips it on the sheet`
    );
  }
  notes.push(
    `${sheet.items.length} items, ${sheet.spells.length} spells, ${sheet.gp} gp, AC ${sheet.ac}`
  );
  return { problems, notes };
}

/**
 * The table's Actor Studio settings for players building at session 0: the kit's settings (see
 * studio.mjs) with the starting equipment choices on, and the class, species and background lists
 * narrowed to the packs a player picks from.
 * @param {ReturnType<typeof import('./studio.mjs').studioSettingsFor>} base
 * @param {{species: string, background: string, class: string}} packs
 * @param {(sources: any, packs: any) => any} narrow  studio.mjs narrowSources
 */
export function playerStudioSettings(base, packs, narrow) {
  return {
    ...base,
    enableEquipmentSelection: true,
    compendiumSources: narrow(base.compendiumSources, packs),
  };
}

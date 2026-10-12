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
 *   species: string[], speciesSources?: Array<string | null>, backgrounds: string[],
 *   hp: {value: number, max: number}, conMod: number, ac: number, gp: number,
 *   items: Array<{name: string, type: string}>,
 *   duplicates?: Array<{name: string, types: string[], count: number, origins: Array<string | null>}>,
 *   classSources?: Array<string | null>, backgroundSources?: Array<string | null>,
 *   spells: Array<{name: string, identifier: string, level: number, origin: string | null}>,
 *   armor: Array<{name: string, equipped: boolean}>,
 *   abilities?: Record<string, number>, saves?: string[], prof?: number, skills?: string[],
 *   tools?: string[], languages?: string[], weaponProf?: string[], armorProf?: string[],
 *   expect?: Expectations
 * }} Sheet
 */

/**
 * What the picked class, species and background promise at level 1, read from their own Trait
 * advancements (default mode only: expertise and weapon mastery are not new proficiencies).
 * `grants` are fixed, `choose` counts what the player picks from a pool.
 * @typedef {{
 *   saves: string[], weapons: string[], armor: string[],
 *   skills: {grants: string[], choose: number, pools?: string[][], poolCounts?: number[]},
 *   tools: {grants: string[], choose: number},
 *   languages: {grants: string[], choose: number}
 * }} Expectations
 */

/**
 * @param {import('playwright-core').Page} page  the GM page
 * @param {string} actorId
 * @returns {Promise<Sheet>}
 */
export async function readSheet(page, actorId) {
  const { copies, advancementItems, ...sheet } = await page.evaluate(id => {
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
      // The compendium entry each species item was copied from (the uuid the player picked).
      speciesSources: items
        .filter(i => i.type === 'race')
        .map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId ?? null),
      backgrounds: items.filter(i => i.type === 'background').map(i => i.name),
      hp: { value: a.system.attributes.hp.value, max: a.system.attributes.hp.max },
      conMod: a.system.abilities.con.mod,
      ac: a.system.attributes.ac?.value ?? 0,
      gp: a.system.currency?.gp ?? 0,
      items: items.map(i => ({ name: i.name, type: i.type })),
      // Each item's type, whether dnd5e keeps it for a Cast activity, and what granted it (the
      // advancement's item, else the raw flag, else null); findDuplicates reads these.
      copies: items.map(i => {
        const flag = i.flags?.dnd5e?.advancementOrigin;
        const granter = flag ? a.items.get(String(flag).split('.')[0]) : null;
        return {
          name: i.name,
          type: i.type,
          cached: !!i.flags?.dnd5e?.cachedFor,
          origin: !flag ? null : granter ? `${granter.type}:${granter.name}` : String(flag),
        };
      }),
      // Where each class and background item was copied from (the uuids the player picked).
      classSources: items
        .filter(i => i.type === 'class')
        .map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId ?? null),
      backgroundSources: items
        .filter(i => i.type === 'background')
        .map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId ?? null),
      // Where a spell came from: the item whose advancement granted it (a species trait, a feat),
      // else the system's sourceItem ('race:forest-gnome'), else null. Actor Studio's Spells tab
      // sets neither, so its picks (the class's spells) read null.
      spells: items
        .filter(i => i.type === 'spell')
        .map(i => {
          const flag = i.flags?.dnd5e?.advancementOrigin;
          const granter = flag ? a.items.get(String(flag).split('.')[0]) : null;
          const origin = granter
            ? `${granter.type}:${granter.system.identifier ?? granter.name}`
            : i.system.sourceItem
              ? String(i.system.sourceItem)
              : null;
          return { name: i.name, identifier: i.system.identifier, level: i.system.level, origin };
        }),
      armor: items
        .filter(i => i.type === 'equipment' && armorTypes.includes(i.system.type?.value))
        .map(i => ({ name: i.name, equipped: !!i.system.equipped })),
      abilities: Object.fromEntries(
        Object.entries(a.system.abilities).map(([k, v]) => [k, v.value])
      ),
      saves: Object.entries(a.system.abilities)
        .filter(([, v]) => v.proficient)
        .map(([k]) => k),
      prof: a.system.attributes.prof,
      skills: Object.entries(a.system.skills)
        .filter(([, v]) => v.value > 0)
        .map(([k]) => k),
      tools: Object.entries(a.system.tools ?? {})
        .filter(([, v]) => v.value > 0)
        .map(([k]) => k),
      languages: [...a.system.traits.languages.value],
      weaponProf: [...a.system.traits.weaponProf.value],
      armorProf: [...a.system.traits.armorProf.value],
      // The Trait advancements of the picked class, species and background as plain data; the
      // pure expectationsFromItems turns them into what the character must have.
      advancementItems: items
        .filter(i => ['class', 'race', 'background'].includes(i.type))
        .map(item => ({
          type: item.type,
          advancement: Array.from(item.system.advancement ?? []).map(adv => {
            // Only a Trait advancement has grants and choices of this shape (an Item Choice
            // advancement's choices are an object keyed by level).
            const trait = adv.type === 'Trait' ? adv.configuration : null;
            return {
              type: adv.type,
              level: adv.level ?? 0,
              classRestriction: adv.classRestriction ?? '',
              mode: trait?.mode ?? 'default',
              grants: [...(trait?.grants ?? [])],
              choices: (trait?.choices ?? []).map(c => ({
                count: c.count,
                pool: [...(c.pool ?? [])],
              })),
            };
          }),
        })),
    };
  }, actorId);
  return {
    ...sheet,
    duplicates: findDuplicates(copies),
    expect: expectationsFromItems(advancementItems),
  };
}

/**
 * What the picked class, species and background promise at level 1, from their Trait advancements
 * (plain data, see readSheet). Default-mode advancements of level 1 or lower only: expertise and
 * weapon mastery are no new proficiency, and an advancement restricted to a multiclass
 * (`classRestriction: 'secondary'`) is not for a first class. A fixed grant two sources repeat
 * counts once. A wildcard grant ("tool:game:*") is a free choice the data does not size, so it
 * adds nothing: the minimums are lower bounds. Feat grants are not read, so a feat that adds a
 * proficiency can hide one skipped choice.
 * @param {Array<{type: string, advancement: Array<{type: string, level: number,
 *   classRestriction: string, mode: string, grants: string[],
 *   choices: Array<{count: number, pool: string[]}>}>}>} items
 * @returns {Expectations}
 */
export function expectationsFromItems(items) {
  const set = () => /** @type {Set<string>} */ (new Set());
  const grants = {
    saves: set(),
    weapons: set(),
    armor: set(),
    skills: set(),
    tools: set(),
    languages: set(),
  };
  const choose = { skills: 0, tools: 0, languages: 0 };
  /** @type {string[][]} */
  const pools = [];
  /** @type {number[]} */
  const poolCounts = [];
  const last = (/** @type {string} */ key) => key.split(':').at(-1) ?? key;
  for (const item of items) {
    for (const adv of item.advancement) {
      if (adv.type !== 'Trait' || adv.level > 1) continue;
      if (adv.classRestriction === 'secondary' || adv.mode !== 'default') continue;
      for (const key of adv.grants) {
        if (key.endsWith('*')) continue;
        const [kind] = key.split(':');
        const target = {
          saves: 'saves',
          weapon: 'weapons',
          armor: 'armor',
          skills: 'skills',
          tool: 'tools',
          languages: 'languages',
        }[kind];
        if (target) grants[/** @type {keyof typeof grants} */ (target)].add(last(key));
      }
      for (const ch of adv.choices) {
        const first = String(ch.pool[0] ?? '');
        if (first.startsWith('skills:')) {
          choose.skills += ch.count;
          pools.push(ch.pool.map(last));
          poolCounts.push(ch.count);
        } else if (first.startsWith('tool:')) choose.tools += ch.count;
        else if (first.startsWith('languages:')) choose.languages += ch.count;
      }
    }
  }
  return {
    saves: [...grants.saves],
    weapons: [...grants.weapons],
    armor: [...grants.armor],
    skills: { grants: [...grants.skills], choose: choose.skills, pools, poolCounts },
    tools: { grants: [...grants.tools], choose: choose.tools },
    languages: { grants: [...grants.languages], choose: choose.languages },
  };
}

/**
 * Features and spells that appear more than once under the same name (any type: a feat and a spell
 * of one name count together), with each copy's type and what granted it. Gear is left out (two
 * Oil flasks are fine), and so are the copies dnd5e keeps for a Cast activity (flags.dnd5e.cachedFor:
 * Favored Enemy's free Hunter's Mark next to the one its ItemGrant gives).
 * @param {Array<{name: string, type: string, cached: boolean, origin: string | null}>} copies
 * @returns {NonNullable<Sheet['duplicates']>}
 */
export function findDuplicates(copies) {
  const gear = ['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container'];
  /** @type {Map<string, typeof copies>} */
  const seen = new Map();
  for (const c of copies) {
    if (gear.includes(c.type) || c.cached) continue;
    const list = seen.get(c.name) ?? [];
    list.push(c);
    seen.set(c.name, list);
  }
  return [...seen.values()]
    .filter(list => list.length > 1)
    .map(list => ({
      name: list[0].name,
      types: list.map(c => c.type),
      count: list.length,
      origins: list.map(c => c.origin),
    }));
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
 * Turns Actor Studio's per-user `usage-tracking` off for another user, from the GM page, before that
 * user joins (kit init only reaches the GM users). A user-scope setting is a Setting document with a
 * `user` field, so the GM writes the player's document directly; the module's onChange (a confirm
 * dialog) never runs on the player's page.
 * @param {import('playwright-core').Page} page  the GM page
 * @param {string} studio  the module id
 * @param {string} userName
 * @returns {Promise<'turned off' | 'already off' | null>}  null: no such user or setting
 */
export function turnOffTrackingFor(page, studio, userName) {
  return page.evaluate(
    async ({ studio, userName }) => {
      const key = `${studio}.usage-tracking`;
      const user = game.users.getName(userName);
      if (!user || !game.settings.settings.has(key)) return null;
      const doc = game.settings.storage.get('user').getSetting(key, user.id);
      if (doc) {
        if (doc.value === false) return 'already off';
        await doc.update({ value: 'false' });
      } else {
        await CONFIG.Setting.documentClass.create({ key, user: user.id, value: 'false' });
      }
      return 'turned off';
    },
    { studio, userName }
  );
}

/**
 * The checks on one new character. Problems fail the step; notes are only reported.
 * @param {{sheet: Sheet, playerId: string, classIdentifier: string, planned: string[],
 *   spellList: string[] | null, pumpErrors?: string[], speciesUuid?: string, classUuid?: string,
 *   backgroundUuid?: string, baseAbilities?: Record<string, number> | null}} o
 *   speciesUuid, classUuid, backgroundUuid: what the plan picked; the sheet's species, class and
 *   background items must come from those entries (a 2014 and a 2024 Fighter share an identifier)
 *   baseAbilities: the six scores the player entered before the background raised them
 * @returns {{problems: Array<{what: string, evidence: string}>, notes: string[]}}
 */
export function judgeSheet({
  sheet,
  playerId,
  classIdentifier,
  planned,
  spellList,
  pumpErrors = [],
  speciesUuid = '',
  classUuid = '',
  backgroundUuid = '',
  baseAbilities = null,
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
  } else if (classUuid && !(sheet.classSources ?? []).includes(classUuid)) {
    bad(
      'the class is not the one picked',
      `picked ${classUuid}; the sheet's class is from ${(sheet.classSources ?? []).join(', ') || 'no source'}`
    );
  }
  if (sheet.species.length !== 1)
    bad('the character has no species', sheet.species.join(', ') || 'none');
  else if (speciesUuid && !(sheet.speciesSources ?? []).includes(speciesUuid)) {
    bad(
      'the species is not the one picked',
      `picked ${speciesUuid}; the sheet has ${sheet.species[0]} from ${(sheet.speciesSources ?? []).join(', ') || 'no source'}`
    );
  }
  if (sheet.backgrounds.length !== 1)
    bad('the character has no background', sheet.backgrounds.join(', ') || 'none');
  else if (backgroundUuid && !(sheet.backgroundSources ?? []).includes(backgroundUuid)) {
    bad(
      'the background is not the one picked',
      `picked ${backgroundUuid}; the sheet has ${sheet.backgrounds[0]} from ${(sheet.backgroundSources ?? []).join(', ') || 'no source'}`
    );
  }
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
  // Only the spells the class gave are judged against its list: a species or feat spell (Forest
  // Gnome's Minor Illusion on a paladin) is allowed off it.
  const fromClass = sheet.spells.filter(s => !s.origin || /^(class|subclass):/.test(s.origin));
  const other = sheet.spells.filter(s => !fromClass.includes(s));
  if (spellList) {
    const allowed = new Set(spellList);
    const off = fromClass.filter(s => !allowed.has(s.identifier));
    if (off.length)
      bad(
        `spells that are not on the ${classIdentifier} spell list`,
        `${off.length} of ${fromClass.length}: ${off.map(s => s.name).join(', ')}`
      );
  } else if (fromClass.length) {
    notes.push(
      `the system has no ${classIdentifier} spell list (dnd5e.registry.spellLists): the class's ${fromClass.length} spells were not checked`
    );
  }
  if (other.length) {
    notes.push(
      `spells from other sources, not judged against the class list: ${other.map(s => `${s.name} (${s.origin})`).join(', ')}`
    );
  }
  for (const e of pumpErrors) bad('an advancement answer failed', e);
  for (const p of judgeAbilities(sheet, baseAbilities)) bad(p.what, p.evidence);
  const proficiencies = judgeProficiencies(sheet);
  for (const p of proficiencies.problems) bad(p.what, p.evidence);
  notes.push(...proficiencies.notes);

  if (sheet.armor.length && !sheet.armor.some(a => a.equipped)) {
    notes.push(
      `the starting armor arrives unequipped (${sheet.armor.map(a => a.name).join(', ')}; AC ${sheet.ac}): the player equips it on the sheet`
    );
  }
  for (const d of sheet.duplicates ?? []) {
    notes.push(
      `${d.name} is on the sheet ${d.count} times: ${d.types.map((type, k) => `${type} from ${d.origins[k] ?? 'no advancement'}`).join(', ')}`
    );
  }
  if (
    classIdentifier === 'wizard' &&
    sheet.items.length &&
    !sheet.items.some(i => /spellbook/i.test(i.name))
  ) {
    notes.push(
      'the wizard has no Spellbook item (the Player’s Handbook module’s wizard equipment does not include one): the GM adds it'
    );
  }
  notes.push(
    `${sheet.items.length} items, ${sheet.spells.length} spells, ${sheet.gp} gp, AC ${sheet.ac}`
  );
  return { problems, notes };
}

/**
 * The ability scores of a new character. Every score is a whole number from 1 to 20 (a level-1
 * build never passes 20). With the scores the player entered, the 2024 background raised them by
 * 3 points in all (2 and 1, or 1, 1 and 1), none by more than 2, none lowered.
 * @param {Sheet} sheet
 * @param {Record<string, number> | null} base
 * @returns {Array<{what: string, evidence: string}>}
 */
export function judgeAbilities(sheet, base) {
  const scores = sheet.abilities;
  if (!scores) return [];
  /** @type {Array<{what: string, evidence: string}>} */
  const problems = [];
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const shown = keys.map(k => `${k} ${scores[k]}`).join(', ');
  const odd = keys.filter(k => !Number.isInteger(scores[k]) || scores[k] < 1 || scores[k] > 20);
  if (odd.length) problems.push({ what: 'ability scores out of range (1 to 20)', evidence: shown });
  if (!base) return problems;
  const raised = keys.map(k => scores[k] - base[k]);
  if (raised.some(n => n < 0 || n > 2)) {
    problems.push({
      what: 'the background changed a score by more than +2, or lowered one',
      evidence: `entered ${keys.map(k => base[k]).join('/')}, now ${shown}`,
    });
  } else if (raised.reduce((sum, n) => sum + n, 0) !== 3) {
    problems.push({
      what: 'the background did not raise the scores by 3 points in all',
      evidence: `entered ${keys.map(k => base[k]).join('/')}, now ${shown}`,
    });
  }
  return problems;
}

/**
 * The proficiencies of a new character against what its class, species and background promise
 * (`sheet.expect`, read from their Trait advancements): the class's saving throws exactly, every
 * fixed skill, tool, weapon and armor grant, at least as many skills, tools and languages as the
 * fixed grants plus the free choices, and the level-1 proficiency bonus of 2.
 * @param {Sheet} sheet
 * @returns {{problems: Array<{what: string, evidence: string}>, notes: string[]}}
 */
export function judgeProficiencies(sheet) {
  const want = sheet.expect;
  /** @type {Array<{what: string, evidence: string}>} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  if (!want || !sheet.skills) return { problems, notes };
  const bad = (/** @type {string} */ what, /** @type {string} */ evidence) =>
    problems.push({ what, evidence });
  const missing = (/** @type {string[]} */ need, /** @type {string[] | undefined} */ have) =>
    need.filter(k => !(have ?? []).includes(k));
  if (sheet.prof !== undefined && sheet.prof !== 2) {
    bad('the proficiency bonus is not +2', `+${sheet.prof}`);
  }
  if (sheet.classes.length && !want.saves.length) {
    bad(
      'the class’s saving throws could not be read from its advancements',
      'the Trait advancements of the class item hold no saves: the data shape may have changed'
    );
  }
  const saves = [...(sheet.saves ?? [])].sort();
  const wantSaves = [...want.saves].sort();
  if (wantSaves.length && saves.join() !== wantSaves.join()) {
    bad(
      'saving throw proficiencies are not the class’s',
      `have ${saves.join(', ') || 'none'}; the class gives ${wantSaves.join(', ')}`
    );
  }
  const lacking = [
    ['skills', want.skills.grants, sheet.skills],
    ['tools', want.tools.grants, sheet.tools],
    ['weapons', want.weapons, sheet.weaponProf],
    ['armor', want.armor, sheet.armorProf],
    ['languages', want.languages.grants, sheet.languages],
  ].map(([what, need, have]) => [
    what,
    missing(/** @type {any} */ (need), /** @type {any} */ (have)),
  ]);
  for (const [what, list] of lacking) {
    if (list.length) bad(`${what} the character should have are missing`, list.join(', '));
  }
  for (const [what, grants, choose, have] of [
    ['skill', want.skills.grants.length, want.skills.choose, sheet.skills],
    ['tool', want.tools.grants.length, want.tools.choose, sheet.tools],
    ['language', want.languages.grants.length, want.languages.choose, sheet.languages],
  ]) {
    const least = /** @type {number} */ (grants) + /** @type {number} */ (choose);
    const count = /** @type {string[]} */ (have)?.length ?? 0;
    // A skill choice that repeats a skill another source grants (an Elf's Keen Senses on Insight
    // for a Wayfarer, who gets Insight too) costs one proficiency: a note, not a skipped choice.
    const repeats = what === 'skill' ? repeatableChoices(want.skills) : 0;
    if (count < least && least - count <= repeats) {
      notes.push(
        `${what} choices may repeat a granted skill (${least - count} proficiency fewer than granted and chosen): pick a skill the background does not already give`
      );
    } else if (count < least) {
      bad(
        `fewer ${what} proficiencies than granted and chosen (a choice was skipped)`,
        `${count}, at least ${grants} granted + ${choose} chosen = ${least}`
      );
    }
  }
  return { problems, notes };
}

/**
 * How many skill picks could land on a skill that is already granted (a pool that holds a granted
 * skill, or any skill, counts all its picks).
 * @param {NonNullable<Sheet['expect']>['skills']} skills
 */
function repeatableChoices(skills) {
  const granted = new Set(skills.grants);
  return (skills.pools ?? []).reduce(
    (sum, pool, i) =>
      pool.includes('*') || pool.some(k => granted.has(k))
        ? sum + (skills.poolCounts?.[i] ?? 1)
        : sum,
    0
  );
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

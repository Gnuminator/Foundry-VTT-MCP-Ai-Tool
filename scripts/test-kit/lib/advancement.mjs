/**
 * The checks of the heroes-advancement scenario, as pure functions: what the advancement data
 * says a hero must have (the GM action describeClass, `expected`) against what the actor has (the
 * GM action inspectActor, `actor`) and what the builder recorded (the manifest's hero row).
 *
 * Every problem is classified, with its evidence:
 * - KIT: our builder or our check is wrong (a choice was not made, an HP rule is off).
 * - CONTENT: the imported data is wrong or incomplete (a grant that does not resolve, a class
 *   without a subclass step, a choice list with no options).
 * - SYSTEM: the dnd5e system did something else than its own data says (a grant not applied, a
 *   slot table that differs).
 */

/** @typedef {'KIT'|'CONTENT'|'SYSTEM'} FailureKind */
/** @typedef {{kind: FailureKind, what: string, evidence: string}} Problem */

export const FAILURE_KINDS = /** @type {const} */ (['KIT', 'CONTENT', 'SYSTEM']);

/** Saving throws and ability keys in the order dnd5e lists them. */
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** @param {unknown} v */
const text = v => (v === null || v === undefined ? 'none' : String(v));

/** The `what` of a hero the builder could not build. Never known (lib/known.mjs): it always fails. */
export const NOT_BUILT = 'the hero was not built';

/**
 * The kind of a hero the builder could not build, from the error it recorded.
 * @param {string} message
 * @returns {Problem}
 */
export function classifyBuildError(message) {
  const m = String(message);
  /** @type {FailureKind} */
  let kind = 'KIT';
  if (
    /no class "|no (class|subclass|species|background) [A-Za-z]*\.|not installed|no default/i.test(
      m
    )
  )
    kind = 'CONTENT';
  else if (/ failed: |refused|advancement manager closed/i.test(m)) kind = 'SYSTEM';
  return { kind, what: NOT_BUILT, evidence: m };
}

/**
 * Picks the manifest recorded for the class and the subclass (a pick's title starts with the name
 * of the item whose advancement asked, "Fighter: Skill Proficiencies"), at class levels only.
 * @param {Array<{level: number, advancement: string, title: string, chosen: string[]}>} picks
 * @param {string[]} owners item names: the class and the subclass
 */
function classPicks(picks, owners) {
  return picks.filter(
    p => p.level >= 1 && owners.some(name => name && p.title.startsWith(`${name}: `))
  );
}

/**
 * Per level: the number of choices the advancement data asks for and the number the builder made.
 * @param {Array<{level: number, advancement: string, count: number}>} expected
 * @param {ReturnType<typeof classPicks>} picks
 * @param {string} advancement
 * @returns {Array<{level: number, asked: number, made: number}>}
 */
function choiceCounts(expected, picks, advancement) {
  const levels = new Set();
  const asked = new Map();
  for (const c of expected.filter(x => x.advancement === advancement)) {
    asked.set(c.level, (asked.get(c.level) ?? 0) + c.count);
    levels.add(c.level);
  }
  const made = new Map();
  for (const p of picks.filter(x => x.advancement === advancement)) {
    if (advancement === 'ItemChoice' && p.title.endsWith('(ability)')) continue;
    const n = advancement === 'AbilityScoreImprovement' ? 1 : p.chosen.length;
    made.set(p.level, (made.get(p.level) ?? 0) + n);
    levels.add(p.level);
  }
  return [...levels]
    .sort((a, b) => a - b)
    .map(level => ({ level, asked: asked.get(level) ?? 0, made: made.get(level) ?? 0 }));
}

/**
 * Compares one hero with the advancement data. Returns the problems found and notes that explain
 * accepted differences (a hit point bonus from a feat, a grant matched by name).
 * @param {{
 *   hero: {name: string, classUuid: string, subclassUuid?: string, level: number, classIdentifier: string,
 *     subclassIdentifier?: string, owner?: string, picks?: any[], warnings?: string[]},
 *   expected: any,
 *   actor: any,
 * }} input
 * @returns {{problems: Problem[], notes: string[], summary: string}}
 */
export function checkHero({ hero, expected, actor }) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  /** @param {FailureKind} kind @param {string} what @param {string} evidence */
  const bad = (kind, what, evidence) => problems.push({ kind, what, evidence });
  const items = /** @type {Array<{name: string, type: string, sourceUuid: string | null}>} */ (
    actor.items ?? []
  );
  const classItem = items.find(i => i.type === 'class');
  const subclassItem = items.find(i => i.type === 'subclass');
  const warnings = hero.warnings ?? [];

  // Class and levels.
  const cls = (actor.classes ?? []).find(
    (/** @type {any} */ c) => c.identifier === hero.classIdentifier
  );
  if (!cls || cls.levels !== hero.level || actor.level !== hero.level) {
    bad(
      'SYSTEM',
      'class level',
      `expected ${hero.classIdentifier} ${hero.level}, the actor has ${JSON.stringify(actor.classes)} at level ${actor.level}`
    );
  }
  if (classItem && classItem.sourceUuid && classItem.sourceUuid !== hero.classUuid) {
    bad('KIT', 'class item', `built from ${classItem.sourceUuid}, planned ${hero.classUuid}`);
  }

  // Subclass.
  const at = expected.subclassAt;
  if (hero.subclassUuid) {
    if (!at) {
      bad(
        'CONTENT',
        'subclass',
        `the class has no Subclass advancement, yet ${hero.subclassIdentifier} was planned`
      );
    } else if (hero.level >= at) {
      if (!cls?.subclass || !subclassItem) {
        bad(
          warnings.length ? 'SYSTEM' : 'KIT',
          'subclass missing',
          `level ${hero.level} is past the subclass level ${at}; warnings: ${warnings.join(' / ') || 'none'}`
        );
      } else if (subclassItem.sourceUuid && subclassItem.sourceUuid !== hero.subclassUuid) {
        bad(
          'KIT',
          'subclass item',
          `built from ${subclassItem.sourceUuid}, planned ${hero.subclassUuid}`
        );
      }
    } else if (cls?.subclass) {
      bad(
        'KIT',
        'subclass too early',
        `${cls.subclass} at level ${hero.level}, the subclass level is ${at}`
      );
    }
  }

  // Grants: every one the data gives up to this level, by source uuid, else by name.
  const bySource = new Map(items.filter(i => i.sourceUuid).map(i => [i.sourceUuid, i]));
  const byName = new Map(items.map(i => [i.name.toLowerCase(), i]));
  let granted = 0;
  const unresolved = [];
  const missing = [];
  const named = [];
  for (const g of expected.grants ?? []) {
    if (g.optional) continue;
    if (g.resolved === false) {
      unresolved.push(`level ${g.level} ${g.uuid}${g.why ? ` (${g.why})` : ''}`);
      continue;
    }
    if (bySource.has(g.uuid)) granted += 1;
    else if (g.name && byName.has(g.name.toLowerCase())) {
      granted += 1;
      named.push(g.name);
    } else missing.push(`${g.name || g.uuid} (level ${g.level})`);
  }
  if (unresolved.length) {
    bad(
      'CONTENT',
      `${unresolved.length} grant uuid(s) do not resolve`,
      unresolved.slice(0, 4).join(', ')
    );
  }
  if (missing.length) {
    bad(
      warnings.length ? 'KIT' : 'SYSTEM',
      `${missing.length} grant(s) missing`,
      `${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}; the uuid resolves, the actor has no item from it or by that name; warnings: ${warnings.join(' / ') || 'none'}`
    );
  }
  if (named.length) notes.push(`${named.length} grant(s) matched by name`);

  // Choices: the advancement data asks for N, the builder made N (per level).
  const owners = [classItem?.name ?? '', subclassItem?.name ?? ''];
  const picks = classPicks(hero.picks ?? [], owners);
  let choicesAsked = 0;
  for (const advancement of ['ItemChoice', 'Trait', 'AbilityScoreImprovement']) {
    for (const row of choiceCounts(expected.choices ?? [], picks, advancement)) {
      choicesAsked += row.asked;
      if (row.made === row.asked) continue;
      const related = warnings.filter(w => w.includes(`level ${row.level}:`));
      // The system offered nothing more: every option of the pool was already on the actor (the
      // human origin, the background, a feat). The same would stop a player, so it is a note.
      const exhausted = related
        .filter(
          w =>
            /every option is already taken/.test(w) && owners.some(o => o && w.startsWith(`${o}: `))
        )
        .reduce((n, w) => n + Number(/(\d+) of \d+ choice/.exec(w)?.[1] ?? 0), 0);
      if (advancement === 'Trait' && exhausted && row.made + exhausted >= row.asked) {
        notes.push(`level ${row.level}: ${exhausted} Trait choice(s) had no option left`);
        continue;
      }
      /** @type {FailureKind} */
      let kind = 'KIT';
      if (related.some(w => /no options offered/.test(w))) kind = 'CONTENT';
      else if (related.some(w => /refused/.test(w))) kind = 'SYSTEM';
      bad(
        kind,
        `${advancement} at level ${row.level}`,
        `the data asks for ${row.asked}, the builder made ${row.made}${related.length ? `; ${related.join(' / ')}` : ''}`
      );
    }
  }
  // Every item the builder picked is on the actor.
  const picked = picks
    .filter(p => p.advancement === 'ItemChoice' && !p.title.endsWith('(ability)'))
    .flatMap(p => p.chosen);
  const lacking = picked.filter(name => !byName.has(String(name).toLowerCase()));
  if (lacking.length) {
    bad(
      'SYSTEM',
      'picked items missing',
      `${lacking.slice(0, 6).join(', ')} were chosen but are not on the actor`
    );
  }

  // Scale values.
  const have = actor.scale?.[hero.classIdentifier] ?? {};
  let scaleOk = 0;
  for (const s of expected.scale ?? []) {
    if (!(s.identifier in have)) {
      bad('SYSTEM', `scale value ${s.identifier}`, `expected ${text(s.value)}, the actor has none`);
    } else if (text(have[s.identifier]) !== text(s.value)) {
      bad(
        'SYSTEM',
        `scale value ${s.identifier}`,
        `expected ${text(s.value)}, the actor has ${text(have[s.identifier])}`
      );
    } else scaleOk += 1;
  }

  // Hit points: the average of the die, the Constitution modifier per level, and any bonus an
  // effect on the actor gives (say which).
  const conMod = actor.abilities?.con?.mod ?? 0;
  const bonusLevel = actor.hp?.bonuses?.level ?? 0;
  const bonusOverall = actor.hp?.bonuses?.overall ?? 0;
  const hpExpected =
    expected.hpFixed + conMod * hero.level + bonusLevel * hero.level + bonusOverall;
  if (bonusLevel || bonusOverall) {
    const from =
      (actor.hp?.sources ?? []).map((/** @type {any} */ s) => s.item).join(', ') || 'an effect';
    notes.push(
      `HP extras ${bonusLevel ? `+${bonusLevel}/level` : ''}${bonusOverall ? ` +${bonusOverall}` : ''} from ${from}`.replace(
        '  ',
        ' '
      )
    );
  }
  if (actor.hp?.max !== hpExpected) {
    const perLevel = (actor.hp?.max - hpExpected) / hero.level;
    bad(
      'KIT',
      'hit points',
      `max ${actor.hp?.max}, expected ${hpExpected} = ${expected.hpFixed} (${expected.hitDie} average) + ${conMod} CON x ${hero.level}` +
        `${bonusLevel || bonusOverall ? ` + bonuses ${bonusLevel}/level and ${bonusOverall}` : ''}` +
        `${Number.isInteger(perLevel) ? ` (${perLevel > 0 ? '+' : ''}${perLevel} per level off)` : ''}`
    );
  }
  if (actor.hp?.value !== actor.hp?.max) {
    bad(
      'KIT',
      'current hit points',
      `${actor.hp?.value} of ${actor.hp?.max}: the hero should start at full health`
    );
  }

  // Spell slots, against the system's own table.
  const slots = expected.spellSlots;
  const spells = actor.spells ?? {};
  const slotText = [];
  for (let n = 1; n <= 9; n += 1) {
    const want = slots?.leveled?.[String(n)] ?? 0;
    const got = spells[`spell${n}`]?.max ?? 0;
    if (want) slotText.push(`${want}`);
    if (want !== got)
      bad('SYSTEM', `spell slots, level ${n}`, `the table gives ${want}, the actor has ${got}`);
  }
  const pactWant = slots?.pact ?? null;
  const pactGot = spells.pact?.max ? { max: spells.pact.max, level: spells.pact.level } : null;
  if (JSON.stringify(pactWant) !== JSON.stringify(pactGot)) {
    bad(
      'SYSTEM',
      'pact slots',
      `the table gives ${JSON.stringify(pactWant)}, the actor has ${JSON.stringify(pactGot)}`
    );
  }
  if (pactWant) slotText.push(`pact ${pactWant.max} at level ${pactWant.level}`);

  // Skills and saving throws.
  const skillCount = Object.values(actor.skills ?? {}).filter(v => Number(v) >= 1).length;
  if (skillCount < (expected.skillsChosen ?? 0)) {
    bad(
      'KIT',
      'skill proficiencies',
      `${skillCount} proficient, the class asks for ${expected.skillsChosen} choices`
    );
  }
  // Saving throws: the class's own, plus any an item's effect adds (a high level feature); an
  // extra proficiency with no effect behind it is a problem.
  const saveWant = [...(expected.saves ?? [])].sort();
  if (saveWant.length) {
    const saveGot = ABILITIES.filter(a => Number(actor.saves?.[a]) >= 1);
    const lacking = saveWant.filter(a => !saveGot.includes(a));
    const extra = saveGot.filter(a => !saveWant.includes(a));
    // A feat the builder picked can grant one (Resilient): its own Trait pick says which.
    const pickedSaves = new Map();
    for (const p of hero.picks ?? []) {
      for (const key of p.chosen ?? []) {
        if (String(key).startsWith('saves:'))
          pickedSaves.set(String(key).slice(6), String(p.title).split(':')[0]);
      }
    }
    const unexplained = extra.filter(a => !actor.saveSources?.[a]?.length && !pickedSaves.has(a));
    if (lacking.length || unexplained.length) {
      bad(
        'SYSTEM',
        'saving throws',
        `the class grants ${saveWant.join(', ')}, the actor is proficient in ${saveGot.join(', ') || 'none'}` +
          `${unexplained.length ? ` (${unexplained.join(', ')} come from no effect)` : ''}`
      );
    } else if (extra.length) {
      const from = [
        ...new Set(extra.flatMap(a => actor.saveSources?.[a] ?? [pickedSaves.get(a) ?? ''])),
      ].join(', ');
      notes.push(`saves ${extra.join(', ')} also from ${from}`);
    }
  }

  // The player's hero belongs to the player.
  if (hero.owner && actor.ownership?.[hero.owner] !== 3) {
    bad(
      'KIT',
      'ownership',
      `${hero.owner} has level ${text(actor.ownership?.[hero.owner])}, expected 3 (owner)`
    );
  }

  const summary =
    `HP ${actor.hp?.max} (${expected.hpFixed} + ${conMod}x${hero.level}${bonusLevel || bonusOverall ? ' + extras' : ''}), ` +
    `${granted} grants, ${choicesAsked} choices, ${scaleOk} scale values, ` +
    `${slotText.length ? `slots ${slotText.join('/')}` : 'no slots'}` +
    `${notes.length ? `; ${notes.join('; ')}` : ''}`;
  return { problems, notes, summary };
}

/**
 * One line for a failed step: the problems with their kind first, so the report can be read at
 * a glance. At most `max` problems are named.
 * @param {Problem[]} problems
 * @param {number} [max]
 */
export function problemText(problems, max = 5) {
  const lines = problems.slice(0, max).map(p => `[${p.kind}] ${p.what}: ${p.evidence}`);
  if (problems.length > max) lines.push(`and ${problems.length - max} more`);
  return lines.join(' | ');
}

/**
 * Counts problems by kind.
 * @param {Problem[]} problems
 * @returns {Record<FailureKind, number>}
 */
export function countByKind(problems) {
  const out = { KIT: 0, CONTENT: 0, SYSTEM: 0 };
  for (const p of problems) out[p.kind] += 1;
  return out;
}

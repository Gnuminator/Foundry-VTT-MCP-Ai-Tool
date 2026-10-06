/**
 * The GM actions, one function per key of GM_ACTIONS (contract.mjs). gm.mjs serializes each into
 * the Foundry GM page with Playwright's `page.evaluate`, so every function here is
 * self-contained: no closures over module scope, helpers are declared inside the function, and
 * the kit constants arrive in `args._kit` (gm.mjs adds `{flagScope, flagKey}`).
 *
 * `consoleErrors` is not here: the Node side collects console and page errors (gm.mjs).
 *
 * Verified against Foundry 14.368 and dnd5e 6.0.5 (Modern Rules 2024). Facts that shaped the code:
 * - The system ships `dnd5e.classes24` (12 classes + subclasses + features), `dnd5e.origins24`
 *   (species, backgrounds, origin feats), the legacy 2014 SRD packs `dnd5e.classes` and
 *   `dnd5e.subclasses`, and a `dnd5e.heroes` pack of premade characters the kit does not use.
 *   Legacy packs store `system.source` as a plain string, so an index field `system.source.rules`
 *   throws; listCompendium asks for the whole `system.source` field.
 * - Creating a class item with `actor.createEmbeddedDocuments` skips advancement (no HP, no
 *   features). The supported route is `AdvancementManager.forNewItem(actor, data,
 *   {automaticApplication: true})`: it applies fixed grants itself and stops (renders) at each
 *   choice. One manager run covers every level up to N; a Subclass advancement stops at the
 *   subclass level, and the subclass's own advancement then arrives as synthetic steps.
 * - createHero answers each stop through the advancement API (what the flow forms call), then
 *   re-renders the flow (its form would otherwise hold stale values and undo the answer) and clicks
 *   "next" until the `dnd5e.advancementManagerComplete` hook fires.
 */
import { SPELL_GM_FUNCTIONS } from './gm-spells.mjs';

import { ORIGIN_GM_FUNCTIONS } from './gm-origins.mjs';
import { inspectBuild } from './inspect-build.mjs';
import { studioPump } from './studio-pump.mjs';

/** @param {object} _args */
async function worldStatus(_args) {
  const mod = game.modules.get('foundry-mcp-bridge');
  return {
    worldId: game.world.id,
    systemId: game.system.id,
    systemVersion: game.system.version,
    coreVersion: game.version,
    userName: game.user.name,
    isGM: game.user.isGM,
    moduleActive: !!mod?.active,
    moduleVersion: mod?.version ?? '',
  };
}

/**
 * Delete every document that carries the kit flag, children first.
 * @param {{_kit: {flagScope: string, flagKey: string}}} args
 */
async function wipeKit(args) {
  const { flagScope, flagKey } = args._kit;
  const marked = doc => !!doc.getFlag(flagScope, flagKey);
  const deleted = { Actor: 0, Scene: 0, Item: 0, JournalEntry: 0, Combat: 0, Folder: 0 };
  const drop = async (name, collection) => {
    const ids = collection.filter(marked).map(d => d.id);
    if (!ids.length) return;
    await getDocumentClass(name).deleteDocuments(ids);
    deleted[name] += ids.length;
  };
  // Combats on a kit scene go with it, flagged or not.
  const kitSceneIds = new Set(game.scenes.filter(marked).map(s => s.id));
  const strayCombats = game.combats
    .filter(c => !marked(c) && kitSceneIds.has(c.scene?.id))
    .map(c => c.id);
  if (strayCombats.length) {
    await Combat.deleteDocuments(strayCombats);
    deleted.Combat += strayCombats.length;
  }
  await drop('Combat', game.combats);
  await drop('Scene', game.scenes);
  await drop('Actor', game.actors);
  await drop('Item', game.items);
  await drop('JournalEntry', game.journal);
  await drop('Folder', game.folders);
  return { deleted };
}

/**
 * A kit folder of a document type, reused when it exists.
 * @param {{type: string, name: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function ensureFolder(args) {
  const { flagScope, flagKey } = args._kit;
  const existing = game.folders.find(
    f => f.type === args.type && f.name === args.name && f.getFlag(flagScope, flagKey)
  );
  if (existing) return { folderId: existing.id };
  const folder = await Folder.create({
    name: args.name,
    type: args.type,
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  return { folderId: folder.id };
}

/**
 * The index of compendium packs: names, ids and the few fields the kit builder sorts by. No text.
 * `rules` comes from system.source.rules (legacy packs store `source` as a plain string, so the whole
 * field is asked for and read defensively), `book` from system.source.book.
 * @param {{packIds: string[], type?: string, subtype?: string}} args
 */
async function listCompendium(args) {
  const entries = [];
  const missing = [];
  const fields = [
    'system.source',
    'system.identifier',
    'system.classIdentifier',
    'system.type.value',
  ];
  for (const packId of args.packIds ?? []) {
    const pack = game.packs.get(packId);
    if (!pack) {
      missing.push(packId);
      continue;
    }
    const index = await pack.getIndex({ fields });
    for (const e of index) {
      if (args.type && e.type !== args.type) continue;
      if (args.subtype && e.system?.type?.value !== args.subtype) continue;
      const source = e.system?.source;
      const rules = typeof source === 'object' && source ? String(source.rules ?? '') : '';
      const book =
        typeof source === 'object' && source ? String(source.book ?? '') : String(source ?? '');
      const slug = e.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const entry = {
        packId,
        id: e._id,
        uuid: e.uuid ?? `Compendium.${packId}.Item.${e._id}`,
        name: e.name,
        type: e.type,
        identifier: e.system?.identifier || slug,
        rules,
        book,
      };
      if (e.system?.classIdentifier) entry.classIdentifier = e.system.classIdentifier;
      entries.push(entry);
    }
  }
  return { entries, missing };
}

/**
 * What the advancement data says a hero of a level must have. Walks the class and the subclass.
 * Every grant says whether its item resolves (`resolved`) and whether the player may decline it
 * (`optional`). `saves` are the saving throw proficiencies the class grants. `spellSlots` is what
 * the system's own slot table gives a single-class caster of that progression and level:
 * `{leveled: {"1": n, ...}, pact: {max, level} | null}`.
 * @param {{classUuid: string, subclassUuid?: string, level: number}} args
 */
async function describeClass(args) {
  const level = Math.max(1, Math.min(20, Number(args.level ?? 1)));
  const klass = await fromUuid(args.classUuid);
  if (!klass || klass.type !== 'class')
    throw new Error(`describeClass: no class ${args.classUuid}`);
  const sub = args.subclassUuid ? await fromUuid(args.subclassUuid) : null;
  if (args.subclassUuid && !sub) throw new Error(`describeClass: no subclass ${args.subclassUuid}`);
  const grants = [];
  const choices = [];
  const scale = [];
  const saves = [];
  let subclassAt = null;
  let skillsChosen = 0;
  const found = new Map();
  const resolve = async uuid => {
    if (!found.has(uuid)) {
      let doc = null;
      try {
        doc = (await fromUuid(uuid)) ?? null;
      } catch {
        doc = null;
      }
      found.set(uuid, doc);
    }
    return found.get(uuid);
  };
  // Why a grant's uuid does not resolve: the pack is missing, or it has no entry with that id.
  const whyMissing = uuid => {
    const m = /^Compendium\.(.+)\.Item\.([^.]+)$/.exec(String(uuid));
    if (!m) return 'not a compendium item uuid';
    const pack = game.packs.get(m[1]);
    if (!pack) return `the pack ${m[1]} is not installed`;
    return `the pack ${m[1]} has no entry with the id ${m[2]}`;
  };
  const walk = async (doc, isClass) => {
    for (const adv of Object.values(doc.advancement.byId)) {
      const type = adv.constructor.typeName;
      // A multiclass-only advancement (a second skill choice, say) does not apply to a first class; a
      // primary-only one (saving throws) does not apply to a second class.
      if (adv.classRestriction === (args.multiclass && isClass ? 'primary' : 'secondary')) continue;
      const levels = (adv.levels ?? []).map(Number).filter(l => l <= level);
      if (type === 'Subclass') {
        if (isClass && adv.levels?.length) subclassAt = Number(adv.levels[0]);
      } else if (type === 'ItemChoice') {
        for (const l of levels) {
          const count = adv.configuration.choices?.[l]?.count ?? 0;
          if (count) choices.push({ level: l, advancement: 'ItemChoice', count });
        }
      } else if (type === 'ItemGrant') {
        for (const l of levels) {
          for (const item of adv.configuration.items ?? []) {
            const doc2 = await resolve(item.uuid);
            grants.push({
              level: l,
              uuid: item.uuid,
              name: doc2?.name ?? '',
              resolved: !!doc2,
              optional: !!(adv.configuration.optional || item.optional),
              ...(doc2 ? {} : { why: whyMissing(item.uuid) }),
            });
          }
        }
      } else if (type === 'Trait') {
        for (const l of levels) {
          for (const key of adv.configuration.grants ?? []) {
            if (String(key).startsWith('saves:')) saves.push(String(key).slice(6));
          }
          for (const c of adv.configuration.choices ?? []) {
            if (!c.count) continue;
            choices.push({ level: l, advancement: 'Trait', count: c.count });
            const pool = [...(c.pool ?? [])];
            if (
              isClass &&
              l === 1 &&
              adv.configuration.mode === 'default' &&
              pool.length &&
              pool.every(k => k.startsWith('skills:'))
            ) {
              skillsChosen += c.count;
            }
          }
        }
      } else if (type === 'AbilityScoreImprovement') {
        // Fixed increases (no points to spend, such as a level 20 capstone) are applied without a choice.
        if (adv.configuration.points > 0) {
          for (const l of levels) choices.push({ level: l, advancement: type, count: 1 });
        }
      } else if (type === 'ScaleValue') {
        const v = adv.valueForLevel(level);
        let value = null;
        if (v)
          value =
            typeof v.value === 'number' || typeof v.value === 'string'
              ? v.value
              : (v.display ?? null);
        scale.push({ identifier: adv.identifier, value });
      }
    }
  };
  await walk(klass, true);
  if (sub) await walk(sub, false);
  const faces = parseInt(String(klass.system.hd.denomination).replace('d', ''), 10);
  let hpFixed = args.multiclass ? faces / 2 + 1 : faces;
  for (let l = 2; l <= level; l++) hpFixed += faces / 2 + 1;
  const progression = klass.system.spellcasting?.progression ?? 'none';
  const subProgression = sub?.system.spellcasting?.progression ?? 'none';
  let spellcasting = null;
  if (progression !== 'none') {
    spellcasting = { progression, ability: klass.system.spellcasting.ability || '' };
  } else if (subProgression !== 'none' && subclassAt && level >= subclassAt) {
    spellcasting = { progression: subProgression, ability: sub.system.spellcasting.ability || '' };
  }
  // The slot table of a single-class caster, the way the system rounds it (computeProgression).
  let spellSlots = null;
  if (spellcasting) {
    const cfg = CONFIG.DND5E.spellProgression[spellcasting.progression];
    const model = cfg?.type ? CONFIG.DND5E.spellcasting[cfg.type] : null;
    if (model && typeof model.calculateSlots === 'function') {
      const divisor = cfg.divisor ?? 1;
      let casterLevel = (cfg.roundUp ? Math.ceil : Math.floor)(level / divisor);
      if (divisor > 1 && casterLevel) casterLevel = Math.ceil(level / divisor);
      const slots = model.calculateSlots(Math.max(0, Math.min(20, casterLevel)));
      spellSlots = { leveled: {}, pact: null };
      if (model.isSingleLevel) {
        const [[slotLevel, max] = []] = Object.entries(slots);
        if (max) spellSlots.pact = { max, level: Number(slotLevel) };
      } else {
        for (const [slotLevel, max] of Object.entries(slots)) spellSlots.leveled[slotLevel] = max;
      }
    }
  }
  return {
    expected: {
      grants,
      choices,
      scale,
      saves,
      hitDie: klass.system.hd.denomination,
      hpFixed,
      spellcasting,
      spellSlots,
      skillsChosen,
      subclassAt,
    },
  };
}

/**
 * One actor as the system sees it, for checks against {@link describeClass}. `hp.bonuses` are the
 * actor's hit point bonuses (per level and overall) worked out, and `hp.sources` the items whose
 * effects change hit points (a feat such as Tough), so a check can explain a difference.
 * A subclass's scale values are listed under the class identifier too.
 * @param {{actorId: string}} args
 */
async function inspectActor(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`inspectActor: no actor ${args.actorId}`);
  const plain = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v.value === 'number' || typeof v.value === 'string') return v.value;
    return v.display ?? String(v);
  };
  const classes = [];
  const scale = {};
  for (const cls of actor.itemTypes.class) {
    classes.push({
      identifier: cls.system.identifier,
      levels: cls.system.levels,
      subclass: cls.subclass?.system.identifier ?? null,
    });
    scale[cls.system.identifier] = {};
    const own = { ...(cls.scaleValues ?? {}), ...(cls.subclass?.scaleValues ?? {}) };
    for (const [id, v] of Object.entries(own)) scale[cls.system.identifier][id] = plain(v);
  }
  const abilities = {};
  for (const [id, a] of Object.entries(actor.system.abilities)) {
    abilities[id] = { value: a.value, mod: a.mod };
  }
  const spells = {};
  for (const [key, s] of Object.entries(actor.system.spells ?? {})) {
    if (!s.max) continue;
    spells[key] = key === 'pact' ? { max: s.max, level: s.level } : { max: s.max };
  }
  const skills = {};
  for (const [id, s] of Object.entries(actor.system.skills ?? {})) skills[id] = s.proficient;
  const saves = {};
  for (const [id, a] of Object.entries(actor.system.abilities)) saves[id] = a.proficient;
  // Saving throw proficiencies an item's effect adds (a level 14 feature, say), by ability.
  const saveSources = {};
  for (const effect of actor.allApplicableEffects()) {
    for (const change of effect.changes) {
      const m = /^system\.abilities\.([a-z]+)\.proficient$/.exec(change.key);
      if (m) (saveSources[m[1]] ??= []).push(effect.parent?.name ?? effect.name);
      // The monk's all-saves feature sets a flag, and the system then adds every saving throw.
      if (change.key === 'flags.dnd5e.diamondSoul') {
        for (const id of Object.keys(actor.system.abilities))
          (saveSources[id] ??= []).push(effect.parent?.name ?? effect.name);
      }
    }
  }
  const ownership = {};
  for (const [userId, level] of Object.entries(actor.ownership ?? {})) {
    ownership[userId === 'default' ? 'default' : (game.users.get(userId)?.name ?? userId)] = level;
  }
  const hpData = actor.system.attributes.hp;
  const rollData = actor.getRollData();
  const bonus = f => Number(dnd5e.utils.simplifyBonus(f, rollData)) || 0;
  const sources = [];
  for (const effect of actor.allApplicableEffects()) {
    const keys = effect.changes.map(c => c.key).filter(k => k.startsWith('system.attributes.hp.'));
    if (keys.length) sources.push({ item: effect.parent?.name ?? effect.name, keys });
  }
  return {
    name: actor.name,
    level: actor.system.details.level,
    classes,
    hp: {
      value: hpData.value,
      max: hpData.max,
      bonuses: { level: bonus(hpData.bonuses?.level), overall: bonus(hpData.bonuses?.overall) },
      sources,
    },
    abilities,
    items: actor.items.map(i => ({
      name: i.name,
      type: i.type,
      sourceUuid: i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId ?? null,
      identifier: i.system?.identifier ?? null,
    })),
    scale,
    spells,
    skills,
    saves,
    saveSources,
    ownership,
  };
}

/** @param {{actorId: string, userName: string, level: number}} args */
async function setOwnership(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`setOwnership: no actor ${args.actorId}`);
  const user = game.users.getName(args.userName);
  if (!user) throw new Error(`setOwnership: no user "${args.userName}"`);
  await actor.update({ [`ownership.${user.id}`]: Number(args.level) });
  return { ok: true };
}

/**
 * A level-N character built through the dnd5e advancement manager, with every choice answered.
 *
 * The class is added at level N in one manager run (`forNewItem` with `automaticApplication`): the
 * manager applies fixed grants itself and stops at each choice; this function answers each stop
 * through the advancement's own API (the same calls the flow forms make), re-renders the flow so
 * its form shows the answer, and clicks "next" until `dnd5e.advancementManagerComplete` fires.
 * Species and background run the same way first.
 *
 * Choice rule: every pick takes option (rotation + k) % options.length from the options the
 * flow offers (a rendered ItemChoice checkbox list, the Trait choices, a feat or spell candidate
 * list), where k counts the hero's picks in order of asking, so siblings with different rotations
 * differ and a build is repeatable. An ability score improvement alternates +2 and a feat on the
 * same count; the hit points take the average from level 2.
 * @param {{name: string, classUuid: string, subclassUuid?: string, level?: number, rotation?: number,
 *   speciesUuid?: string, backgroundUuid?: string, folderId?: string, featPackIds?: string[],
 *   abilities?: Record<string, number>, chooseSize?: boolean, actorId?: string,
 *   items?: Array<{uuid: string, level?: number, subclassUuid?: string}>,
 *   _kit: {flagScope: string, flagKey: string}}} args
 */
async function createHero(args) {
  const { flagScope, flagKey } = args._kit;
  const level = Math.max(1, Math.min(20, Number(args.level ?? 1)));
  const rotation = Math.max(0, Math.floor(Number(args.rotation ?? 0)));
  const kitFlags = { [flagScope]: { [flagKey]: { built: true } } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const Manager = dnd5e.applications.advancement.AdvancementManager;
  const STEP_TIMEOUT = 30000;
  const picks = [];
  const traitMade = new Map();
  const warnings = [];
  let k = 0;
  // The subclass the next Subclass advancement takes: the hero's own, or the one of the extra item being added.
  let currentSubclass = args.subclassUuid;
  const pick = list => list[(rotation + k++) % list.length];
  // The most options a pick records as offered (a spell list can be long).
  const OFFERED_MAX = 300;
  const nameOf = uuid => fromUuidSync(uuid)?.name ?? uuid;

  const loadData = async (uuid, label) => {
    const doc = await fromUuid(uuid);
    if (!doc) throw new Error(`createHero: no ${label} ${uuid}`);
    return game.items.fromCompendium(doc);
  };
  const findOrigin = async (uuid, name, type) => {
    if (uuid) return loadData(uuid, type);
    const index = await game.packs.get('dnd5e.origins24').getIndex();
    const entry = index.find(e => e.type === type && e.name === name);
    if (!entry) throw new Error(`createHero: no default ${type} "${name}" in dnd5e.origins24`);
    return loadData(entry.uuid, type);
  };
  const describe = step => {
    const f = step?.flow;
    const a = f?.advancement;
    return `${f?.item?.name ?? '?'} / ${a?.constructor?.typeName ?? '?'} "${a?.title ?? ''}" / level ${f?.level ?? '?'}`;
  };

  // Candidates for an ItemChoice whose pool is empty (the player browses a compendium instead).
  const browseCandidates = async (adv, flow, lvl) => {
    const cfg = adv.configuration;
    const taken = new Set(
      adv.actor.items.map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId)
    );
    const out = new Map();
    if (cfg.type === 'spell') {
      let uuids = [];
      const lists = [...(cfg.restriction.list ?? [])];
      if (lists.length) {
        for (const key of lists) {
          const [type, ...rest] = key.split(':');
          const list = dnd5e.registry.spellLists.forType(type, rest.join(':'));
          if (list) uuids.push(...list.uuids);
        }
      } else {
        for (const pack of game.packs) {
          if (pack.documentName !== 'Item') continue;
          const index = await pack.getIndex({ fields: ['system.level'] });
          for (const e of index)
            if (e.type === 'spell')
              uuids.push(e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`);
        }
      }
      const want = cfg.restriction.level;
      const max = flow._maxSpellSlotLevel();
      for (const uuid of uuids) {
        if (taken.has(uuid)) continue;
        const entry = fromUuidSync(uuid);
        if (!entry) continue;
        const lv = Number(entry.system?.level ?? (await fromUuid(uuid))?.system?.level ?? -1);
        if (want === 'available' && lv > max) continue;
        if (want === 'availableNoCantrips' && (lv > max || lv < 1)) continue;
        if (
          want !== '' &&
          !['available', 'availableNoCantrips'].includes(want) &&
          lv !== Number(want)
        )
          continue;
        if (!out.has(entry.name)) out.set(entry.name, uuid);
      }
    } else if (cfg.type === 'feat' && cfg.restriction.type) {
      for (const pack of game.packs) {
        if (pack.documentName !== 'Item') continue;
        const index = await pack.getIndex({ fields: ['system.type.value', 'system.type.subtype'] });
        for (const e of index) {
          if (e.type !== 'feat' || e.system?.type?.value !== cfg.restriction.type) continue;
          if (cfg.restriction.subtype && e.system?.type?.subtype !== cfg.restriction.subtype)
            continue;
          const uuid = e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`;
          if (taken.has(uuid) || out.has(e.name)) continue;
          const doc = await fromUuid(uuid);
          if (doc?.system.assertPrerequisites?.(adv.actor, { level: lvl }) === true)
            out.set(e.name, uuid);
        }
      }
    }
    return [...out.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'en'))
      .map(([, uuid]) => uuid);
  };

  const chooseAbility = async (adv, lvl, title) => {
    const abilities = adv.configuration.spell?.ability;
    if (!abilities || abilities.size < 2) return;
    const ability = pick([...abilities]);
    await adv.apply(lvl, { ability });
    picks.push({
      level: lvl,
      advancement: adv.constructor.typeName,
      title: `${title} (ability)`,
      chosen: [ability],
    });
  };

  const answers = {
    async HitPoints(flow, adv, lvl) {
      if (adv.value[lvl] === undefined) {
        await adv.apply(lvl, { [lvl]: 'avg' });
        await flow.render();
      }
      const box = flow.element?.querySelector('[name="useAverage"]');
      if (box && !box.checked) {
        box.click();
        await sleep(400);
      }
    },

    async Trait(flow, adv, lvl, title) {
      const chosen = [];
      // What the system offered before the first pick, for the report's pick coverage.
      let offered = null;
      // Only as many picks as the data asks for: an advancement with fixed grants and no choices
      // (a subclass's skill grants, say) must not get a pick of ours.
      const total = (adv.configuration.choices ?? []).reduce((n, c) => n + (c.count ?? 0), 0);
      for (let guard = 0; guard < total; guard++) {
        const available = await adv.availableChoices();
        const keys = available ? [...available.choices.asSet()] : [];
        offered ??= keys.slice(0, OFFERED_MAX);
        if (!keys.length) break;
        const key = pick(keys);
        await adv.apply(lvl, { key });
        chosen.push(key);
      }
      if (chosen.length) {
        picks.push({ level: lvl, advancement: 'Trait', title, chosen, offered: offered ?? [] });
        await flow.render();
      }
      traitMade.set(adv.id, (traitMade.get(adv.id) ?? 0) + chosen.length);
    },

    async ItemChoice(flow, adv, lvl, title) {
      const need =
        (adv.configuration.choices?.[lvl]?.count ?? 0) -
        Object.keys(adv.value.added?.[lvl] ?? {}).length;
      if (need <= 0) return;
      await chooseAbility(adv, lvl, title);
      const chosen = [];
      let offered = null;
      let browse = null;
      for (let i = 0; i < need; i++) {
        let options = [...flow.element.querySelectorAll('dnd5e-checkbox')]
          .filter(c => c.name && !c.checked && !c.disabled)
          .map(c => c.name);
        options = [...new Set(options)];
        if (!options.length) {
          browse ??= await browseCandidates(adv, flow, lvl);
          options = browse.filter(u => !chosen.includes(u));
        }
        offered ??= options.slice(0, OFFERED_MAX).map(nameOf);
        if (!options.length) {
          warnings.push(`${title} level ${lvl}: ${need - i} choice(s) left, no options offered`);
          break;
        }
        const uuid = pick(options);
        try {
          await adv.apply(lvl, { selected: [uuid] });
        } catch (err) {
          warnings.push(`${title} level ${lvl}: ${nameOf(uuid)} refused: ${err.message}`);
          break;
        }
        chosen.push(uuid);
        await flow.render();
      }
      if (chosen.length)
        picks.push({
          level: lvl,
          advancement: 'ItemChoice',
          title,
          chosen: chosen.map(nameOf),
          offered: offered ?? [],
        });
    },

    async ItemGrant(flow, adv, lvl, title) {
      const abilities = adv.configuration.spell?.ability;
      if (abilities && abilities.size > 1) {
        await chooseAbility(adv, lvl, title);
        await flow.render();
      }
    },

    async Subclass(flow, adv, lvl, title) {
      if (!currentSubclass) {
        warnings.push(`${title} level ${lvl}: no subclass asked for`);
        return;
      }
      await adv.apply(lvl, { uuid: currentSubclass });
      picks.push({
        level: lvl,
        advancement: 'Subclass',
        title,
        chosen: [nameOf(currentSubclass)],
      });
      await flow.render();
    },

    // A species' size, only when the caller asks for it (it takes no k, so no other choice moves).
    async Size(flow, adv, lvl, title) {
      if (!args.chooseSize) return;
      const sizes = [...(adv.configuration.sizes ?? [])];
      if (sizes.length < 2) return;
      const size = sizes[rotation % sizes.length];
      await adv.apply(lvl, { size });
      picks.push({ level: lvl, advancement: 'Size', title, chosen: [size] });
      await flow.render();
    },

    async AbilityScoreImprovement(flow, adv, lvl, title) {
      const cfg = adv.configuration;
      const actor = adv.actor;
      let featFallback = false;
      if (adv.allowFeat && (rotation + k++) % 2 === 1) {
        const candidates = [];
        if (adv.isEpicBoon && cfg.recommendation) candidates.push(cfg.recommendation);
        for (const packId of args.featPackIds ?? []) {
          const fields = ['system.type.value', 'system.type.subtype'];
          const index = (await game.packs.get(packId)?.getIndex({ fields })) ?? [];
          // General feats, or epic boons from level 19 on (their level rule is not in the data).
          const subtypes = adv.isEpicBoon ? ['epicBoon'] : ['', 'general', undefined];
          const feats = index
            .filter(e => e.type === 'feat' && e.system?.type?.value === 'feat')
            .filter(e => subtypes.includes(e.system?.type?.subtype))
            .sort((a, b) => a.name.localeCompare(b.name, 'en'));
          const start = feats.length ? (rotation + k) % feats.length : 0;
          for (let i = 0; i < feats.length; i++) {
            candidates.push(
              feats[(start + i) % feats.length].uuid ??
                `Compendium.${packId}.Item.${feats[(start + i) % feats.length]._id}`
            );
          }
        }
        for (const uuid of candidates.slice(0, 15)) {
          const doc = await fromUuid(uuid);
          if (!doc || doc.system.assertPrerequisites?.(actor, { showMessage: false }) !== true)
            continue;
          await adv.apply(lvl, { type: 'feat', uuid });
          if (adv.value.type === 'feat') {
            picks.push({
              level: lvl,
              advancement: adv.constructor.typeName,
              title,
              chosen: [`feat: ${doc.name}`],
            });
            await flow.render();
            return;
          }
        }
        // Few general feats exist in the SRD and none repeat: the improvement it is.
        featFallback = true;
      }
      const keys = Object.keys(CONFIG.DND5E.abilities).filter(
        a => adv.canImprove(a) && !cfg.locked.has(a)
      );
      const cap = rotation % 2 === 0 ? (cfg.cap ?? 2) : 1;
      let remaining = cfg.points ?? 0;
      const assignments = {};
      const start = (rotation + k++) % keys.length;
      for (let i = 0; i < keys.length && remaining > 0; i++) {
        const key = keys[(start + i) % keys.length];
        const ability = actor.system.abilities[key];
        const room =
          Math.max(ability.max, cfg.max ?? -Infinity) -
          (actor.system._source.abilities[key]?.value ?? ability.value);
        const give = Math.min(cap, remaining, room);
        if (give > 0) {
          assignments[key] = give;
          remaining -= give;
        }
      }
      if (Object.keys(assignments).length) {
        await adv.apply(lvl, { type: 'asi', assignments });
        picks.push({
          level: lvl,
          advancement: adv.constructor.typeName,
          title: featFallback ? `${title} (no feat left)` : title,
          chosen: Object.entries(assignments).map(([key, v]) => `${key} +${v}`),
        });
        await flow.render();
      }
    },
  };

  // Run one manager to the end, answering every choice.
  const runManager = async (actor, itemData, label) => {
    const mgr = Manager.forNewItem(actor, itemData, { automaticApplication: true });
    if (!mgr.steps.length) {
      await actor.createEmbeddedDocuments('Item', [itemData]);
      return;
    }
    let done = false;
    const hook = Hooks.on('dnd5e.advancementManagerComplete', m => {
      if (m === mgr) done = true;
    });
    try {
      await mgr.render(true);
      let lastStep = null;
      let idle = 0;
      while (!done) {
        await sleep(120);
        idle += 120;
        const step = mgr.step;
        if (!mgr.rendered && !done && idle > 2000) {
          throw new Error(`createHero: the advancement manager closed before finishing (${label})`);
        }
        if (step && step === lastStep) {
          if (step.error)
            throw new Error(
              `createHero: ${label}: ${describe(step)} failed: ${step.error.message}`
            );
          if (idle > STEP_TIMEOUT)
            throw new Error(`createHero: ${label}: stuck after answering ${describe(step)}`);
          continue;
        }
        const flow = step?.flow;
        const button = mgr.element?.querySelector('[data-action="next"],[data-action="complete"]');
        if (!step || !flow?.rendered || !flow.element?.isConnected || !button || button.disabled) {
          if (idle > STEP_TIMEOUT)
            throw new Error(`createHero: ${label}: the step never appeared ${describe(step)}`);
          continue;
        }
        lastStep = step;
        idle = 0;
        const adv = flow.advancement;
        const type = adv?.constructor?.typeName;
        if (answers[type])
          await answers[type](flow, adv, flow.level, `${flow.item.name}: ${adv.title}`);
        (
          mgr.element?.querySelector('[data-action="next"],[data-action="complete"]') ?? button
        ).click();
      }
    } finally {
      Hooks.off('dnd5e.advancementManagerComplete', hook);
      if (mgr.rendered) await mgr.close({ skipConfirmation: true });
    }
  };

  // A Trait choice the manager never asked (nothing was left to choose, so it skips the step) or
  // that was only partly made: say which, so a check can tell "every option was already taken"
  // from a choice the builder missed.
  const auditTraits = async actor => {
    const roots = [actor.itemTypes.class[0], actor.itemTypes.subclass[0]].filter(Boolean);
    for (const root of roots) {
      for (const adv of Object.values(root.advancement.byId)) {
        if (adv.constructor.typeName !== 'Trait' || adv.classRestriction === 'secondary') continue;
        const lvl = Number((adv.levels ?? [])[0]);
        if (!lvl || lvl > level) continue;
        const total = (adv.configuration.choices ?? []).reduce((n, c) => n + (c.count ?? 0), 0);
        const made = traitMade.get(adv.id) ?? 0;
        if (total <= made) continue;
        const available = await adv.availableChoices?.();
        const keys = available ? [...available.choices.asSet()] : [];
        const title = `${root.name}: ${adv.title}`;
        warnings.push(
          keys.length
            ? `${title} level ${lvl}: ${total - made} of ${total} choice(s) left, ${keys.length} option(s) were still open`
            : `${title} level ${lvl}: ${total - made} of ${total} choice(s) left, every option is already taken`
        );
      }
    }
  };

  const closeStray = async () => {
    for (const app of [...foundry.applications.instances.values()]) {
      const advancement = app.options?.classes?.includes('advancement');
      if (advancement || app instanceof foundry.applications.api.DialogV2) {
        await app.close({ skipConfirmation: true }).catch(() => {});
      }
    }
  };

  // An existing kit hero (a feat or a second class is added to it), or a new one.
  const existing = args.actorId ? game.actors.get(args.actorId) : null;
  if (args.actorId && !existing) throw new Error(`createHero: no actor ${args.actorId}`);
  if (existing && !existing.getFlag(flagScope, flagKey))
    throw new Error(`createHero: ${existing.name} is not a kit actor; not changing it`);
  const array = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8, ...(args.abilities ?? {}) };
  const actor =
    existing ??
    (await Actor.implementation.create({
      name: args.name,
      type: 'character',
      folder: args.folderId ?? null,
      flags: kitFlags,
      // The standard array unless the caller gives scores; Constitution 13 gives +1 hit point per level.
      system: {
        abilities: Object.fromEntries(Object.entries(array).map(([id, value]) => [id, { value }])),
      },
    }));
  try {
    if (!existing || args.speciesUuid)
      await runManager(actor, await findOrigin(args.speciesUuid, 'Human', 'race'), 'species');
    if (!existing || args.backgroundUuid)
      await runManager(
        actor,
        await findOrigin(args.backgroundUuid, 'Soldier', 'background'),
        'background'
      );
    const added = [];
    if (args.classUuid) {
      const klass = await loadData(args.classUuid, 'class');
      klass.system.levels = level;
      klass.flags = { ...(klass.flags ?? {}), ...kitFlags };
      await runManager(actor, klass, 'class');
    }
    // Extra items through the same manager: a feat, or a second class at its own level.
    for (const extra of args.items ?? []) {
      const data = await loadData(extra.uuid, 'item');
      if (data.type === 'class') {
        data.system.levels = Math.max(1, Math.min(20, Number(extra.level ?? 1)));
        data.flags = { ...(data.flags ?? {}), ...kitFlags };
      }
      currentSubclass = extra.subclassUuid;
      await runManager(actor, data, `${data.type} ${data.name}`);
      added.push({ uuid: extra.uuid, name: data.name, type: data.type });
    }
    await auditTraits(actor);
    // A new hero starts at full health with every spell slot ready.
    const max = actor.system.attributes.hp.max;
    const fill = {};
    if (actor.system.attributes.hp.value !== max) fill['system.attributes.hp.value'] = max;
    for (const [key, slot] of Object.entries(actor.system.spells ?? {})) {
      if (slot.max && slot.value !== slot.max) fill[`system.spells.${key}.value`] = slot.max;
    }
    if (Object.keys(fill).length) await actor.update(fill);
    const classItem = actor.itemTypes.class[0];
    if (!classItem && (args.classUuid || !existing))
      throw new Error('createHero: the class item was not added');
    const subclassItem = actor.itemTypes.subclass[0] ?? null;
    if (args.subclassUuid && !subclassItem) {
      warnings.push(
        'the subclass was asked for but not applied (the class has no subclass step up to this level)'
      );
    }
    return {
      actorId: actor.id,
      name: actor.name,
      classIdentifier: classItem?.system.identifier ?? '',
      subclassIdentifier: subclassItem?.system.identifier ?? '',
      level: actor.system.details.level,
      hp: { value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max },
      picks,
      warnings,
      classes: actor.itemTypes.class.map(c => ({
        identifier: c.system.identifier,
        levels: c.system.levels,
        subclass: c.subclass?.system.identifier ?? null,
      })),
      added,
    };
  } catch (err) {
    if (!existing) await actor.delete().catch(() => {});
    throw err;
  } finally {
    await closeStray();
  }
}

/**
 * A gridded scene without an image: a rectangular room of walls with one door and a light.
 * `width` and `height` are in grid squares, `grid` is the square size in pixels (default 100),
 * `walls` (boolean) draws the four room walls, `doors` is how many door segments the bottom
 * wall gets (0 or 1), `lights` is how many lights to place (in the middle of the room).
 * The scene is activated; the call returns once the canvas has drawn it.
 * @param {{name: string, folderId?: string, width: number, height: number, grid?: number, walls?: boolean, doors?: number, lights?: number, _kit: {flagScope: string, flagKey: string}}} args
 */
async function createCombatScene(args) {
  const { flagScope, flagKey } = args._kit;
  const size = args.grid ?? 100;
  const cols = args.width;
  const rows = args.height;
  const w = cols * size;
  const h = rows * size;
  const scene = await Scene.create({
    name: args.name,
    folder: args.folderId ?? null,
    width: cols * size,
    height: rows * size,
    padding: 0,
    backgroundColor: '#2b2b33',
    grid: { type: CONST.GRID_TYPES.SQUARE, size, distance: 5, units: 'ft' },
    tokenVision: true,
    fog: { exploration: false },
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  // activate() alone draws it (a second view() call races the first draw and logs canvas errors).
  // Walls and lights come after the canvas is ready: placeables created before the first draw are
  // drawn while the canvas is torn down and rebuilt, and log uncaught canvas errors.
  await scene.activate();
  const until = Date.now() + 45000;
  while (!(globalThis.canvas?.ready && globalThis.canvas.scene?.id === scene.id)) {
    if (Date.now() > until) throw new Error('createCombatScene: the canvas did not draw the scene');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (args.walls !== false) {
    const wall = (x1, y1, x2, y2, door = 0) => ({ c: [x1, y1, x2, y2], door });
    const walls = [wall(0, 0, w, 0), wall(0, 0, 0, h), wall(w, 0, w, h)];
    if ((args.doors ?? 1) > 0) {
      const gap = Math.floor(cols / 2) * size;
      walls.push(wall(0, h, gap, h), wall(gap, h, gap + size, h, CONST.WALL_DOOR_TYPES.DOOR));
      walls.push(wall(gap + size, h, w, h));
    } else walls.push(wall(0, h, w, h));
    await scene.createEmbeddedDocuments('Wall', walls);
  }
  const lightCount = args.lights ?? 1;
  if (lightCount > 0) {
    const lights = Array.from({ length: lightCount }, (_, i) => ({
      x: Math.round(w / 2) + i * size,
      y: Math.round(h / 2),
      config: { dim: 30, bright: 15 }, // grid distance units (ft)
    }));
    await scene.createEmbeddedDocuments('AmbientLight', lights);
  }
  return { sceneId: scene.id, name: scene.name };
}

/**
 * A token for an actor on a scene; x and y are grid squares (top-left of the token). The actor
 * is adopted into the kit: it gets the kit flag and the kit Actor folder if one exists, so a
 * rebuild wipes actors the bridge created too.
 * @param {{sceneId: string, actorId: string, x: number, y: number, hidden?: boolean, name?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function placeToken(args) {
  const { flagScope, flagKey } = args._kit;
  const scene = game.scenes.get(args.sceneId);
  if (!scene) throw new Error(`placeToken: no scene ${args.sceneId}`);
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`placeToken: no actor ${args.actorId}`);
  if (!actor.getFlag(flagScope, flagKey)) {
    const folder = game.folders.find(f => f.type === 'Actor' && f.getFlag(flagScope, flagKey));
    const update = { [`flags.${flagScope}.${flagKey}`]: { built: true } };
    if (folder && !actor.folder) update.folder = folder.id;
    await actor.update(update);
  }
  const size = scene.grid.size;
  const overrides = { x: args.x * size, y: args.y * size, hidden: !!args.hidden };
  if (args.name) overrides.name = args.name;
  const data = (await actor.getTokenDocument(overrides)).toObject();
  data.flags = { ...(data.flags ?? {}), [flagScope]: { [flagKey]: { built: true } } };
  // A few SRD monsters ship with no image (Allosaurus, Ankylosaurus); an empty token texture makes
  // the canvas log "Requested texture path is empty".
  if (!data.texture?.src) {
    data.texture = { ...(data.texture ?? {}), src: 'icons/svg/mystery-man.svg' };
  }
  const [token] = await scene.createEmbeddedDocuments('Token', [data]);
  return { tokenId: token.id };
}

/**
 * A new combat on a scene with those tokens, initiative rolled and started.
 * @param {{sceneId: string, tokenIds: string[], _kit: {flagScope: string, flagKey: string}}} args
 */
async function startCombat(args) {
  const { flagScope, flagKey } = args._kit;
  const scene = game.scenes.get(args.sceneId);
  if (!scene) throw new Error(`startCombat: no scene ${args.sceneId}`);
  const combat = await Combat.implementation.create({
    scene: scene.id,
    active: true,
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  const combatants = args.tokenIds.map(id => {
    const token = scene.tokens.get(id);
    if (!token) throw new Error(`startCombat: no token ${id} on ${scene.name}`);
    return { tokenId: id, sceneId: scene.id, actorId: token.actorId, hidden: token.hidden };
  });
  const created = await combat.createEmbeddedDocuments('Combatant', combatants);
  await combat.rollAll();
  await combat.startCombat();
  // Foundry returns the new combatants in its own order; hand the ids back in the order asked.
  const byToken = new Map(created.map(c => [c.tokenId, c.id]));
  return { combatId: combat.id, combatantIds: args.tokenIds.map(id => byToken.get(id)) };
}

/**
 * Delete every combat on a kit scene (or carrying the kit flag). `endCombat()` opens a confirm
 * dialog in Foundry 14, so this deletes the document instead.
 * @param {{_kit: {flagScope: string, flagKey: string}}} args
 */
async function endCombats(args) {
  const { flagScope, flagKey } = args._kit;
  const ids = game.combats
    .filter(c => c.getFlag(flagScope, flagKey) || c.scene?.getFlag(flagScope, flagKey))
    .map(c => c.id);
  if (ids.length) await Combat.deleteDocuments(ids);
  return { ended: ids.length };
}

/**
 * With `sceneId` and `tokenId` it reads the token's actor (an unlinked token has its own HP).
 * @param {{actorId: string, sceneId?: string, tokenId?: string}} args
 */
async function readActor(args) {
  let actor = game.actors.get(args.actorId);
  if (args.tokenId) {
    const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
    if (!token?.actor) throw new Error(`readActor: no token ${args.tokenId} on ${args.sceneId}`);
    actor = token.actor;
  }
  if (!actor) throw new Error(`readActor: no actor ${args.actorId}`);
  const hp = actor.system.attributes?.hp ?? {};
  return {
    name: actor.name,
    hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0 },
    conditions: [...actor.statuses],
  };
}

/**
 * Everything the feature scenarios need to know about one actor, read only: its features with
 * their uses, activities (and what each consumes) and effects, plus the derived numbers the deep
 * checks compare with the rules (proficiency bonus, armor class, hit dice, slots, scale values).
 * Verified against dnd5e 6.0.5: `item.system.uses` has `max` (a number once prepared), `spent` and
 * `recovery`; `item.system.activities` is a collection of activities with `consumption.targets`.
 * @param {{actorId: string}} args
 */
async function inspectFeatures(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`inspectFeatures: no actor ${args.actorId}`);
  const list = coll => Array.from(coll?.values?.() ?? coll ?? []);
  const numOrNull = v =>
    v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const plain = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v.value === 'number' || typeof v.value === 'string') return v.value;
    return v.display ?? String(v);
  };
  const scale = {};
  const classes = [];
  for (const cls of actor.itemTypes.class) {
    scale[cls.system.identifier] = {};
    const own = { ...(cls.scaleValues ?? {}), ...(cls.subclass?.scaleValues ?? {}) };
    for (const [id, v] of Object.entries(own)) scale[cls.system.identifier][id] = plain(v);
    classes.push({
      identifier: cls.system.identifier,
      denomination: String(cls.system.hd?.denomination ?? ''),
      levels: cls.system.levels,
      spent: cls.system.hd?.spent ?? 0,
    });
  }
  const abilities = {};
  for (const [id, a] of Object.entries(actor.system.abilities))
    abilities[id] = { value: a.value, mod: a.mod };
  const spells = {};
  for (const [key, s] of Object.entries(actor.system.spells ?? {})) {
    if (!s.max) continue;
    spells[key] = { value: s.value ?? 0, max: s.max, level: s.level ?? 0, type: s.type ?? '' };
  }
  const armorTypes = ['light', 'medium', 'heavy', 'shield'];
  const items = actor.items.map(item => {
    const u = item.system.uses;
    const uses =
      u && (numOrNull(u.max) !== null || (u.recovery?.length ?? 0) > 0)
        ? {
            max: numOrNull(u.max),
            spent: numOrNull(u.spent) ?? 0,
            recovery: Array.from(u.recovery ?? []).map(r => ({
              period: String(r.period ?? ''),
              type: String(r.type ?? ''),
              formula: String(r.formula ?? ''),
            })),
          }
        : null;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      identifier: item.system?.identifier ?? null,
      sourceUuid: item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId ?? null,
      equipped: !!item.system?.equipped,
      uses,
      activities: list(item.system?.activities).map(a => ({
        id: a.id,
        type: a.type,
        name: a.name ?? '',
        activation: a.activation?.type ?? '',
        activationValue: numOrNull(a.activation?.value),
        canUse: !!a.canUse,
        consumption: list(a.consumption?.targets).map(t => ({
          type: String(t.type ?? ''),
          target: String(t.target ?? ''),
          value: String(t.value ?? ''),
        })),
      })),
      effects: item.effects.map(e => ({
        id: e.id,
        name: e.name,
        disabled: !!e.disabled,
        transfer: !!e.transfer,
        changes: (e.changes ?? []).map(c => ({
          key: String(c.key),
          value: String(c.value),
          type: String(c.type ?? ''),
        })),
      })),
    };
  });
  const ac = actor.system.attributes.ac ?? {};
  const hd = actor.system.attributes.hd ?? {};
  let npc;
  if (actor.type === 'npc') {
    const speed = (m, key) => numOrNull(m?.speeds?.[key] ?? m?.[key]) ?? 0;
    const speeds = m => ({
      walk: speed(m, 'walk'),
      fly: speed(m, 'fly'),
      swim: speed(m, 'swim'),
      burrow: speed(m, 'burrow'),
      climb: speed(m, 'climb'),
      hover: !!m?.hover,
    });
    const counter = r =>
      r && Number(r.max) > 0 ? { max: Number(r.max), spent: Number(r.spent) || 0 } : null;
    const res = actor.system.resources ?? {};
    npc = {
      cr: actor.system.details.cr ?? null,
      creatureType: String(actor.system.details.type?.value ?? ''),
      size: String(actor.system.traits?.size ?? ''),
      ac: numOrNull(ac.value),
      movement: speeds(actor.system.attributes.movement),
      movementSource: speeds(actor._source.system.attributes.movement),
      resources: {
        legact: counter(res.legact),
        legres: counter(res.legres),
        lair: res.lair
          ? {
              value: res.lair.value === true,
              initiative: numOrNull(res.lair.initiative),
              inside: res.lair.inside === true,
            }
          : null,
      },
      spell: {
        ability: String(actor.system.attributes.spellcasting ?? ''),
        dc: numOrNull(actor.system.attributes.spell?.dc) ?? 0,
      },
    };
  }
  return {
    ...(npc ? { npc } : {}),
    name: actor.name,
    level: actor.system.details.level,
    prof: actor.system.attributes.prof,
    ac: {
      value: ac.value,
      calc: String(ac.calc ?? ''),
      armor: actor.items.some(
        i =>
          i.type === 'equipment' && i.system.equipped && armorTypes.includes(i.system.type?.value)
      ),
    },
    hd: { value: hd.value ?? 0, max: hd.max ?? 0, classes },
    hp: { value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max },
    abilities,
    spells,
    scale,
    items,
  };
}

/**
 * Runs one thing on an actor and puts the actor back as it was found (see the contract). The state
 * that is saved and restored: every item's uses (and each activity's), quantity, hit dice spent and
 * effects' disabled flag; the spell slots; hit points; exhaustion; and the ids of the actor's
 * effects, items and of the chat messages, so what the run created is deleted again. The reply says
 * whether the restore worked (`restored`, `drift`).
 * @param {{actorId: string, op: 'use'|'effect'|'rest', itemId?: string, activityId?: string, effectId?: string,
 *   enabled?: boolean, read?: string[], type?: 'short'|'long'}} args
 */
async function exerciseActor(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`exerciseActor: no actor ${args.actorId}`);
  const list = coll => Array.from(coll?.values?.() ?? coll ?? []);

  const state = () => {
    const items = {};
    for (const item of actor.items) {
      items[item.id] = {
        spent: item.system.uses?.spent ?? null,
        quantity: item.system.quantity ?? null,
        activities: Object.fromEntries(
          list(item.system.activities).map(a => [a.id, a.uses?.spent ?? null])
        ),
        effects: Object.fromEntries(item.effects.map(e => [e.id, !!e.disabled])),
        hd: item.type === 'class' ? (item.system.hd?.spent ?? 0) : null,
      };
    }
    const spells = {};
    for (const [key, s] of Object.entries(actor.system.spells ?? {})) spells[key] = s.value ?? 0;
    const hp = actor.system.attributes.hp;
    return {
      items,
      spells,
      effects: actor.effects.map(e => e.id).sort(),
      messages: game.messages.map(m => m.id).sort(),
      hp: { value: hp.value, temp: hp.temp ?? 0 },
      exhaustion: actor.system.attributes.exhaustion ?? 0,
      // The whole stored actor.system, so any other change (death saves, currency, resources...) shows.
      system: JSON.parse(JSON.stringify(actor._source.system)),
    };
  };

  const restoreErrors = [];
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      restoreErrors.push(`${label}: ${err?.message ?? err}`);
    }
  };

  const restore = async before => {
    // Hit points, slots and exhaustion first: the system adds and removes its own effects (the
    // bloodied status) when hit points change, so what is left over is read after it has settled.
    await attempt('actor', async () => {
      const now = state();
      const update = {};
      for (const [key, value] of Object.entries(before.spells)) {
        if (now.spells[key] !== value) update[`system.spells.${key}.value`] = value;
      }
      if (now.hp.value !== before.hp.value) update['system.attributes.hp.value'] = before.hp.value;
      if (now.hp.temp !== before.hp.temp) update['system.attributes.hp.temp'] = before.hp.temp;
      if (now.exhaustion !== before.exhaustion)
        update['system.attributes.exhaustion'] = before.exhaustion;
      if (Object.keys(update).length) await actor.update(update);
      // Wait (up to 3 s) until the bloodied status is as it was: the system adds or removes it by itself.
      const bloodied = () => actor.effects.some(e => e.statuses?.has('bloodied'));
      const wasBloodied = actor.effects.some(
        e => before.effects.includes(e.id) && e.statuses?.has('bloodied')
      );
      for (let i = 0; i < 30 && bloodied() !== wasBloodied; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
    // Whatever else differs in actor.system goes back by its path.
    await attempt('system', async () => {
      const was = foundry.utils.flattenObject(before.system);
      const now = foundry.utils.flattenObject(state().system);
      const update = {};
      for (const [path, value] of Object.entries(was)) {
        if (JSON.stringify(now[path]) !== JSON.stringify(value)) update[`system.${path}`] = value;
      }
      if (Object.keys(update).length) await actor.update(update);
    });
    await attempt('items', async () => {
      const now = state();
      for (const [id, was] of Object.entries(before.items)) {
        const item = actor.items.get(id);
        const cur = now.items[id];
        if (!item || !cur) continue;
        const update = {};
        // A fresh item can have `spent: null` in its source; that goes back as null too.
        if (cur.spent !== was.spent && item.system.uses) update['system.uses.spent'] = was.spent;
        if (was.quantity !== null && cur.quantity !== was.quantity)
          update['system.quantity'] = was.quantity;
        for (const [aid, spent] of Object.entries(was.activities)) {
          if (cur.activities[aid] !== spent && item.system.activities?.get(aid))
            update[`system.activities.${aid}.uses.spent`] = spent;
        }
        if (was.hd !== null && cur.hd !== was.hd) update['system.hd.spent'] = was.hd;
        if (Object.keys(update).length) await item.update(update);
        const effects = Object.entries(was.effects)
          .filter(
            ([eid, disabled]) =>
              item.effects.get(eid) && !!item.effects.get(eid).disabled !== disabled
          )
          .map(([eid, disabled]) => ({ _id: eid, disabled }));
        if (effects.length) await item.updateEmbeddedDocuments('ActiveEffect', effects);
      }
    });
    await attempt('new items', async () => {
      const ids = actor.items.filter(i => !(i.id in before.items)).map(i => i.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('Item', ids);
    });
    await attempt('new effects', async () => {
      const ids = actor.effects.filter(e => !before.effects.includes(e.id)).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
    });
    await attempt('new messages', async () => {
      const ids = game.messages.filter(m => !before.messages.includes(m.id)).map(m => m.id);
      if (ids.length) await ChatMessage.deleteDocuments(ids);
    });
  };

  /** What differs between two states, in words (empty when they are equal). */
  const drift = (a, b) => {
    const out = [];
    for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
      if (JSON.stringify(a.items[id]) !== JSON.stringify(b.items[id])) {
        const fields = Object.keys({ ...a.items[id], ...b.items[id] }).filter(
          f => JSON.stringify(a.items[id]?.[f]) !== JSON.stringify(b.items[id]?.[f])
        );
        out.push(
          `item ${actor.items.get(id)?.name ?? id} (${fields.join(', ') || 'added or removed'})`
        );
      }
    }
    for (const key of ['spells', 'effects', 'messages', 'hp', 'exhaustion']) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
    }
    const was = foundry.utils.flattenObject(a.system);
    const now = foundry.utils.flattenObject(b.system);
    const paths = new Set([...Object.keys(was), ...Object.keys(now)]);
    for (const path of paths) {
      if (JSON.stringify(was[path]) !== JSON.stringify(now[path])) out.push(`system.${path}`);
    }
    return out;
  };

  const before = state();
  let result;
  try {
    if (args.op === 'use') {
      const item = actor.items.get(args.itemId);
      const activity = item?.system.activities?.get(args.activityId);
      if (!item || !activity)
        throw new Error(`exerciseActor: no activity ${args.itemId}/${args.activityId}`);
      // The system's error notifications become `notes` instead of toasts (and console errors).
      const notes = [];
      const patched = {};
      const ours = (level, orig) => (message, options) => {
        let text = String(message);
        if (options?.localize || game.i18n.has(text)) text = game.i18n.localize(text);
        notes.push({ level, message: text });
        return orig;
      };
      for (const level of ['error', 'warn']) {
        patched[level] = {
          own: Object.prototype.hasOwnProperty.call(ui.notifications, level),
          orig: ui.notifications[level],
        };
        ui.notifications[level] = ours(level, undefined);
      }
      let results;
      let threw = null;
      // A use that still opens a dialog would wait for ever: give it 20 s, then close what it opened.
      const openBefore = new Set(foundry.applications.instances.keys());
      try {
        // No dialog, no measured template, no summons, no action cost, no roll after the card.
        const use = activity.use(
          {
            // Action consumption is what spends resources.legact for a legendary activation that has
            // no consumption target of its own (dnd5e 6, _prepareUsageUpdates): off unless asked for.
            consume: { action: args.consumeAction === true },
            create: { measuredTemplate: false, summons: false },
            concentration: { begin: false },
            subsequentActions: false,
          },
          { configure: false },
          {}
        );
        use.catch(() => {});
        let timer;
        const limit = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out after 20 s, probably waiting for a dialog')),
            20000
          );
        });
        try {
          results = await Promise.race([use, limit]);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        threw = String(err?.message ?? err);
      } finally {
        for (const level of ['error', 'warn']) {
          if (patched[level].own) ui.notifications[level] = patched[level].orig;
          else delete ui.notifications[level];
        }
        for (const [id, app] of [...foundry.applications.instances.entries()]) {
          if (!openBefore.has(id)) await app.close({ skipConfirmation: true }).catch(() => {});
        }
      }
      const after = state();
      const messageId = results?.message?.id ?? null;
      const spells = {};
      for (const [key, value] of Object.entries(after.spells)) {
        if (before.spells[key] !== value)
          spells[key] = { before: before.spells[key] ?? 0, after: value };
      }
      result = {
        ok: !!results && typeof results === 'object' && !threw,
        notes,
        threw,
        chatCard: !!messageId && game.messages.has(messageId),
        uses: {
          before: before.items[item.id]?.spent ?? null,
          after: after.items[item.id]?.spent ?? null,
          max: Number.isFinite(Number(item.system.uses?.max)) ? Number(item.system.uses.max) : null,
        },
        spells,
        effects: actor.effects
          .filter(e => !before.effects.includes(e.id))
          .map(e => ({
            name: e.name,
            changes: (e.changes ?? []).map(c => ({ key: String(c.key), value: String(c.value) })),
          })),
        itemsCreated: Object.keys(after.items).filter(id => !(id in before.items)).length,
        changed: (() => {
          const was = foundry.utils.flattenObject(before.system);
          const now = foundry.utils.flattenObject(after.system);
          const out = {};
          for (const path of new Set([...Object.keys(was), ...Object.keys(now)])) {
            if (JSON.stringify(was[path]) === JSON.stringify(now[path])) continue;
            if (Object.keys(out).length >= 60) break;
            out[path] = { before: was[path] ?? null, after: now[path] ?? null };
          }
          return out;
        })(),
      };
    } else if (args.op === 'effect') {
      const item = actor.items.get(args.itemId);
      const effect = item?.effects.get(args.effectId);
      if (!item || !effect)
        throw new Error(`exerciseActor: no effect ${args.itemId}/${args.effectId}`);
      const read = () => {
        const out = {};
        const rollData = actor.getRollData();
        for (const path of args.read ?? []) {
          let v = foundry.utils.getProperty(actor, path);
          if (v instanceof Set) v = [...v];
          const entry = { value: v ?? null };
          if (typeof v === 'string' && v.trim()) {
            try {
              entry.resolved = Number(dnd5e.utils.simplifyBonus(v, rollData));
            } catch {
              entry.resolved = null;
            }
          }
          out[path] = entry;
        }
        return out;
      };
      const was = read();
      // An effect on an item is applied to the actor as a copy (what the chat card's apply
      // button does); the copy is deleted again by the restore.
      if (args.enabled) {
        const data = effect.toObject();
        delete data._id;
        data.origin = item.uuid;
        data.disabled = false;
        data.transfer = false;
        await actor.createEmbeddedDocuments('ActiveEffect', [data]);
      }
      result = { before: was, during: read() };
    } else if (args.op === 'recharge') {
      const item = actor.items.get(args.itemId);
      const recharge = item?.system.uses?.recovery?.find(r => r.period === 'recharge');
      if (!item || !recharge) throw new Error(`exerciseActor: no recharge on ${args.itemId}`);
      const max = Number(item.system.uses.max) || 1;
      const target = parseInt(recharge.formula);
      const rolls = [];
      for (let i = 0; i < Math.max(1, Number(args.rolls ?? 6)); i += 1) {
        await item.update({ 'system.uses.spent': max });
        const spentBefore = Number(item.system.uses.spent);
        const reply = await item.system.uses.rollRecharge({ apply: true });
        const roll = reply?.rolls?.[0];
        rolls.push({
          total: roll ? Number(roll.total) : null,
          success: roll ? roll.isSuccess === true : null,
          spentBefore,
          spentAfter: Number(item.system.uses.spent),
        });
      }
      result = { target, max, rolls };
    } else if (args.op === 'rest') {
      const summary = () => ({
        items: actor.items
          .filter(i => (i.system.uses?.recovery?.length ?? 0) > 0 && Number(i.system.uses.max) > 0)
          .map(i => ({
            id: i.id,
            name: i.name,
            max: Number(i.system.uses.max),
            spent: Number(i.system.uses.spent) || 0,
            recovery: Array.from(i.system.uses.recovery).map(r => ({
              period: String(r.period ?? ''),
              type: String(r.type ?? ''),
              formula: String(r.formula ?? ''),
            })),
          })),
        spells: Object.fromEntries(
          Object.entries(actor.system.spells ?? {})
            .filter(([, s]) => s.max)
            .map(([key, s]) => [
              key,
              { value: s.value ?? 0, max: s.max, type: String(s.type ?? '') },
            ])
        ),
        hp: { value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max },
        hd: {
          value: actor.system.attributes.hd?.value ?? 0,
          max: actor.system.attributes.hd?.max ?? 0,
        },
      });
      // Spend everything first, so a rest has something to give back.
      for (const row of summary().items) {
        await actor.items.get(row.id).update({ 'system.uses.spent': row.max });
      }
      for (const cls of actor.itemTypes.class) {
        await cls.update({ 'system.hd.spent': cls.system.hd.max });
      }
      const update = { 'system.attributes.hp.value': 1 };
      for (const [key, s] of Object.entries(actor.system.spells ?? {})) {
        if (s.max) update[`system.spells.${key}.value`] = 0;
      }
      await actor.update(update);
      const afterSpend = summary();
      const config = { dialog: false, chat: false, advanceTime: false, advanceBastionTurn: false };
      if (args.type === 'long') await actor.longRest(config);
      else await actor.shortRest(config);
      // Let the system finish what it does after a rest before the hero is put back.
      await new Promise(resolve => setTimeout(resolve, 300));
      result = { type: args.type, afterSpend, afterRest: summary() };
    } else {
      throw new Error(`exerciseActor: unknown op "${args.op}"`);
    }
  } finally {
    await restore(before);
  }
  const final = state();
  const differences = [...restoreErrors.map(e => `restore failed, ${e}`), ...drift(before, final)];
  return { ...result, restored: differences.length === 0, drift: differences };
}

/**
 * The monsters of one compendium pack as facts: one row per actor of type npc, sorted by name then
 * id, `count` rows from `from`. Names, numbers and flags only, never text. Read only. Verified
 * against dnd5e 6.0.5: `system.resources.legact|legres` are `{max, spent}`, `lair` is `{value,
 * initiative, inside}`, `traits.dr|di|dv|ci.value` are Sets, `attributes.senses` has the ranges
 * as plain numbers, an item's activities are a collection (a feat or weapon of an npc has them).
 * @param {{packId: string, from?: number, count?: number}} args
 */
async function listMonsters(args) {
  const pack = game.packs.get(args.packId);
  if (!pack) {
    return { packId: args.packId, installed: false, total: 0, skipped: {}, from: 0, entries: [] };
  }
  const index = await pack.getIndex();
  const skipped = {};
  const npcs = [];
  for (const e of index) {
    if (e.type !== 'npc') skipped[e.type] = (skipped[e.type] ?? 0) + 1;
    else npcs.push(e);
  }
  npcs.sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
  );
  const from = Math.max(0, Number(args.from ?? 0));
  const count = Math.max(1, Number(args.count ?? 100));
  const slice = npcs.slice(from, from + count);
  const docs = slice.length ? await pack.getDocuments({ _id__in: slice.map(e => e._id) }) : [];
  const byId = new Map(docs.map(d => [d.id, d]));
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const words = v =>
    Array.from(v ?? [])
      .map(String)
      .sort();
  const list = coll => Array.from(coll?.values?.() ?? coll ?? []);
  const entries = [];
  for (const e of slice) {
    const d = byId.get(e._id);
    if (!d) continue;
    const sys = d.system;
    const mv = sys.attributes.movement ?? {};
    const sn = sys.attributes.senses?.ranges ?? sys.attributes.senses ?? {};
    const source = sys.source;
    const items = list(d.items);
    const named = re => items.some(i => re.test(i.name));
    const activities = items.flatMap(i => list(i.system?.activities));
    const spells = items.filter(i => i.type === 'spell');
    entries.push({
      packId: args.packId,
      id: d.id,
      uuid: d.uuid,
      name: d.name,
      cr: sys.details?.cr ?? null,
      creatureType: String(sys.details?.type?.value ?? ''),
      size: String(sys.traits?.size ?? ''),
      book: typeof source === 'object' && source ? String(source.book ?? '') : String(source ?? ''),
      rules: typeof source === 'object' && source ? String(source.rules ?? '') : '',
      hp: num(sys.attributes.hp?.max),
      ac: num(sys.attributes.ac?.value),
      movement: {
        walk: num(mv.walk),
        fly: num(mv.fly),
        swim: num(mv.swim),
        burrow: num(mv.burrow),
        climb: num(mv.climb),
        hover: !!mv.hover,
        units: String(mv.units ?? ''),
      },
      senses: {
        darkvision: num(sn.darkvision),
        blindsight: num(sn.blindsight),
        tremorsense: num(sn.tremorsense),
        truesight: num(sn.truesight),
        special: !!sys.attributes.senses?.special,
      },
      languages: words(sys.traits?.languages?.labels?.languages),
      resist: {
        dr: words(sys.traits?.dr?.value),
        di: words(sys.traits?.di?.value),
        dv: words(sys.traits?.dv?.value),
        ci: words(sys.traits?.ci?.value),
        dm: Object.keys(sys.traits?.dm?.amount ?? {}).length > 0,
      },
      spell: {
        spells: spells.length,
        ability: String(sys.attributes.spellcasting ?? ''),
        innate:
          named(/innate spellcasting/i) ||
          spells.some(i => ['innate', 'atwill'].includes(String(i.system?.method ?? ''))),
        dc: num(sys.attributes.spell?.dc),
      },
      legact: num(sys.resources?.legact?.max),
      legres: num(sys.resources?.legres?.max),
      lair: sys.resources?.lair?.value === true,
      items: items.length,
      activities: activities.length,
      odd: {
        regeneration: named(/regenerat/i),
        shapechanger: named(/shapechang|change shape|shape-?shift/i),
        damageThreshold: named(/damage threshold/i) || num(sys.attributes.hp?.dt) > 0,
        multiattack: named(/^multiattack/i),
        innateSpellcasting: named(/innate spellcasting/i),
        recharge: items.filter(i =>
          Array.from(i.system?.uses?.recovery ?? []).some(r => r.period === 'recharge')
        ).length,
        summon: activities.filter(a => a.type === 'summon').length,
        transform: activities.filter(a => a.type === 'transform').length,
        legendaryActivities: activities.filter(a => a.activation?.type === 'legendary').length,
        lairActivities: activities.filter(a => a.activation?.type === 'lair').length,
      },
    });
  }
  return { packId: args.packId, installed: true, total: npcs.length, skipped, from, entries };
}

/**
 * A world copy of a compendium monster for a probe, flagged as kit so a rebuild wipes it.
 * @param {{packId: string, itemId: string, name?: string, folderId?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function createMonster(args) {
  const { flagScope, flagKey } = args._kit;
  const pack = game.packs.get(args.packId);
  if (!pack) throw new Error(`createMonster: no pack ${args.packId}`);
  const doc = await pack.getDocument(args.itemId);
  if (!doc) throw new Error(`createMonster: no entry ${args.packId} ${args.itemId}`);
  const data = game.actors.fromCompendium(doc);
  data.name = args.name ?? `Probe ${doc.name}`;
  if (args.folderId) data.folder = args.folderId;
  foundry.utils.setProperty(data, `flags.${flagScope}.${flagKey}`, { built: true, probe: true });
  const actor = await Actor.implementation.create(data);
  return { actorId: actor.id, name: actor.name };
}

/**
 * Deletes probe actors. Only an actor that createMonster made (the kit flag with `probe: true`) is
 * deleted; any other actor, kit hero or kit monster included, is refused.
 * @param {{actorIds: string[], _kit: {flagScope: string, flagKey: string}}} args
 */
async function deleteMonsters(args) {
  const { flagScope, flagKey } = args._kit;
  const ids = [];
  const refused = [];
  for (const id of args.actorIds ?? []) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    if (actor.getFlag(flagScope, flagKey)?.probe === true) ids.push(id);
    else refused.push(id);
  }
  if (ids.length) await Actor.deleteDocuments(ids);
  return { deleted: ids.length, refused };
}

/** The functions gm.mjs runs in the page, by GM action. */
/**
 * Marks an actor that Actor Studio made as one of the kit's own (the kit flag and folder, a name), so
 * a rebuild wipes it and the world is left as the kit found it.
 * @param {{actorId: string, name?: string, folderId?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function adoptActor(args) {
  const { flagScope, flagKey } = args._kit;
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`adoptActor: no actor ${args.actorId}`);
  const update = { [`flags.${flagScope}.${flagKey}`]: { built: true, studio: true } };
  if (args.name) update.name = args.name;
  if (args.folderId) update.folder = args.folderId;
  await actor.update(update);
  return { ok: true };
}

/**
 * Delete an actor, but only one that carries the kit flag.
 * @param {{actorId: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function deleteKitActor(args) {
  const { flagScope, flagKey } = args._kit;
  const actor = game.actors.get(args.actorId);
  if (!actor) return { deleted: false };
  if (!actor.getFlag(flagScope, flagKey))
    throw new Error(`deleteKitActor: ${actor.name} is not a kit actor; not deleting it`);
  await actor.delete();
  return { deleted: true };
}

export const GM_ACTION_FUNCTIONS = {
  ...ORIGIN_GM_FUNCTIONS,
  inspectBuild,
  studioPump,
  adoptActor,
  deleteKitActor,
  ...SPELL_GM_FUNCTIONS,
  inspectFeatures,
  exerciseActor,
  worldStatus,
  wipeKit,
  ensureFolder,
  listCompendium,
  createHero,
  describeClass,
  inspectActor,
  setOwnership,
  createCombatScene,
  placeToken,
  startCombat,
  endCombats,
  readActor,
  listMonsters,
  createMonster,
  deleteMonsters,
};

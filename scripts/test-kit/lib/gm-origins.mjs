/**
 * The GM actions of the origin scenarios (slice 3c): `listOrigins` (the species, backgrounds or
 * feats of some packs, from the index), `describeOrigin` (what the data of one species, background,
 * feat or class says) and `cloneHero` (a copy of a kit hero, so one host hero can take many feats).
 * The advancement itself is `createHero` (gm-actions.mjs), which also learned to add items to an
 * existing hero. Like gm-actions.mjs, every function here is serialized into the Foundry GM page by
 * Playwright, so each is self-contained: no closures over module scope.
 *
 * Verified against the dnd5e 6 source as far as it can be read; the live run is the real check:
 * - A species is an item of type `race` (with `system.movement`, `system.senses`, `system.type`), a
 *   background of type `background`, a feat of type `feat` whose `system.type.value` is "feat" and
 *   whose subtype is origin, general, fightingStyle or epicBoon.
 * - An item's advancements are in `item.advancement.byId`; each has a `classRestriction`
 *   ('primary' only for the first class, 'secondary' only when multiclassing) and a typed
 *   `configuration` (Trait: grants and choices, ItemGrant: items, ItemChoice, AbilityScoreImprovement:
 *   points, cap, fixed, locked, Size: sizes).
 * - A feat checks its prerequisites with `system.assertPrerequisites(actor, {showMessage: false})`,
 *   which returns true, or something else that says what is missing.
 */

/**
 * The species, backgrounds or feats of some packs, from the index only (names and ids, no text).
 * @param {{packIds: string[], kind: 'species'|'background'|'feat'}} args
 */
async function listOrigins(args) {
  const type = { species: 'race', background: 'background', feat: 'feat' }[args.kind];
  if (!type) throw new Error(`listOrigins: unknown kind "${args.kind}"`);
  const entries = [];
  const missing = [];
  const fields = ['system.source', 'system.identifier', 'system.type.value', 'system.type.subtype'];
  for (const packId of args.packIds ?? []) {
    const pack = game.packs.get(packId);
    if (!pack) {
      missing.push(packId);
      continue;
    }
    const index = await pack.getIndex({ fields });
    for (const e of index) {
      if (e.type !== type) continue;
      // A feat of the "feat" type; class, species and monster features are not feats a player takes.
      if (type === 'feat' && e.system?.type?.value !== 'feat') continue;
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
      if (type === 'feat') entry.featType = String(e.system?.type?.subtype || 'general');
      entries.push(entry);
    }
  }
  return { entries, missing };
}

/**
 * What the data of one document says. Facts only: numbers, keys and the names of the document's own
 * grants. With `actorId`, whether that actor meets the document's prerequisites (a feat).
 * @param {{uuid: string, actorId?: string}} args
 */
async function describeOrigin(args) {
  const doc = await fromUuid(args.uuid);
  if (!doc) throw new Error(`describeOrigin: no document ${args.uuid}`);
  const sys = doc.system ?? {};
  const list = coll => Array.from(coll?.values?.() ?? coll ?? []);
  const numbers = obj => {
    const out = {};
    for (const [key, v] of Object.entries(obj ?? {})) {
      // dnd5e 6 keeps a species' speeds as strings ("30"); a blank is null or "".
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n === 'number' && n > 0) out[key] = n;
    }
    return out;
  };
  const found = new Map();
  const resolve = async uuid => {
    if (!found.has(uuid)) {
      let d = null;
      try {
        d = (await fromUuid(uuid)) ?? null;
      } catch {
        d = null;
      }
      found.set(uuid, d);
    }
    return found.get(uuid);
  };

  const advancements = [];
  for (const adv of Object.values(doc.advancement?.byId ?? {})) {
    const type = adv.constructor.typeName;
    const cfg = adv.configuration ?? {};
    const row = {
      id: adv.id,
      type,
      title: adv.title ?? '',
      levels: (adv.levels ?? []).map(Number),
      classRestriction: adv.classRestriction || '',
    };
    if (type === 'Trait') {
      row.mode = String(cfg.mode ?? '');
      row.grants = [...(cfg.grants ?? [])].map(String);
      row.choices = (cfg.choices ?? []).map(c => ({
        count: Number(c.count ?? 0),
        pool: [...(c.pool ?? [])].map(String),
      }));
    } else if (type === 'ItemGrant') {
      row.optional = !!cfg.optional;
      row.items = [];
      for (const item of cfg.items ?? []) {
        const d = await resolve(item.uuid);
        row.items.push({
          uuid: item.uuid,
          name: d?.name ?? '',
          resolved: !!d,
          optional: !!item.optional,
          // A feat a player takes (an origin feat), not a class or species feature.
          playerFeat: d?.type === 'feat' && d.system?.type?.value === 'feat',
        });
      }
    } else if (type === 'ItemChoice') {
      row.itemType = String(cfg.type ?? '');
      row.itemChoices = Object.entries(cfg.choices ?? {})
        .map(([level, c]) => ({ level: Number(level), count: Number(c?.count ?? 0) }))
        .filter(c => c.count > 0);
    } else if (type === 'AbilityScoreImprovement') {
      row.asi = {
        points: Number(cfg.points ?? 0),
        cap: Number(cfg.cap ?? 2),
        fixed: Object.fromEntries(
          Object.entries(cfg.fixed ?? {}).filter(([, v]) => Number(v) !== 0)
        ),
        locked: [...(cfg.locked ?? [])].map(String),
        max: cfg.max ?? null,
      };
    } else if (type === 'Size') {
      row.sizes = [...(cfg.sizes ?? [])].map(String);
    }
    advancements.push(row);
  }

  const out = {
    name: doc.name,
    type: doc.type,
    rules: typeof sys.source === 'object' && sys.source ? String(sys.source.rules ?? '') : '',
    featType: doc.type === 'feat' ? String(sys.type?.subtype || 'general') : '',
    movement: doc.type === 'race' ? numbers(sys.movement?.speeds ?? sys.movement) : null,
    senses: doc.type === 'race' ? numbers(sys.senses?.ranges ?? sys.senses) : null,
    creatureType: doc.type === 'race' ? String(sys.type?.value ?? '') : '',
    advancements,
    effects: doc.effects.map(e => ({
      name: e.name,
      transfer: !!e.transfer,
      disabled: !!e.disabled,
      changes: (e.changes ?? []).length,
      // Proficiencies the effect adds, in trait keys ("weapon:mar"): a feature may grant them this way.
      profs: (e.changes ?? [])
        .map(c => {
          const m = /^system\.traits\.(weapon|armor|tool)Prof\.value$/.exec(String(c.key));
          return m && c.value ? `${m[1]}:${String(c.value)}` : null;
        })
        .filter(Boolean),
    })),
    activities: list(sys.activities).map(a => ({ type: a.type, name: a.name ?? '' })),
    uses:
      typeof sys.uses?.max === 'number' || typeof sys.uses?.max === 'string' ? sys.uses.max : null,
    startingEquipment: list(sys.startingEquipment).length,
    primaryAbility: doc.type === 'class' ? [...(sys.primaryAbility?.value ?? [])].map(String) : [],
    primaryAll: doc.type === 'class' ? !!sys.primaryAbility?.all : false,
    hitDie: doc.type === 'class' ? String(sys.hd?.denomination ?? '') : '',
    spellcasting:
      (doc.type === 'class' || doc.type === 'subclass') &&
      sys.spellcasting?.progression &&
      sys.spellcasting.progression !== 'none'
        ? {
            progression: String(sys.spellcasting.progression),
            ability: String(sys.spellcasting.ability ?? ''),
          }
        : null,
    prerequisites:
      doc.type === 'feat'
        ? {
            level: sys.prerequisites?.level ?? null,
            repeatable: !!sys.prerequisites?.repeatable,
          }
        : null,
  };
  if (args.actorId) {
    const actor = game.actors.get(args.actorId);
    if (!actor) throw new Error(`describeOrigin: no actor ${args.actorId}`);
    let verdict = true;
    if (typeof sys.assertPrerequisites === 'function') {
      try {
        verdict = sys.assertPrerequisites(actor, { showMessage: false });
      } catch (err) {
        verdict = `assertPrerequisites threw: ${err.message}`;
      }
    }
    out.actor = {
      prerequisitesMet: verdict === true,
      detail:
        verdict === true
          ? ''
          : Array.isArray(verdict)
            ? verdict.map(String).join('; ')
            : String(verdict?.message ?? verdict),
    };
  }
  return out;
}

/**
 * A copy of a kit hero with its items and their advancement origins (item ids are kept, so the
 * origins still point at the right items).
 * @param {{actorId: string, name?: string, folderId?: string, abilityFloor?: number, drop?: string[],
 *   _kit: {flagScope: string, flagKey: string}}} args
 */
async function cloneHero(args) {
  const { flagScope, flagKey } = args._kit;
  const source = game.actors.get(args.actorId);
  if (!source) throw new Error(`cloneHero: no actor ${args.actorId}`);
  if (!source.getFlag(flagScope, flagKey))
    throw new Error(`cloneHero: ${source.name} is not a kit actor; not copying it`);
  const data = source.toObject();
  delete data._id;
  data.name = args.name ?? `${source.name} copy`;
  data.folder = args.folderId ?? source.folder?.id ?? null;
  data.flags = { ...(data.flags ?? {}), [flagScope]: { [flagKey]: { built: true, clone: true } } };
  // Items to leave out of the copy, by name (a host that already has the feat being tested).
  const drop = new Set((args.drop ?? []).map(n => String(n).toLowerCase()));
  if (drop.size) data.items = data.items.filter(i => !drop.has(String(i.name).toLowerCase()));
  const floor = Number(args.abilityFloor ?? 0);
  if (floor) {
    for (const ability of Object.values(data.system?.abilities ?? {})) {
      if (typeof ability.value === 'number' && ability.value < floor) ability.value = floor;
    }
  }
  const copy = await Actor.implementation.create(data, { keepEmbeddedIds: true });
  return { actorId: copy.id, name: copy.name };
}

/** The functions gm.mjs runs in the page, by GM action. */
export const ORIGIN_GM_FUNCTIONS = { listOrigins, describeOrigin, cloneHero };

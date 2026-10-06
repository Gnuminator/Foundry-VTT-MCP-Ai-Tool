/**
 * The GM actions of the spell scenarios (slice 3b): `listSpells` (the spells of some packs, from
 * the index) and `exerciseSpell` (give spells to an actor, cast them with no dialog, read what the
 * system did, and put the actor back). Like gm-actions.mjs, every function here is serialized into
 * the Foundry GM page by Playwright, so each is self-contained: no closures over module scope.
 *
 * Verified against Foundry 14.368 and dnd5e 6.0.5 (read from the system's own source):
 * - `activity.use(usage, dialog, message)` takes `consume.spellSlot`, `spell.slot`, `scaling`,
 *   `concentration.begin`, `create.measuredTemplate`, `create.summons` and `subsequentActions`.
 *   With `subsequentActions: false` it posts only the usage card, so attack, damage and healing
 *   rolls are asked for one by one (`rollAttack`, `rollDamage`; a heal activity rolls through
 *   `rollDamage` too) with `{configure: false}` and `{create: false}`.
 * - The scaled formula of an upcast comes from the item's `flags.dnd5e.scaling`; the system sets it
 *   on a clone of the item before it rolls, and so does this file.
 * - A measured template is a Region in v14 and its placement is interactive, so a template is
 *   only checked by creating the Region the system would build from the activity's template data.
 * - Summons are placed by `TokenPlacement.place`, which is interactive too: the summon check
 *   replaces it for the length of one call.
 * - A slot is taken from `actor.system.spells[key].value`; a ritual or an at-will spell has no
 *   such key, so nothing is taken.
 */

/**
 * The spells of some packs, from the index only (names and numbers, no text).
 * @param {{packIds: string[]}} args
 */
async function listSpells(args) {
  const entries = [];
  const missing = [];
  const fields = [
    'system.level',
    'system.school',
    'system.properties',
    'system.activities',
    'system.source',
    'system.target',
  ];
  for (const packId of args.packIds ?? []) {
    const pack = game.packs.get(packId);
    if (!pack) {
      missing.push(packId);
      continue;
    }
    const index = await pack.getIndex({ fields });
    for (const e of index) {
      if (e.type !== 'spell') continue;
      const sys = e.system ?? {};
      const props = Array.isArray(sys.properties)
        ? sys.properties
        : Array.from(sys.properties ?? []);
      const acts = Object.values(sys.activities ?? {});
      const source = sys.source;
      const rules = typeof source === 'object' && source ? String(source.rules ?? '') : '';
      const book =
        typeof source === 'object' && source ? String(source.book ?? '') : String(source ?? '');
      const template =
        String(sys.target?.template?.type ?? '') ||
        String(acts.map(a => a.target?.template?.type).find(t => t) ?? '');
      entries.push({
        packId,
        id: e._id,
        uuid: e.uuid ?? `Compendium.${packId}.Item.${e._id}`,
        name: e.name,
        level: Number(sys.level ?? 0),
        school: String(sys.school ?? ''),
        rules,
        book,
        ritual: props.includes('ritual'),
        concentration:
          props.includes('concentration') || acts.some(a => a.duration?.concentration === true),
        activities: acts.map(a => String(a.type ?? '')),
        template,
      });
    }
  }
  return { entries, missing };
}

/**
 * Casts spells on an actor and puts the actor back as it was found (see the contract).
 * @param {{actorId: string, sceneId?: string, slots?: Record<string, number>, casts: Array<Record<string, any>>}} args
 */
async function exerciseSpell(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`exerciseSpell: no actor ${args.actorId}`);
  const scene = args.sceneId ? game.scenes.get(args.sceneId) : null;
  const list = coll => Array.from(coll?.values?.() ?? coll ?? []);

  /** The state that is put back: the actor, its items, effects and chat messages, the scene's regions and tokens, the world's actors. */
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
      regions: scene ? scene.regions.map(r => r.id).sort() : [],
      tokens: scene ? scene.tokens.map(t => t.id).sort() : [],
      actors: game.actors.map(a => a.id).sort(),
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
    // Tokens and regions the casts made, and the actors a summon brought into the world.
    await attempt('tokens', async () => {
      const ids = scene
        ? scene.tokens.filter(t => !before.tokens.includes(t.id)).map(t => t.id)
        : [];
      if (ids.length) await scene.deleteEmbeddedDocuments('Token', ids);
    });
    await attempt('regions', async () => {
      const ids = scene
        ? scene.regions.filter(r => !before.regions.includes(r.id)).map(r => r.id)
        : [];
      if (ids.length) await scene.deleteEmbeddedDocuments('Region', ids);
    });
    await attempt('world actors', async () => {
      const ids = game.actors.filter(a => !before.actors.includes(a.id)).map(a => a.id);
      if (ids.length) await Actor.deleteDocuments(ids);
    });
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
      const bloodied = () => actor.effects.some(e => e.statuses?.has('bloodied'));
      const wasBloodied = actor.effects.some(
        e => before.effects.includes(e.id) && e.statuses?.has('bloodied')
      );
      for (let i = 0; i < 30 && bloodied() !== wasBloodied; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
    // Whatever else differs in actor.system (slot overrides, death saves...) goes back by its path.
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
    for (const key of [
      'spells',
      'effects',
      'messages',
      'hp',
      'exhaustion',
      'regions',
      'tokens',
      'actors',
    ]) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
    }
    const was = foundry.utils.flattenObject(a.system);
    const now = foundry.utils.flattenObject(b.system);
    for (const path of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (JSON.stringify(was[path]) !== JSON.stringify(now[path])) out.push(`system.${path}`);
    }
    return out;
  };

  const num = v =>
    v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const arr = v => Array.from(v ?? []);
  const partsOf = parts =>
    list(parts).map(p => ({
      number: num(p.number),
      denomination: num(p.denomination),
      bonus: String(p.bonus ?? ''),
      types: arr(p.types),
      custom: p.custom?.enabled ? String(p.custom.formula ?? '') : '',
      scaling: {
        mode: String(p.scaling?.mode ?? ''),
        number: num(p.scaling?.number),
        formula: String(p.scaling?.formula ?? ''),
      },
    }));
  const effectsOf = coll =>
    list(coll).map(e => ({
      name: String(e.name ?? ''),
      statuses: arr(e.statuses),
      changes: list(e.changes).map(c => ({
        key: String(c.key),
        value: String(c.value),
        type: String(c.type ?? ''),
      })),
    }));
  const resolve = (text, rollData) => {
    try {
      return Number(dnd5e.utils.simplifyBonus(String(text ?? ''), rollData));
    } catch {
      return null;
    }
  };

  /** What the spell's activity says about itself (numbers and ids, no text). */
  const describe = (item, activity) => {
    const target = activity.target ?? {};
    const tpl = target.template ?? {};
    const aff = target.affects ?? {};
    let rollData = {};
    try {
      rollData = activity.getRollData();
    } catch {
      rollData = {};
    }
    return {
      type: String(activity.type),
      name: String(activity.name ?? ''),
      activation: String(activity.activation?.type ?? ''),
      itemActivation: String(item.system.activation?.type ?? ''),
      consumesSlot: !!(activity.requiresSpellSlot && activity.consumption?.spellSlot),
      concentration: !!activity.requiresConcentration,
      range: {
        value: String(activity.range?.value ?? ''),
        units: String(activity.range?.units ?? ''),
      },
      duration: {
        value: String(activity.duration?.value ?? ''),
        units: String(activity.duration?.units ?? ''),
      },
      target: {
        type: String(aff.type ?? ''),
        count: String(aff.count ?? ''),
        resolvedCount: aff.count ? resolve(aff.count, rollData) : null,
        template: {
          type: String(tpl.type ?? ''),
          size: String(tpl.size ?? ''),
          width: String(tpl.width ?? ''),
          height: String(tpl.height ?? ''),
          units: String(tpl.units ?? ''),
        },
      },
      save: activity.save
        ? {
            ability: arr(activity.save.ability),
            dc: num(activity.save.dc?.value),
            calc: String(activity.save.dc?.calculation ?? ''),
            onSave: String(activity.damage?.onSave ?? ''),
          }
        : null,
      attack: activity.attack
        ? {
            type: String(activity.attack.type?.value ?? ''),
            classification: String(activity.attack.type?.classification ?? ''),
          }
        : null,
      damage: activity.damage?.parts ? partsOf(activity.damage.parts) : [],
      healing: activity.healing ? partsOf([activity.healing]) : [],
      effects: effectsOf(item.effects),
      summon:
        activity.type === 'summon'
          ? {
              mode: String(activity.summon?.mode ?? ''),
              profiles: list(activity.profiles).map(p => ({
                id: String(p._id ?? ''),
                uuid: String(p.uuid ?? ''),
                count: String(p.count ?? ''),
              })),
            }
          : null,
    };
  };

  const rollInfo = r => ({
    formula: String(r.formula),
    total: Number(r.total),
    dice: arr(r.dice).map(d => ({ n: Number(d.number), f: Number(d.faces) })),
    types: r.options?.types
      ? arr(r.options.types)
      : r.options?.type
        ? [String(r.options.type)]
        : [],
  });

  /** The values at some paths of the actor (with a worked-out number for a bonus formula). */
  const readPaths = paths => {
    const out = {};
    const rollData = actor.getRollData();
    for (const path of paths) {
      let v = foundry.utils.getProperty(actor, path);
      if (v instanceof Set) v = [...v];
      const entry = { value: v ?? null };
      if (typeof v === 'string' && v.trim()) entry.resolved = resolve(v, rollData);
      out[path] = entry;
    }
    return out;
  };

  /** The Region data the system builds from an activity's template (the placement itself is interactive). */
  const regionShape = (tpl, sceneDoc) => {
    const shape = dnd5e.config.areaTargetTypes?.[tpl.type]?.template;
    if (!shape) return null;
    const mult = sceneDoc.grid.size / sceneDoc.grid.distance;
    const size = Number(tpl.size || 0) * mult;
    const width = Number(tpl.width || 0) * mult;
    const base = { x: sceneDoc.grid.size * 6, y: sceneDoc.grid.size * 6, rotation: 0, type: shape };
    switch (shape) {
      case 'circle':
        return { ...base, radius: size };
      case 'cone':
        return { ...base, angle: CONFIG.MeasuredTemplate?.defaults?.angle ?? 53.13, radius: size };
      case 'line':
      case 'ray':
        return { ...base, type: 'line', length: size, width: width || sceneDoc.grid.size };
      case 'rect':
      case 'rectangle':
        return { ...base, type: 'rectangle', width: size, height: size };
      case 'ring':
        return { ...base, radius: size, outerWidth: width, innerWidth: 0 };
      default:
        return null;
    }
  };

  const slotOf = key => {
    const s = key ? actor.system.spells?.[key] : null;
    return s ? { value: s.value ?? 0, max: s.max ?? 0, level: s.level ?? null } : null;
  };

  /** Gives the actor one spell (or a scroll of it) and casts it as the spec says. */
  const castOne = async spec => {
    const result = {
      uuid: spec.uuid ?? null,
      name: null,
      ok: false,
      threw: null,
      notes: [],
      chatCard: false,
    };
    const patched = {};
    for (const level of ['error', 'warn']) {
      patched[level] = {
        own: Object.prototype.hasOwnProperty.call(ui.notifications, level),
        orig: ui.notifications[level],
      };
      ui.notifications[level] = (message, options) => {
        let text = String(message);
        if (options?.localize || game.i18n.has(text)) text = game.i18n.localize(text);
        result.notes.push({ level, message: text });
        return undefined;
      };
    }
    const openBefore = new Set(foundry.applications.instances.keys());
    const effectsBefore = new Set(actor.effects.map(e => e.id));
    const itemsBefore = new Set(actor.items.map(i => i.id));
    let spellsBefore = {};
    try {
      const src = await fromUuid(spec.uuid);
      if (!src) throw new Error(`no spell ${spec.uuid}`);
      let item;
      if (spec.scroll) {
        const scroll = await Item.implementation.createScrollFromSpell(
          src,
          {},
          { dialog: false, level: spec.scroll.level ?? src.system.level }
        );
        if (!scroll) throw new Error('the scroll could not be made');
        [item] = await actor.createEmbeddedDocuments('Item', [scroll.toObject()]);
      } else {
        const data = game.items.fromCompendium(src);
        foundry.utils.setProperty(data, 'system.method', spec.as ?? 'spell');
        [item] = await actor.createEmbeddedDocuments('Item', [data]);
      }
      result.name = item.name;
      result.itemId = item.id;
      result.level = Number(item.system.level ?? src.system.level ?? 0);
      result.school = String(item.system.school ?? '');
      result.properties = arr(item.system.properties);
      result.method = String(item.system.method ?? '');
      const acts = list(item.system.activities);
      result.activities = acts.map(a => ({ type: String(a.type), name: String(a.name ?? '') }));
      if (!acts.length) {
        result.noActivities = true;
        return result;
      }
      const activity =
        (spec.activityType ? acts.find(a => a.type === spec.activityType) : null) ??
        acts[spec.activity ?? 0] ??
        acts[0];
      result.activityIndex = acts.indexOf(activity);
      result.facts = describe(item, activity);

      // Which slot the system will use, and a forced one when the actor has none of that level.
      let key = spec.slot ?? null;
      if (!key && item.type === 'spell' && result.level > 0) {
        try {
          const model = CONFIG.DND5E.spellcasting?.[item.system.method];
          key = model?.getSpellSlotKey?.(result.level) ?? `spell${result.level}`;
        } catch {
          key = `spell${result.level}`;
        }
      }
      result.slotKey = key;
      if (key && /^spell[1-9]$/.test(key) && result.facts.consumesSlot && !spec.noForce) {
        const slot = slotOf(key);
        if (slot && slot.value < 1) {
          await actor.update({
            [`system.spells.${key}.override`]: 2,
            [`system.spells.${key}.value`]: 2,
          });
          result.slotForced = true;
        }
      }
      result.slotBefore = slotOf(key);
      spellsBefore = Object.fromEntries(
        Object.entries(actor.system.spells ?? {}).map(([k, s]) => [k, s.value ?? 0])
      );

      // No dialog, no measured template, no summons, no roll after the card, no action cost.
      const usage = {
        consume: { action: false },
        create: { measuredTemplate: false, summons: false },
        subsequentActions: false,
      };
      if (spec.slot) usage.spell = { slot: spec.slot };
      if (spec.concentration === false) usage.concentration = { begin: false };
      let results;
      const use = activity.use(usage, { configure: false }, {});
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
      const messageId = results?.message?.id ?? null;
      result.ok = !!results && typeof results === 'object';
      result.chatCard = !!messageId && game.messages.has(messageId);
      result.slotAfter = slotOf(key);
      result.spells = {};
      for (const [k, s] of Object.entries(actor.system.spells ?? {})) {
        const after = s.value ?? 0;
        if ((spellsBefore[k] ?? 0) !== after)
          result.spells[k] = { before: spellsBefore[k] ?? 0, after };
      }
      const slotLevel = key ? (actor.system.spells?.[key]?.level ?? 0) : 0;
      result.scaling = Math.max(
        Number(results?.message?.system?.scaling ?? 0),
        slotLevel > result.level ? slotLevel - result.level : 0
      );
      result.extraItems = actor.items.filter(
        i => !itemsBefore.has(i.id) && i.id !== item.id
      ).length;
      result.effects = effectsOf(actor.effects.filter(e => !effectsBefore.has(e.id)));
      result.concentrating = list(actor.concentration?.effects).map(e => String(e.name));
      result.itemLeft = actor.items.has(item.id);
      result.itemUses = {
        spent: num(item.system.uses?.spent),
        max: num(item.system.uses?.max),
        quantity: num(item.system.quantity),
      };
      if (!result.ok) return result;

      // The item the rolls use: a clone carrying the scaling the cast chose, as the system does.
      let rollItem = item;
      let rollActivity = activity;
      if (result.scaling) {
        rollItem = item.clone({}, { keepId: true });
        actor._embeddedPreparation = true;
        rollItem.updateSource({ 'flags.dnd5e.scaling': result.scaling });
        delete actor._embeddedPreparation;
        rollItem.prepareFinalAttributes();
        rollActivity = rollItem.system.activities.get(activity.id);
        result.scaled = describe(rollItem, rollActivity);
      }
      const rolled = {};
      for (const kind of spec.rolls ?? []) {
        try {
          if (kind === 'attack') {
            const rolls = await rollActivity.rollAttack(
              {},
              { configure: false },
              { create: false }
            );
            const r = rolls?.[0];
            if (r) {
              const d20 = r.dice?.[0]?.total ?? null;
              rolled.attack = { ...rollInfo(r), d20, bonus: d20 === null ? null : r.total - d20 };
            } else rolled.attackError = 'the attack roll returned nothing';
          } else {
            const rolls = await rollActivity.rollDamage(
              {},
              { configure: false },
              { create: false }
            );
            if (rolls?.length) rolled[kind === 'heal' ? 'heal' : 'damage'] = rolls.map(rollInfo);
            else rolled[`${kind}Error`] = 'the roll returned nothing';
          }
        } catch (err) {
          rolled[`${kind}Error`] = String(err?.message ?? err);
        }
      }
      if (Object.keys(rolled).length) result.rolled = rolled;

      // Temporary hit points from the healing roll.
      if (spec.applyTemp) {
        const total = rolled.heal?.[0]?.total;
        if (typeof total === 'number') await actor.applyTempHP(total);
        result.hp = {
          value: actor.system.attributes.hp.value,
          temp: actor.system.attributes.hp.temp ?? 0,
        };
      }

      // The spell's effects on the caster, as the chat card's apply button puts them (a copy).
      if (spec.apply) {
        const paths = ['system.attributes.ac.value', ...(spec.read ?? [])];
        const effects = item.effects.filter(e => !spec.effectName || e.name === spec.effectName);
        const was = readPaths(paths);
        const data = effects.slice(0, 8).map(e => {
          const copy = e.toObject();
          delete copy._id;
          copy.origin = item.uuid;
          copy.disabled = false;
          copy.transfer = false;
          return copy;
        });
        if (data.length) await actor.createEmbeddedDocuments('ActiveEffect', data);
        result.applied = {
          count: data.length,
          statuses: arr(actor.statuses),
          before: was,
          during: readPaths(paths),
        };
      }

      // The Region the system would build from the activity's template data.
      if (spec.region) {
        if (!scene) throw new Error('region: the action got no sceneId');
        const withTemplate = acts.find(a => a.target?.template?.type) ?? activity;
        const tpl = withTemplate.target?.template ?? {};
        const shape = regionShape(tpl, scene);
        result.region = {
          templateType: String(tpl.type ?? ''),
          size: String(tpl.size ?? ''),
          shapeType: shape?.type ?? null,
          created: 0,
          shapes: [],
        };
        if (shape) {
          const docs = await scene.createEmbeddedDocuments('Region', [
            {
              name: `${item.name} (kit)`,
              color: '#ff6400',
              shapes: [shape],
              visibility: CONST.REGION_VISIBILITY.ALWAYS,
            },
          ]);
          result.region.created = docs.length;
          result.region.shapes = docs.flatMap(d => list(d.shapes).map(s => String(s.type)));
        }
      }

      // The summon, placed with the placement dialog replaced for this one call.
      if (spec.summon) {
        const sa = acts.find(a => a.type === 'summon');
        result.summoned = { placed: 0, tokens: [] };
        if (!sa) result.summoned.skipped = 'the spell has no summon activity';
        else if (!scene || canvas.scene?.id !== scene.id)
          result.summoned.skipped = 'the kit scene is not the one on the canvas';
        else if (sa.summon?.mode)
          result.summoned.skipped = `summon mode "${sa.summon.mode}" asks for a creature`;
        else {
          const profile = list(sa.profiles).find(p => p.uuid);
          const body = profile ? await fromUuid(profile.uuid) : null;
          if (!profile || !body)
            result.summoned.skipped = 'the summon profile has no creature that resolves';
          else {
            const Placement = dnd5e.canvas.TokenPlacement;
            const own = Object.prototype.hasOwnProperty.call(Placement, 'place');
            const orig = Placement.place;
            Placement.place = async config =>
              config.tokens.map((token, index) => ({
                x: scene.grid.size * (8 + index * 2),
                y: scene.grid.size * 8,
                elevation: 0,
                rotation: 0,
                prototypeToken: token,
                index: { total: index, unique: index },
              }));
            try {
              const placed = await sa.placeSummons({ profile: profile._id });
              result.summoned.placed = list(placed).length;
              result.summoned.tokens = list(placed).map(t => String(t.name));
            } finally {
              if (own) Placement.place = orig;
              else delete Placement.place;
            }
          }
        }
      }
    } catch (err) {
      result.threw = String(err?.message ?? err);
    } finally {
      for (const level of ['error', 'warn']) {
        if (patched[level].own) ui.notifications[level] = patched[level].orig;
        else delete ui.notifications[level];
      }
      for (const [id, app] of [...foundry.applications.instances.entries()]) {
        if (!openBefore.has(id)) await app.close({ skipConfirmation: true }).catch(() => {});
      }
    }
    return result;
  };

  // What the actor's own numbers say about its spellcasting (the oracle of the attack and save checks is the rules).
  const spellData = actor.system.attributes.spell ?? {};
  const abilityKey = String(actor.system.attributes.spellcasting ?? '');
  const caster = {
    ability: abilityKey,
    abilityMod: num(actor.system.abilities?.[abilityKey]?.mod),
    attack: num(spellData.attack),
    dc: num(spellData.dc),
    mod: num(spellData.mod),
    prof: num(actor.system.attributes.prof),
    level: num(actor.system.details.level),
  };
  const before = state();
  const casts = [];
  let error = null;
  try {
    // Slots to set before the casts: a number of slots left (more than the actor has gets an override).
    for (const [key, n] of Object.entries(args.slots ?? {})) {
      const update = { [`system.spells.${key}.value`]: n };
      if (n > (actor.system.spells?.[key]?.max ?? 0)) update[`system.spells.${key}.override`] = n;
      await actor.update(update);
    }
    for (const spec of args.casts ?? []) casts.push(await castOne(spec));
  } catch (err) {
    error = String(err?.message ?? err);
  } finally {
    await restore(before);
  }
  const final = state();
  const differences = [...restoreErrors.map(e => `restore failed, ${e}`), ...drift(before, final)];
  return { casts, caster, error, restored: differences.length === 0, drift: differences };
}

/** The functions gm.mjs runs in the page, by GM action. */
export const SPELL_GM_FUNCTIONS = { listSpells, exerciseSpell };

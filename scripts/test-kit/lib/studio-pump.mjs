/**
 * The answer pump: the one GM action that runs inside the Foundry page while Actor Studio drives
 * its own windows. Actor Studio embeds the system's advancement manager (the dnd5e window that
 * asks for skills, spells, ability score improvements and so on) in its "Advancements" tab. A
 * person answers those questions by hand; the pump answers them with the kit's rotation rule, the
 * same rule `createHero` uses, so a Studio hero and a raw kit hero make the same choices.
 *
 * Like every GM action it is serialized into the page by Playwright, so it is self-contained: no
 * closures over module scope. The pump keeps its state on `globalThis.__kitPump` between calls.
 *
 * Ops: `start` ({rotation, subclassUuid?, featPackIds?, k?}), `status`, `stop`. `stop` returns what
 * was picked. The answer code mirrors `createHero` in gm-actions.mjs (keep the two in step).
 *
 * @param {{op: 'start'|'status'|'stop', rotation?: number, k?: number, subclassUuid?: string, featPackIds?: string[], _kit?: object}} args
 */
export async function studioPump(args) {
  const G = globalThis;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const Manager = dnd5e.applications.advancement.AdvancementManager;

  const summary = st =>
    st
      ? {
          running: st.running,
          k: st.k,
          picks: st.picks,
          warnings: st.warnings,
          errors: st.errors,
          answered: st.answered,
          managersSeen: st.managersSeen,
          completed: st.completed,
          lastStep: st.lastDescribe,
          lastActivityAt: st.lastActivityAt,
        }
      : null;

  if (args.op === 'status') return summary(G.__kitPump);
  if (args.op === 'stop') {
    const st = G.__kitPump;
    if (!st) return null;
    st.running = false;
    await st.loop?.catch(() => {});
    delete G.__kitPump;
    return summary(st);
  }
  if (G.__kitPump?.running) throw new Error('studioPump: already running');

  const st = {
    running: true,
    rotation: Math.max(0, Math.floor(Number(args.rotation ?? 0))),
    k: Number(args.k ?? 0),
    subclassUuid: args.subclassUuid ?? '',
    featPackIds: args.featPackIds ?? [],
    picks: [],
    warnings: [],
    errors: [],
    answered: 0,
    completed: 0,
    managersSeen: 0,
    traitMade: new Map(),
    seenStep: new WeakMap(),
    seenManager: new WeakSet(),
    lastDescribe: '',
    lastActivityAt: Date.now(),
    loop: null,
  };
  G.__kitPump = st;
  const rotation = st.rotation;
  const picks = st.picks;
  const warnings = st.warnings;
  const traitMade = st.traitMade;
  const pick = list => list[(rotation + st.k++) % list.length];
  const nameOf = uuid => fromUuidSync(uuid)?.name ?? uuid;
  const describe = step => {
    const f = step?.flow;
    const a = f?.advancement;
    return `${f?.item?.name ?? '?'} / ${a?.constructor?.typeName ?? '?'} "${a?.title ?? ''}" / level ${f?.level ?? '?'}`;
  };

  const browseCandidates = async (adv, flow, lvl) => {
    const cfg = adv.configuration;
    const taken = new Set(
      adv.actor.items.map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId)
    );
    const out = new Map();
    if (cfg.type === 'spell') {
      const uuids = [];
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
      const total = (adv.configuration.choices ?? []).reduce((n, c) => n + (c.count ?? 0), 0);
      for (let guard = 0; guard < total; guard++) {
        const available = await adv.availableChoices();
        const keys = available ? [...available.choices.asSet()] : [];
        if (!keys.length) break;
        const key = pick(keys);
        await adv.apply(lvl, { key });
        chosen.push(key);
      }
      if (chosen.length) {
        picks.push({ level: lvl, advancement: 'Trait', title, chosen });
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
        picks.push({ level: lvl, advancement: 'ItemChoice', title, chosen: chosen.map(nameOf) });
    },

    async ItemGrant(flow, adv, lvl, title) {
      const abilities = adv.configuration.spell?.ability;
      if (abilities && abilities.size > 1) {
        await chooseAbility(adv, lvl, title);
        await flow.render();
      }
    },

    // The Subclass step is left to Actor Studio: it asks for the subclass in its own drop-down and
    // drops the subclass item itself after the class level. Answering the step here as well would
    // leave Actor Studio waiting for a dialog that never comes.
    async Subclass() {},

    async AbilityScoreImprovement(flow, adv, lvl, title) {
      const cfg = adv.configuration;
      const actor = adv.actor;
      let featFallback = false;
      if (adv.allowFeat && (rotation + st.k++) % 2 === 1) {
        const candidates = [];
        if (adv.isEpicBoon && cfg.recommendation) candidates.push(cfg.recommendation);
        for (const packId of st.featPackIds) {
          const fields = ['system.type.value', 'system.type.subtype'];
          const index = (await game.packs.get(packId)?.getIndex({ fields })) ?? [];
          const subtypes = adv.isEpicBoon ? ['epicBoon'] : ['', 'general', undefined];
          const feats = index
            .filter(e => e.type === 'feat' && e.system?.type?.value === 'feat')
            .filter(e => subtypes.includes(e.system?.type?.subtype))
            .sort((a, b) => a.name.localeCompare(b.name, 'en'));
          const start = feats.length ? (rotation + st.k) % feats.length : 0;
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
        featFallback = true;
      }
      const keys = Object.keys(CONFIG.DND5E.abilities).filter(
        a => adv.canImprove(a) && !cfg.locked.has(a)
      );
      const cap = rotation % 2 === 0 ? (cfg.cap ?? 2) : 1;
      let remaining = cfg.points ?? 0;
      const assignments = {};
      const start = (rotation + st.k++) % keys.length;
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

  const hook = Hooks.on('dnd5e.advancementManagerComplete', () => {
    st.completed += 1;
    st.lastActivityAt = Date.now();
  });

  // One pass over every open advancement manager: answer a step that has appeared and press its
  // next or complete button. A step is answered once; the manager moves on to a new step object.
  const pass = async () => {
    const managers = [...foundry.applications.instances.values()].filter(a => a instanceof Manager);
    for (const mgr of managers) {
      if (!st.seenManager.has(mgr)) {
        st.seenManager.add(mgr);
        st.managersSeen += 1;
        st.lastActivityAt = Date.now();
      }
      const step = mgr.step;
      if (!step) continue;
      if (st.seenStep.get(mgr) === step) {
        if (step.error) {
          st.errors.push(`${describe(step)} failed: ${step.error.message}`);
          st.seenStep.set(mgr, null);
        }
        continue;
      }
      const flow = step.flow;
      const button = mgr.element?.querySelector('[data-action="next"],[data-action="complete"]');
      if (!flow?.rendered || !flow.element?.isConnected || !button || button.disabled) continue;
      st.seenStep.set(mgr, step);
      st.lastDescribe = describe(step);
      st.lastActivityAt = Date.now();
      const adv = flow.advancement;
      const type = adv?.constructor?.typeName;
      try {
        if (answers[type])
          await answers[type](flow, adv, flow.level, `${flow.item.name}: ${adv.title}`);
        (
          mgr.element?.querySelector('[data-action="next"],[data-action="complete"]') ?? button
        ).click();
        st.answered += 1;
      } catch (err) {
        st.errors.push(`${describe(step)}: ${err?.message ?? err}`);
      }
    }
  };

  st.loop = (async () => {
    try {
      while (st.running) {
        await pass();
        await sleep(120);
      }
    } finally {
      Hooks.off('dnd5e.advancementManagerComplete', hook);
    }
  })();
  return summary(st);
}

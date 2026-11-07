// Seven-book baseline (the user, 2026-11-04): one player-facing pack per item type, built from the kept entries, so a
// module update cannot change what players see. A GM script like seven-books-trim.js: the body of an async function that
// gets `args` ({ dryRun, log }), run by gm-script.sh through stage 22 (scripts/pi/remote/22-seven-books.sh) in the
// running world as the Assistant GM. It never prints book text, only counts, names and ids. Run it after the trim.
//
// What it makes true (a second run changes nothing):
//   1. Every entry in the kept packs (aitool-content classes, species, backgrounds, feats, spells, items and the
//      dnd-players-handbook classes, origins, feats, spells, equipment) is copied, with the same id, into the world pack for
//      its item type: class and subclass -> player-classes, race -> player-species, background -> player-backgrounds,
//      feat with subtype feat -> player-feats (other feat-type entries, class features and species traits, go to
//      player-items), spell -> player-spells, everything else -> player-items. The copy carries
//      flags.foundry-ai-tool.sourcePack and baselineCopy: true (only copies with both are ever removed as orphans). Every Compendium link in a copy that names one of the kept packs is rewritten to
//      the world pack that now holds the target (same id), in system and effects (advancement grants, descriptions).
//   2. The journal pages of dnd-players-handbook.content and aitool-content.journals (class text, spell lists) are
//      rewritten the same way. Those are module packs, so a module update overwrites the rewrite: run this again then
//      (MODE=check of stage 22 says when).
//   3. Only when 1 and 2 are done and nothing is left unmapped, the six world packs are opened to Player and Trusted
//      (Observer) and the old kept packs are hidden from them. The world packs are made hidden and stay so until then.
//      Actor Studio's sources are set by stage 13, which also waits for that last step.
// The old entries stay where they are (hidden, never deleted). The undo (BASELINE_MODE 'undo', stage 22 MODE=baseline-undo)
// writes the journal links back to the old packs, shows the old packs again and hides the six world packs; it deletes
// nothing, and a rerun of the baseline shows the six packs again. A dry run counts and changes nothing. Module packs are
// locked again at the end of every real run, also after a failure. A failure carries the progress lines.
// The check mode (stage 22 MODE=check puts `const BASELINE_MODE = 'check';` in front of this file, after the trim check)
// never runs for real and fails on drift; a world without the six packs is "not applied", not drift.
const MODE = typeof BASELINE_MODE === 'undefined' ? 'run' : BASELINE_MODE;
if (MODE !== 'run' && MODE !== 'check' && MODE !== 'undo')
  throw new Error(`BASELINE_MODE '${MODE}' is not run, check or undo`);
if (MODE === 'check' && !args.dryRun) throw new Error('check only: this file is never a real run');

const SOURCES = [
  'aitool-content.classes',
  'aitool-content.species',
  'aitool-content.backgrounds',
  'aitool-content.feats',
  'aitool-content.spells',
  'aitool-content.items',
  'dnd-players-handbook.classes',
  'dnd-players-handbook.origins',
  'dnd-players-handbook.feats',
  'dnd-players-handbook.spells',
  'dnd-players-handbook.equipment',
];
const JOURNALS = ['dnd-players-handbook.content', 'aitool-content.journals'];
const TARGETS = {
  classes: 'Classes and subclasses',
  species: 'Species',
  backgrounds: 'Backgrounds',
  feats: 'Feats',
  spells: 'Spells',
  items: 'Equipment and items',
};
const targetPackOf = name => `world.player-${name}`;
// A feat-type entry is a real feat only with subtype 'feat'; class features, species traits and enchantments (about 1000
// of them) go to player-items, so Actor Studio's feat list stays the feats a player may pick.
const targetFor = (type, subtype) => {
  if (type === 'feat' && subtype !== 'feat') return targetPackOf('items');
  if (type === 'class' || type === 'subclass') return targetPackOf('classes');
  if (type === 'race') return targetPackOf('species');
  if (type === 'background') return targetPackOf('backgrounds');
  if (type === 'feat') return targetPackOf('feats');
  if (type === 'spell') return targetPackOf('spells');
  return targetPackOf('items');
};
const LEGACY = 'world.legacy-other-books';
const HIDDEN = { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
const OPEN = { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
// Both link spellings: Compendium.<pack>.<Type>.<id> (also without the type) and the old @Compendium[<pack>.<id>].
const linkRe = packs =>
  new RegExp(
    `(@Compendium\\[|Compendium\\.)(${packs.map(p => p.replace(/[\\.]/g, '\\$&')).join('|')})\\.((?:[A-Za-z]+\\.)?)([A-Za-z0-9]{16})`,
    'g'
  );
// The name form @Compendium[<pack>.<Name>] is not rewritten (no id to map): the dry run counts it.
const nameLinkRe = packs =>
  new RegExp(
    `@Compendium\\[(${packs.map(p => p.replace(/[\\.]/g, '\\$&')).join('|')})\\.(?![A-Za-z0-9]{16}\\])[^\\]]+\\]`,
    'g'
  );
const done = [];
const log = t => {
  done.push(t);
  args.log(t);
};
const sorted = o =>
  JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))));
const same = (a, b) => sorted(a) === sorted(b);
const ownershipOf = p => JSON.parse(JSON.stringify(p.ownership ?? p.config?.ownership ?? {}));
// Foundry stamps _stats (core version, times) on documents it writes and gives each effect change a new random _id when
// it creates the effect: neither is content. (Seen live, 2026-11-07: about 1100 false refreshes without this.)
const noChangeIds = effects =>
  (effects ?? []).map(e =>
    e.system?.changes
      ? {
          ...e,
          system: { ...e.system, changes: e.system.changes.map(c => ({ ...c, _id: undefined })) },
        }
      : e
  );
// Foundry's HTML cleaning also turns <hr /> and <img ... /> into <hr> and <img ...> when it writes a description.
const content = d =>
  JSON.stringify({ system: d.system, effects: noChangeIds(d.effects) }, (k, v) =>
    k === '_stats' ? undefined : typeof v === 'string' ? v.replace(/\s*\/>/g, '>') : v
  );
const differs = (a, b) => content(a) !== content(b);
const sourcePackOf = e => e.flags?.['foundry-ai-tool']?.sourcePack;
// Written only by this script on its copies (the trim writes sourcePack on legacy entries too): the mark of "ours".
const isBaselineCopy = e => e.flags?.['foundry-ai-tool']?.baselineCopy === true;
const pick = async (pack, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 40)
    out.push(...(await pack.getDocuments({ _id__in: ids.slice(i, i + 40) })));
  return out;
};
const unlocked = async (pack, fn) => {
  const wasLocked = pack.locked;
  if (wasLocked) await pack.configure({ locked: false });
  let out;
  try {
    out = await fn();
  } catch (e) {
    if (wasLocked) {
      try {
        await pack.configure({ locked: true });
      } catch (r) {
        e.message = `${e.message}\n(could not lock ${pack.collection} again: ${r.message})`;
      }
    }
    throw e;
  }
  if (wasLocked) await pack.configure({ locked: true });
  return out;
};
const setOwnership = async (pack, wanted) => {
  if (same(ownershipOf(pack), wanted)) return false;
  await pack.configure({ ownership: wanted });
  return true;
};
// Rewrites links in a JSON string. `to` maps "oldpack|id" to the pack the link must name; a link whose id is not in the
// map is left alone and counted by `miss`.
const rewrite = (text, packs, to, miss) =>
  text.replace(linkRe(packs), (m, open, pack, type, id) => {
    const target = to.get(`${pack}|${id}`);
    if (!target) {
      miss?.add(`${pack}|${id}`);
      return m;
    }
    return open === '@Compendium[' ? `${open}${target}.${id}` : `${open}${target}.${type}${id}`;
  });

const sourcePacks = SOURCES.filter(id => game.packs.get(id));
if (sourcePacks.length < 3) {
  log(`SKIPPED: this world does not have the kept content packs (found ${sourcePacks.length})`);
  return { skipped: true };
}
const targetIds = Object.keys(TARGETS).map(targetPackOf);
const existingTargets = targetIds.filter(id => game.packs.get(id));
if (MODE === 'check' && existingTargets.length === 0) {
  log('baseline not applied in this world (no world.player-* packs): not checked');
  return { applied: false };
}
// The legacy pack is no requirement: MODE=delete removes it for good after the baseline.
// Without it and without any world pack the trim was never run here: a real run refuses (the baseline copies what the
// trim has not moved out yet, and the orphan removal would have to catch up).
if (MODE !== 'undo' && !game.packs.get(LEGACY)) {
  log(`${LEGACY} is not in this world (the trim was not run here, or the legacy pack was deleted)`);
  if (MODE === 'run' && !args.dryRun && existingTargets.length === 0)
    throw new Error(
      `${LEGACY} is missing and no world.player-* pack exists: run MODE=trim first. Nothing was changed`
    );
}
const journalPacks = JOURNALS.filter(id => game.packs.get(id));
const idx = async (pack, fields) => [...(await game.packs.get(pack).getIndex({ fields }))];
// The journal entries with their pages as plain data (the index does not reliably carry embedded pages).
const journalEntries = async jp => {
  const out = [];
  const ids = (await idx(jp, [])).map(e => e._id);
  for (const d of await pick(game.packs.get(jp), ids)) out.push(d.toObject());
  return out;
};

// Undone (the world packs are there but hidden): a check has nothing to compare, but only when no journal page still
// names a world pack. A run that stopped after the journal rewrite leaves exactly that: dead links for players.
if (
  MODE === 'check' &&
  existingTargets.every(id => {
    const own = ownershipOf(game.packs.get(id));
    return own.PLAYER === 'NONE' && own.TRUSTED === 'NONE';
  })
) {
  // Only a link whose id sits in a world pack of this world counts: one the undo cannot map back (a copy removed as an
  // orphan, a page another world's baseline rewrote) is no half-finished run, and a rerun or an undo could not fix it.
  const held = new Set();
  for (const t of existingTargets) for (const e of await idx(t, [])) held.add(`${t}|${e._id}`);
  for (const jp of journalPacks)
    for (const entry of await journalEntries(jp))
      for (const p of entry.pages ?? []) {
        const hit = [
          ...JSON.stringify({ text: p.text, system: p.system }).matchAll(linkRe(targetIds)),
        ].some(m => held.has(`${m[2]}|${m[4]}`));
        if (hit)
          throw new Error(
            `HALF-FINISHED: journal pages point at hidden world packs; rerun MODE=baseline (dry run first) or MODE=baseline-undo\n${done.join('\n')}`
          );
      }
  log('baseline undone (world packs hidden): not checked');
  return { applied: false };
}

// ---------- undo ----------
if (MODE === 'undo') {
  if (!existingTargets.length) {
    log('nothing to undo: no world.player-* packs');
    return { undone: false };
  }
  // The journals go back to the pack each copy came from.
  const back = new Map(); // "world pack|id" -> old pack
  for (const t of existingTargets)
    for (const e of await idx(t, ['flags']))
      if (sourcePackOf(e)) back.set(`${t}|${e._id}`, sourcePackOf(e));
  const reRe = linkRe(targetIds);
  let pages = 0;
  const plan = [];
  for (const jp of journalPacks) {
    for (const entry of await journalEntries(jp)) {
      for (const p of entry.pages ?? []) {
        const blob = JSON.stringify({ text: p.text, system: p.system });
        if (reRe.test(blob)) plan.push([jp, entry._id, p._id]);
        reRe.lastIndex = 0;
      }
    }
  }
  pages = plan.length;
  const toOpen = SOURCES.filter(
    id => game.packs.get(id) && !same(ownershipOf(game.packs.get(id)), OPEN)
  );
  const toHide = existingTargets.filter(id => !same(ownershipOf(game.packs.get(id)), HIDDEN));
  log(
    `UNDO: ${pages} journal pages to point back, ${toOpen.length} old packs to show, ${toHide.length} world packs to hide`
  );
  if (args.dryRun) return { pages, show: toOpen.length, hide: toHide.length };
  const failure = [];
  try {
    for (const jp of [...new Set(plan.map(p => p[0]))]) {
      await unlocked(game.packs.get(jp), async () => {
        for (const entryId of [...new Set(plan.filter(p => p[0] === jp).map(p => p[1]))]) {
          const [doc] = await pick(game.packs.get(jp), [entryId]);
          const pageData = doc.toObject().pages ?? [];
          const updates = [];
          for (const p of pageData) {
            const next = JSON.parse(
              rewrite(JSON.stringify({ text: p.text, system: p.system }), targetIds, back)
            );
            if (JSON.stringify(next) !== JSON.stringify({ text: p.text, system: p.system }))
              updates.push({ _id: p._id, ...next });
          }
          if (updates.length) await doc.updateEmbeddedDocuments('JournalEntryPage', updates);
        }
      });
    }
    // Scan before anything is shown or hidden: no journal page may still name a world pack by an id the undo maps back.
    const stuck = [];
    let unmapped = 0;
    for (const jp of journalPacks)
      for (const entry of await journalEntries(jp))
        for (const p of entry.pages ?? [])
          for (const m of JSON.stringify({ t: p.text, s: p.system }).matchAll(reRe)) {
            if (back.has(`${m[2]}|${m[4]}`)) stuck.push(`${jp} ${entry.name} ${p.name ?? ''}`);
            else unmapped++;
          }
    if (unmapped)
      log(`links to world packs with no copy to map back (left as they are): ${unmapped}`);
    if (stuck.length)
      throw new Error(
        `${stuck.length} journal pages still name a world pack after the undo; the old packs stay as they are: ${stuck.slice(0, 10).join(' | ')}`
      );
    for (const id of toOpen) {
      const was = ownershipOf(game.packs.get(id));
      await setOwnership(game.packs.get(id), OPEN);
      log(`RESTORED ${id}: Player ${was.PLAYER ?? '-'} -> ${OPEN.PLAYER}`);
    }
    for (const id of existingTargets) await setOwnership(game.packs.get(id), HIDDEN);
  } catch (e) {
    failure.push(e);
  }
  for (const id of [...SOURCES, ...JOURNALS]) {
    const pack = game.packs.get(id);
    try {
      if (pack && !pack.locked) await pack.configure({ locked: true });
    } catch (e) {
      failure.push(e);
    }
  }
  if (failure.length)
    throw new Error(`${failure[0].message}\nDONE BEFORE THE FAILURE:\n${done.join('\n')}`);
  log(
    'UNDONE: journals point at the old packs, the old packs are visible, the world packs are hidden'
  );
  return { undone: true, pages, shown: toOpen.length, hidden: toHide.length };
}

// ---------- plan ----------
const sourceIndex = {};
for (const id of sourcePacks) sourceIndex[id] = await idx(id, ['system', 'effects', 'flags']);
const to = new Map(); // "old pack|id" -> world pack
const typeOf = new Map(); // id -> "pack name"
const collisions = [];
const counts = Object.fromEntries(
  targetIds.map(t => [t, { copy: 0, have: 0, refresh: 0, orphan: 0 }])
);
for (const id of sourcePacks) {
  for (const e of sourceIndex[id]) {
    const target = targetFor(e.type, e.system?.type?.value);
    const first = typeOf.get(e._id);
    if (first && first.pack !== id)
      collisions.push(`${e._id}: ${first.pack} ${first.name} and ${id} ${e.name}`);
    typeOf.set(e._id, { pack: id, name: e.name, target });
    to.set(`${id}|${e._id}`, target);
  }
}
if (collisions.length)
  throw new Error(
    `${collisions.length} id collision(s) between the kept packs, nothing changed: ${collisions.slice(0, 10).join(' | ')}`
  );
const miss = new Set();
let nameLinks = 0;
const sourceRe = sourcePacks;
const wantedCopy = new Map(); // id -> { data (rewritten, plain), target }
const sourceOf = new Map(); // id -> the kept pack it is read from
const targetIndex = {};
// The copies are read as documents, like the sources, so both sides have the same shape (an index entry may not).
for (const t of targetIds) {
  targetIndex[t] = new Map();
  if (!game.packs.get(t)) continue;
  const ids = (await idx(t, [])).map(e => e._id);
  for (const d of await pick(game.packs.get(t), ids)) {
    const o = d.toObject();
    targetIndex[t].set(o._id, {
      name: o.name,
      system: o.system,
      effects: o.effects ?? [],
      // A copy of ours carries baselineCopy and the pack it came from; an entry the GM added by hand, or one that has
      // only the trim's sourcePack tag, is never removed.
      ours: isBaselineCopy(o) && Boolean(sourcePackOf(o)),
      source: sourcePackOf(o),
      raw: o, // kept for the restore if a refresh cannot create the new copy
    });
  }
}
for (const id of sourcePacks) {
  const ids = sourceIndex[id].map(e => e._id);
  for (const doc of await pick(game.packs.get(id), ids)) {
    const o = doc.toObject();
    const target = targetFor(o.type, o.system?.type?.value);
    const text = rewrite(
      JSON.stringify({ system: o.system, effects: o.effects ?? [] }),
      sourceRe,
      to,
      miss
    );
    nameLinks += (text.match(nameLinkRe(sourceRe)) ?? []).length;
    const moved = JSON.parse(text);
    sourceOf.set(o._id, id);
    wantedCopy.set(o._id, {
      target,
      data: {
        ...o,
        system: moved.system,
        effects: moved.effects,
        folder: null,
        flags: {
          ...o.flags,
          'foundry-ai-tool': {
            ...o.flags?.['foundry-ai-tool'],
            sourcePack: id,
            baselineCopy: true,
          },
        },
      },
    });
  }
}
// A copy needs a refresh when its content or name differs from the source (a rename in a kept pack) or when it was made
// before the baselineCopy flag existed (it never gets the flag otherwise and is never seen as ours).
const needsRefresh = (have, w) => differs(have, w.data) || have.name !== w.data.name || !have.ours;
const stale = []; // same id, other name, and not a copy of ours: stops the run
const refreshNames = [];
for (const [docId, w] of wantedCopy) {
  const have = targetIndex[w.target].get(docId);
  if (!have) counts[w.target].copy++;
  else if (have.name !== w.data.name && !(have.ours && have.source === sourceOf.get(docId)))
    stale.push(`${docId}: ${w.target} holds ${have.name}, source has ${w.data.name}`);
  else if (needsRefresh(have, w)) {
    refreshNames.push(`${w.target.slice(13)}:${w.data.name}`);
    counts[w.target].refresh++;
  } else counts[w.target].have++;
}
if (stale.length)
  throw new Error(
    `${stale.length} world pack entries are not the kept ones, nothing changed: ${stale.slice(0, 10).join(' | ')}`
  );
// An orphan is a copy of ours (baselineCopy flag) whose source pack is in this world and no longer holds its id (a trim
// moved it out, or a module update dropped it): the real run removes it, so the players' packs follow the kept packs. A
// copy whose source pack is not in this world is kept (a renamed or missing module pack must not empty the players'
// packs); an entry without our flag is only reported.
const orphanIds = Object.fromEntries(targetIds.map(t => [t, []]));
let foreign = 0;
const missingSource = new Map(); // source pack -> copies kept
for (const t of targetIds)
  for (const [docId, have] of targetIndex[t])
    if (!wantedCopy.has(docId) || wantedCopy.get(docId).target !== t) {
      if (!have.ours) foreign++;
      else if (!sourcePacks.includes(have.source))
        missingSource.set(have.source, (missingSource.get(have.source) ?? 0) + 1);
      else {
        counts[t].orphan++;
        orphanIds[t].push(docId);
      }
    }
if (foreign) log(`NOT OURS in the world packs (no baselineCopy tag, left alone): ${foreign}`);
for (const [pack, n] of missingSource) log(`SOURCE PACK MISSING (copies kept): ${pack} ${n}`);
if (refreshNames.length)
  log(`REFRESH (copy differs from its source): ${refreshNames.slice(0, 20).join(' | ')}`);
for (const t of targetIds) log(`COUNT ${t}: ${JSON.stringify(counts[t])}`);

// The journal pages.
const journalPlan = []; // [pack, entry id, page id]
for (const jp of journalPacks) {
  for (const entry of await journalEntries(jp)) {
    for (const p of entry.pages ?? []) {
      const blob = JSON.stringify({ text: p.text, system: p.system });
      const next = rewrite(blob, sourceRe, to, miss);
      nameLinks += (next.match(nameLinkRe(sourceRe)) ?? []).length;
      if (next !== blob) journalPlan.push([jp, entry._id, p._id]);
    }
  }
}
log(`JOURNAL PAGES to rewrite: ${journalPlan.length}`);
log(
  `NAME-FORM LINKS @Compendium[pack.Name] to kept packs (not rewritten, they stay as they are): ${nameLinks}`
);
log(
  `LINKS TO KEPT PACKS WITH NO ENTRY (already dead, left as they are): ${miss.size}${miss.size ? ` (${[...miss].slice(0, 20).join(', ')})` : ''}`
);
const toHide = sourcePacks.filter(id => !same(ownershipOf(game.packs.get(id)), HIDDEN));
const toOpen = targetIds.filter(
  id => game.packs.get(id) && !same(ownershipOf(game.packs.get(id)), OPEN)
);
log(
  `HIDE the old kept packs from Player and Trusted: ${toHide.length} of ${sourcePacks.length} not hidden yet; ${toOpen.length} existing world packs to show`
);
const orphans = targetIds.reduce((n, t) => n + counts[t].orphan, 0);
if (orphans)
  log(
    `ORPHANS in the world packs (copies no kept pack has any more; the real run removes them): ${orphans}`
  );
const totals = {
  copy: targetIds.reduce((n, t) => n + counts[t].copy, 0),
  refresh: targetIds.reduce((n, t) => n + counts[t].refresh, 0),
  journalPages: journalPlan.length,
  hide: toHide.length,
  missingPacks: targetIds.length - existingTargets.length,
};

if (args.dryRun) {
  if (MODE === 'check') {
    const drift = {
      ...totals,
      orphans,
      open: toOpen.length,
      missingSource: missingSource.size,
    };
    if (Object.values(drift).some(n => n > 0))
      throw new Error(
        `DRIFT: the world no longer matches the seven-book baseline ${JSON.stringify(drift)}; run stage 22 MODE=baseline again (dry run first)\n${done.join('\n')}`
      );
    log('no drift: the world matches the seven-book baseline');
  }
  return totals;
}

// ---------- real run ----------
let journalStarted = false;
let opened = false;
const real = async () => {
  for (const name of Object.keys(TARGETS)) {
    const id = targetPackOf(name);
    // A new world pack starts hidden; an existing one keeps what it has. Players get them in the last step, together
    // with the hiding of the old packs, so a run that stops halfway never leaves them on two half-filled sets.
    if (!game.packs.get(id)) {
      const pack = await CompendiumCollection.createCompendium({
        type: 'Item',
        label: `${TARGETS[name]} (players)`,
        name: `player-${name}`,
        package: 'world',
        ownership: HIDDEN,
      });
      await setOwnership(pack, HIDDEN);
    }
  }
  // Copy, in chunks, create before anything else; a refresh replaces the old copy.
  for (const t of targetIds) {
    const entries = [...wantedCopy].filter(([, w]) => w.target === t);
    const need = entries.filter(([docId, w]) => {
      const have = targetIndex[t].get(docId);
      return !have || needsRefresh(have, w);
    });
    for (let i = 0; i < need.length; i += 40) {
      const chunk = need.slice(i, i + 40);
      const replace = chunk.filter(([docId]) => targetIndex[t].has(docId)).map(([docId]) => docId);
      // A refresh has to delete before it creates (same id), so the old copies are put back if the create fails.
      if (replace.length) await Item.deleteDocuments(replace, { pack: t });
      let made = [];
      let createError = null;
      try {
        made = await Item.createDocuments(
          chunk.map(([, w]) => w.data),
          { pack: t, keepId: true }
        );
      } catch (e) {
        createError = e;
      }
      if (createError || made.length !== chunk.length) {
        let restored = 'nothing to restore';
        if (replace.length) {
          const index = game.packs.get(t).index;
          const back = replace.filter(x => !index.has(x)).map(x => targetIndex[t].get(x).raw);
          try {
            if (back.length) await Item.createDocuments(back, { pack: t, keepId: true });
            restored = `${back.length} replaced copies put back`;
          } catch (r) {
            restored = `COULD NOT put the replaced copies back (${r.message}); run again`;
          }
        }
        throw new Error(
          `${t}: created ${made.length} of ${chunk.length}${createError ? ` (${createError.message})` : ''}; ${restored}; the old packs are not hidden yet`
        );
      }
    }
    log(`COPIED into ${t}: ${need.length} (now ${game.packs.get(t).index.size})`);
  }
  // Orphans go after all copies are in (an entry whose type changed is created in its new pack first).
  for (const t of targetIds) {
    if (!orphanIds[t].length) continue;
    for (let i = 0; i < orphanIds[t].length; i += 40)
      await Item.deleteDocuments(orphanIds[t].slice(i, i + 40), { pack: t });
    log(`REMOVED ${orphanIds[t].length} orphan copies from ${t}`);
  }
  // The journal pages.
  let pagesDone = 0;
  journalStarted = true;
  for (const jp of [...new Set(journalPlan.map(p => p[0]))]) {
    const pack = game.packs.get(jp);
    await unlocked(pack, async () => {
      for (const entryId of [...new Set(journalPlan.filter(p => p[0] === jp).map(p => p[1]))]) {
        const [doc] = await pick(pack, [entryId]);
        const updates = [];
        for (const p of doc.toObject().pages ?? []) {
          const blob = JSON.stringify({ text: p.text, system: p.system });
          const next = rewrite(blob, sourceRe, to);
          if (next !== blob) updates.push({ _id: p._id, ...JSON.parse(next) });
        }
        if (updates.length) {
          await doc.updateEmbeddedDocuments('JournalEntryPage', updates);
          pagesDone += updates.length;
        }
      }
    });
    log(`REWROTE journal pages in ${jp}`);
  }
  // Nothing in the world packs or the journals may still name an old kept pack by an id the baseline knows.
  const left = [];
  for (const t of targetIds)
    for (const e of await idx(t, ['system', 'effects']))
      for (const m of JSON.stringify({ s: e.system, e: e.effects ?? [] }).matchAll(
        linkRe(sourceRe)
      ))
        if (to.has(`${m[2]}|${m[4]}`)) left.push(`${t} ${e.name}`);
  for (const jp of journalPacks)
    for (const entry of await journalEntries(jp))
      for (const p of entry.pages ?? [])
        for (const m of JSON.stringify({ t: p.text, s: p.system }).matchAll(linkRe(sourceRe)))
          if (to.has(`${m[2]}|${m[4]}`)) left.push(`${jp} ${entry.name} ${p.name ?? ''}`);
  log(`links still naming an old kept pack: ${left.length}`);
  if (left.length)
    throw new Error(
      `${left.length} links still name an old kept pack; the old packs stay visible: ${left.slice(0, 10).join(' | ')}`
    );
  for (const id of targetIds) await setOwnership(game.packs.get(id), OPEN);
  opened = true;
  log(`OPENED the ${targetIds.length} world packs for players`);
  for (const id of sourcePacks) await setOwnership(game.packs.get(id), HIDDEN);
  log(`HIDDEN ${sourcePacks.length} old kept packs`);
  return {
    copied: totals.copy,
    refreshed: totals.refresh,
    journalPages: pagesDone,
    hidden: sourcePacks.length,
  };
};

let result;
let failure = null;
try {
  result = await real();
} catch (e) {
  failure = e;
}
const relockFailures = [];
for (const id of [...sourcePacks, ...journalPacks]) {
  const pack = game.packs.get(id);
  try {
    if (!pack.locked) await pack.configure({ locked: true });
  } catch (e) {
    relockFailures.push(`could not lock ${id} again: ${e.message}`);
  }
}
if (failure || relockFailures.length) {
  const head = failure
    ? failure.message
    : 'the baseline finished but module packs could not be locked';
  const advice =
    journalStarted && !opened
      ? '\nHALF-FINISHED: journal pages may already point at hidden world packs; rerun MODE=baseline (dry run first) or MODE=baseline-undo'
      : '';
  throw new Error(
    `${head}${advice}\nDONE BEFORE THE FAILURE:\n${[...done, ...relockFailures].join('\n')}`
  );
}
return result;

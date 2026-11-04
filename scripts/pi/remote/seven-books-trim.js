// Trims the player-facing content to the seven kept books (the user, 2026-11-03): PHB 2024, DMG 2024, CoS,
// CoSCO, TCoE, XGtE, MotM. A GM script: the body of an async function that gets `args` ({ dryRun, log }), run by
// gm-script.sh through stage 22 (scripts/pi/remote/22-seven-books.sh) in the running world as the Assistant GM.
// It never prints book text, only counts, names and ids.
//
// What it makes true (a second run changes nothing):
//   1. Every entry in aitool-content classes, species, backgrounds, feats, spells and items whose source book is not
//      one of the seven moves, with the same id, into the GM-only world pack world.legacy-other-books; the copy
//      carries flags.foundry-ai-tool.sourcePack (the pack it came from). An entry with no book stays. An entry that a
//      kept entry links to (also through other kept entries) stays too, so no link breaks. A kept entry that links
//      to an id that is only in the legacy pack gets that entry back. Ids are matched with name and type (and the
//      source pack when the copy has one); an id that two packs share, or that the legacy pack holds for another
//      entry, stops the run before anything changes.
//   2. The SRD items and creatures that kept entries still link to are copied (same ids) into the player-visible
//      world packs world.linked-srd-items and world.linked-srd-creatures, and the links are re-pointed.
//   3. The dnd5e Item and Actor packs (and content24, tables, tables24) are hidden from Player and Trusted, except
//      a pack that kept entries link to (it stays visible and is named in the log); dnd5e.items and dnd5e.monsters
//      are hidden once nothing kept links to them.
// The module packs are shared by every world on this Foundry, so run it in the one world that holds the legacy
// pack (curse-of-strahd). In every other world the moved entries are gone from the shared packs (kept only in the
// legacy pack of this world), the re-pointed links reach world packs that exist only here, and the dnd5e packs stay
// visible (hiding is per world), so the strahd-kit test kit does not show the trimmed view (stage 22 asks for an OK).
// Actor Studio's compendiumSources are not set here: stage 13 owns them.
// Module packs are locked again at the end of every real run, also after a failure (a killed run is put right by the
// next real run, not by a dry run). A failure carries the progress lines in its error text.
// The check mode (stage 22 MODE=check puts `const CHECK_ONLY = true;` in front of this file) never runs for real, even if
// gm-script.sh is pointed at the generated file without --dry-run.
if (typeof CHECK_ONLY !== 'undefined' && CHECK_ONLY && !args.dryRun)
  throw new Error('check only: this file is never a real run');
const KEEP = new Set(['PHB 2024', 'DMG 2024', 'CoS', 'CoSCO', 'TCoE', 'XGtE', 'MotM']);
const TRIM = ['classes', 'species', 'backgrounds', 'feats', 'spells', 'items'].map(
  n => `aitool-content.${n}`
);
// Packs whose entries link to each other and so decide what must stay (the kept entries are what players see).
const SCAN = [
  ...TRIM,
  'dnd-players-handbook.classes',
  'dnd-players-handbook.origins',
  'dnd-players-handbook.feats',
  'dnd-players-handbook.spells',
  'dnd-players-handbook.equipment',
];
const LEGACY = 'world.legacy-other-books';
const LINKED = { items: 'world.linked-srd-items', monsters: 'world.linked-srd-creatures' };
const HIDDEN = { PLAYER: 'NONE', TRUSTED: 'NONE', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
const OPEN = { PLAYER: 'OBSERVER', TRUSTED: 'OBSERVER', ASSISTANT: 'OWNER', GAMEMASTER: 'OWNER' };
const HIDE_EXTRA = ['dnd5e.content24', 'dnd5e.tables', 'dnd5e.tables24'];
const LINK = /Compendium\.([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.(?:[A-Za-z]+\.)?([A-Za-z0-9]{16})/g;
const done = []; // the progress lines, so a failure can say how far the run got
const log = t => {
  done.push(t);
  args.log(t);
};
// Foundry hands the ownership back with its keys in another order than they were set in: compare sorted keys.
const sorted = o =>
  JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))));
const same = (a, b) => sorted(a) === sorted(b);
const ownershipOf = p => JSON.parse(JSON.stringify(p.ownership ?? p.config?.ownership ?? {}));
const sourcePackOf = e => e.flags?.['foundry-ai-tool']?.sourcePack;
const verdict = e => {
  const book = e.system?.source?.book;
  return !book || KEEP.has(book) ? 'keep' : 'move';
};
const blobOf = e => JSON.stringify(e.system ?? '') + JSON.stringify(e.effects ?? '');
const pick = async (pack, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 40)
    out.push(...(await pack.getDocuments({ _id__in: ids.slice(i, i + 40) })));
  return out;
};
// Runs fn with the pack unlocked and locks it again afterwards, also when fn throws.
const unlocked = async (pack, fn) => {
  const wasLocked = pack.locked;
  if (wasLocked) await pack.configure({ locked: false });
  try {
    return await fn();
  } finally {
    if (wasLocked) await pack.configure({ locked: true });
  }
};
const setOwnership = async (pack, wanted) => {
  if (same(ownershipOf(pack), wanted)) return false;
  await pack.configure({ ownership: wanted });
  return true;
};

if (!TRIM.every(id => game.packs.get(id))) {
  log(
    `SKIPPED: this world does not have the aitool-content packs (${TRIM.filter(id => !game.packs.get(id)).join(', ')})`
  );
  return { skipped: true };
}
const scan = SCAN.filter(id => game.packs.get(id));
const fields = { fields: ['system', 'effects'] };
const indexAll = async () => {
  const out = {};
  for (const id of scan) out[id] = await game.packs.get(id).getIndex(fields);
  return out;
};
const index = await indexAll();
const legacyPack = game.packs.get(LEGACY);
const legacyIndex = new Map(
  legacyPack ? (await legacyPack.getIndex({ fields: ['flags'] })).map(e => [e._id, e]) : []
);

// 1. What moves: not one of the seven books.
const moved = new Map(); // "pack|id" -> the index entry
const counts = {};
for (const id of TRIM) {
  counts[id] = { keep: 0, move: 0, keptAsDependency: 0 };
  for (const e of index[id]) {
    if (verdict(e) === 'move') moved.set(`${id}|${e._id}`, e);
    else counts[id].keep++;
  }
  counts[id].move = [...moved.keys()].filter(k => k.startsWith(`${id}|`)).length;
}
const links = new Map(); // "pack|id" -> Set of "pack|id" it links to
for (const id of scan) {
  for (const e of index[id]) {
    const set = new Set();
    for (const m of blobOf(e).matchAll(LINK)) set.add(`${m[1]}|${m[2]}`);
    links.set(`${id}|${e._id}`, set);
  }
}
// A kept entry keeps what it links to, and so on down the chain.
const retained = [];
for (let changed = true; changed; ) {
  changed = false;
  for (const [key, targets] of links) {
    if (moved.has(key)) continue;
    for (const t of targets) {
      if (!moved.has(t)) continue;
      retained.push(moved.get(t).name);
      counts[t.split('|')[0]].keptAsDependency++;
      counts[t.split('|')[0]].move--;
      moved.delete(t);
      changed = true;
    }
  }
}
// The same id in two packs, or an id the legacy pack holds for another entry, would merge two entries into one.
const collisions = [];
const firstOf = new Map(); // id -> "pack|name"
for (const [key, e] of moved) {
  const [pack, docId] = key.split('|');
  const first = firstOf.get(docId);
  if (first && first.pack !== pack)
    collisions.push(`${docId}: ${first.pack} ${first.name} and ${pack} ${e.name}`);
  else firstOf.set(docId, { pack, name: e.name });
  const old = legacyIndex.get(docId);
  if (
    old &&
    !(
      old.name === e.name &&
      old.type === e.type &&
      (!sourcePackOf(old) || sourcePackOf(old) === pack)
    )
  )
    collisions.push(`${docId}: the legacy pack holds ${old.name}, ${pack} has ${e.name}`);
}
if (collisions.length)
  throw new Error(
    `${collisions.length} id collision(s), nothing changed: ${collisions.slice(0, 10).join(' | ')}`
  );
// A kept entry that links to something only the legacy pack has: that entry comes back.
const comeBack = new Map(); // id -> pack
for (const [key, targets] of links) {
  if (moved.has(key)) continue;
  for (const t of targets) {
    const [pack, id] = t.split('|');
    const old = legacyIndex.get(id);
    if (!TRIM.includes(pack) || !old || index[pack].has(id)) continue;
    if (sourcePackOf(old) && sourcePackOf(old) !== pack)
      log(`NOT RESTORED ${id} to ${pack}: the legacy copy came from ${sourcePackOf(old)}`);
    else comeBack.set(id, pack);
  }
}
for (const id of TRIM) log(`COUNT ${id}: ${JSON.stringify(counts[id])}`);
log(
  `DEPENDENCIES kept although another book: ${retained.length}${retained.length ? ` (${retained.slice(0, 40).join(' | ')})` : ''}`
);
log(`BACK FROM LEGACY (kept entries link to them): ${comeBack.size}`);

// 2. The SRD items and creatures that kept entries link to.
const srdTargets = { items: new Set(), monsters: new Set() };
const re = new RegExp(
  `Compendium\\.dnd5e\\.(items|monsters)\\.((?:Item|Actor)\\.)?([A-Za-z0-9]{16})`,
  'g'
);
const todo = []; // [pack, id, name] kept entries that still link to dnd5e.items or dnd5e.monsters
for (const id of scan) {
  for (const e of index[id]) {
    if (moved.has(`${id}|${e._id}`)) continue;
    let hit = false;
    for (const m of blobOf(e).matchAll(re)) {
      srdTargets[m[1]].add(m[3]);
      hit = true;
    }
    if (hit) todo.push([id, e._id, e.name]);
  }
}
for (const kind of ['items', 'monsters']) {
  const pack = game.packs.get(`dnd5e.${kind}`);
  const missing = [...srdTargets[kind]].filter(id => !pack?.index.has(id));
  if (missing.length)
    throw new Error(`dnd5e.${kind} has no entry ${missing.join(', ')} that kept entries link to`);
}
log(
  `SRD LINKS: ${srdTargets.items.size} items, ${srdTargets.monsters.size} creatures; ${todo.length} kept entries to re-point`
);

// 3. Which packs to hide: not a pack that kept entries link to (only dnd5e.items and dnd5e.monsters are re-pointed).
const linkedPacks = new Map(); // pack -> number of kept entries linking to it
for (const [key, targets] of links) {
  if (moved.has(key)) continue;
  for (const pack of new Set([...targets].map(t => t.split('|')[0])))
    linkedPacks.set(pack, (linkedPacks.get(pack) ?? 0) + 1);
}
const candidates = game.packs
  .filter(
    p =>
      p.collection.startsWith('dnd5e.') &&
      !['dnd5e.items', 'dnd5e.monsters'].includes(p.collection) &&
      (['Item', 'Actor'].includes(p.documentName) || HIDE_EXTRA.includes(p.collection))
  )
  .map(p => p.collection);
const hide = candidates.filter(id => !linkedPacks.has(id));
const leftVisible = candidates.filter(id => linkedPacks.has(id));
const toHide = hide.filter(id => !same(ownershipOf(game.packs.get(id)), HIDDEN));
log(`HIDE from Player and Trusted: ${toHide.length} of ${hide.length} packs not hidden yet`);
log(
  `LEFT VISIBLE because kept entries link to them: ${leftVisible.length}${leftVisible.length ? ` (${leftVisible.map(id => `${id} ${linkedPacks.get(id)}`).join(', ')})` : ''}`
);
for (const id of leftVisible) {
  if (same(ownershipOf(game.packs.get(id)), HIDDEN))
    log(`WARNING ${id} is hidden from players although kept entries link to it: make it visible`);
}
log(`MOVE ${moved.size} entries to ${LEGACY}`);
// A rerun deletes the old legacy copy of an entry that is moving again (it came back into aitool-content) and writes the
// content pack's version in its place: a GM edit of the legacy copy is lost, so the dry run says how many.
const replacing = [...moved]
  .filter(([key]) => legacyIndex.has(key.split('|')[1]))
  .map(([, e]) => e.name);
log(
  `REPLACE stale legacy copies with the content pack's version: ${replacing.length}${replacing.length ? ` (${replacing.slice(0, 40).join(' | ')})` : ''}`
);
// Kept entries that link into a pack players cannot open (a dead link for them). The summons and tables packs were
// GM-only before the trim and are a known open point; anything else is drift.
const KNOWN_GM_ONLY = ['aitool-content.summons', 'aitool-content.tables'];
const deadForPlayers = [...linkedPacks.keys()].filter(pid => {
  const p = game.packs.get(pid);
  return p && ownershipOf(p).PLAYER === 'NONE';
});
const unexpectedDead = deadForPlayers.filter(pid => !KNOWN_GM_ONLY.includes(pid));
log(
  `LINKS INTO PACKS PLAYERS CANNOT OPEN: ${deadForPlayers.length}${deadForPlayers.length ? ` (${deadForPlayers.map(id => `${id} ${linkedPacks.get(id)}`).join(', ')})` : ''}, unexpected: ${unexpectedDead.length}`
);
if (args.dryRun) {
  const result = {
    move: moved.size,
    comeBack: comeBack.size,
    repoint: todo.length,
    hide: toHide.length,
  };
  // The check mode of stage 22 (MODE=check) puts `const CHECK_ONLY = true;` in front of this file: a read-only run that
  // fails when the world no longer matches what the trim leaves, so a stage 11 push or a module update cannot undo the
  // trim unseen. The ordinary dry run only reports.
  if (typeof CHECK_ONLY !== 'undefined' && CHECK_ONLY) {
    const srdVisible = ['dnd5e.items', 'dnd5e.monsters'].filter(
      pid => game.packs.get(pid) && !same(ownershipOf(game.packs.get(pid)), HIDDEN)
    );
    // Links into packs players cannot open are listed above but are not drift: running the trim again cannot change
    // them (it never touches the ownership of aitool-content packs), so they are a finding for the user.
    const drift = { ...result, srdVisible: srdVisible.length };
    if (Object.values(drift).some(n => n > 0))
      throw new Error(
        `DRIFT: the world no longer matches the seven-book trim ${JSON.stringify(drift)}; run stage 22 again (dry run first)\n${done.join('\n')}`
      );
    log('no drift: the world matches the seven-book trim');
  }
  return result;
}

// ---- real run ----
const real = async () => {
  let legacy = legacyPack;
  if (!legacy) {
    legacy = await CompendiumCollection.createCompendium({
      type: 'Item',
      label: 'Legacy and other books (GM only)',
      name: 'legacy-other-books',
      package: 'world',
    });
  }
  await setOwnership(legacy, HIDDEN);

  // Create in the target first, delete from the source only after the create is confirmed, chunk by chunk.
  for (const id of TRIM) {
    const ids = [...moved.keys()].filter(k => k.startsWith(`${id}|`)).map(k => k.split('|')[1]);
    const pack = game.packs.get(id);
    await unlocked(pack, async () => {
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = ids.slice(i, i + 40);
        // An entry that is in the legacy pack already (a killed earlier run, or a stage 11 push that brought it back
        // into aitool-content) is replaced by the copy from the content pack, never kept as the stale one. The old
        // copy goes first; if the create then fails, the entry is still in its content pack and the run stops.
        const stale = chunk.filter(x => legacy.index.has(x));
        if (stale.length) await Item.deleteDocuments(stale, { pack: LEGACY });
        const fresh = chunk;
        if (fresh.length) {
          const data = (await pick(pack, fresh)).map(d => {
            const o = d.toObject();
            return {
              ...o,
              folder: null,
              flags: {
                ...o.flags,
                'foundry-ai-tool': { ...o.flags?.['foundry-ai-tool'], sourcePack: id },
              },
            };
          });
          const made = await Item.createDocuments(data, { pack: LEGACY, keepId: true });
          if (made.length !== fresh.length)
            throw new Error(
              `${id}: created ${made.length} of ${fresh.length}; nothing deleted from ${id} (${stale.length} stale legacy copies were already replaced)`
            );
        }
        await Item.deleteDocuments(chunk, { pack: id });
      }
    });
    log(`MOVED ${id}: ${ids.length}, left ${pack.index.size}`);
  }
  for (const [id, target] of comeBack) {
    const pack = game.packs.get(target);
    await unlocked(pack, async () => {
      const doc = await legacy.getDocument(id);
      const made = await Item.createDocuments([{ ...doc.toObject(), folder: null }], {
        pack: target,
        keepId: true,
      });
      if (made.length !== 1) throw new Error(`${id}: not created in ${target}`);
      await Item.deleteDocuments([id], { pack: LEGACY });
    });
    log(`RESTORED ${id} to ${target} (run again to check its own links)`);
  }

  // Copies, same ids, then the re-pointing in the kept entries.
  for (const kind of ['items', 'monsters']) {
    const ids = [...srdTargets[kind]];
    if (!ids.length) continue;
    const doc = kind === 'items' ? Item : Actor;
    let pack = game.packs.get(LINKED[kind]);
    if (!pack) {
      pack = await CompendiumCollection.createCompendium({
        type: kind === 'items' ? 'Item' : 'Actor',
        label:
          kind === 'items' ? 'Linked equipment (from SRD 5.1)' : 'Linked creatures (from SRD 5.1)',
        name: LINKED[kind].split('.')[1],
        package: 'world',
      });
    }
    await setOwnership(pack, OPEN);
    const fresh = ids.filter(x => !pack.index.has(x));
    if (fresh.length) {
      const docs = await pick(game.packs.get(`dnd5e.${kind}`), fresh);
      if (docs.length !== fresh.length)
        throw new Error(`dnd5e.${kind}: got ${docs.length} of ${fresh.length}`);
      await doc.createDocuments(
        docs.map(d => d.toObject()),
        { pack: pack.collection, keepId: true }
      );
    }
    log(`COPIED into ${pack.collection}: ${fresh.length} (now ${pack.index.size})`);
  }
  const swap = text =>
    text.replace(re, (m, kind, type, id) => `Compendium.${LINKED[kind]}.${type ?? ''}${id}`);
  let repointed = 0;
  for (const pid of [...new Set(todo.map(t => t[0]))]) {
    const pack = game.packs.get(pid);
    const ids = todo.filter(t => t[0] === pid).map(t => t[1]);
    await unlocked(pack, async () => {
      for (const d of await pick(pack, ids)) {
        const o = d.toObject();
        await d.update({ system: JSON.parse(swap(JSON.stringify(o.system))) });
        if (re.test(JSON.stringify(o.effects ?? []))) {
          re.lastIndex = 0;
          const eff = JSON.parse(swap(JSON.stringify(o.effects)));
          await d.updateEmbeddedDocuments(
            'ActiveEffect',
            eff.map(e => ({
              _id: e._id,
              changes: e.changes,
              flags: e.flags,
              description: e.description,
            }))
          );
        }
        re.lastIndex = 0;
        repointed++;
      }
    });
    log(`RE-POINTED in ${pid}: ${ids.length}`);
  }

  // Nothing kept may still link to dnd5e.items or dnd5e.monsters before they are hidden.
  let left = 0;
  const after = await indexAll();
  for (const id of scan) {
    for (const e of after[id]) {
      if (re.test(blobOf(e))) {
        left++;
        log(`STILL LINKS ${id} ${e.name}`);
      }
      re.lastIndex = 0;
    }
  }
  log(`kept entries still linking to dnd5e.items or dnd5e.monsters: ${left}`);
  for (const pid of hide) await setOwnership(game.packs.get(pid), HIDDEN);
  if (left !== 0) {
    throw new Error(
      `${left} kept entries still link to the SRD packs; dnd5e.items and dnd5e.monsters stay visible`
    );
  }
  for (const pid of ['dnd5e.items', 'dnd5e.monsters'])
    await setOwnership(game.packs.get(pid), HIDDEN);
  log('HIDDEN dnd5e.items and dnd5e.monsters');
  return {
    moved: moved.size,
    comeBack: comeBack.size,
    repointed,
    hidden: hide.length + 2,
    leftVisible: leftVisible.length,
  };
};

let result;
let failure = null;
try {
  result = await real();
} catch (e) {
  failure = e;
}
// A killed run skips the lock in unlocked(): every module pack the run may have opened is locked again here, each
// on its own so that one refusal neither hides the error above nor leaves the other packs open.
const relockFailures = [];
for (const id of scan) {
  const pack = game.packs.get(id);
  try {
    if (!pack.locked) await pack.configure({ locked: true });
  } catch (e) {
    relockFailures.push(`could not lock ${id} again: ${e.message}`);
  }
}
if (failure || relockFailures.length) {
  const head = failure ? failure.message : 'the trim finished but module packs could not be locked';
  throw new Error(`${head}\nDONE BEFORE THE FAILURE:\n${[...done, ...relockFailures].join('\n')}`);
}
return result;

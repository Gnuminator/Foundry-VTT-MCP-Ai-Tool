// Trims the player-facing content to the seven kept books (the user, 2026-11-03): PHB 2024, DMG 2024, CoS,
// CoSCO, TCoE, XGtE, MotM. A GM script: the body of an async function that gets `args` ({ dryRun, log }), run by
// gm-script.sh through stage 22 (scripts/pi/remote/22-seven-books.sh) in the running world as the Assistant GM.
// It never prints book text, only counts, names and ids.
//
// What it makes true (a second run changes nothing):
//   1. Every entry in aitool-content classes, species, backgrounds, feats, spells and items whose source book is not
//      one of the seven moves, with the same id, into the GM-only world pack world.legacy-other-books. An entry
//      with no book stays. An entry that a kept entry links to (also through other kept entries) stays too, so no
//      link breaks. A kept entry that links to an id that is only in the legacy pack gets that entry back.
//   2. The SRD items and creatures that kept entries still link to are copied (same ids) into the player-visible
//      world packs world.linked-srd-items and world.linked-srd-creatures, and the links are re-pointed.
//   3. The dnd5e Item and Actor packs (and content24, tables, tables24) are hidden from Player and Trusted;
//      dnd5e.items and dnd5e.monsters too once nothing kept links to them.
// The module packs are shared by every world on this Foundry, so run it in the one world that holds the legacy
// pack (curse-of-strahd). Actor Studio's compendiumSources are not set here: stage 13 owns them.
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
const log = t => args.log(t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ownershipOf = p => JSON.parse(JSON.stringify(p.ownership ?? p.config?.ownership ?? {}));
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
const legacyIds = new Set(legacyPack ? (await legacyPack.getIndex()).map(e => e._id) : []);

// 1. What moves: not one of the seven books.
const moved = new Map(); // "pack|id" -> name
const counts = {};
for (const id of TRIM) {
  counts[id] = { keep: 0, move: 0, keptAsDependency: 0 };
  for (const e of index[id]) {
    if (verdict(e) === 'move') moved.set(`${id}|${e._id}`, e.name);
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
      retained.push(moved.get(t));
      counts[t.split('|')[0]].keptAsDependency++;
      counts[t.split('|')[0]].move--;
      moved.delete(t);
      changed = true;
    }
  }
}
// A kept entry that links to something only the legacy pack has: that entry comes back.
const comeBack = new Map(); // id -> pack
for (const [key, targets] of links) {
  if (moved.has(key)) continue;
  for (const t of targets) {
    const [pack, id] = t.split('|');
    if (TRIM.includes(pack) && legacyIds.has(id) && !index[pack].has(id)) comeBack.set(id, pack);
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

const hide = game.packs
  .filter(
    p =>
      p.collection.startsWith('dnd5e.') &&
      !['dnd5e.items', 'dnd5e.monsters'].includes(p.collection) &&
      (['Item', 'Actor'].includes(p.documentName) || HIDE_EXTRA.includes(p.collection))
  )
  .map(p => p.collection);
const toHide = hide.filter(id => !same(ownershipOf(game.packs.get(id)), HIDDEN));
log(`HIDE from Player and Trusted: ${toHide.length} of ${hide.length} packs not hidden yet`);
log(`MOVE ${moved.size} entries to ${LEGACY}`);
if (args.dryRun) {
  return { move: moved.size, comeBack: comeBack.size, repoint: todo.length, hide: toHide.length };
}

// ---- real run ----
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
      const fresh = chunk.filter(x => !legacy.index.has(x));
      if (fresh.length) {
        const data = (await pick(pack, fresh)).map(d => ({ ...d.toObject(), folder: null }));
        const made = await Item.createDocuments(data, { pack: LEGACY, keepId: true });
        if (made.length !== fresh.length)
          throw new Error(
            `${id}: created ${made.length} of ${fresh.length}; nothing of this chunk deleted`
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
          eff.map(e => ({ _id: e._id, changes: e.changes, flags: e.flags }))
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
if (left === 0) {
  for (const pid of ['dnd5e.items', 'dnd5e.monsters'])
    await setOwnership(game.packs.get(pid), HIDDEN);
  log('HIDDEN dnd5e.items and dnd5e.monsters');
} else {
  throw new Error(
    `${left} kept entries still link to the SRD packs; dnd5e.items and dnd5e.monsters stay visible`
  );
}
return { moved: moved.size, comeBack: comeBack.size, repointed, hidden: hide.length + 2 };

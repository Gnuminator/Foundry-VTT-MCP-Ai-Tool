// Deletes the GM-only pack world.legacy-other-books for good (the last step of the seven-book trim). A GM script
// like seven-books-trim.js, run by stage 22 only with MODE=delete and the user's OK for this deletion: the entries in
// it exist nowhere else on the Pi (a dietpi-backup snapshot or the PC's content module is the only way back).
// It refuses when a kept entry in the player-visible packs still links to an id that only the legacy pack has, and
// when the legacy pack is not the one made by the trim (GM only). The dry run only counts.
const LEGACY = 'world.legacy-other-books';
const SCAN = [
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
  'world.linked-srd-items',
  'world.linked-srd-creatures',
];
const LINK = /Compendium\.([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.(?:[A-Za-z]+\.)?([A-Za-z0-9]{16})/g;
const log = t => args.log(t);

const legacy = game.packs.get(LEGACY);
if (!legacy) {
  log('nothing to delete: world.legacy-other-books does not exist');
  return { deleted: false };
}
const own = JSON.parse(JSON.stringify(legacy.ownership ?? legacy.config?.ownership ?? {}));
if (own.PLAYER !== 'NONE' || own.TRUSTED !== 'NONE') {
  throw new Error(`the legacy pack is visible to players (${JSON.stringify(own)}); not deleting`);
}
const legacyIndex = new Map((await legacy.getIndex({ fields: ['flags'] })).map(e => [e._id, e]));
const legacyIds = new Set(legacyIndex.keys());
log(`legacy pack holds ${legacyIds.size} entries`);

// A link is cut off by the deletion when it names the legacy pack, or names an id that the legacy pack holds (from
// that pack, or untagged) and that its own pack no longer has.
const linked = [];
for (const id of SCAN) {
  const pack = game.packs.get(id);
  if (!pack) continue;
  for (const e of await pack.getIndex({ fields: ['system', 'effects'] })) {
    const blob = JSON.stringify(e.system ?? '') + JSON.stringify(e.effects ?? '');
    for (const m of blob.matchAll(LINK)) {
      const [, targetPack, targetId] = m;
      const old = legacyIndex.get(targetId);
      const from = old?.flags?.['foundry-ai-tool']?.sourcePack;
      if (
        targetPack === LEGACY
          ? old
          : old &&
            (!from || from === targetPack) &&
            !game.packs.get(targetPack)?.index.has(targetId)
      )
        linked.push(`${e.name} (${id})`);
    }
  }
}
log(
  `kept entries that link to a legacy-only entry: ${linked.length}${linked.length ? ` (${linked.slice(0, 20).join(' | ')})` : ''}`
);
if (linked.length)
  throw new Error('a kept entry still links to the legacy pack; run seven-books-trim.js first');
if (args.dryRun) return { wouldDelete: legacyIds.size };

await legacy.deleteCompendium();
log(`deleted ${LEGACY} (${legacyIds.size} entries); pack still there: ${game.packs.has(LEGACY)}`);
return { deleted: true, entries: legacyIds.size };

// Grave Domain content patch (the user, 2026-11-08; Backlog grave-domain-content-patch). A GM script like
// seven-books-trim.js: the body of an async function that gets `args` ({ dryRun, log }), run by gm-script.sh through
// stage 22 (MODE=grave-patch) in the running world as the Assistant GM, or by hand in a browser console on a test
// server (see docs/dev/PI-SETUP.md, "Grave Domain content patch"). It never prints book text, only counts, names and ids.
//
// What it makes true in the module pack aitool-content.classes (a second run changes nothing):
//   1. Circle of Mortality (the 2014 Grave Domain feature) gets an ItemGrant advancement at level 1 for a copy of the
//      Spare the Dying spell: Wisdom, always prepared. The copy lives in aitool-content.spells under a fixed id and
//      differs from the book spell only by what the feature says: range 30 feet and a bonus action, written on the spell
//      and as an override on its activities. It is made from the Players Handbook spell at run time, so no spell text
//      is stored in this repo.
//   2. Channel Divinity: Path to the Grave gets a utility activity (a Use button) that spends one use of the cleric's
//      Channel Divinity feature (identifier channel-divinity). The Cursed effect stays on
//      the feature to be applied by hand.
// Nothing else in the packs changes. The copies in world.player-classes and world.player-spells are not touched here:
// run the baseline (stage 22 MODE=baseline) afterwards and it copies the patched entries over and re-points the links.
// Module packs are locked again at the end of every real run, also after a failure. A module update that rewrites
// aitool-content.classes undoes the patch: run this again (MODE=grave-check says when).
// The check mode (stage 22 MODE=grave-check puts `const GRAVE_MODE = 'check';` in front of this file) never writes and
// fails when the patch is missing.
const CHECK = typeof GRAVE_MODE !== 'undefined' && GRAVE_MODE === 'check';
if (CHECK && !args.dryRun) throw new Error('check only: this file is never a real run');

const CLASSES = 'aitool-content.classes';
const SPELLS = 'aitool-content.spells';
const PHB_SPELLS = 'dnd-players-handbook.spells';
const PHB_SPARE = 'phbsplSparetheDy';
// dnd5e's own form for "the cleric's Channel Divinity on this actor": item type and identifier (tested on server A:
// it spends the use from the Channel Divinity item on the actor; a compendium uuid here did not on a bare copy).
const CD_TARGET = 'feat:channel-divinity';
const CIRCLE = 'cVLrkyhsPzELan6D';
const PATH = 'RC9A6n8RjP4gtPoF';
const SPARE_ID = 'aitGraveSpareDy1';
const ADV_ID = 'aitGraveSpare001';
const ACT_ID = 'utilityPtGclNe00';
const FLAG = 'foundry-ai-tool';

const done = [];
const log = t => {
  done.push(t);
  args.log(t);
};
// Foundry fills defaults into what it stores: the patch holds when every value we write is there.
const covers = (have, want) =>
  want && typeof want === 'object'
    ? have && typeof have === 'object' && Object.keys(want).every(k => covers(have[k], want[k]))
    : have === want;

const wantedAdvancement = () => ({
  _id: ADV_ID,
  type: 'ItemGrant',
  level: 1,
  classRestriction: '',
  hint: '',
  value: {},
  configuration: {
    items: [{ uuid: `Compendium.${SPELLS}.Item.${SPARE_ID}`, optional: false }],
    optional: false,
    sorting: 'm',
    spell: {
      ability: ['wis'],
      method: 'spell',
      prepared: 2,
      uses: { max: '', per: '', requireSlot: false },
    },
  },
});

const wantedActivity = () => ({
  _id: ACT_ID,
  type: 'utility',
  name: 'Path to the Grave',
  sort: 0,
  activation: { type: 'action', value: 1, condition: '', override: false },
  consumption: {
    targets: [
      { type: 'itemUses', target: CD_TARGET, value: '1', scaling: { mode: '', formula: '' } },
    ],
    scaling: { allowed: false, max: '' },
    spellSlot: false,
  },
  description: { chatFlavor: '' },
  duration: { units: 'inst', concentration: false, override: false },
  effects: [],
  range: { units: 'ft', value: '30', special: '', override: false },
  target: {
    prompt: true,
    affects: { count: '1', type: 'creature', choice: false, special: '' },
    template: { contiguous: false, units: 'ft' },
    override: false,
  },
  uses: { spent: 0, recovery: [] },
  roll: { prompt: false, visible: false },
  img: null,
});

// The Spare the Dying copy: the book spell with the feature's range and activation.
const spareFrom = book => {
  const o = book.toObject();
  o._id = SPARE_ID;
  delete o.folder;
  delete o.sort;
  o.ownership = { default: 0 };
  o.flags = { ...(o.flags ?? {}), [FLAG]: { ...(o.flags?.[FLAG] ?? {}), graveDomainSpare: true } };
  // The feature is Xanathar's content, and XGtE is one of the seven kept books: the seven-book trim keeps the copy
  // and the check does not call it drift.
  o.system.source = { ...(o.system.source ?? {}), book: 'XGtE', custom: '' };
  o.system.range = { ...(o.system.range ?? {}), value: '30', units: 'ft', special: '' };
  o.system.activation = { ...(o.system.activation ?? {}), type: 'bonus', value: 1, condition: '' };
  for (const a of Object.values(o.system.activities ?? {})) {
    a.activation = { ...(a.activation ?? {}), type: 'bonus', value: 1, override: true };
    a.range = { ...(a.range ?? {}), value: '30', units: 'ft', special: '', override: true };
  }
  return o;
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

const classes = game.packs.get(CLASSES);
const spells = game.packs.get(SPELLS);
const phb = game.packs.get(PHB_SPELLS);
if (!classes || !spells)
  throw new Error(`${CLASSES} or ${SPELLS} is not installed. Nothing was changed`);
if (!phb)
  throw new Error(
    `${PHB_SPELLS} is not installed (the Spare the Dying copy is made from it). Nothing was changed`
  );
const book = await phb.getDocument(PHB_SPARE);
if (!book || book.name !== 'Spare the Dying')
  throw new Error(`${PHB_SPELLS} ${PHB_SPARE} is not Spare the Dying. Nothing was changed`);
const circle = await classes.getDocument(CIRCLE);
const path = await classes.getDocument(PATH);
if (!circle || circle.name !== 'Circle of Mortality')
  throw new Error(`${CLASSES} ${CIRCLE} is not Circle of Mortality. Nothing was changed`);
if (!path || path.name !== 'Channel Divinity: Path to the Grave')
  throw new Error(
    `${CLASSES} ${PATH} is not Channel Divinity: Path to the Grave. Nothing was changed`
  );

const haveSpare = await spells.getDocument(SPARE_ID);
const wantSpare = spareFrom(book);
const spareOk =
  haveSpare &&
  covers(
    { system: haveSpare.toObject().system, flags: haveSpare.toObject().flags?.[FLAG] },
    { system: wantSpare.system, flags: wantSpare.flags[FLAG] }
  );
const advOk = covers(circle.toObject().system.advancement?.[ADV_ID], wantedAdvancement());
const actOk = covers(path.toObject().system.activities?.[ACT_ID], wantedActivity());
const todo = [];
if (!spareOk)
  todo.push(haveSpare ? 'refresh the Spare the Dying copy' : 'make the Spare the Dying copy');
if (!advOk) todo.push('add the Spare the Dying grant to Circle of Mortality');
if (!actOk) todo.push('add the Use activity to Path to the Grave');
log(todo.length ? `to do: ${todo.join('; ')}` : 'already patched, nothing to do');

if (CHECK) {
  if (todo.length) throw new Error(`grave domain patch missing: ${todo.join('; ')}`);
  return { patched: true };
}
if (args.dryRun || !todo.length) return { todo };

let failure = null;
try {
  if (!spareOk) {
    await unlocked(spells, async () => {
      if (haveSpare) await haveSpare.update({ system: wantSpare.system, flags: wantSpare.flags });
      else await Item.createDocuments([wantSpare], { pack: SPELLS, keepId: true });
    });
    log(`Spare the Dying copy ${SPARE_ID} in ${SPELLS}`);
  }
  if (!advOk || !actOk) {
    await unlocked(classes, async () => {
      if (!advOk) {
        await circle.update({ [`system.advancement.${ADV_ID}`]: wantedAdvancement() });
        log(`Circle of Mortality now grants ${SPARE_ID} (Wisdom, always prepared)`);
      }
      if (!actOk) {
        await path.update({ [`system.activities.${ACT_ID}`]: wantedActivity() });
        log('Path to the Grave has a Use activity that spends one Channel Divinity use');
      }
    });
  }
} catch (e) {
  failure = e;
}
for (const p of [classes, spells]) {
  try {
    if (!p.locked) await p.configure({ locked: true });
  } catch (e) {
    log(`could not lock ${p.collection} again: ${e.message}`);
  }
}
if (failure) throw new Error(`${failure.message}\nDONE BEFORE THE FAILURE:\n${done.join('\n')}`);
return { patched: true, done };

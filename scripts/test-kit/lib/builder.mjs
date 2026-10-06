/**
 * The kit builder: wipes what an earlier build made (every document with the kit flag) and
 * builds the kit again, the same every time: a "Test Kit" folder per type, a gridded combat
 * scene, heroes for every class and subclass leveled through the system's advancement (class and
 * subclass packs come from the content profile, profiles.mjs), and a small monster matrix chosen
 * by rule from the system's monster compendium through the bridge tools, with tokens on a fixed
 * layout.
 *
 * Hero selection (the user's picks, 2026-10-05): every 2024 class and subclass, plus the legacy
 * (2014) subclasses that remain. A legacy entry is skipped when a 2024 entry with the same
 * identifier or name exists; an exact duplicate across packs is skipped (first pack wins). A
 * legacy subclass is paired with the legacy version of its class when the profile has one, else
 * with the 2024 class. How many heroes and at which levels is HERO_PLAN (contract.mjs).
 *
 * The monsters and the scene are data: scripts/test-kit/data/smoke-matrix.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_PLAN, KIT_FORMAT_VERSION, KIT_PLAYER_USER } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { loadProfile } from './profiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MATRIX_FILE = path.join(here, '..', 'data', 'smoke-matrix.json');

/** Document types that get a "Test Kit" folder. */
const FOLDER_TYPES = ['Actor', 'Scene', 'Item', 'JournalEntry'];
const FOLDER_NAME = 'Test Kit';

/** @returns {any} the matrix from data/smoke-matrix.json */
export function loadMatrix() {
  return JSON.parse(readFileSync(MATRIX_FILE, 'utf8'));
}

const byNameThenId = (a, b) =>
  a.name.localeCompare(b.name, 'en') || String(a.id).localeCompare(String(b.id), 'en');

/**
 * Whether a full compendium entry has the trait a matrix cell requires.
 * `fly`: a flying speed. `resistance`: any damage resistance, immunity or vulnerability.
 * @param {'fly'|'resistance'} trait
 * @param {any} entry  a `get-compendium-item` result (not compact)
 */
export function hasTrait(trait, entry) {
  // fullData is the stored source (arrays); `system` is prepared data (sets arrive as {}).
  const source = entry?.fullData?.system ?? {};
  const prepared = entry?.system ?? {};
  if (trait === 'fly') {
    const movement = source.attributes?.movement ?? {};
    const fly = movement.speeds?.fly ?? movement.fly ?? prepared.attributes?.movement?.fly ?? 0;
    return Number(fly) > 0;
  }
  const traits = source.traits ?? {};
  return ['dr', 'di', 'dv'].some(key => {
    const value = traits[key]?.value;
    return Array.isArray(value) && value.length > 0;
  });
}

/**
 * Picks the monsters for the matrix, deterministically: per cell, the creatures the criteria
 * match, restricted to the matrix pack, sorted by name then id; the first one nobody picked
 * before (and that has the required trait) wins.
 * @param {{tool: (name: string, args?: object) => Promise<any>}} dashboard
 * @param {any} matrix  the `monsters` part of the matrix file
 * @param {(m: string) => void} [log]
 * @returns {Promise<Array<{cell: string, packId: string, itemId: string, name: string, cr: number, type: string, size: string}>>}
 */
export async function selectMonsters(dashboard, matrix, log = () => {}) {
  const exclude = new RegExp(matrix.excludeIdPattern);
  const picked = [];
  for (const cell of matrix.cells) {
    const listed = await dashboard.tool('list-creatures-by-criteria', {
      ...cell.criteria,
      limit: 1000,
    });
    const candidates = (listed?.creatures ?? [])
      .filter(c => c.pack?.id === matrix.pack && !exclude.test(c.id))
      .filter(c => !picked.some(p => p.itemId === c.id))
      .sort(byNameThenId);
    let chosen = null;
    for (const candidate of candidates) {
      if (cell.require) {
        const entry = await dashboard.tool('get-compendium-item', {
          packId: matrix.pack,
          itemId: candidate.id,
        });
        if (!hasTrait(cell.require, entry)) continue;
      }
      chosen = candidate;
      break;
    }
    if (!chosen)
      throw new Error(`The kit matrix cell "${cell.cell}" matched no creature in ${matrix.pack}.`);
    log(
      `monster ${cell.cell}: ${chosen.name} (CR ${chosen.challengeRating}, ${chosen.size} ${chosen.creatureType})`
    );
    picked.push({
      cell: cell.cell,
      packId: matrix.pack,
      itemId: chosen.id,
      name: chosen.name,
      cr: Number(chosen.challengeRating),
      type: String(chosen.creatureType),
      size: String(chosen.size),
    });
  }
  return picked;
}

/**
 * One compendium index row as listCompendium returns it.
 * @typedef {{packId: string, id: string, uuid: string, name: string, type: string, identifier: string,
 *   classIdentifier?: string, rules: string, book: string}} IndexEntry
 */

/** Anything that is not marked 2024 counts as legacy (2014). @param {IndexEntry} e */
const rulesOf = e => (e.rules === '2024' ? '2024' : '2014');

const byName = (/** @type {{name: string}} */ a, /** @type {{name: string}} */ b) =>
  a.name.localeCompare(b.name, 'en');

/**
 * Entries that pass the profile's selection: rules version, names and id pattern to skip, and
 * exact duplicates (same type, rules, name and class) dropped with the first pack winning.
 * @param {IndexEntry[]} entries in pack order
 * @param {{rules: string[], skipNames?: string[], skipIds?: string}} select
 */
function passSelect(entries, select) {
  const skipNames = new Set((select.skipNames ?? []).map(n => n.toLowerCase()));
  const skipIds = select.skipIds ? new RegExp(select.skipIds) : null;
  const seen = new Set();
  return entries.filter(e => {
    if (!select.rules.includes(rulesOf(e))) return false;
    if (skipNames.has(e.name.toLowerCase())) return false;
    if (skipIds && skipIds.test(e.id)) return false;
    const key = [e.type, rulesOf(e), e.name.toLowerCase(), e.classIdentifier ?? ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Chooses the classes and subclasses to build, by the user's rules (see the file header).
 * Pure: the same index rows give the same choice.
 * @param {{classes: IndexEntry[], subclasses: IndexEntry[], select: {rules: string[], skipNames?: string[], skipIds?: string}}} o
 * @returns {{classes: IndexEntry[], subclasses: Array<{entry: IndexEntry, classEntry: IndexEntry | null}>, skipped: string[]}}
 */
export function selectContent({ classes, subclasses, select }) {
  const skipped = [];
  const allClasses = passSelect(classes, select);
  const modernClasses = allClasses.filter(c => rulesOf(c) === '2024');
  const legacyClasses = allClasses.filter(c => rulesOf(c) === '2014');
  const modernIds = new Set(modernClasses.map(c => c.identifier));
  // Tier heroes: every 2024 class, plus a legacy class that has no 2024 version.
  const heroClasses = [
    ...modernClasses,
    ...legacyClasses.filter(c => !modernIds.has(c.identifier)),
  ].sort(byName);

  const allSubs = passSelect(subclasses, select);
  const modernSubs = allSubs.filter(s => rulesOf(s) === '2024');
  const modernKeys = new Set();
  for (const s of modernSubs) {
    modernKeys.add(`${s.classIdentifier}/id/${s.identifier}`);
    modernKeys.add(`${s.classIdentifier}/name/${s.name.toLowerCase()}`);
  }
  const keptSubs = allSubs.filter(s => {
    if (rulesOf(s) === '2024') return true;
    const same =
      modernKeys.has(`${s.classIdentifier}/id/${s.identifier}`) ||
      modernKeys.has(`${s.classIdentifier}/name/${s.name.toLowerCase()}`);
    if (same) skipped.push(`${s.name} (legacy, a 2024 entry exists)`);
    return !same;
  });
  const legacyClassBy = new Map();
  for (const c of legacyClasses)
    if (!legacyClassBy.has(c.identifier)) legacyClassBy.set(c.identifier, c);
  const modernClassBy = new Map();
  for (const c of modernClasses)
    if (!modernClassBy.has(c.identifier)) modernClassBy.set(c.identifier, c);
  const paired = keptSubs.map(entry => {
    const id = entry.classIdentifier ?? '';
    const classEntry =
      rulesOf(entry) === '2014'
        ? (legacyClassBy.get(id) ?? modernClassBy.get(id) ?? null)
        : (modernClassBy.get(id) ?? legacyClassBy.get(id) ?? null);
    return { entry, classEntry };
  });
  paired.sort(
    (a, b) =>
      (a.entry.classIdentifier ?? '').localeCompare(b.entry.classIdentifier ?? '', 'en') ||
      byName(a.entry, b.entry)
  );
  return { classes: heroClasses, subclasses: paired, skipped };
}

/**
 * The heroes to build for a kit size. Tier heroes: every class at each tier level, with the
 * class's first subclass (by name) from the subclass level on. Subclass heroes: every subclass at
 * the plan's subclass level. Rotation is the hero's index within its class, so siblings differ.
 * Pure.
 * @param {{classes: IndexEntry[], subclasses: Array<{entry: IndexEntry, classEntry: IndexEntry | null}>,
 *   size: 'smoke'|'full'|'long', subclassAt?: Record<string, number>}} o  subclassAt: class uuid -> level
 * @returns {Array<{name: string, role: 'tier'|'subclass', level: number, rotation: number,
 *   classEntry: IndexEntry | null, subclassEntry: IndexEntry | null}>}
 */
export function planHeroes({ classes, subclasses, size, subclassAt = {} }) {
  const plan = HERO_PLAN[size];
  const rows = [];
  for (const classEntry of classes) {
    const first = subclasses.find(s => s.classEntry === classEntry);
    for (const level of plan.tierLevels) {
      const from = subclassAt[classEntry.uuid] ?? 3;
      rows.push({
        name: `Kit ${classEntry.name} ${level}`,
        role: /** @type {const} */ ('tier'),
        level,
        rotation: 0,
        classEntry,
        subclassEntry: first && level >= from ? first.entry : null,
      });
    }
  }
  if (plan.subclassLevel) {
    for (const { entry, classEntry } of subclasses) {
      rows.push({
        name: `Kit ${entry.name} ${plan.subclassLevel}`,
        role: /** @type {const} */ ('subclass'),
        level: plan.subclassLevel,
        rotation: 0,
        classEntry,
        subclassEntry: entry,
      });
    }
  }
  const counts = new Map();
  const names = new Set();
  for (const row of rows) {
    const key = row.classEntry?.uuid ?? row.subclassEntry?.classIdentifier ?? '';
    row.rotation = counts.get(key) ?? 0;
    counts.set(key, row.rotation + 1);
    // Two heroes with one name would hide each other in the folder: tell them apart.
    if (names.has(row.name)) {
      const tag = row.subclassEntry
        ? rulesOf(row.subclassEntry)
        : row.classEntry
          ? rulesOf(row.classEntry)
          : '';
      row.name = `${row.name} (${tag || row.rotation})`;
    }
    while (names.has(row.name)) row.name += '+';
    names.add(row.name);
  }
  return rows;
}

/** @param {{x: number, y: number, dx: number, dy: number, perRow: number}} layout @param {number} i */
function slot(layout, i) {
  return {
    x: layout.x + (i % layout.perRow) * layout.dx,
    y: layout.y + Math.floor(i / layout.perRow) * layout.dy,
  };
}

/**
 * Reads the profile's class, subclass, species and background packs through the GM page.
 * @param {{call: (action: string, args?: object) => Promise<any>}} gm
 * @param {ReturnType<typeof loadProfile>} profile
 * @param {(m: string) => void} log
 */
async function discover(gm, profile, log) {
  const list = async (packIds, type) => {
    const reply = await gm.call('listCompendium', { packIds, type });
    for (const id of reply.missing ?? []) log(`profile pack not installed: ${id}`);
    return /** @type {IndexEntry[]} */ (reply.entries);
  };
  const classes = await list(profile.packs.classes, 'class');
  const subclasses = await list(profile.packs.subclasses, 'subclass');
  const species = await list(profile.packs.species, 'race');
  const backgrounds = await list(profile.packs.backgrounds, 'background');
  return { classes, subclasses, species, backgrounds };
}

/** The named origin (2024 first), else the first 2024 one, else undefined (the GM action's default). */
function pickOrigin(entries, name) {
  const modern = entries.filter(e => rulesOf(e) === '2024').sort(byName);
  return (modern.find(e => e.name === name) ?? entries.find(e => e.name === name) ?? modern[0])
    ?.uuid;
}

/**
 * Build the kit in the world. Switches GM Actions on for the monster writes and puts the switch
 * back as it found it.
 * @param {{dashboard: any, gm: {call: (action: string, args?: object) => Promise<any>}, world: string,
 *   size?: 'smoke'|'full'|'long', log?: (m: string) => void, matrix?: any,
 *   profile?: ReturnType<typeof loadProfile>, classes?: string[]}} o
 *   classes: a development filter, class identifiers or names (lower case); empty builds all
 * @returns {Promise<import('./contract.mjs').KitManifest>}
 */
export async function buildKit({
  dashboard,
  gm,
  world,
  size = 'smoke',
  log = () => {},
  matrix = loadMatrix(),
  profile = loadProfile(),
  classes: classFilter = [],
}) {
  if (profile.world !== world) {
    throw new EnvError(`The profile "${profile.id}" builds in ${profile.world}, not ${world}.`);
  }
  const buildStartedAt = Date.now();
  const status = await gm.call('worldStatus');
  if (status.worldId !== world) {
    throw new EnvError(`The GM page is in world "${status.worldId}", not "${world}".`);
  }
  if (!status.moduleActive) {
    throw new EnvError(
      'The foundry-mcp-bridge module is not active in the kit world (run provisioning).'
    );
  }

  const found = await discover(gm, profile, log);
  let content = selectContent({
    classes: found.classes,
    subclasses: found.subclasses,
    select: profile.select,
  });
  if (classFilter.length) {
    const wanted = new Set(classFilter);
    const keep = c => wanted.has(c.identifier.toLowerCase()) || wanted.has(c.name.toLowerCase());
    const classes = content.classes.filter(keep);
    const ids = new Set(classes.map(c => c.identifier));
    content = {
      ...content,
      classes,
      subclasses: content.subclasses.filter(s => ids.has(s.entry.classIdentifier ?? '')),
    };
    if (!classes.length) throw new EnvError(`--classes ${classFilter.join(',')} matched no class.`);
  }
  log(
    `content (${profile.id}): ${content.classes.length} classes, ${content.subclasses.length} subclasses` +
      ` (${content.skipped.length} legacy subclasses skipped: a 2024 version exists)`
  );
  const speciesUuid = pickOrigin(found.species, 'Human');
  const backgroundUuid = pickOrigin(found.backgrounds, 'Soldier');

  const wiped = await gm.call('wipeKit');
  log(`wiped: ${JSON.stringify(wiped.deleted)}`);

  /** @type {Record<string, string>} */
  const folders = {};
  for (const type of FOLDER_TYPES) {
    folders[type] = (await gm.call('ensureFolder', { type, name: FOLDER_NAME })).folderId;
  }

  const sceneCfg = matrix.scene;
  const scene = await gm.call('createCombatScene', {
    name: sceneCfg.name,
    folderId: folders.Scene,
    width: sceneCfg.width,
    height: sceneCfg.height,
    grid: sceneCfg.grid,
    walls: true,
    doors: 1,
    lights: 1,
  });
  log(`scene ${scene.name}`);

  // The subclass level per class, from the advancement data (3 for most, 1 or 2 for a few legacy ones).
  const subclassAt = {};
  for (const c of content.classes) {
    try {
      const d = await gm.call('describeClass', { classUuid: c.uuid, level: 20 });
      if (d.expected.subclassAt) subclassAt[c.uuid] = d.expected.subclassAt;
    } catch (e) {
      log(`describeClass ${c.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const plan = planHeroes({
    classes: content.classes,
    subclasses: content.subclasses,
    size,
    subclassAt,
  });
  log(`${plan.length} heroes planned (kit size ${size})`);

  /** @type {import('./contract.mjs').KitManifest['heroes']} */
  const heroes = [];
  const started = Date.now();
  for (const [i, row] of plan.entries()) {
    const t0 = Date.now();
    const base = {
      name: row.name,
      classIdentifier: row.classEntry?.identifier ?? row.subclassEntry?.classIdentifier ?? '',
      level: row.level,
      classUuid: row.classEntry?.uuid ?? '',
      classRules: row.classEntry ? rulesOf(row.classEntry) : '',
      ...(row.subclassEntry
        ? { subclassUuid: row.subclassEntry.uuid, subclassIdentifier: row.subclassEntry.identifier }
        : {}),
      rules: rulesOf(
        row.subclassEntry ?? /** @type {IndexEntry} */ (row.classEntry ?? { rules: '' })
      ),
      book: (row.subclassEntry ?? row.classEntry)?.book ?? '',
      role: row.role,
      rotation: row.rotation,
    };
    const tag = `hero ${i + 1}/${plan.length} ${row.name}`;
    if (!row.classEntry) {
      heroes.push({
        ...base,
        actorId: '',
        buildError: `no class "${base.classIdentifier}" in the profile's class packs`,
      });
      log(`${tag}: FAILED, no class entry for the subclass`);
      continue;
    }
    try {
      const hero = await gm.call('createHero', {
        name: row.name,
        classUuid: row.classEntry.uuid,
        subclassUuid: row.subclassEntry?.uuid,
        level: row.level,
        rotation: row.rotation,
        speciesUuid,
        backgroundUuid,
        folderId: folders.Actor,
        featPackIds: profile.packs.feats,
      });
      const row2 = {
        ...base,
        actorId: hero.actorId,
        classIdentifier: hero.classIdentifier || base.classIdentifier,
        subclassIdentifier: hero.subclassIdentifier || base.subclassIdentifier,
        level: hero.level,
        picks: hero.picks,
        warnings: hero.warnings,
      };
      if (!(hero.hp.max > 0 && hero.hp.value === hero.hp.max)) {
        row2.buildError = `invalid HP ${JSON.stringify(hero.hp)}`;
      }
      heroes.push(row2);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log(
        `${tag}: ${hero.hp.value}/${hero.hp.max} HP, ${hero.picks.length} picks, ` +
          `${hero.warnings.length} warnings, ${secs}s${row2.buildError ? ` FAILED ${row2.buildError}` : ''}`
      );
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).split('\n')[0];
      heroes.push({ ...base, actorId: '', buildError: message });
      log(`${tag}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${message}`);
    }
  }
  const built = heroes.filter(h => h.actorId && !h.buildError);
  log(
    `${built.length}/${heroes.length} heroes built in ${((Date.now() - started) / 1000).toFixed(0)}s` +
      (built.length ? ` (${((Date.now() - started) / 1000 / built.length).toFixed(1)}s each)` : '')
  );
  // Stray actor rows of a failed hero are not kept: createHero deletes its actor on error.
  const okHeroes = heroes.filter(h => !h.buildError);

  // The first level 5 hero of the first class belongs to the kit's player user.
  const firstPlayable = okHeroes.find(h => h.role === 'tier' && h.level === 5);
  if (firstPlayable) {
    await gm.call('setOwnership', {
      actorId: firstPlayable.actorId,
      userName: KIT_PLAYER_USER,
      level: 3,
    });
    firstPlayable.owner = KIT_PLAYER_USER;
  }

  const picks = await selectMonsters(dashboard, matrix.monsters, log);
  const monsters = [];
  const gmActionsBefore = await dashboard.getGmActions();
  if (!gmActionsBefore) await dashboard.setGmActions(true);
  try {
    for (const pick of picks) {
      const reply = await dashboard.tool('create-actor-from-compendium', {
        packId: pick.packId,
        itemId: pick.itemId,
        names: [`Kit ${pick.name}`],
        addToScene: false,
      });
      const actor = reply?.details?.actors?.[0];
      if (!reply?.success || !actor?.id) {
        throw new Error(`Creating ${pick.name} failed: ${JSON.stringify(reply).slice(0, 300)}`);
      }
      monsters.push({ ...pick, name: actor.name, actorId: actor.id });
    }
  } finally {
    if (!gmActionsBefore) await dashboard.setGmActions(false);
  }

  // Tokens last: placeToken also adopts the bridge-made monsters into the kit (flag and folder),
  // so the next build's wipe finds them. Heroes: the level 5 tier hero of the first four classes.
  const tokenHeroes = content.classes
    .slice(0, 4)
    .map(c => okHeroes.find(h => h.role === 'tier' && h.level === 5 && h.classUuid === c.uuid))
    .filter(Boolean);
  for (const [i, hero] of tokenHeroes.entries()) {
    const at = slot(matrix.layout.heroes, i);
    const { tokenId } = await gm.call('placeToken', {
      sceneId: scene.sceneId,
      actorId: hero.actorId,
      ...at,
    });
    hero.tokenId = tokenId;
  }
  for (const [i, monster] of monsters.entries()) {
    const at = slot(matrix.layout.monsters, i);
    const { tokenId } = await gm.call('placeToken', {
      sceneId: scene.sceneId,
      actorId: monster.actorId,
      ...at,
    });
    monster.tokenId = tokenId;
  }
  log(`${tokenHeroes.length} hero tokens, ${monsters.length} monster tokens placed`);

  // Coverage: what the profile offered and what got built.
  const classIds = new Set(content.classes.map(c => c.identifier));
  const builtClassIds = new Set(built.map(h => h.classIdentifier).filter(id => classIds.has(id)));
  const subName = uuid => content.subclasses.find(s => s.entry.uuid === uuid)?.entry.name ?? uuid;
  const builtSubs = new Set(built.map(h => h.subclassUuid).filter(Boolean));
  const failedSubs = new Set(
    heroes
      .filter(h => h.buildError && h.subclassUuid && !builtSubs.has(h.subclassUuid))
      .map(h => subName(h.subclassUuid))
  );

  // The GM page's console errors over the whole build, kept in the manifest.
  const logged = await gm.call('consoleErrors', { since: buildStartedAt }).catch(() => null);
  const consoleErrors = Array.isArray(logged?.errors) ? logged.errors : [];
  if (consoleErrors.length) log(`${consoleErrors.length} console error(s) during the build`);

  return {
    version: KIT_FORMAT_VERSION,
    world,
    builtAt: new Date().toISOString(),
    systemVersion: status.systemVersion,
    folders,
    profile: profile.id,
    heroes,
    coverage: {
      classes: { found: content.classes.length, built: builtClassIds.size },
      subclasses: {
        found: content.subclasses.length,
        built: builtSubs.size,
        failed: [...failedSubs].sort(),
      },
      heroes: built.length,
    },
    consoleErrors,
    monsters,
    scene: {
      sceneId: scene.sceneId,
      name: scene.name,
      width: sceneCfg.width,
      height: sceneCfg.height,
    },
  };
}

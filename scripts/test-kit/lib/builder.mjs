/**
 * The kit builder: wipes what an earlier build made (every document with the kit flag) and
 * builds the SRD kit again, the same every time: a "Test Kit" folder per type, a gridded combat
 * scene, one level-1 hero per class and a small monster matrix chosen by rule from the system's
 * monster compendium through the bridge tools, all with tokens on a fixed layout.
 *
 * What gets built is data, not code: scripts/test-kit/data/smoke-matrix.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_FORMAT_VERSION } from './contract.mjs';
import { EnvError } from './errors.mjs';

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

/** @param {{x: number, y: number, dx: number, dy: number, perRow: number}} layout @param {number} i */
function slot(layout, i) {
  return {
    x: layout.x + (i % layout.perRow) * layout.dx,
    y: layout.y + Math.floor(i / layout.perRow) * layout.dy,
  };
}

/**
 * Build the kit in the world. Switches GM Actions on for the monster writes and puts the switch
 * back as it found it.
 * @param {{dashboard: any, gm: {call: (action: string, args?: object) => Promise<any>}, world: string, size?: 'smoke'|'full'|'long', log?: (m: string) => void, matrix?: any}} o
 * @returns {Promise<import('./contract.mjs').KitManifest>}
 */
export async function buildKit({
  dashboard,
  gm,
  world,
  size = 'smoke',
  log = () => {},
  matrix = loadMatrix(),
}) {
  const status = await gm.call('worldStatus');
  if (status.worldId !== world) {
    throw new EnvError(`The GM page is in world "${status.worldId}", not "${world}".`);
  }
  if (!status.moduleActive) {
    throw new EnvError(
      'The foundry-mcp-bridge module is not active in the kit world (run provisioning).'
    );
  }

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

  const heroes = [];
  for (const className of matrix.classes.names) {
    const hero = await gm.call('createHero', {
      name: `Kit ${className} ${matrix.classes.level}`,
      classId: className,
      level: matrix.classes.level,
      folderId: folders.Actor,
    });
    if (!(hero.hp.max > 0 && hero.hp.value === hero.hp.max)) {
      throw new Error(`Hero ${hero.name} came out with invalid HP ${JSON.stringify(hero.hp)}.`);
    }
    log(`hero ${hero.name}: ${hero.hp.value}/${hero.hp.max} HP`);
    heroes.push({
      actorId: hero.actorId,
      name: hero.name,
      classIdentifier: hero.classIdentifier,
      level: hero.level,
    });
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
  // so the next build's wipe finds them.
  for (const [i, hero] of heroes.entries()) {
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
  log(`${heroes.length} heroes, ${monsters.length} monsters placed (kit size ${size})`);

  return {
    version: KIT_FORMAT_VERSION,
    world,
    builtAt: new Date().toISOString(),
    systemVersion: status.systemVersion,
    folders,
    heroes,
    monsters,
    scene: {
      sceneId: scene.sceneId,
      name: scene.name,
      width: sceneCfg.width,
      height: sceneCfg.height,
    },
  };
}

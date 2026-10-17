/**
 * A player builds a level 1 character in Actor Studio with the STANDARD ARRAY, then the kit's own sheet
 * checks (judgeSheet) judge it. The kit's normal player flow types scores into the manual-input fields, which a
 * table setup (standard array only) turns off; this is the run for that setup, on the Pi's `strahd-kit` world
 * (kit-session.sh MODE=up) or on the PC test world.
 *
 * Usage:
 *   node scripts/test-kit/player-run.mjs <foundryUrl> "<user>" [class] [species] [background] [--out <dir>]
 * Defaults: Wizard, "Elf, High", Sage (the standard array 8 13 14 15 12 10 in sheet row order).
 *
 * It joins as <user> with no password, so the user must be a Player that may create actors (the kit session's
 * "Kit Player"). It refuses a GM, the `curse-of-strahd` world, and the live bridge ports. A Player may not
 * delete actors in Foundry: the actor it makes stays in the world until the GM side removes it (kit-session.sh
 * MODE=down deletes the actors made after `up`). result.json and sheet.png (error.png on a failure) go to --out,
 * or to a new temp folder, never into the repo. The exit code is 1 on an error or when the sheet has problems.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = { className: 'Wizard', speciesName: 'Elf, High', backgroundName: 'Sage' };
// The standard array, in sheet row order str dex con int wis cha: a wizard.
export const TARGET = { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 };
export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const REFUSED_WORLDS = ['curse-of-strahd'];

/** @returns {{url: string, user: string, className: string, speciesName: string, backgroundName: string, out: string | null}} */
export function parseArgs(argv) {
  const positional = [];
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[++i] ?? '';
      if (!out || out.startsWith('--')) throw new Error('--out needs a folder');
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [url, user, className, speciesName, backgroundName, ...extra] = positional;
  if (!url || !user) {
    throw new Error(
      'usage: node scripts/test-kit/player-run.mjs <foundryUrl> "<user>" [class] [species] [background] [--out <dir>]'
    );
  }
  if (extra.length) throw new Error(`too many arguments (${extra.join(' ')})`);
  return {
    url,
    user,
    className: className || DEFAULTS.className,
    speciesName: speciesName || DEFAULTS.speciesName,
    backgroundName: backgroundName || DEFAULTS.backgroundName,
    out,
  };
}

/**
 * The next up-chevron click that brings the six rows closer to `want`: the index of the row to move up one place
 * (it swaps with the row above), or null when the rows are in order. Throws when `want` cannot be reached
 * (a value is missing, so the page does not offer the standard array).
 * @param {number[]} cur the six scores in row order
 * @param {number[]} want
 */
export function nextArrayMove(cur, want) {
  const i = cur.findIndex((v, n) => v !== want[n]);
  if (i < 0) return null;
  const j = cur.findIndex((v, n) => n > i && v === want[i]);
  if (j < 0) throw new Error(`cannot reach ${want} from ${cur}`);
  return j;
}

/** Every click it takes to arrange `cur` into `want`, as the row index each click is on. */
export function planArrayMoves(cur, want) {
  const rows = [...cur];
  const moves = [];
  for (let guard = 0; guard < 40; guard++) {
    const j = nextArrayMove(rows, want);
    if (j === null) return moves;
    moves.push(j);
    [rows[j - 1], rows[j]] = [rows[j], rows[j - 1]];
  }
  throw new Error('standard array did not settle');
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** True when `dir` is the repo or inside it: the run's files (a sheet screenshot) never go there. */
export function insideRepo(dir, repoRoot = REPO_ROOT) {
  const rel = path.relative(repoRoot, path.resolve(dir));
  // A repo folder named `..out` is inside; only `..` itself or `..` plus a separator leaves the repo.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** The refusal for a world this run must never touch; shared by `worldRefusals` and `refusals`. */
const worldMessage = world => `the world is ${world}: this run only ever builds test characters`;

/**
 * Refusal that needs no browser: the world Foundry serves right now, from /api/status, so the user never joins the
 * live world first. A server that does not answer with a world is refused too (the in-page checks stay as the second line).
 * @returns {Promise<string[]>}
 */
export async function worldRefusals(url, fetchImpl = fetch) {
  let world;
  try {
    const res = await fetchImpl(new URL('api/status', url.endsWith('/') ? url : `${url}/`), {
      signal: AbortSignal.timeout(10_000),
    });
    world = (await res.json())?.world;
  } catch (e) {
    return [`${url} did not answer on /api/status (${e?.message ?? e})`];
  }
  if (typeof world !== 'string' || world === '') {
    return [`${url} reports no world on /api/status: start the test world first`];
  }
  return REFUSED_WORLDS.includes(world) ? [worldMessage(world)] : [];
}

/** Refusals that need the page: the world and the user. @returns {string[]} */
export function refusals(who) {
  const problems = [];
  if (REFUSED_WORLDS.includes(who.world)) {
    problems.push(worldMessage(who.world));
  }
  if (who.isGM) problems.push('the user is a GM: this run needs a Player');
  else if (!who.canCreate) problems.push('the user may not create actors');
  return problems;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = message => console.log(`[player-run] ${message}`);

async function arrangeStandardArray(page, studio, target) {
  await studio.clickTab(page, 'Abilities');
  const rows = studio.rootOf(page).locator('table tbody tr');
  const read = async () => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push(Number(await rows.nth(i).locator('input.mainscore').inputValue()));
    }
    return out;
  };
  const want = ABILITY_KEYS.map(key => target[key]);
  for (let guard = 0; guard < 40; guard++) {
    const cur = await read();
    const j = nextArrayMove(cur, want);
    if (j === null) return cur;
    await rows.nth(j).locator('.up.chevron').click();
    await sleep(500);
  }
  throw new Error('standard array did not settle');
}

async function lookUp(page, { className, speciesName, backgroundName }) {
  return page.evaluate(
    async ({ className, speciesName, backgroundName }) => {
      const look = async (packId, type, name) => {
        const pack = game.packs.get(packId);
        if (!pack) return { hits: [], names: [], missingPack: packId };
        const index = await pack.getIndex();
        const hits = index.filter(e => e.type === type && e.name === name);
        return {
          hits: hits.map(h => ({ uuid: h.uuid, name: h.name })),
          names: index.filter(e => e.type === type).map(e => e.name),
        };
      };
      return {
        cls: await look('dnd-players-handbook.classes', 'class', className),
        sp: await look('dnd-players-handbook.origins', 'race', speciesName),
        bg: await look('dnd-players-handbook.origins', 'background', backgroundName),
      };
    },
    { className, speciesName, backgroundName }
  );
}

/** Runs the whole flow in `page`; fills `result`; returns the verdict problems. */
async function playerRun(page, errors, options, result, outDir, libs) {
  const { studio, flow, pc, pump } = libs;
  const { className, speciesName, backgroundName } = options;
  const who = await page.evaluate(
    id => ({
      id: game.user.id,
      isGM: game.user.isGM,
      canCreate: game.user.can('ACTOR_CREATE'),
      world: game.world.id,
    }),
    studio.STUDIO_MODULE
  );
  log(JSON.stringify(who));
  const refused = refusals(who);
  if (refused.length) throw new Error(`refused: ${refused.join('; ')}`);
  result.world = who.world;

  const pick = await lookUp(page, options);
  for (const key of ['cls', 'sp', 'bg']) {
    if (pick[key].missingPack)
      throw new Error(`${key}: the pack ${pick[key].missingPack} is not in this world`);
    if (pick[key].hits.length !== 1) {
      throw new Error(
        `${key}: ${pick[key].hits.length} hits; names: ${pick[key].names.join(', ')}`
      );
    }
  }
  const uuids = { cls: pick.cls.hits[0].uuid, sp: pick.sp.hits[0].uuid, bg: pick.bg.hits[0].uuid };
  log(JSON.stringify(uuids));

  const name = `Pi Test ${className}`;
  const before = await page.evaluate(() => game.actors.map(a => a.id));
  await studio.openCreationWindow(page);
  log(`abilities ${await arrangeStandardArray(page, studio, TARGET)}`);
  await studio.clickTab(page, '(Species|Race)');
  log(`species: ${await studio.pickByUuid(page, 'race-select', uuids.sp)}`);
  await studio.clickTab(page, 'Background');
  await studio.pickByUuid(page, 'background-select', uuids.bg);
  await studio.clickTab(page, 'Class');
  await studio.pickByUuid(page, 'characterClass-select', uuids.cls);
  await sleep(1500);
  await studio.rootOf(page).locator('.character-name-input').fill(name);
  await sleep(500);
  await page.evaluate(pump.studioPump, {
    op: 'start',
    rotation: 0,
    subclassUuid: '',
    featPackIds: ['dnd-players-handbook.feats'],
    prefer: {},
  });
  log('creating in Actor Studio');
  await studio.until(() => flow.pressFooter(page, 'gas-create-character-btn'), {
    what: 'Create Character',
    timeoutMs: 20000,
  });
  let done;
  try {
    done = await flow.finishWindow(page, { rotation: 0, equipment: true, log });
  } finally {
    result.pump = await flow.stopPump(page).catch(() => null);
  }
  await sleep(1500);
  const actorId = await page.evaluate(
    ({ before, name }) =>
      game.actors
        .filter(a => !before.includes(a.id) && a.name === name)
        .map(a => a.id)
        .pop() ?? '',
    { before, name }
  );
  if (!actorId) throw new Error(`no actor ${name} after creation`);
  result.actorId = actorId;
  const sheet = await pc.readSheet(page, actorId);
  const spellList = sheet.spells.length
    ? await pc.spellListOf(page, className.toLowerCase())
    : null;
  const verdict = pc.judgeSheet({
    sheet,
    playerId: who.id,
    classIdentifier: className.toLowerCase(),
    planned: done.equipment?.inventory ?? [],
    spellList,
    pumpErrors: result.pump?.errors ?? [],
    speciesUuid: uuids.sp,
    classUuid: uuids.cls,
    backgroundUuid: uuids.bg,
    baseAbilities: TARGET,
  });
  result.sheet = {
    hp: sheet.hp,
    ac: sheet.ac,
    abilities: sheet.abilities,
    saves: sheet.saves,
    skills: sheet.skills,
    tools: sheet.tools,
    languages: sheet.languages,
    level: sheet.level,
    classes: sheet.classes.map(c => c.identifier),
    species: sheet.species,
    backgrounds: sheet.backgrounds,
    spells: sheet.spells.map(s => s.name),
    items: sheet.items.map(i => i.name),
  };
  result.planned = done.equipment;
  result.problems = verdict.problems;
  result.notes = verdict.notes;
  result.consoleErrors = errors.map(e => String(e.message).slice(0, 200));
  log(`PROBLEMS: ${verdict.problems.length}`);
  for (const p of verdict.problems) log(`  - ${p.what}: ${p.evidence}`);
  for (const n of verdict.notes) log(`  note: ${n}`);
  log(`console errors: ${errors.length}`);
  await page.screenshot({ path: path.join(outDir, 'sheet.png') });
  return verdict.problems;
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch } = {}) {
  const options = parseArgs(argv);
  const { guardUrl } = await import('./lib/guard-url.mjs');
  // The Pi is the usual target, so a remote host is allowed; the live bridge ports are still refused.
  const url = guardUrl(options.url, { label: 'Foundry URL', loopbackOnly: false });
  const outOption = options.out ? path.resolve(options.out) : null;
  if (outOption && insideRepo(outOption))
    throw new Error(`--out ${outOption} is inside the repo: pick a folder outside it`);
  const worldProblems = await worldRefusals(url, fetchImpl);
  if (worldProblems.length) throw new Error(`refused: ${worldProblems.join('; ')}`);
  // The temp folder is made after the refusals that need no browser, so a run refused on those leaves nothing behind.
  const outDir = outOption ?? mkdtempSync(path.join(tmpdir(), 'player-run-'));
  mkdirSync(outDir, { recursive: true });
  const [gm, studio, flow, pc, pump] = await Promise.all([
    import('./lib/gm.mjs'),
    import('./lib/studio.mjs'),
    import('./lib/studio-flow.mjs'),
    import('./lib/player-creation.mjs'),
    import('./lib/studio-pump.mjs'),
  ]);
  const result = {
    user: options.user,
    url,
    class: options.className,
    species: options.speciesName,
    background: options.backgroundName,
  };
  const browser = await gm.launchBrowser({ headless: true });
  let failed = true;
  try {
    const errors = gm.collectErrors(browser.page);
    await gm.keepChatNotificationsQuiet(browser.page);
    await gm.joinGame(browser.page, { foundryUrl: url, user: options.user });
    const problems = await playerRun(browser.page, errors, options, result, outDir, {
      studio,
      flow,
      pc,
      pump,
    });
    failed = problems.length > 0;
  } catch (e) {
    result.error = String(e?.stack ?? e);
    log(`ERROR ${result.error}`);
    await browser.page.screenshot({ path: path.join(outDir, 'error.png') }).catch(() => {});
  } finally {
    writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    await browser.close();
  }
  log(`result: ${path.join(outDir, 'result.json')}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    code => process.exit(code),
    e => {
      console.error(`[player-run] ${e.message}`);
      process.exit(2);
    }
  );
}

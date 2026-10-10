// Lets players make their own level-1 characters in Actor Studio (decisions D-112 and D-113). Run by stage 13
// (scripts/pi/remote/13-player-creation.sh) once per world, while Foundry runs that world; it can also be run
// by hand with the same environment. A headless Chromium joins the world as its GM (the same way
// assistant-gm.mjs does) and sets, through Foundry's own settings API:
//   - core.permissions: ACTOR_CREATE includes the Player and Trusted Player roles (the roles already there stay);
//   - Actor Studio, world settings: enableEquipmentSelection = true, and compendiumSources with
//     equipment = ["dnd-players-handbook.equipment"] (every other source keeps its value);
//   - Actor Studio's per-user usage-tracking: every saved value that is not false becomes false.
// It prints the values before and after, reloads the world and reads them back, and exits 1 on any mismatch.
// A second run changes nothing. Passwords are never printed.
//
// Environment: TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL (default http://127.0.0.1:30000),
// CHROMIUM (default /usr/bin/chromium), GM_USER, GM_PASSWORD, WORLD (the world id that must be running).

import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
const MODULE_ID = 'foundryvtt-actor-studio';
const EQUIPMENT_PACK = 'dnd-players-handbook.equipment';
// CONST.USER_ROLES.PLAYER and TRUSTED: the roles that may create actors (and so open Actor Studio).
const PLAYER_ROLES = [1, 2];

const log = msg => console.log(`[player-creation] ${msg}`);

// Runs in the browser: the values this script cares about, plus what must exist for them to work.
// trackingOn: how many users have Actor Studio's usage-tracking saved as anything but false (a saved
// per-user value overrides the off default); null when the module does not register the setting.
export function readState({ moduleId, pack }) {
  const settings = game.settings;
  const registered = key => settings.settings.has(`${moduleId}.${key}`);
  const permissions = settings.get('core', 'permissions');
  const trackingKey = `${moduleId}.usage-tracking`;
  const trackingOn = settings.settings.has(trackingKey)
    ? settings.storage
        .get('user')
        .contents.filter(doc => doc.key === trackingKey && doc.user && doc.value !== false).length
    : null;
  return {
    trackingOn,
    world: game.world.id,
    user: game.user.name,
    isGM: game.user.isGM,
    moduleActive: game.modules.get(moduleId)?.active === true,
    packExists: game.packs.has(pack),
    studioSettingsRegistered:
      registered('enableEquipmentSelection') && registered('compendiumSources'),
    actorCreate: permissions?.ACTOR_CREATE ?? null,
    enableEquipmentSelection: registered('enableEquipmentSelection')
      ? settings.get(moduleId, 'enableEquipmentSelection')
      : null,
    compendiumSources: registered('compendiumSources')
      ? JSON.parse(JSON.stringify(settings.get(moduleId, 'compendiumSources')))
      : null,
  };
}

// Runs in the browser: changes only what differs; returns what it changed.
export async function applyState({ moduleId, pack, roles }) {
  const changed = [];
  if (roles.join() !== [CONST.USER_ROLES.PLAYER, CONST.USER_ROLES.TRUSTED].join()) {
    throw new Error(`the player roles are ${JSON.stringify(CONST.USER_ROLES)} in this Foundry`);
  }

  const permissions = JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')));
  const current = permissions.ACTOR_CREATE;
  if (!Array.isArray(current)) throw new Error('core.permissions has no ACTOR_CREATE list');
  const wanted = [...new Set([...current, ...roles])].sort((a, b) => a - b);
  if (wanted.length !== current.length) {
    await game.settings.set('core', 'permissions', { ...permissions, ACTOR_CREATE: wanted });
    changed.push('core.permissions ACTOR_CREATE');
  }

  if (game.settings.get(moduleId, 'enableEquipmentSelection') !== true) {
    await game.settings.set(moduleId, 'enableEquipmentSelection', true);
    changed.push('enableEquipmentSelection');
  }

  const sources = JSON.parse(JSON.stringify(game.settings.get(moduleId, 'compendiumSources')));
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new Error('compendiumSources is not an object');
  }
  if (JSON.stringify(sources.equipment) !== JSON.stringify([pack])) {
    await game.settings.set(moduleId, 'compendiumSources', { ...sources, equipment: [pack] });
    changed.push('compendiumSources.equipment');
  }

  // Usage tracking stays off for every user (D-113): each saved per-user value that is not false is
  // set to false, the same way the test kit's turnOffTrackingFor does it.
  const trackingKey = `${moduleId}.usage-tracking`;
  if (game.settings.settings.has(trackingKey)) {
    const on = game.settings.storage
      .get('user')
      .contents.filter(doc => doc.key === trackingKey && doc.user && doc.value !== false);
    for (const doc of on) await doc.update({ value: 'false' });
    if (on.length) changed.push(`usage-tracking off for ${on.length} user(s)`);
  }
  return changed;
}

const show = state =>
  JSON.stringify({
    ACTOR_CREATE: state.actorCreate,
    enableEquipmentSelection: state.enableEquipmentSelection,
    'compendiumSources.equipment': state.compendiumSources?.equipment ?? null,
    'usage-tracking on (users)': state.trackingOn,
  });

// The problems that stop the settings from working, as a list of plain sentences.
export function blockers(state, world) {
  const problems = [];
  if (state.world !== world) problems.push(`joined world ${state.world}, expected ${world}`);
  if (!state.isGM) problems.push(`${state.user} is not a GM`);
  if (!state.moduleActive) {
    problems.push(`the ${MODULE_ID} module is not active in this world (enable it as a GM first)`);
  } else if (!state.studioSettingsRegistered) {
    problems.push(`${MODULE_ID} did not register enableEquipmentSelection and compendiumSources`);
  }
  if (!state.packExists) problems.push(`the compendium ${EQUIPMENT_PACK} is not in this world`);
  if (!Array.isArray(state.actorCreate)) problems.push('core.permissions has no ACTOR_CREATE list');
  return problems;
}

// What the settings must look like at the end, checked against what they were at the start.
export function mismatches(before, after) {
  const problems = [];
  const roles = after.actorCreate ?? [];
  for (const role of PLAYER_ROLES) {
    if (!roles.includes(role))
      problems.push(`ACTOR_CREATE lacks role ${role}: ${JSON.stringify(roles)}`);
  }
  for (const role of before.actorCreate ?? []) {
    if (!roles.includes(role)) problems.push(`ACTOR_CREATE lost role ${role}`);
  }
  if (after.trackingOn) problems.push(`usage-tracking is still on for ${after.trackingOn} user(s)`);
  if (after.enableEquipmentSelection !== true)
    problems.push('enableEquipmentSelection is not true');
  const sources = after.compendiumSources ?? {};
  if (JSON.stringify(sources.equipment) !== JSON.stringify([EQUIPMENT_PACK])) {
    problems.push(`compendiumSources.equipment is ${JSON.stringify(sources.equipment)}`);
  }
  const rest = o =>
    JSON.stringify(
      Object.entries(o ?? {})
        .filter(([k]) => k !== 'equipment')
        .sort()
    );
  if (rest(before.compendiumSources) !== rest(sources)) {
    problems.push('another compendium source changed');
  }
  return problems;
}

async function main() {
  const require = createRequire(join(env('TOOL_APP'), 'package.json'));
  const { chromium } = require('playwright-core');
  const user = env('GM_USER');
  const password = env('GM_PASSWORD');
  const world = env('WORLD');

  // A throwaway profile, so the GM's session never lands in the Assistant GM's profile.
  const profile = mkdtempSync(join(tmpdir(), 'player-creation-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: env('CHROMIUM', '/usr/bin/chromium'),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const res = await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'domcontentloaded' });
    // /join answers 200 with no world running; a running world's page carries <template id="join-game">.
    const onJoin = res?.ok() && new URL(page.url()).pathname.endsWith('/join');
    if (!onJoin || (await page.locator('template#join-game').count()) === 0) {
      throw new Error(`no world is running at ${FOUNDRY_URL}`);
    }
    await page.locator('#join-username').fill(user);
    await page.keyboard.press('Escape');
    await page.locator('#join-password').fill(password);
    await page.locator('button[name="join"]').click();
    await page.waitForURL(/\/game$/, { timeout: 60_000 }).catch(() => {
      throw new Error(`could not join as ${user}: wrong password, or that user is already online`);
    });
    const ready = () =>
      page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
    await ready();

    const args = { moduleId: MODULE_ID, pack: EQUIPMENT_PACK, roles: PLAYER_ROLES };
    const before = await page.evaluate(readState, args);
    log(`world ${before.world}, joined as ${before.user} (GM: ${before.isGM})`);
    const problems = blockers(before, world);
    if (problems.length) throw new Error(problems.join('; '));
    log(`before: ${show(before)}`);

    const changed = await page.evaluate(applyState, args);
    log(changed.length ? `changed: ${changed.join(', ')}` : 'nothing to change (already set)');

    // Read back after a reload, so the check sees what the server stored and not this browser's copy.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const after = await page.evaluate(readState, args);
    log(`after:  ${show(after)}`);
    const wrong = mismatches(before, after);
    if (wrong.length) throw new Error(`read-back does not match: ${wrong.join('; ')}`);
    log('verified');
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

// Run only as a script (stage 13 runs it with node); the tests import the functions above. import.meta.url is the
// real path while argv[1] keeps a symlinked one, so compare against the real path: a false guard would exit 0 and
// change nothing, and stage 13 would report the settings as set.
// The lookup runs on import too (the tests), where argv[1] need not be a file: then this is not the script.
const invokedAs = (() => {
  try {
    return process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
  } catch {
    return '';
  }
})();
if (invokedAs === import.meta.url) {
  main().catch(err => {
    log(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}

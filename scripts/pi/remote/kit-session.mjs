// The in-browser part of the kit session (scripts/pi/remote/kit-session.sh, docs/dev/PI-SETUP.md): a throwaway
// test run of level-1 character creation, as a player, in the Pi's world strahd-kit. Run by the stage while
// Foundry runs that world; it can also be run by hand with the same environment. A headless Chromium joins the
// world as its GM (the same way player-creation-settings.mjs does). ACTION says what to do:
//
//   ACTION=setup     sets up the world for a player who builds a character in Actor Studio, through Foundry's
//                    own settings API, changing only what differs:
//     - core.permissions: ACTOR_CREATE includes the Player and Trusted Player roles (the roles already there stay);
//     - Actor Studio, world settings: compendiumSources races, racialFeatures and backgrounds = the PHB origins
//       pack, classes and subclasses = the PHB classes pack, spells, feats and equipment = their PHB packs (the
//       other sources, items included, keep their values); the standard array on, manual input, point buy and
//       rolling off; spell and equipment selection on;
//     - Actor Studio's per-user usage-tracking: every saved value that is not false becomes false;
//     - the player user "Kit Player" exists: made without a password when missing; an existing one must be a
//       Player with no password, otherwise nothing is changed and the run fails.
//     It prints the values before and after, reloads the world and reads them back, and exits 1 on any mismatch.
//     A second run changes nothing.
//   ACTION=teardown  deletes the actors that Kit Player owns (at most 5; MAX_DELETE raises the limit; their names
//                    and ids are printed first) and then the user Kit Player. Nothing else is deleted and no
//                    setting is touched. Without that user there is nothing to do and the run succeeds.
//
// Passwords are never printed.
//
// Environment: ACTION, TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL (default
// http://127.0.0.1:30000), CHROMIUM (default /usr/bin/chromium), GM_USER, GM_PASSWORD, WORLD (the world id
// that must be running), MAX_DELETE (teardown only).

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

export const MODULE_ID = 'foundryvtt-actor-studio';
export const PHB_MODULE = 'dnd-players-handbook';
export const PLAYER_NAME = 'Kit Player';
// CONST.USER_ROLES.PLAYER and TRUSTED: the roles that may create actors (and so open Actor Studio).
export const PLAYER_ROLES = [1, 2];
const PLAYER_ROLE = PLAYER_ROLES[0];
export const DEFAULT_MAX_DELETE = 5;

// Actor Studio's compendiumSources, by kind. Kinds that are not here (items) keep whatever they have.
export const SOURCES = {
  races: [`${PHB_MODULE}.origins`],
  racialFeatures: [`${PHB_MODULE}.origins`],
  backgrounds: [`${PHB_MODULE}.origins`],
  classes: [`${PHB_MODULE}.classes`],
  subclasses: [`${PHB_MODULE}.classes`],
  spells: [`${PHB_MODULE}.spells`],
  feats: [`${PHB_MODULE}.feats`],
  equipment: [`${PHB_MODULE}.equipment`],
};
// Actor Studio's boolean world settings.
export const FLAGS = {
  allowStandardArray: true,
  allowManualInput: false,
  allowPointBuy: false,
  allowRolling: false,
  enableSpellSelection: true,
  enableEquipmentSelection: true,
};
export const PACKS = [...new Set(Object.values(SOURCES).flat())];
// Every Actor Studio setting this script sets; each must be registered, or the module is not the build we expect.
export const SETTING_KEYS = ['compendiumSources', ...Object.keys(FLAGS)];

const log = msg => console.log(`[kit-session] ${msg}`);

// ---- runs in the browser (page.evaluate): the three functions below must not use anything but their argument
// and Foundry's globals ----------------------------------------------------------------------------------------

// The values this script cares about, plus what must exist for them to work.
// trackingOn: how many users have Actor Studio's usage-tracking saved as anything but false (a saved
// per-user value overrides the off default); null when the module does not register the setting.
// ownedActors: for the user named playerName, the actors where that user is an explicit OWNER.
export function readState({ moduleId, phbModule, packs, settingKeys, playerName }) {
  const settings = game.settings;
  const registered = key => settings.settings.has(`${moduleId}.${key}`);
  const permissions = settings.get('core', 'permissions');
  const trackingKey = `${moduleId}.usage-tracking`;
  const trackingOn = settings.settings.has(trackingKey)
    ? settings.storage
        .get('user')
        .contents.filter(doc => doc.key === trackingKey && doc.user && doc.value !== false).length
    : null;
  const values = {};
  for (const key of settingKeys) {
    values[key] = registered(key)
      ? JSON.parse(JSON.stringify(settings.get(moduleId, key) ?? null))
      : null;
  }
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const users = game.users
    .filter(u => u.name === playerName)
    .map(u => ({ id: u.id, name: u.name, role: u.role }));
  const ownedActors = users.length
    ? game.actors
        .filter(a => users.some(u => a.ownership?.[u.id] === owner))
        .map(a => ({ id: a.id, name: a.name, type: a.type }))
    : [];
  return {
    trackingOn,
    world: game.world.id,
    user: game.user.name,
    isGM: game.user.isGM,
    roles: { PLAYER: CONST.USER_ROLES.PLAYER, TRUSTED: CONST.USER_ROLES.TRUSTED },
    moduleActive: game.modules.get(moduleId)?.active === true,
    phbActive: game.modules.get(phbModule)?.active === true,
    missingPacks: packs.filter(pack => !game.packs.has(pack)),
    unregistered: settingKeys.filter(key => !registered(key)),
    actorCreate: permissions?.ACTOR_CREATE ?? null,
    values,
    users,
    ownedActors,
  };
}

// Applies the changes settingsDiff() worked out and nothing else; returns what it changed.
export async function applyChanges({ moduleId, changes }) {
  const done = [];
  for (const change of changes) {
    if (change.kind === 'permissions') {
      const permissions = JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')));
      await game.settings.set('core', 'permissions', {
        ...permissions,
        ACTOR_CREATE: change.value,
      });
    } else if (change.kind === 'setting') {
      await game.settings.set(moduleId, change.key, change.value);
    } else if (change.kind === 'tracking') {
      // Usage tracking stays off for every user (D-113): each saved per-user value that is not false is
      // set to false, the same way the test kit's turnOffTrackingFor does it.
      const trackingKey = `${moduleId}.usage-tracking`;
      const on = game.settings.storage
        .get('user')
        .contents.filter(doc => doc.key === trackingKey && doc.user && doc.value !== false);
      for (const doc of on) await doc.update({ value: 'false' });
    } else {
      throw new Error(`unknown change ${change.kind}`);
    }
    done.push(change.label);
  }
  return done;
}

// Makes the player user, with no password (no password field at all: the schema's default is empty).
// A second user of that name is refused here too (Foundry would refuse it as well).
export async function createPlayer({ playerName }) {
  if (game.users.some(u => u.name === playerName)) {
    throw new Error(`a user named ${playerName} exists already`);
  }
  await User.implementation.create({ name: playerName, role: CONST.USER_ROLES.PLAYER });
}

// Deletes the actors in actorIds and then the user userId, after looking at them once more: the user must be
// the Player named playerName, every actor must have that user as an explicit OWNER.
export async function deleteKit({ playerName, userId, actorIds }) {
  const user = game.users.get(userId);
  if (!user || user.name !== playerName) throw new Error(`the user ${userId} is not ${playerName}`);
  if (user.role !== CONST.USER_ROLES.PLAYER) {
    throw new Error(`${playerName} is not a Player (role ${user.role})`);
  }
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const actors = actorIds.map(id => game.actors.get(id));
  for (const [i, actor] of actors.entries()) {
    if (!actor || actor.ownership?.[userId] !== owner) {
      throw new Error(`actor ${actorIds[i]} is not owned by ${playerName}`);
    }
  }
  for (const actor of actors) await actor.delete();
  await user.delete();
  return { actors: actors.length };
}

// ---- runs in node: the decisions --------------------------------------------------------------------------------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const show = state =>
  JSON.stringify({
    ACTOR_CREATE: state.actorCreate,
    ...Object.fromEntries(Object.keys(FLAGS).map(key => [key, state.values?.[key] ?? null])),
    sources: Object.fromEntries(
      Object.keys(SOURCES).map(key => [key, state.values?.compendiumSources?.[key] ?? null])
    ),
    'usage-tracking on (users)': state.trackingOn,
    [PLAYER_NAME]: state.users.length ? `role ${state.users[0].role}` : 'missing',
  });

// The problems that stop either action from working, as a list of plain sentences.
export function blockers(state, world, action) {
  const problems = [];
  if (state.world !== world) problems.push(`joined world ${state.world}, expected ${world}`);
  if (!state.isGM) problems.push(`${state.user} is not a GM`);
  if (state.users.length > 1) problems.push(`more than one user is named ${PLAYER_NAME}`);
  if (action === 'teardown') return problems;
  if (state.roles.PLAYER !== PLAYER_ROLES[0] || state.roles.TRUSTED !== PLAYER_ROLES[1]) {
    problems.push(`the player roles are ${JSON.stringify(state.roles)} in this Foundry`);
  }
  if (!state.moduleActive) {
    problems.push(`the ${MODULE_ID} module is not active in this world (enable it as a GM first)`);
  } else if (state.unregistered.length) {
    problems.push(`${MODULE_ID} did not register ${state.unregistered.join(', ')}`);
  }
  if (!state.phbActive) problems.push(`the ${PHB_MODULE} module is not active in this world`);
  for (const pack of state.missingPacks)
    problems.push(`the compendium ${pack} is not in this world`);
  if (!Array.isArray(state.actorCreate)) problems.push('core.permissions has no ACTOR_CREATE list');
  const sources = state.values?.compendiumSources;
  if (state.moduleActive && !state.unregistered.length) {
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
      problems.push('compendiumSources is not an object');
    }
  }
  return problems;
}

// The existing Kit Player user, if any, must be a Player who joins without a password. joinsFree is the answer
// of joinsWithoutPassword() (the client never sees a user's password, so the only way to know is to try).
export function playerUserProblems(user, joinsFree) {
  const problems = [];
  if (user.role !== PLAYER_ROLE) {
    problems.push(`${PLAYER_NAME} has role ${user.role}, not Player (${PLAYER_ROLE})`);
  }
  if (!joinsFree) {
    problems.push(
      `${PLAYER_NAME} could not join without a password (it has one, or it is online right now)`
    );
  }
  return problems;
}

// What has to change, as the list applyChanges() takes. Empty when everything is set already.
export function settingsDiff(state) {
  const changes = [];
  const current = state.actorCreate ?? [];
  const wanted = [...new Set([...current, ...PLAYER_ROLES])].sort((a, b) => a - b);
  if (wanted.length !== current.length) {
    changes.push({ kind: 'permissions', value: wanted, label: 'core.permissions ACTOR_CREATE' });
  }
  const sources = state.values.compendiumSources;
  const wantedSources = { ...sources, ...SOURCES };
  if (!same(sortedEntries(sources), sortedEntries(wantedSources))) {
    changes.push({
      kind: 'setting',
      key: 'compendiumSources',
      value: wantedSources,
      label: `compendiumSources (${Object.keys(SOURCES)
        .filter(key => !same(sources[key], SOURCES[key]))
        .join(', ')})`,
    });
  }
  for (const [key, value] of Object.entries(FLAGS)) {
    if (state.values[key] !== value) {
      changes.push({ kind: 'setting', key, value, label: `${key} = ${value}` });
    }
  }
  if (state.trackingOn) {
    changes.push({
      kind: 'tracking',
      label: `usage-tracking off for ${state.trackingOn} user(s)`,
    });
  }
  return changes;
}
const sortedEntries = o => Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b));

// What the world must look like at the end of setup, checked against what it was at the start.
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
  for (const [key, value] of Object.entries(FLAGS)) {
    if (after.values[key] !== value) problems.push(`${key} is ${after.values[key]}, not ${value}`);
  }
  const sources = after.values.compendiumSources ?? {};
  for (const [key, value] of Object.entries(SOURCES)) {
    if (!same(sources[key], value)) {
      problems.push(`compendiumSources.${key} is ${JSON.stringify(sources[key])}`);
    }
  }
  const rest = o =>
    sortedEntries(Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !(k in SOURCES))));
  if (!same(rest(before.values.compendiumSources), rest(sources))) {
    problems.push('another compendium source changed');
  }
  if (after.users.length !== 1) {
    problems.push(`${after.users.length} users are named ${PLAYER_NAME}, expected 1`);
  } else if (after.users[0].role !== PLAYER_ROLE) {
    problems.push(`${PLAYER_NAME} has role ${after.users[0].role}, not Player`);
  }
  return problems;
}

// MAX_DELETE: a whole number from 1 up; empty means the default.
export function parseMaxDelete(value) {
  if (value === undefined || value === '') return DEFAULT_MAX_DELETE;
  if (!/^[1-9][0-9]{0,3}$/.test(value)) {
    throw new Error(`MAX_DELETE must be a whole number from 1 (got "${value}")`);
  }
  return Number(value);
}

// What stops the teardown: a user that is not a Player, or more actors than the sanity limit.
export function teardownProblems(state, maxDelete) {
  const problems = [];
  const [user] = state.users;
  if (!user) return problems;
  if (user.role !== PLAYER_ROLE) {
    problems.push(
      `${PLAYER_NAME} has role ${user.role}, not Player (${PLAYER_ROLE}): refusing to delete it`
    );
  }
  if (state.ownedActors.length > maxDelete) {
    problems.push(
      `${PLAYER_NAME} owns ${state.ownedActors.length} actors, more than the limit of ${maxDelete} ` +
        `(${state.ownedActors.map(a => a.name).join(', ')}): check them, then MAX_DELETE=<n> to allow more`
    );
  }
  return problems;
}

// After the teardown neither the user nor an actor it owned may be left.
export function teardownMismatches(before, after) {
  const problems = [];
  if (after.users.length) problems.push(`${PLAYER_NAME} still exists`);
  const left = after.ownedActors.map(a => a.id);
  if (left.length) problems.push(`these actors are still there: ${left.join(', ')}`);
  for (const actor of before.ownedActors) {
    if (left.includes(actor.id)) problems.push(`${actor.name} (${actor.id}) was not deleted`);
  }
  return problems;
}

// ---- runs in node: the browser ----------------------------------------------------------------------------------

// Tries to join as the player with an empty password in a page of its own. True when the game opens.
export async function joinsWithoutPassword(page, { url, user, timeout = 20_000 }) {
  await page.goto(`${url}/join`, { waitUntil: 'domcontentloaded' });
  await page.locator('#join-username').fill(user);
  await page.keyboard.press('Escape');
  await page.locator('#join-password').fill('');
  await page.locator('button[name="join"]').click();
  try {
    await page.waitForURL(/\/game$/, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const action = env('ACTION', '');
  if (action !== 'setup' && action !== 'teardown') {
    throw new Error(`ACTION must be setup or teardown (got "${action}")`);
  }
  const maxDelete = action === 'teardown' ? parseMaxDelete(process.env.MAX_DELETE) : 0;
  const require = createRequire(join(env('TOOL_APP'), 'package.json'));
  const { chromium } = require('playwright-core');
  const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
  const user = env('GM_USER');
  const password = env('GM_PASSWORD');
  const world = env('WORLD');

  // Throwaway profiles, so no session here ever lands in the Assistant GM's profile.
  const profiles = [];
  const launch = async () => {
    const profile = mkdtempSync(join(tmpdir(), 'kit-session-'));
    profiles.push(profile);
    return chromium.launchPersistentContext(profile, {
      executablePath: env('CHROMIUM', '/usr/bin/chromium'),
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
      viewport: { width: 1280, height: 800 },
    });
  };
  const contexts = [];
  const probe = async () => {
    const context = await launch();
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      return await joinsWithoutPassword(page, { url: FOUNDRY_URL, user: PLAYER_NAME });
    } finally {
      await context.close().catch(() => {});
    }
  };
  try {
    const context = await launch();
    contexts.push(context);
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

    const args = {
      moduleId: MODULE_ID,
      phbModule: PHB_MODULE,
      packs: PACKS,
      settingKeys: SETTING_KEYS,
      playerName: PLAYER_NAME,
    };
    const before = await page.evaluate(readState, args);
    log(`world ${before.world}, joined as ${before.user} (GM: ${before.isGM})`);
    const problems = blockers(before, world, action);
    if (problems.length) throw new Error(problems.join('; '));
    log(`before: ${show(before)}`);

    if (action === 'setup') {
      // Everything that can refuse is checked first, so a refusal changes nothing.
      if (before.users.length === 1) {
        const bad = playerUserProblems(before.users[0], await probe());
        if (bad.length) throw new Error(bad.join('; '));
      }
      const changes = settingsDiff(before);
      const makeUser = before.users.length === 0;
      const plan = [
        ...changes.map(c => c.label),
        ...(makeUser ? [`create user ${PLAYER_NAME}`] : []),
      ];
      log(plan.length ? `changing: ${plan.join(', ')}` : 'nothing to change (already set)');
      if (changes.length) {
        await page.evaluate(applyChanges, { moduleId: MODULE_ID, changes });
      }
      if (makeUser) await page.evaluate(createPlayer, { playerName: PLAYER_NAME });

      // Read back after a reload, so the check sees what the server stored and not this browser's copy.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      const after = await page.evaluate(readState, args);
      log(`after:  ${show(after)}`);
      const wrong = mismatches(before, after);
      if (wrong.length) throw new Error(`read-back does not match: ${wrong.join('; ')}`);
      if (makeUser && !(await probe())) {
        throw new Error(`the new user ${PLAYER_NAME} could not join without a password`);
      }
      log('verified');
    } else {
      const [kit] = before.users;
      if (!kit) {
        log(`no user named ${PLAYER_NAME}: nothing to delete`);
        return;
      }
      const bad = teardownProblems(before, maxDelete);
      if (bad.length) throw new Error(bad.join('; '));
      for (const actor of before.ownedActors) {
        log(`deleting actor ${actor.name} (${actor.type}, ${actor.id})`);
      }
      log(`deleting user ${kit.name} (${kit.id})`);
      await page.evaluate(deleteKit, {
        playerName: PLAYER_NAME,
        userId: kit.id,
        actorIds: before.ownedActors.map(a => a.id),
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      const after = await page.evaluate(readState, args);
      log(`after:  ${show(after)}`);
      const wrong = teardownMismatches(before, after);
      if (wrong.length) throw new Error(`read-back does not match: ${wrong.join('; ')}`);
      log('verified');
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
  }
}

// Run only as a script (the stage runs it with node); the tests import the functions above. import.meta.url is the
// real path while argv[1] keeps a symlinked one, so compare against the real path: a false guard would exit 0 and
// change nothing, and the stage would report the session as set up.
// The lookup runs on import too (the tests), where argv[1] need not be a file: then this is not the script.
// If the real-path lookup fails, the path as given is compared instead, so a real run still matches.
const invokedAs = (() => {
  if (!process.argv[1]) return '';
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return pathToFileURL(process.argv[1]).href;
  }
})();
if (invokedAs === import.meta.url) {
  main().catch(err => {
    log(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}

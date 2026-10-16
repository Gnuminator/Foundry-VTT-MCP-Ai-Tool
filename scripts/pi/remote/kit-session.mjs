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
//       Player with no password, otherwise nothing is changed and the run fails;
//     - the foundry-mcp-bridge module is active (enabled, with a reload, when it is not), the GM user "Kit GM"
//       exists with role Game Master and the password in KIT_GM_PASSWORD (made, or role and password updated: the
//       name is reserved for the kit session), and Kit GM is the module's bridge user (world setting
//       foundry-mcp-bridge.bridgeUserId). A Kit GM that is online right now, or has a role above Game Master, is
//       refused. The last check is a throwaway browser joining as Kit GM with that password.
//     It prints the values before and after, reloads the world and reads them back, and exits 1 on any mismatch.
//     A second run changes nothing but the Kit GM password. When it has verified everything it prints one line,
//     "ORIG_BRIDGE_USER=<id or empty>": the bridge user it replaced, which the stage keeps for the teardown.
//   ACTION=teardown  deletes the actors that Kit Player owns and that were made after the session started (SINCE_EPOCH or SINCE_STAMP;
//                    at most 5; MAX_DELETE raises the limit; older ones are kept and listed; their names
//                    and ids are printed first) and then the user Kit Player; then, when Kit GM is the bridge user,
//                    the bridge user goes back to what setup found (ORIG_BRIDGE_USER, when that user still exists
//                    and is a GM, role 3 or above) or else to "Any GM" (the empty value), and the user Kit GM is
//                    deleted (it must be exactly named, a Game Master, offline and not the user this run joined
//                    as). Nothing else is deleted and no other setting is touched. Without those users there is nothing to do
//                    and the run succeeds. Everything that can refuse is checked before the first delete.
//
// Passwords are never printed (a log line has them cut out even when an error message holds one).
//
// Environment: ACTION, TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL (default
// http://127.0.0.1:30000), CHROMIUM (default /usr/bin/chromium), GM_USER, GM_PASSWORD, WORLD (the world id
// that must be running), KIT_GM_PASSWORD (setup only: 32 lowercase hex characters), MAX_DELETE, SINCE_EPOCH (seconds, the state file's STAMP_EPOCH; wins when set), SINCE_STAMP (YYYYMMDD-HHMMSS, the state file's STAMP; the fallback; one of the two is required) and
// ORIG_BRIDGE_USER (teardown only; the latter is a 16 character user id or empty, and when it is not set at all the bridge user goes back to Any GM).

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
// The test kit's GM: CONST.USER_ROLES.GAMEMASTER, and the bridge module's own setting (settings.ts: ANY_GM_CHOICE is
// the empty value, "Any GM").
export const GM_NAME = 'Kit GM';
export const GM_ROLE = 4;
export const BRIDGE_MODULE = 'foundry-mcp-bridge';
export const ANY_GM_CHOICE = '';

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

// Secrets that must never reach a log line (the GM login and the Kit GM password): main() adds them. An error message
// that holds one (a browser library echoing what was typed) is cut before it is printed.
const secrets = [];
export const redact = msg =>
  secrets.reduce((text, secret) => (secret ? text.split(secret).join('***') : text), String(msg));
export const addSecret = secret => {
  if (typeof secret === 'string' && secret.length >= 8) secrets.push(secret);
};
const log = msg => console.log(`[kit-session] ${redact(msg)}`);

// ---- runs in the browser (page.evaluate): the functions below (readState to deleteKitGm) must not use anything but their argument
// and Foundry's globals ----------------------------------------------------------------------------------------

// The values this script cares about, plus what must exist for them to work.
// trackingOn: how many users have Actor Studio's usage-tracking saved as anything but false (a saved
// per-user value overrides the off default); null when the module does not register the setting.
// ownedActors: for the user named playerName, the actors where that user is an explicit OWNER (createdTime: the
// actor's _stats.createdTime in ms, null when it has none).
// leftActors: the ids in actorIds that are still in game.actors (the teardown's read-back: once the user is gone,
// ownedActors can no longer find its actors, so the ids found before the delete are looked up one by one).
// gmIds: the ids of the users with role 3 or above; assistantGms: those of them named assistantName; kitGm: the users named gmName (online or not); userId: the user this page joined as; bridgeModuleInstalled and
// bridgeModuleActive: the bridge module (bridgeModule); bridgeUserId: its world setting, null while the module
// registers none (it registers its settings only when it is active).
export function readState({
  moduleId,
  phbModule,
  packs,
  settingKeys,
  playerName,
  gmName,
  bridgeModule,
  assistantName = 'Assistant GM',
  actorIds = [],
}) {
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
        .map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          createdTime: a._stats?.createdTime ?? null,
        }))
    : [];
  // The users that can hold the bridge link: the roles Assistant GM (3) and Game Master (4).
  const gmIds = game.users.filter(u => u.role >= CONST.USER_ROLES.ASSISTANT).map(u => u.id);
  const kitGm = game.users
    .filter(u => u.name === gmName)
    .map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active === true }));
  const bridgeUserKey = `${bridgeModule}.bridgeUserId`;
  return {
    trackingOn,
    world: game.world.id,
    user: game.user.name,
    userId: game.user.id ?? null,
    isGM: game.user.isGM,
    kitGm,
    gmIds,
    assistantGms: game.users
      .filter(u => u.name === assistantName && u.role >= CONST.USER_ROLES.ASSISTANT)
      .map(u => u.id),
    bridgeModuleInstalled: game.modules.has(bridgeModule),
    bridgeModuleActive: game.modules.get(bridgeModule)?.active === true,
    bridgeUserId: settings.settings.has(bridgeUserKey)
      ? (settings.get(bridgeModule, 'bridgeUserId') ?? null)
      : null,
    roles: { PLAYER: CONST.USER_ROLES.PLAYER, TRUSTED: CONST.USER_ROLES.TRUSTED },
    moduleActive: game.modules.get(moduleId)?.active === true,
    phbActive: game.modules.get(phbModule)?.active === true,
    missingPacks: packs.filter(pack => !game.packs.has(pack)),
    unregistered: settingKeys.filter(key => !registered(key)),
    actorCreate: permissions?.ACTOR_CREATE ?? null,
    values,
    users,
    ownedActors,
    leftActors: actorIds.filter(id => game.actors.has(id)),
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

// Turns the bridge module on in this world (the way assistant-gm.mjs provision does); the caller reloads.
export async function enableBridgeModule({ moduleId }) {
  const config = game.settings.get('core', 'moduleConfiguration') ?? {};
  await game.settings.set('core', 'moduleConfiguration', { ...config, [moduleId]: true });
}

// Makes the GM user gmName, or updates the role and password of the one that is there (the name is reserved for the
// kit session), and makes it the bridge user. It looks again first: the module must be active, there is one user of
// that name at most, and that one is offline with no role above role. The password is not returned or logged.
export async function provisionKitGm({ moduleId, gmName, role, password }) {
  if (!game.modules.get(moduleId)?.active) throw new Error(`${moduleId} is not active`);
  const matches = game.users.filter(u => u.name === gmName);
  if (matches.length > 1) throw new Error(`more than one user is named ${gmName}`);
  let [user] = matches;
  if (user) {
    if (user.active) throw new Error(`${gmName} is online right now`);
    if (user.role > role) throw new Error(`${gmName} has role ${user.role}, above ${role}`);
    await user.update({ role, password });
  } else {
    user = await User.implementation.create({ name: gmName, role, password });
  }
  await game.settings.set(moduleId, 'bridgeUserId', user.id);
  return { id: user.id };
}

// Deletes the user userId after looking at it once more: exactly gmName, a Game Master, offline, and not the user
// this page joined as. When it is the bridge user, the bridge user goes back to bridgeTo first (looked at again here:
// a user that is gone, or below role 3, or the Kit GM itself becomes anyGm).
export async function deleteKitGm({ moduleId, gmName, userId, anyGm, bridgeTo = anyGm }) {
  const user = game.users.get(userId);
  if (!user || user.name !== gmName) throw new Error(`the user ${userId} is not ${gmName}`);
  if (user.role !== CONST.USER_ROLES.GAMEMASTER) {
    throw new Error(`${gmName} is not a Game Master (role ${user.role})`);
  }
  if (user.id === game.user.id) throw new Error(`${gmName} is the user this page joined as`);
  if (user.active) throw new Error(`${gmName} is online right now`);
  if (
    game.settings.settings.has(`${moduleId}.bridgeUserId`) &&
    game.settings.get(moduleId, 'bridgeUserId') === user.id
  ) {
    const target = bridgeTo ? game.users.get(bridgeTo) : null;
    const usable = target && target.id !== user.id && target.role >= CONST.USER_ROLES.ASSISTANT;
    await game.settings.set(moduleId, 'bridgeUserId', usable ? bridgeTo : anyGm);
  }
  await user.delete();
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
    [GM_NAME]: state.kitGm.length ? `role ${state.kitGm[0].role}` : 'missing',
    [`${BRIDGE_MODULE} active`]: state.bridgeModuleActive,
    [`bridge user is ${GM_NAME}`]: state.kitGm.length
      ? state.bridgeUserId === state.kitGm[0].id
      : false,
  });

// The problems that stop either action from working, as a list of plain sentences.
export function blockers(state, world, action) {
  const problems = [];
  if (state.world !== world) problems.push(`joined world ${state.world}, expected ${world}`);
  if (!state.isGM) problems.push(`${state.user} is not a GM`);
  if (state.users.length > 1) problems.push(`more than one user is named ${PLAYER_NAME}`);
  if (state.kitGm.length > 1) problems.push(`more than one user is named ${GM_NAME}`);
  if (state.user === GM_NAME) {
    problems.push(`the stage joined as ${GM_NAME} itself: it must join as the world's own GM`);
  }
  if (action === 'teardown') return problems;
  if (!state.bridgeModuleInstalled) {
    problems.push(
      `the ${BRIDGE_MODULE} module is not installed on this Foundry (stage 5 installs it)`
    );
  }
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

// SINCE_EPOCH: the state file's STAMP_EPOCH (whole seconds since the epoch) as milliseconds, or null when it is not set.
// It wins over SINCE_STAMP because it does not shift with a DST change or a timezone change on the Pi.
export function parseSinceEpoch(value) {
  if (value === undefined || value === '') return null;
  if (!/^\d{9,11}$/.test(value)) {
    throw new Error(
      `SINCE_EPOCH must be whole seconds since 1970, like 1792000000 (got "${value}")`
    );
  }
  return Number(value) * 1000;
}

// SINCE_STAMP: the state file's STAMP (YYYYMMDD-HHMMSS, the host's local time when "up" ran) as milliseconds since the
// epoch, or null when it is not set (main() refuses a teardown without it). The Pi's clock and
// timezone are the ones that wrote the stamp and that stamp the actors, so the local-time reading is the right one.
export function parseSinceStamp(value) {
  if (value === undefined || value === '') return null;
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!m) throw new Error(`SINCE_STAMP must look like 20261014-093000 (got "${value}")`);
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, sec);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== sec
  ) {
    throw new Error(`SINCE_STAMP is not a real date and time (got "${value}")`);
  }
  return date.getTime();
}

// Only the actors made after "up" go; an owned actor from before it (the world's own, or one Kit Player was given by
// hand) is kept, and so is one with no creation time. sinceMs null: all owned actors are the kit session's.
export function splitOwnedActors(actors, sinceMs) {
  if (sinceMs === null || sinceMs === undefined) return { mine: [...actors], older: [] };
  const mine = [];
  const older = [];
  for (const actor of actors) {
    (Number.isFinite(actor.createdTime) && actor.createdTime >= sinceMs ? mine : older).push(actor);
  }
  return { mine, older };
}

// What stops the teardown: a user that is not a Player, or more actors than the sanity limit. Only the actors that
// will be deleted count (state.ownedActors is the list of those; main() hands over the split).
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
  // after must come from readState with the ids of before.ownedActors as actorIds.
  const left = after.leftActors ?? [];
  const wanted = new Set(before.ownedActors.map(a => a.id));
  for (const id of left) {
    const name = before.ownedActors.find(a => a.id === id)?.name ?? '?';
    problems.push(`${name} (${id}) was not deleted`);
  }
  if (wanted.size && after.leftActors === undefined) {
    problems.push('the read-back did not look up the deleted actors');
  }
  return problems;
}

// KIT_GM_PASSWORD: 32 lowercase hex characters (the stage makes it with 16 random bytes). The error never holds it.
export function parseKitGmPassword(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
    throw new Error('KIT_GM_PASSWORD is not set, or is not 32 lowercase hexadecimal characters');
  }
  return value;
}

// An existing Kit GM is ours and reserved, so setup updates its role and password; but not while a browser is joined
// as it right now, and never when its role is above Game Master.
export function kitGmUserProblems(user) {
  const problems = [];
  if (user.role > GM_ROLE) {
    problems.push(
      `${GM_NAME} has role ${user.role}, above Game Master (${GM_ROLE}): refusing to change it`
    );
  }
  if (user.active) {
    problems.push(`${GM_NAME} is online right now (a browser is joined as it): stop that first`);
  }
  return problems;
}

// What the world must show at the end of setup for the Kit GM: one user with the role Game Master, the bridge module
// active and that user as the bridge user. The password cannot be read back; the join probe checks it.
export function kitGmMismatches(after) {
  const problems = [];
  if (after.kitGm.length !== 1) {
    problems.push(`${after.kitGm.length} users are named ${GM_NAME}, expected 1`);
  } else if (after.kitGm[0].role !== GM_ROLE) {
    problems.push(`${GM_NAME} has role ${after.kitGm[0].role}, not Game Master (${GM_ROLE})`);
  }
  if (!after.bridgeModuleActive) problems.push(`the ${BRIDGE_MODULE} module is not active`);
  const [gm] = after.kitGm;
  if (gm && after.bridgeUserId !== gm.id) {
    problems.push(`the bridge user is ${JSON.stringify(after.bridgeUserId)}, not ${GM_NAME}`);
  }
  return problems;
}

// What stops the teardown of the Kit GM: not exactly named, not a Game Master, the user this run joined as, or online.
// Without a Kit GM there is nothing to refuse.
export function kitGmTeardownProblems(state) {
  const problems = [];
  const [gm] = state.kitGm;
  if (!gm) return problems;
  if (gm.name !== GM_NAME) problems.push(`the user ${gm.id} is not named ${GM_NAME}`);
  if (gm.role !== GM_ROLE) {
    problems.push(
      `${GM_NAME} has role ${gm.role}, not Game Master (${GM_ROLE}): refusing to delete it`
    );
  }
  if (gm.id === state.userId) {
    problems.push(`${GM_NAME} is the user this run joined as: refusing to delete it`);
  }
  if (gm.active) {
    problems.push(`${GM_NAME} is online right now: stop its browser first, refusing to delete it`);
  }
  return problems;
}

// After the teardown the Kit GM is gone and no longer the bridge user (before holds the user as it was). When it was
// the bridge user, the bridge user must now be bridgeTo (see bridgeRestoreTarget). The check only applies when there
// was a Kit GM.
export function kitGmTeardownMismatches(before, after, bridgeTo) {
  const problems = [];
  const [gm] = before.kitGm;
  if (!gm) return problems;
  if (after.kitGm.length) problems.push(`${GM_NAME} still exists`);
  if (after.bridgeUserId === gm.id) {
    problems.push(`the bridge user is still the deleted ${GM_NAME} (${gm.id})`);
  } else if (
    bridgeTo !== undefined &&
    before.bridgeUserId === gm.id &&
    (after.bridgeUserId ?? ANY_GM_CHOICE) !== bridgeTo
  ) {
    problems.push(
      `the bridge user is ${JSON.stringify(after.bridgeUserId)}, expected ${JSON.stringify(bridgeTo)}`
    );
  }
  return problems;
}

const USER_ID = /^([A-Za-z0-9]{16})?$/;

// Setup: the bridge user it is about to replace, as the id the stage keeps (or empty for "Any GM", also when the
// setting is not registered yet). The Kit GM itself (a session that was cut off) is never restored: the single
// Assistant GM stands in for it, if there is one. Anything that is not a Foundry user id is refused.
export function originalBridgeUser(bridgeUserId, kitGmId, assistantGms = []) {
  const id = bridgeUserId ?? ANY_GM_CHOICE;
  if (typeof id !== 'string' || !USER_ID.test(id)) {
    throw new Error(`the bridge user setting holds ${JSON.stringify(id)}, which is not a user id`);
  }
  if (id !== kitGmId) return id;
  // The Kit GM is already the bridge user: an earlier run was cut off and left it. Its original is lost; the best
  // guess is the one Assistant GM that stage 11 provisions (exactly one, role 3 or above), else Any GM.
  const [only] = assistantGms;
  return assistantGms.length === 1 && USER_ID.test(only) ? only : ANY_GM_CHOICE;
}

// Teardown: ORIG_BRIDGE_USER from the environment. Not set means the old state file format: undefined (Any GM).
export function parseOrigBridgeUser(value) {
  if (value === undefined) return undefined;
  if (!USER_ID.test(value)) {
    throw new Error(`ORIG_BRIDGE_USER must be a 16 character user id or empty (got "${value}")`);
  }
  return value;
}

// Teardown: where the bridge user goes back to: the original user when it is not the Kit GM and still exists with
// role 3 or above (state.gmIds), else Any GM.
export function bridgeRestoreTarget(state, origId) {
  const [gm] = state.kitGm;
  if (!origId || !gm || origId === gm.id) return ANY_GM_CHOICE;
  return state.gmIds.includes(origId) ? origId : ANY_GM_CHOICE;
}

// ---- runs in node: the browser ----------------------------------------------------------------------------------

// Tries to join as user with this password in a page of its own. True when the game opens. The password only goes
// through the page's fill; a failing step says which step, never what was typed.
export async function joinsWithPassword(page, { url, user, password, timeout = 20_000 }) {
  await page.goto(`${url}/join`, { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('#join-username').fill(user);
    await page.keyboard.press('Escape');
    await page.locator('#join-password').fill(password);
    await page.locator('button[name="join"]').click();
  } catch {
    throw new Error(`the join form did not take the login of ${user}`);
  }
  try {
    await page.waitForURL(/\/game$/, { timeout });
    return true;
  } catch {
    return false;
  }
}

// The same with an empty password (the passwordless Kit Player).
export const joinsWithoutPassword = (page, options) =>
  joinsWithPassword(page, { ...options, password: '' });

async function main() {
  const action = env('ACTION', '');
  if (action !== 'setup' && action !== 'teardown') {
    throw new Error(`ACTION must be setup or teardown (got "${action}")`);
  }
  const maxDelete = action === 'teardown' ? parseMaxDelete(process.env.MAX_DELETE) : 0;
  const sinceMs =
    action === 'teardown'
      ? (parseSinceEpoch(process.env.SINCE_EPOCH) ?? parseSinceStamp(process.env.SINCE_STAMP))
      : null;
  const origBridge =
    action === 'teardown' ? parseOrigBridgeUser(process.env.ORIG_BRIDGE_USER) : undefined;
  if (action === 'teardown' && sinceMs === null) {
    throw new Error(
      'SINCE_STAMP is not set (and no SINCE_EPOCH): the teardown deletes only actors made after the session started'
    );
  }
  const toolApp = env('TOOL_APP');
  // Checked before the browser is even loaded; the error never holds the value.
  const kitGmPassword = action === 'setup' ? parseKitGmPassword(process.env.KIT_GM_PASSWORD) : '';
  addSecret(kitGmPassword);
  const require = createRequire(join(toolApp, 'package.json'));
  const { chromium } = require('playwright-core');
  const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
  const user = env('GM_USER');
  const password = env('GM_PASSWORD');
  addSecret(password);
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
  // Joins as one user in a context of its own, which is closed again.
  const probeAs = async (name, pass) => {
    const context = await launch();
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      return await joinsWithPassword(page, { url: FOUNDRY_URL, user: name, password: pass });
    } finally {
      await context.close().catch(() => {});
    }
  };
  const probe = () => probeAs(PLAYER_NAME, '');
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
      gmName: GM_NAME,
      bridgeModule: BRIDGE_MODULE,
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
      const [oldGm] = before.kitGm;
      if (oldGm) {
        const bad = kitGmUserProblems(oldGm);
        if (bad.length) throw new Error(bad.join('; '));
      }
      const changes = settingsDiff(before);
      const makeUser = before.users.length === 0;
      const plan = [
        ...changes.map(c => c.label),
        ...(makeUser ? [`create user ${PLAYER_NAME}`] : []),
        ...(before.bridgeModuleActive ? [] : [`enable ${BRIDGE_MODULE}`]),
        `${oldGm ? 'update' : 'create'} user ${GM_NAME} (Game Master) as the bridge user`,
      ];
      log(`changing: ${plan.join(', ')}`);
      let bridgeSeen = before.bridgeUserId;
      if (!before.bridgeModuleActive) {
        await page.evaluate(enableBridgeModule, { moduleId: BRIDGE_MODULE });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        const enabled = await page.evaluate(readState, args);
        if (!enabled.bridgeModuleActive) {
          throw new Error(`${BRIDGE_MODULE} is not active after enabling it`);
        }
        log(`${BRIDGE_MODULE} is active`);
        bridgeSeen = enabled.bridgeUserId;
      }
      // The bridge user this setup replaces, kept by the stage so the teardown can put it back.
      const origBridgeUser = originalBridgeUser(bridgeSeen, oldGm?.id, before.assistantGms);
      if (changes.length) {
        await page.evaluate(applyChanges, { moduleId: MODULE_ID, changes });
      }
      if (makeUser) await page.evaluate(createPlayer, { playerName: PLAYER_NAME });
      await page.evaluate(provisionKitGm, {
        moduleId: BRIDGE_MODULE,
        gmName: GM_NAME,
        role: GM_ROLE,
        password: kitGmPassword,
      });

      // Read back after a reload, so the check sees what the server stored and not this browser's copy.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      const after = await page.evaluate(readState, args);
      log(`after:  ${show(after)}`);
      const wrong = [...mismatches(before, after), ...kitGmMismatches(after)];
      if (wrong.length) throw new Error(`read-back does not match: ${wrong.join('; ')}`);
      if (makeUser && !(await probe())) {
        throw new Error(`the new user ${PLAYER_NAME} could not join without a password`);
      }
      if (!(await probeAs(GM_NAME, kitGmPassword))) {
        throw new Error(`${GM_NAME} could not join with the password this run set`);
      }
      log('verified');
      log(`ORIG_BRIDGE_USER=${origBridgeUser}`);
    } else {
      const [kit] = before.users;
      const [gm] = before.kitGm;
      if (!kit) log(`no user named ${PLAYER_NAME}: nothing to delete`);
      if (!gm) log(`no user named ${GM_NAME}: nothing to delete`);
      if (!kit && !gm) return;
      // Everything that can refuse is checked before the first delete.
      const { mine, older } = splitOwnedActors(before.ownedActors, sinceMs);
      const bad = [
        ...teardownProblems({ ...before, ownedActors: mine }, maxDelete),
        ...kitGmTeardownProblems(before),
      ];
      if (bad.length) throw new Error(bad.join('; '));
      const actorIds = mine.map(a => a.id);
      let bridgeTo;
      if (kit) {
        for (const actor of older) {
          log(
            `keeping actor ${actor.name} (${actor.type}, ${actor.id}): not made after the session started`
          );
        }
        for (const actor of mine) {
          log(`deleting actor ${actor.name} (${actor.type}, ${actor.id})`);
        }
        log(`deleting user ${kit.name} (${kit.id})`);
        await page.evaluate(deleteKit, { playerName: PLAYER_NAME, userId: kit.id, actorIds });
      }
      if (gm) {
        bridgeTo = bridgeRestoreTarget(before, origBridge);
        const bridge =
          before.bridgeUserId === gm.id
            ? `, the bridge user goes back to ${bridgeTo ? bridgeTo : 'Any GM'}`
            : '';
        log(`deleting user ${gm.name} (${gm.id})${bridge}`);
        await page.evaluate(deleteKitGm, {
          moduleId: BRIDGE_MODULE,
          gmName: GM_NAME,
          userId: gm.id,
          anyGm: ANY_GM_CHOICE,
          bridgeTo,
        });
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      const after = await page.evaluate(readState, { ...args, actorIds });
      log(`after:  ${show(after)}`);
      const wrong = [
        ...(kit ? teardownMismatches({ ...before, ownedActors: mine }, after) : []),
        ...kitGmTeardownMismatches(before, after, bridgeTo),
      ];
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

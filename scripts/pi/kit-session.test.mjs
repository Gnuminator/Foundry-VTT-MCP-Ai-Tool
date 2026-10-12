// Tests for the Pi kit session (scripts/pi/remote/kit-session.sh and kit-session.mjs, docs/dev/PI-SETUP.md):
//   node --test scripts/pi/kit-session.test.mjs
// - the in-browser part (kit-session.mjs) against a fake `game`: every decision of the setup (which settings
//   differ, what the read-back must show, the checks on the Kit Player user) and of the teardown (which actors
//   count, the limit, what is deleted, what must be gone afterwards), a second run changing nothing, and the Kit GM
//   (the bridge module enabled, the GM user made or updated with the run's password, the bridge user, the teardown
//   putting it back to Any GM and deleting the user, every refusal, the password never printed);
// - with PI_KIT_SESSION_CONTAINER=1 (needs Docker; CI would run it on the ARM runner): the stage itself in a
//   Debian 13 ARM64 container with stand-ins for systemd (scripts/pi/container-test/kit-session-scenarios.sh): up and
//   down, every refusal before anything stops, a failing driver or Kit GM browser putting everything back, services
//   that were off staying off, the Kit GM password file (mode 600, never printed) and the transient Kit GM browser unit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ANY_GM_CHOICE,
  BRIDGE_MODULE,
  FLAGS,
  GM_NAME,
  GM_ROLE,
  MODULE_ID,
  PACKS,
  PHB_MODULE,
  PLAYER_NAME,
  SETTING_KEYS,
  SOURCES,
  addSecret,
  applyChanges,
  bridgeRestoreTarget,
  blockers,
  createPlayer,
  deleteKit,
  deleteKitGm,
  enableBridgeModule,
  joinsWithPassword,
  joinsWithoutPassword,
  kitGmMismatches,
  kitGmTeardownMismatches,
  kitGmTeardownProblems,
  kitGmUserProblems,
  mismatches,
  originalBridgeUser,
  parseKitGmPassword,
  parseMaxDelete,
  parseOrigBridgeUser,
  playerUserProblems,
  provisionKitGm,
  readState,
  redact,
  settingsDiff,
  teardownMismatches,
  teardownProblems,
} from './remote/kit-session.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ARGS = {
  moduleId: MODULE_ID,
  phbModule: PHB_MODULE,
  packs: PACKS,
  settingKeys: SETTING_KEYS,
  playerName: PLAYER_NAME,
  gmName: GM_NAME,
  bridgeModule: BRIDGE_MODULE,
};
const TRACKING = `${MODULE_ID}.usage-tracking`;
const OWNER = 3;

// A Setting document: Foundry keeps `value` as JSON, so an update with the string 'false' reads back as false.
function settingDoc(key, user, value) {
  return {
    key,
    user,
    value,
    updates: 0,
    async update(change) {
      const v = change.value;
      this.value = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v));
      this.updates += 1;
    },
  };
}

// Foundry's collections have get(); filter and map give plain arrays.
class Collection extends Array {
  static get [Symbol.species]() {
    return Array;
  }
  get(id) {
    return this.find(item => item.id === id);
  }
  has(id) {
    return this.some(item => item.id === id);
  }
}

const startSources = () => ({
  races: [],
  racialFeatures: ['some.pack'],
  backgrounds: [],
  classes: ['dnd5e.classes'],
  subclasses: [],
  spells: [],
  feats: [],
  equipment: null,
  items: ['dnd5e.items'],
});

function fakeGame({
  docs = [],
  actorCreate = [3, 4],
  flags = {},
  sources = startSources(),
  isGM = true,
  moduleActive = true,
  phbActive = true,
  unregistered = [],
  tracking = true,
  packs = PACKS,
  users = [],
  actors = [],
  world = 'strahd-kit',
  bridgeInstalled = true,
  bridgeActive = true,
  bridgeUserId = ANY_GM_CHOICE,
  userName = 'Gamemaster',
} = {}) {
  const values = new Map([
    ['core.permissions', { ACTOR_CREATE: actorCreate, FILES_BROWSE: [2, 3, 4] }],
    [`${MODULE_ID}.compendiumSources`, sources],
    ...Object.keys(FLAGS).map(key => [`${MODULE_ID}.${key}`, flags[key] ?? !FLAGS[key]]),
  ]);
  const registered = new Map(
    [...values.keys()]
      .filter(k => !unregistered.some(u => k === `${MODULE_ID}.${u}`))
      .map(k => [k, {}])
  );
  if (tracking) registered.set(TRACKING, {});
  // The bridge module registers its settings only when it is active.
  if (bridgeActive) {
    values.set(`${BRIDGE_MODULE}.bridgeUserId`, bridgeUserId);
    registered.set(`${BRIDGE_MODULE}.bridgeUserId`, {});
  }
  const sets = [];
  const game = {
    sets,
    docs,
    world: { id: world },
    user: { id: 'userGm', name: userName, isGM },
    modules: new Map([
      [MODULE_ID, { active: moduleActive }],
      [PHB_MODULE, { active: phbActive }],
      ...(bridgeInstalled ? [[BRIDGE_MODULE, { active: bridgeActive }]] : []),
    ]),
    packs: new Map(packs.map(p => [p, {}])),
    users: Collection.from(users),
    actors: Collection.from(actors),
    settings: {
      settings: registered,
      storage: new Map([['user', { contents: docs }]]),
      get: (ns, key) => values.get(`${ns}.${key}`),
      async set(ns, key, value) {
        sets.push(`${ns}.${key}`);
        values.set(`${ns}.${key}`, JSON.parse(JSON.stringify(value)));
      },
    },
  };
  // Documents remove themselves from their collection, the way Foundry's do.
  for (const u of game.users) {
    u.delete = async () => game.users.splice(game.users.indexOf(u), 1);
    u.update = async change => Object.assign(u, change);
  }
  for (const a of game.actors) {
    a.deleted = false;
    a.delete = async () => {
      a.deleted = true;
      game.actors.splice(game.actors.indexOf(a), 1);
    };
  }
  return game;
}

const kitUser = (over = {}) => ({ id: 'userKit', name: PLAYER_NAME, role: 1, ...over });
const actor = (id, name, ownership = {}) => ({ id, name, type: 'character', ownership });

function installGlobals(game) {
  globalThis.game = game;
  globalThis.User = {
    implementation: {
      async create(data) {
        const user = { id: `user${game.users.length}`, ...data };
        user.delete = async () => game.users.splice(game.users.indexOf(user), 1);
        user.update = async change => Object.assign(user, change);
        game.users.push(user);
        return user;
      },
    },
  };
}

// Runs the whole setup the way main() does, without the browser; returns what it printed to decide on.
async function runSetup(game) {
  installGlobals(game);
  const before = readState(ARGS);
  const problems = blockers(before, 'strahd-kit', 'setup');
  if (problems.length) return { before, problems };
  const changes = settingsDiff(before);
  const done = await applyChanges({ moduleId: MODULE_ID, changes });
  if (before.users.length === 0) await createPlayer({ playerName: PLAYER_NAME });
  const after = readState(ARGS);
  return { before, after, changes, done, problems: [], wrong: mismatches(before, after) };
}

describe('kit-session.mjs setup (the in-browser part)', () => {
  before(() => {
    globalThis.CONST = {
      USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
      DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER },
    };
  });
  after(() => {
    delete globalThis.game;
    delete globalThis.CONST;
    delete globalThis.User;
  });

  test('sets the roles, sources and flags, keeps the rest, makes Kit Player, then verifies', async () => {
    const run = await runSetup(fakeGame());
    assert.deepEqual(run.problems, []);
    assert.deepEqual(run.done, [
      'core.permissions ACTOR_CREATE',
      'compendiumSources (races, racialFeatures, backgrounds, classes, subclasses, spells, feats, equipment)',
      'allowStandardArray = true',
      'allowManualInput = false',
      'allowPointBuy = false',
      'allowRolling = false',
      'enableSpellSelection = true',
      'enableEquipmentSelection = true',
    ]);
    assert.deepEqual(run.after.actorCreate, [1, 2, 3, 4]);
    assert.deepEqual(run.after.values.compendiumSources, { ...SOURCES, items: ['dnd5e.items'] });
    for (const [key, value] of Object.entries(FLAGS)) assert.equal(run.after.values[key], value);
    assert.deepEqual(
      run.after.users.map(u => [u.name, u.role]),
      [[PLAYER_NAME, 1]]
    );
    assert.deepEqual(run.wrong, []);
  });

  test('the sources and flags are the ones the kit session promises', () => {
    assert.deepEqual(SOURCES, {
      races: ['dnd-players-handbook.origins'],
      racialFeatures: ['dnd-players-handbook.origins'],
      backgrounds: ['dnd-players-handbook.origins'],
      classes: ['dnd-players-handbook.classes'],
      subclasses: ['dnd-players-handbook.classes'],
      spells: ['dnd-players-handbook.spells'],
      feats: ['dnd-players-handbook.feats'],
      equipment: ['dnd-players-handbook.equipment'],
    });
    assert.deepEqual(FLAGS, {
      allowStandardArray: true,
      allowManualInput: false,
      allowPointBuy: false,
      allowRolling: false,
      enableSpellSelection: true,
      enableEquipmentSelection: true,
    });
    assert.deepEqual([...PACKS].sort(), [
      'dnd-players-handbook.classes',
      'dnd-players-handbook.equipment',
      'dnd-players-handbook.feats',
      'dnd-players-handbook.origins',
      'dnd-players-handbook.spells',
    ]);
  });

  test('a second run changes nothing: no diff, no set, no new user', async () => {
    const game = fakeGame();
    await runSetup(game);
    const setsAfterFirst = game.sets.length;
    const usersAfterFirst = game.users.length;
    const second = await runSetup(game);
    assert.deepEqual(second.changes, []);
    assert.deepEqual(second.done, []);
    assert.equal(game.sets.length, setsAfterFirst);
    assert.equal(game.users.length, usersAfterFirst);
    assert.deepEqual(second.wrong, []);
  });

  test('only what differs changes: settings that are right already are left alone', async () => {
    const sources = { ...SOURCES, items: ['x.items'], extra: ['x.extra'] };
    const flags = { ...FLAGS, enableSpellSelection: false };
    const run = await runSetup(
      fakeGame({ actorCreate: [1, 2, 4], sources, flags, users: [kitUser()] })
    );
    assert.deepEqual(run.done, ['enableSpellSelection = true']);
    assert.deepEqual(run.after.values.compendiumSources, sources);
    assert.deepEqual(run.after.actorCreate, [1, 2, 4]);
    assert.equal(run.after.users.length, 1);
  });

  test('a role that was in ACTOR_CREATE stays when the Player roles are added', async () => {
    const run = await runSetup(fakeGame({ actorCreate: [2, 3] }));
    assert.deepEqual(run.after.actorCreate, [1, 2, 3]);
    assert.deepEqual(run.wrong, []);
  });

  test('turns usage-tracking off for each user who has it saved as anything but false', async () => {
    const docs = [
      settingDoc(TRACKING, 'u1', true),
      settingDoc(TRACKING, 'u2', 'yes'),
      settingDoc(TRACKING, 'u3', false),
      settingDoc(TRACKING, null, true), // not a per-user value: left alone
      settingDoc(`${MODULE_ID}.other`, 'u1', true),
    ];
    const run = await runSetup(fakeGame({ docs }));
    assert.equal(run.before.trackingOn, 2);
    assert.ok(run.done.includes('usage-tracking off for 2 user(s)'), run.done.join(', '));
    assert.deepEqual(
      docs.map(d => d.updates),
      [1, 1, 0, 0, 0]
    );
    assert.equal(run.after.trackingOn, 0);
    assert.deepEqual(run.wrong, []);
    assert.match(
      mismatches(run.after, { ...run.after, trackingOn: 1 }).join('; '),
      /usage-tracking is still on for 1 user\(s\)/
    );
  });

  test('without the usage-tracking setting registered, tracking is null and not touched', async () => {
    const docs = [settingDoc(TRACKING, 'u1', true)];
    const run = await runSetup(fakeGame({ tracking: false, docs }));
    assert.equal(run.before.trackingOn, null);
    assert.ok(!run.done.some(c => c.startsWith('usage-tracking')), run.done.join(', '));
    assert.equal(docs[0].updates, 0);
  });

  test('blockers name every reason the setup cannot run', () => {
    installGlobals(
      fakeGame({
        world: 'curse-of-strahd',
        isGM: false,
        moduleActive: false,
        phbActive: false,
        packs: [],
        users: [kitUser(), kitUser({ id: 'two' })],
      })
    );
    const problems = blockers(readState(ARGS), 'strahd-kit', 'setup').join('; ');
    assert.match(problems, /joined world curse-of-strahd, expected strahd-kit/);
    assert.match(problems, /Gamemaster is not a GM/);
    assert.match(problems, /foundryvtt-actor-studio module is not active/);
    assert.match(problems, /dnd-players-handbook module is not active/);
    assert.match(problems, /the compendium dnd-players-handbook\.equipment is not in this world/);
    assert.match(problems, /more than one user is named Kit Player/);
  });

  test('blockers name a setting Actor Studio did not register, and a missing pack on its own', () => {
    installGlobals(fakeGame({ unregistered: ['allowRolling'], packs: PACKS.slice(1) }));
    const problems = blockers(readState(ARGS), 'strahd-kit', 'setup');
    assert.equal(problems.length, 2, problems.join('; '));
    assert.match(problems.join('; '), /did not register allowRolling/);
    assert.match(
      problems.join('; '),
      /the compendium dnd-players-handbook\.\w+ is not in this world/
    );
  });

  test('a good world has no blockers; the teardown needs only the right world and a GM', () => {
    installGlobals(fakeGame());
    assert.deepEqual(blockers(readState(ARGS), 'strahd-kit', 'setup'), []);
    installGlobals(fakeGame({ moduleActive: false, phbActive: false, packs: [], world: 'other' }));
    const state = readState(ARGS);
    assert.deepEqual(blockers(state, 'strahd-kit', 'teardown'), [
      'joined world other, expected strahd-kit',
    ]);
  });

  test('an existing Kit Player must be a Player who joins without a password', () => {
    assert.deepEqual(playerUserProblems(kitUser(), true), []);
    assert.match(playerUserProblems(kitUser({ role: 4 }), true).join('; '), /role 4, not Player/);
    assert.match(
      playerUserProblems(kitUser(), false).join('; '),
      /could not join without a password/
    );
    assert.equal(playerUserProblems(kitUser({ role: 2 }), false).length, 2);
  });

  test('settingsDiff lists the permissions only when a Player role is missing, and the sources by kind', () => {
    installGlobals(fakeGame({ actorCreate: [1, 2, 4], sources: { ...SOURCES, spells: [] } }));
    const changes = settingsDiff(readState(ARGS));
    assert.ok(!changes.some(c => c.kind === 'permissions'));
    const sources = changes.find(c => c.key === 'compendiumSources');
    assert.equal(sources.label, 'compendiumSources (spells)');
    assert.deepEqual(sources.value, SOURCES);
  });

  test('mismatches catch a lost role, a changed source, a wrong flag and a missing or wrong user', async () => {
    const run = await runSetup(fakeGame());
    const wrongAfter = {
      ...run.after,
      actorCreate: [1, 4],
      values: {
        ...run.after.values,
        allowRolling: true,
        compendiumSources: { ...run.after.values.compendiumSources, spells: [], items: [] },
      },
      users: [],
    };
    const problems = mismatches(run.before, wrongAfter).join('; ');
    assert.match(problems, /ACTOR_CREATE lacks role 2/);
    assert.match(problems, /ACTOR_CREATE lost role 3/);
    assert.match(problems, /allowRolling is true, not false/);
    assert.match(problems, /compendiumSources\.spells is \[\]/);
    assert.match(problems, /another compendium source changed/);
    assert.match(problems, /0 users are named Kit Player, expected 1/);
    const wrongRole = mismatches(run.before, { ...run.after, users: [kitUser({ role: 4 })] });
    assert.match(wrongRole.join('; '), /Kit Player has role 4, not Player/);
  });
});

describe('kit-session.mjs teardown (the in-browser part)', () => {
  before(() => {
    globalThis.CONST = {
      USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
      DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER },
    };
  });
  after(() => {
    delete globalThis.game;
    delete globalThis.CONST;
  });

  // One Kit Player, two actors it owns, and actors it must not lose.
  const world = () =>
    fakeGame({
      users: [kitUser(), { id: 'userGm', name: 'Gamemaster', role: 4 }],
      actors: [
        actor('a1', 'Mine one', { default: 0, userKit: OWNER }),
        actor('a2', 'Mine two', { userKit: OWNER, userGm: OWNER }),
        actor('a3', 'Only observed', { userKit: 2 }),
        actor('a4', 'GM only', { default: 0, userGm: OWNER }),
        actor('a5', 'Everyone observes', { default: 2 }),
        actor('a6', 'No ownership at all'),
      ],
    });

  test('only actors where Kit Player is an explicit OWNER count', () => {
    globalThis.game = world();
    const state = readState(ARGS);
    assert.deepEqual(
      state.ownedActors.map(a => a.id),
      ['a1', 'a2']
    );
    assert.deepEqual(state.users, [{ id: 'userKit', name: PLAYER_NAME, role: 1 }]);
  });

  test('without a Kit Player there are no users and no actors to find', () => {
    globalThis.game = fakeGame({
      users: [{ id: 'userGm', name: 'Gamemaster', role: 4 }],
      actors: [actor('a1', 'Someone', { userGm: OWNER })],
    });
    const state = readState(ARGS);
    assert.deepEqual(state.users, []);
    assert.deepEqual(state.ownedActors, []);
    assert.deepEqual(teardownProblems(state, 5), []);
  });

  test('deletes the owned actors and the user, nothing else, and the read-back is clean', async () => {
    const game = world();
    globalThis.game = game;
    const before = readState(ARGS);
    assert.deepEqual(teardownProblems(before, 5), []);
    const res = await deleteKit({
      playerName: PLAYER_NAME,
      userId: before.users[0].id,
      actorIds: before.ownedActors.map(a => a.id),
    });
    assert.equal(res.actors, 2);
    assert.deepEqual(
      game.actors.map(a => a.id),
      ['a3', 'a4', 'a5', 'a6']
    );
    assert.deepEqual(
      game.users.map(u => u.name),
      ['Gamemaster']
    );
    assert.deepEqual(game.sets, [], 'no setting is touched');
    const ids = before.ownedActors.map(a => a.id);
    const after = readState({ ...ARGS, actorIds: ids });
    assert.deepEqual(after.leftActors, []);
    assert.deepEqual(teardownMismatches(before, after), []);
  });

  test('the read-back complains when the user or an actor is still there', () => {
    globalThis.game = world();
    const before = readState(ARGS);
    const ids = before.ownedActors.map(a => a.id);
    const problems = teardownMismatches(before, readState({ ...ARGS, actorIds: ids })).join('; ');
    assert.match(problems, /Kit Player still exists/);
    assert.match(problems, /Mine one \(a1\) was not deleted/);
    assert.match(problems, /Mine two \(a2\) was not deleted/);
  });

  test('the read-back finds an actor that is left although the user is gone', async () => {
    const game = world();
    globalThis.game = game;
    const before = readState(ARGS);
    const ids = before.ownedActors.map(a => a.id);
    // The user is deleted and a1 too, but a2 is still there (a delete that did not take).
    await game.actors.get('a1').delete();
    await game.users.get('userKit').delete();
    const after = readState({ ...ARGS, actorIds: ids });
    assert.deepEqual(after.users, []);
    assert.deepEqual(after.ownedActors, [], 'the owner is gone, so ownership alone finds nothing');
    assert.deepEqual(after.leftActors, ['a2']);
    assert.deepEqual(teardownMismatches(before, after), ['Mine two (a2) was not deleted']);
    // A read-back that never looked up the ids is not accepted as clean.
    const blind = { ...after, leftActors: undefined };
    assert.match(
      teardownMismatches(before, blind).join('; '),
      /did not look up the deleted actors/
    );
  });

  test('more actors than the limit, or a user that is not a Player, are refused', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      actor(`m${i}`, `Hero ${i}`, { userKit: OWNER })
    );
    globalThis.game = fakeGame({ users: [kitUser()], actors: many });
    const state = readState(ARGS);
    assert.match(teardownProblems(state, 5).join('; '), /owns 6 actors, more than the limit of 5/);
    assert.match(teardownProblems(state, 5).join('; '), /Hero 0, Hero 1/);
    assert.deepEqual(teardownProblems(state, 6), []);
    globalThis.game = fakeGame({ users: [kitUser({ role: 4 })] });
    assert.match(
      teardownProblems(readState(ARGS), 5).join('; '),
      /role 4, not Player \(1\): refusing to delete it/
    );
  });

  test('parseMaxDelete: 5 by default, a whole number from 1, nothing else', () => {
    assert.equal(parseMaxDelete(undefined), 5);
    assert.equal(parseMaxDelete(''), 5);
    assert.equal(parseMaxDelete('12'), 12);
    for (const bad of ['0', '-1', 'lots', '1.5', ' 3', '10000']) {
      assert.throws(() => parseMaxDelete(bad), /MAX_DELETE must be a whole number from 1/, bad);
    }
  });

  test('deleteKit looks again: a wrong user, a wrong role or an actor it does not own deletes nothing', async () => {
    const game = world();
    globalThis.game = game;
    await assert.rejects(
      deleteKit({ playerName: PLAYER_NAME, userId: 'userGm', actorIds: [] }),
      /is not Kit Player/
    );
    await assert.rejects(
      deleteKit({ playerName: PLAYER_NAME, userId: 'userKit', actorIds: ['a1', 'a4'] }),
      /actor a4 is not owned by Kit Player/
    );
    await assert.rejects(
      deleteKit({ playerName: PLAYER_NAME, userId: 'userKit', actorIds: ['a1', 'nope'] }),
      /actor nope is not owned/
    );
    game.users.get('userKit').role = 4;
    await assert.rejects(
      deleteKit({ playerName: PLAYER_NAME, userId: 'userKit', actorIds: ['a1'] }),
      /is not a Player \(role 4\)/
    );
    assert.equal(game.actors.length, 6);
    assert.equal(game.users.length, 2);
  });

  test('createPlayer makes a Player with no password field, and refuses a second one', async () => {
    const game = fakeGame();
    installGlobals(game);
    const created = [];
    globalThis.User.implementation.create = async data => {
      created.push(data);
      game.users.push({ id: 'new', ...data });
    };
    await createPlayer({ playerName: PLAYER_NAME });
    assert.deepEqual(created, [{ name: PLAYER_NAME, role: 1 }]);
    assert.ok(!('password' in created[0]));
    await assert.rejects(createPlayer({ playerName: PLAYER_NAME }), /exists already/);
  });
});

test("the stage never lets root chown, chmod, install or write through a path in the foundry user's folder", () => {
  const src = readFileSync(path.join(repo, 'scripts', 'pi', 'remote', 'kit-session.sh'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*#/.test(l));
  const bad = code.filter(
    l =>
      /\b(chown|chmod|install|ln|touch|tee)\b/.test(l) &&
      /\$(\{?)(KIT_GM_PROFILE|TOOL_DATA|STATE)\b/.test(l) &&
      !/runuser/.test(l)
  );
  assert.deepEqual(bad, []);
  assert.ok(
    code.some(l => l.includes('runuser -u "$FOUNDRY_USER" -- mkdir -m 700 "$KIT_GM_PROFILE"')),
    'the profile folder is made by the foundry user'
  );
  assert.ok(!code.some(l => /install -d .*-o .*KIT_GM_PROFILE/.test(l)));
  assert.ok(code.some(l => l.includes('mktemp "$TOOL_ETC/.kit-gm.XXXXXX"')));
});

describe('kit-session.mjs, the Kit GM (the in-browser part)', () => {
  before(() => {
    globalThis.CONST = {
      USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
      DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER },
    };
  });
  after(() => {
    delete globalThis.game;
    delete globalThis.CONST;
    delete globalThis.User;
  });

  const PASSWORD = '0123456789abcdef0123456789abcdef';
  const gmUser = (over = {}) => ({ id: 'userKitGm', name: GM_NAME, role: 4, ...over });
  const PROVISION = { moduleId: BRIDGE_MODULE, gmName: GM_NAME, role: GM_ROLE, password: PASSWORD };
  const DELETE = {
    moduleId: BRIDGE_MODULE,
    gmName: GM_NAME,
    userId: 'userKitGm',
    anyGm: ANY_GM_CHOICE,
  };
  const use = game => {
    installGlobals(game);
    return game;
  };

  test('readState reports the Kit GM users, who joined, and the bridge module and its user', () => {
    const game = use(
      fakeGame({
        users: [gmUser({ active: true }), { id: 'u2', name: 'Gamemaster', role: 4 }],
        bridgeUserId: 'userKitGm',
      })
    );
    const state = readState(ARGS);
    assert.deepEqual(state.kitGm, [{ id: 'userKitGm', name: GM_NAME, role: 4, active: true }]);
    assert.equal(state.userId, game.user.id);
    assert.equal(state.bridgeModuleInstalled, true);
    assert.equal(state.bridgeModuleActive, true);
    assert.equal(state.bridgeUserId, 'userKitGm');
    // An inactive module registers no setting: the bridge user reads as null, not as an error.
    use(fakeGame({ bridgeActive: false }));
    const off = readState(ARGS);
    assert.equal(off.bridgeModuleInstalled, true);
    assert.equal(off.bridgeModuleActive, false);
    assert.equal(off.bridgeUserId, null);
    assert.deepEqual(off.kitGm, []);
    use(fakeGame({ bridgeInstalled: false, bridgeActive: false }));
    assert.equal(readState(ARGS).bridgeModuleInstalled, false);
  });

  test('blockers: two Kit GMs, a stage joined as Kit GM, and a bridge module that is not installed', () => {
    use(fakeGame({ users: [gmUser(), gmUser({ id: 'two' })] }));
    assert.match(
      blockers(readState(ARGS), 'strahd-kit', 'setup').join('; '),
      /more than one user is named Kit GM/
    );
    assert.match(
      blockers(readState(ARGS), 'strahd-kit', 'teardown').join('; '),
      /more than one user is named Kit GM/
    );
    use(fakeGame({ userName: GM_NAME }));
    for (const action of ['setup', 'teardown']) {
      assert.match(
        blockers(readState(ARGS), 'strahd-kit', action).join('; '),
        /joined as Kit GM itself/
      );
    }
    use(fakeGame({ bridgeInstalled: false, bridgeActive: false }));
    assert.match(
      blockers(readState(ARGS), 'strahd-kit', 'setup').join('; '),
      /foundry-mcp-bridge module is not installed/
    );
    // The teardown has no use for the module, and an installed but inactive module is enabled by the setup.
    assert.deepEqual(blockers(readState(ARGS), 'strahd-kit', 'teardown'), []);
    use(fakeGame({ bridgeActive: false }));
    assert.deepEqual(blockers(readState(ARGS), 'strahd-kit', 'setup'), []);
  });

  test('parseKitGmPassword takes 32 lowercase hex characters and nothing else, and never repeats the value', () => {
    assert.equal(parseKitGmPassword(PASSWORD), PASSWORD);
    const bad = [
      undefined,
      '',
      PASSWORD.toUpperCase(),
      `${PASSWORD}0`,
      PASSWORD.slice(1),
      'g'.repeat(32),
    ];
    for (const value of [...bad, 'tooSecretToPrint']) {
      assert.throws(
        () => parseKitGmPassword(value),
        error => {
          assert.match(
            error.message,
            /KIT_GM_PASSWORD is not set, or is not 32 lowercase hexadecimal/
          );
          if (value) assert.ok(!error.message.includes(value), 'the value is not in the error');
          return true;
        }
      );
    }
  });

  test('an existing Kit GM is refused while online or above Game Master, and updated otherwise', () => {
    assert.deepEqual(kitGmUserProblems(gmUser()), []);
    assert.deepEqual(kitGmUserProblems(gmUser({ role: 3 })), []);
    assert.match(kitGmUserProblems(gmUser({ active: true })).join('; '), /online right now/);
    assert.match(kitGmUserProblems(gmUser({ role: 5 })).join('; '), /role 5, above Game Master/);
    assert.equal(kitGmUserProblems(gmUser({ role: 5, active: true })).length, 2);
  });

  test('enableBridgeModule turns the module on and keeps the other modules as they are', async () => {
    const game = use(fakeGame({ bridgeActive: false }));
    game.settings.get = (ns, key) =>
      ns === 'core' && key === 'moduleConfiguration'
        ? { other: true, [BRIDGE_MODULE]: false }
        : undefined;
    const written = [];
    const realSet = game.settings.set;
    game.settings.set = async (ns, key, value) => {
      written.push([ns, key, value]);
      return realSet(ns, key, value);
    };
    await enableBridgeModule({ moduleId: BRIDGE_MODULE });
    assert.deepEqual(written, [
      ['core', 'moduleConfiguration', { other: true, [BRIDGE_MODULE]: true }],
    ]);
  });

  test('provisionKitGm makes Kit GM a Game Master with the password and makes it the bridge user', async () => {
    const game = use(fakeGame({ users: [{ id: 'userGm', name: 'Gamemaster', role: 4 }] }));
    const made = await provisionKitGm(PROVISION);
    const user = game.users.find(u => u.name === GM_NAME);
    assert.equal(made.id, user.id);
    assert.equal(user.role, 4);
    assert.equal(user.password, PASSWORD);
    assert.equal(game.users.length, 2);
    assert.deepEqual(game.sets, [`${BRIDGE_MODULE}.bridgeUserId`]);
    const state = readState(ARGS);
    assert.equal(state.bridgeUserId, user.id);
    assert.deepEqual(kitGmMismatches(state), []);
    assert.equal(JSON.stringify(made).includes(PASSWORD), false, 'the password is not returned');
  });

  test('a second provision updates the same user: role and password, no second user', async () => {
    const game = use(fakeGame({ users: [gmUser({ role: 3, password: 'old' })] }));
    await provisionKitGm(PROVISION);
    assert.equal(game.users.length, 1);
    assert.equal(game.users[0].role, 4);
    assert.equal(game.users[0].password, PASSWORD);
    assert.equal(readState(ARGS).bridgeUserId, 'userKitGm');
    await provisionKitGm({ ...PROVISION, password: 'f'.repeat(32) });
    assert.equal(game.users.length, 1);
    assert.equal(game.users[0].password, 'f'.repeat(32));
  });

  test('provisionKitGm looks again and refuses: online, above Game Master, two users, module not active', async () => {
    for (const [users, extra, reason] of [
      [[gmUser({ active: true })], {}, /online right now/],
      [[gmUser({ role: 5 })], {}, /role 5, above 4/],
      [[gmUser(), gmUser({ id: 'two' })], {}, /more than one user is named Kit GM/],
      [[], { bridgeActive: false }, /foundry-mcp-bridge is not active/],
    ]) {
      const game = use(fakeGame({ users, ...extra }));
      const snapshot = JSON.stringify(game.users);
      await assert.rejects(provisionKitGm(PROVISION), reason);
      assert.equal(JSON.stringify(game.users), snapshot, 'no user changed');
      assert.deepEqual(game.sets, [], 'no setting changed');
    }
  });

  test('kitGmMismatches: one Game Master Kit GM, the module active and Kit GM as the bridge user', () => {
    const good = {
      kitGm: [gmUser()],
      bridgeModuleActive: true,
      bridgeUserId: 'userKitGm',
    };
    assert.deepEqual(kitGmMismatches(good), []);
    assert.match(
      kitGmMismatches({ ...good, kitGm: [] }).join('; '),
      /0 users are named Kit GM, expected 1/
    );
    assert.match(
      kitGmMismatches({ ...good, kitGm: [gmUser(), gmUser({ id: 'two' })] }).join('; '),
      /2 users are named Kit GM, expected 1/
    );
    assert.match(
      kitGmMismatches({ ...good, kitGm: [gmUser({ role: 3 })] }).join('; '),
      /Kit GM has role 3, not Game Master \(4\)/
    );
    assert.match(
      kitGmMismatches({ ...good, bridgeModuleActive: false }).join('; '),
      /foundry-mcp-bridge module is not active/
    );
    assert.match(
      kitGmMismatches({ ...good, bridgeUserId: ANY_GM_CHOICE }).join('; '),
      /the bridge user is "", not Kit GM/
    );
    assert.match(
      kitGmMismatches({ ...good, bridgeUserId: null }).join('; '),
      /bridge user is null/
    );
  });

  test('kitGmTeardownProblems: nothing without a Kit GM; wrong name, role, own user or online are refused', () => {
    const state = (kitGm, userId = 'userGm') => ({ kitGm, userId });
    assert.deepEqual(kitGmTeardownProblems(state([])), []);
    assert.deepEqual(kitGmTeardownProblems(state([gmUser()])), []);
    assert.match(
      kitGmTeardownProblems(state([gmUser({ role: 3 })])).join('; '),
      /role 3, not Game Master \(4\): refusing to delete it/
    );
    assert.match(
      kitGmTeardownProblems(state([gmUser({ role: 1 })])).join('; '),
      /refusing to delete it/
    );
    assert.match(
      kitGmTeardownProblems(state([gmUser()], 'userKitGm')).join('; '),
      /the user this run joined as/
    );
    assert.match(
      kitGmTeardownProblems(state([gmUser({ active: true })])).join('; '),
      /online right now/
    );
    assert.match(
      kitGmTeardownProblems(state([gmUser({ name: 'Kit GM 2' })])).join('; '),
      /is not named Kit GM/
    );
  });

  test('deleteKitGm puts the bridge user back on Any GM and deletes the user', async () => {
    const game = use(
      fakeGame({
        users: [gmUser(), { id: 'userGm', name: 'Gamemaster', role: 4 }],
        bridgeUserId: 'userKitGm',
      })
    );
    await deleteKitGm(DELETE);
    assert.deepEqual(game.sets, [`${BRIDGE_MODULE}.bridgeUserId`]);
    assert.equal(game.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ANY_GM_CHOICE);
    assert.deepEqual(
      game.users.map(u => u.name),
      ['Gamemaster']
    );
    const after = readState(ARGS);
    assert.deepEqual(kitGmTeardownMismatches({ kitGm: [gmUser()] }, after), []);
  });

  test('deleteKitGm leaves another bridge user alone, and an unregistered setting untouched', async () => {
    const other = use(fakeGame({ users: [gmUser()], bridgeUserId: 'someoneElse' }));
    await deleteKitGm(DELETE);
    assert.deepEqual(other.sets, []);
    assert.equal(other.settings.get(BRIDGE_MODULE, 'bridgeUserId'), 'someoneElse');
    assert.equal(other.users.length, 0);
    const off = use(fakeGame({ users: [gmUser()], bridgeActive: false }));
    await deleteKitGm(DELETE);
    assert.deepEqual(off.sets, []);
    assert.equal(off.users.length, 0);
  });

  test('deleteKitGm looks again: wrong user, wrong role, its own user or an online user deletes nothing', async () => {
    for (const [users, args, reason] of [
      [[gmUser()], { userId: 'nope' }, /is not Kit GM/],
      [
        [gmUser(), { id: 'userGm', name: 'Gamemaster', role: 4 }],
        { userId: 'userGm' },
        /is not Kit GM/,
      ],
      [[gmUser({ role: 3 })], {}, /not a Game Master \(role 3\)/],
      [[gmUser({ id: 'userGm' })], { userId: 'userGm' }, /user this page joined as/],
      [[gmUser({ active: true })], {}, /online right now/],
    ]) {
      const game = use(fakeGame({ users, bridgeUserId: 'userKitGm' }));
      const snapshot = users.length;
      await assert.rejects(deleteKitGm({ ...DELETE, ...args }), reason);
      assert.equal(game.users.length, snapshot, 'no user deleted');
      assert.deepEqual(game.sets, [], 'the bridge user is not touched');
    }
  });

  test('kitGmTeardownMismatches: gone, and no longer the bridge user', () => {
    const before = { kitGm: [gmUser()] };
    assert.deepEqual(kitGmTeardownMismatches(before, { kitGm: [], bridgeUserId: '' }), []);
    assert.deepEqual(kitGmTeardownMismatches(before, { kitGm: [], bridgeUserId: null }), []);
    assert.deepEqual(kitGmTeardownMismatches({ kitGm: [] }, { kitGm: [], bridgeUserId: 'x' }), []);
    const problems = kitGmTeardownMismatches(before, {
      kitGm: [gmUser()],
      bridgeUserId: 'userKitGm',
    }).join('; ');
    assert.match(problems, /Kit GM still exists/);
    assert.match(problems, /the bridge user is still the deleted Kit GM/);
  });

  test('the whole round trip: setup creates the Kit GM, a second setup keeps one, teardown removes it again', async () => {
    const game = use(fakeGame({ users: [{ id: 'userGm', name: 'Gamemaster', role: 4 }] }));
    const before = readState(ARGS);
    assert.deepEqual(blockers(before, 'strahd-kit', 'setup'), []);
    await provisionKitGm(PROVISION);
    await provisionKitGm(PROVISION);
    const after = readState(ARGS);
    assert.deepEqual(kitGmMismatches(after), []);
    assert.equal(game.users.filter(u => u.name === GM_NAME).length, 1);
    const teardown = readState(ARGS);
    assert.deepEqual(kitGmTeardownProblems(teardown), []);
    await deleteKitGm({ ...DELETE, userId: teardown.kitGm[0].id });
    const gone = readState(ARGS);
    assert.deepEqual(kitGmTeardownMismatches(teardown, gone), []);
    assert.equal(gone.bridgeUserId, ANY_GM_CHOICE);
    assert.deepEqual(
      game.users.map(u => u.name),
      ['Gamemaster']
    );
  });

  test('a teardown with both a Kit Player and a Kit GM removes both, and nothing else', async () => {
    const game = use(
      fakeGame({
        users: [kitUser(), gmUser(), { id: 'userGm', name: 'Gamemaster', role: 4 }],
        actors: [actor('a1', 'Mine', { userKit: OWNER }), actor('a2', 'Theirs', { userGm: OWNER })],
        bridgeUserId: 'userKitGm',
      })
    );
    const before = readState(ARGS);
    assert.deepEqual(teardownProblems(before, 5), []);
    assert.deepEqual(kitGmTeardownProblems(before), []);
    const actorIds = before.ownedActors.map(a => a.id);
    await deleteKit({ playerName: PLAYER_NAME, userId: before.users[0].id, actorIds });
    await deleteKitGm({ ...DELETE, userId: before.kitGm[0].id });
    const after = readState({ ...ARGS, actorIds });
    assert.deepEqual(teardownMismatches(before, after), []);
    assert.deepEqual(kitGmTeardownMismatches(before, after), []);
    assert.deepEqual(
      game.users.map(u => u.name),
      ['Gamemaster']
    );
    assert.deepEqual(
      game.actors.map(a => a.id),
      ['a2']
    );
  });

  const ID_A = 'AbCdEfGh01234567';
  const ID_B = 'ZyXwVuTs76543210';

  test('originalBridgeUser: the user id the setup replaced, Any GM when empty or unregistered, never the Kit GM itself', () => {
    assert.equal(originalBridgeUser(ID_A, 'userKitGm'), ID_A);
    assert.equal(originalBridgeUser('', undefined), '');
    assert.equal(originalBridgeUser(null, undefined), '');
    assert.equal(
      originalBridgeUser(ID_A, ID_A),
      '',
      'the Kit GM of a cut-off session is not worth restoring'
    );
    for (const bad of ['../etc', 'short', 'x'.repeat(17), 'has space 1234567', 42]) {
      assert.throws(
        () => originalBridgeUser(bad, undefined),
        /which is not a user id/,
        String(bad)
      );
    }
  });

  test('originalBridgeUser: after a cut-off run (the Kit GM is the bridge user) the single Assistant GM stands in', () => {
    assert.equal(originalBridgeUser(ID_A, ID_A, [ID_B]), ID_B);
    assert.equal(originalBridgeUser(ID_A, ID_A, []), '', 'no Assistant GM: Any GM');
    assert.equal(
      originalBridgeUser(ID_A, ID_A, [ID_B, 'QrStUvWx98765432']),
      '',
      'two of them: not a guess'
    );
    assert.equal(
      originalBridgeUser(ID_A, ID_A, ['../etc']),
      '',
      'what is not a user id is dropped'
    );
    // Not the Kit GM: the setting is what it is, whoever the Assistant GMs are.
    assert.equal(originalBridgeUser(ID_B, ID_A, [ID_B]), ID_B);
    assert.equal(originalBridgeUser('', ID_A, [ID_B]), '');
  });

  test('readState lists the Assistant GM users with role 3 or above as assistantGms', () => {
    use(
      fakeGame({
        users: [
          { id: 'asst', name: 'Assistant GM', role: 3 },
          { id: 'asstGm', name: 'Assistant GM', role: 4 },
          { id: 'asstPlayer', name: 'Assistant GM', role: 1 },
          { id: 'other', name: 'Someone', role: 4 },
        ],
      })
    );
    assert.deepEqual(readState(ARGS).assistantGms, ['asst', 'asstGm']);
  });

  test('parseOrigBridgeUser: unset stays unset (the old state file), empty and an id pass, nothing else does', () => {
    assert.equal(parseOrigBridgeUser(undefined), undefined);
    assert.equal(parseOrigBridgeUser(''), '');
    assert.equal(parseOrigBridgeUser(ID_A), ID_A);
    for (const bad of ['../etc', ID_A + 'x', ' ' + ID_A, 'a b']) {
      assert.throws(
        () => parseOrigBridgeUser(bad),
        /ORIG_BRIDGE_USER must be a 16 character user id/
      );
    }
  });

  test('bridgeRestoreTarget: the original user when it still exists as a GM, else Any GM', () => {
    const state = (gmIds, kitGm = [gmUser()]) => ({ gmIds, kitGm });
    assert.equal(bridgeRestoreTarget(state([ID_A, 'userKitGm']), ID_A), ID_A);
    assert.equal(
      bridgeRestoreTarget(state(['userKitGm']), ID_A),
      '',
      'the user is gone or below role 3'
    );
    assert.equal(bridgeRestoreTarget(state([ID_A]), ''), '');
    assert.equal(bridgeRestoreTarget(state([ID_A]), undefined), '', 'no ORIG_BRIDGE_USER: Any GM');
    assert.equal(
      bridgeRestoreTarget(state(['userKitGm']), 'userKitGm'),
      '',
      'never the deleted Kit GM'
    );
    assert.equal(bridgeRestoreTarget(state([ID_A], []), ID_A), '');
  });

  test('readState lists the users with role 3 or above as gmIds', () => {
    use(
      fakeGame({
        users: [
          gmUser(),
          { id: 'asst', name: 'Assistant GM', role: 3 },
          { id: 'trusted', name: 'T', role: 2 },
          kitUser(),
        ],
      })
    );
    assert.deepEqual(readState(ARGS).gmIds, ['userKitGm', 'asst']);
  });

  test('deleteKitGm puts the bridge user back to the original GM; a user that is gone or below role 3 becomes Any GM', async () => {
    const world = (extra, bridgeUserId = 'userKitGm') =>
      use(fakeGame({ users: [gmUser(), ...extra], bridgeUserId }));
    const back = world([{ id: ID_A, name: 'Assistant GM', role: 3 }]);
    await deleteKitGm({ ...DELETE, bridgeTo: ID_A });
    assert.equal(back.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ID_A);
    assert.equal(
      back.users.some(u => u.name === GM_NAME),
      false
    );
    const gone = world([]);
    await deleteKitGm({ ...DELETE, bridgeTo: ID_A });
    assert.equal(gone.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ANY_GM_CHOICE);
    const player = world([{ id: ID_A, name: 'Pat', role: 1 }]);
    await deleteKitGm({ ...DELETE, bridgeTo: ID_A });
    assert.equal(player.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ANY_GM_CHOICE);
    const kitself = world([]);
    await deleteKitGm({ ...DELETE, bridgeTo: 'userKitGm' });
    assert.equal(kitself.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ANY_GM_CHOICE);
    // Not given: Any GM, as before.
    const plain = world([{ id: ID_A, name: 'Assistant GM', role: 3 }]);
    await deleteKitGm(DELETE);
    assert.equal(plain.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ANY_GM_CHOICE);
    // Another bridge user stays whatever bridgeTo says.
    const other = world([{ id: ID_A, name: 'Assistant GM', role: 3 }], ID_B);
    await deleteKitGm({ ...DELETE, bridgeTo: ID_A });
    assert.equal(other.settings.get(BRIDGE_MODULE, 'bridgeUserId'), ID_B);
  });

  test('kitGmTeardownMismatches checks the bridge user against where it had to go back to', () => {
    const before = { kitGm: [gmUser()], bridgeUserId: 'userKitGm' };
    const after = bridgeUserId => ({ kitGm: [], bridgeUserId });
    assert.deepEqual(kitGmTeardownMismatches(before, after(ID_A), ID_A), []);
    assert.deepEqual(kitGmTeardownMismatches(before, after(''), ''), []);
    assert.deepEqual(kitGmTeardownMismatches(before, after(null), ''), []);
    assert.match(
      kitGmTeardownMismatches(before, after(''), ID_A).join('; '),
      /the bridge user is "", expected "AbCdEfGh01234567"/
    );
    assert.match(kitGmTeardownMismatches(before, after(ID_B), ID_A).join('; '), /expected/);
    // Another bridge user before: not touched, not checked.
    assert.deepEqual(
      kitGmTeardownMismatches({ ...before, bridgeUserId: ID_B }, after(ID_B), ID_A),
      []
    );
    // Without bridgeTo (the old call) only "no longer the Kit GM" is checked.
    assert.deepEqual(kitGmTeardownMismatches(before, after('')), []);
  });

  test('log lines have the secrets cut out; a short value is not registered', () => {
    addSecret('s3cretValueOfTheRun');
    addSecret('short');
    addSecret('');
    assert.equal(redact('join failed: s3cretValueOfTheRun typed'), 'join failed: *** typed');
    assert.equal(redact('a short word'), 'a short word');
    assert.equal(redact(new Error('x s3cretValueOfTheRun x')), 'Error: x *** x');
  });

  test('joinsWithPassword types the password into the form, says whether the game opened, and never repeats it', async () => {
    const calls = [];
    const page = ({ opens, breaks }) => ({
      goto: async url => calls.push(['goto', url]),
      keyboard: { press: async key => calls.push(['press', key]) },
      locator: sel => ({
        fill: async value => {
          calls.push(['fill', sel, value]);
          if (breaks && sel === '#join-password') throw new Error(`fill ${value} failed`);
        },
        click: async () => calls.push(['click', sel]),
      }),
      waitForURL: async () => {
        if (!opens) throw new Error('timeout');
      },
    });
    const options = { url: 'http://x:30000', user: GM_NAME, password: PASSWORD };
    assert.equal(await joinsWithPassword(page({ opens: true }), options), true);
    assert.deepEqual(calls, [
      ['goto', 'http://x:30000/join'],
      ['fill', '#join-username', GM_NAME],
      ['press', 'Escape'],
      ['fill', '#join-password', PASSWORD],
      ['click', 'button[name="join"]'],
    ]);
    assert.equal(await joinsWithPassword(page({ opens: false }), options), false);
    await assert.rejects(joinsWithPassword(page({ opens: true, breaks: true }), options), error => {
      assert.ok(!error.message.includes(PASSWORD), 'the password is not in the error');
      assert.match(error.message, /did not take the login of Kit GM/);
      return true;
    });
  });
});

describe('kit-session.mjs, the browser side and the script', () => {
  // A page that records what is done to it; waitForURL answers like the game opening, or not.
  const fakePage = ({ opens }) => {
    const calls = [];
    return {
      calls,
      goto: async url => calls.push(['goto', url]),
      keyboard: { press: async key => calls.push(['press', key]) },
      locator: sel => ({
        fill: async value => calls.push(['fill', sel, value]),
        click: async () => calls.push(['click', sel]),
      }),
      waitForURL: async () => {
        if (!opens) throw new Error('timeout');
      },
    };
  };

  test('joinsWithoutPassword fills an empty password and says whether the game opened', async () => {
    const yes = fakePage({ opens: true });
    assert.equal(
      await joinsWithoutPassword(yes, { url: 'http://x:30000', user: PLAYER_NAME }),
      true
    );
    assert.deepEqual(yes.calls, [
      ['goto', 'http://x:30000/join'],
      ['fill', '#join-username', PLAYER_NAME],
      ['press', 'Escape'],
      ['fill', '#join-password', ''],
      ['click', 'button[name="join"]'],
    ]);
    const no = fakePage({ opens: false });
    assert.equal(
      await joinsWithoutPassword(no, { url: 'http://x:30000', user: PLAYER_NAME }),
      false
    );
  });

  test('run as a script (also through a symlinked folder), main() runs and stops on a missing ACTION or TOOL_APP', () => {
    const script = path.join(repo, 'scripts', 'pi', 'remote', 'kit-session.mjs');
    const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
    const bad = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /ACTION must be setup or teardown/);
    const direct = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...env, ACTION: 'teardown' },
    });
    assert.equal(direct.status, 1, direct.stdout + direct.stderr);
    assert.match(direct.stdout + direct.stderr, /TOOL_APP is not set/);
    const maxDelete = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...env, ACTION: 'teardown', MAX_DELETE: 'lots' },
    });
    assert.match(maxDelete.stdout + maxDelete.stderr, /MAX_DELETE must be a whole number/);

    // The setup needs the Kit GM password in the environment: 32 lowercase hex characters, checked before the
    // browser is loaded, and the error never holds what was given.
    const secret = 'Tooshort-but-secret-0123456789';
    const noPassword = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...env, ACTION: 'setup', TOOL_APP: repo, KIT_GM_PASSWORD: secret },
    });
    assert.equal(noPassword.status, 1, noPassword.stdout + noPassword.stderr);
    assert.match(
      noPassword.stdout + noPassword.stderr,
      /KIT_GM_PASSWORD is not set, or is not 32 lowercase hexadecimal characters/
    );
    assert.ok(
      !(noPassword.stdout + noPassword.stderr).includes(secret),
      'the value is not printed'
    );
    // The teardown takes ORIG_BRIDGE_USER (an id or empty) and refuses anything else before the browser is loaded.
    const origBad = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...env, ACTION: 'teardown', ORIG_BRIDGE_USER: '../etc' },
    });
    assert.equal(origBad.status, 1, origBad.stdout + origBad.stderr);
    assert.match(
      origBad.stdout + origBad.stderr,
      /ORIG_BRIDGE_USER must be a 16 character user id/
    );
    // The teardown does not need it: it gets as far as the next missing variable.
    const teardown = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...env, ACTION: 'teardown', TOOL_APP: repo },
    });
    assert.doesNotMatch(teardown.stdout + teardown.stderr, /KIT_GM_PASSWORD/);

    // Node gives import.meta.url the real path but keeps the link in argv[1]; the guard must still be true.
    const dir = mkdtempSync(path.join(tmpdir(), 'ks-link-'));
    const link = path.join(dir, 'remote');
    try {
      symlinkSync(path.dirname(script), link, 'junction');
      const viaLink = spawnSync(process.execPath, [path.join(link, 'kit-session.mjs')], {
        encoding: 'utf8',
        env: { ...env, ACTION: 'setup' },
      });
      assert.equal(viaLink.status, 1, viaLink.stdout + viaLink.stderr);
      assert.match(viaLink.stdout + viaLink.stderr, /TOOL_APP is not set/);
    } finally {
      // Remove the link itself first, so the cleanup can never walk into the real folder.
      try {
        unlinkSync(link);
      } catch {
        /* not created */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- the stage in an ARM64 container ------------------------------------------------------------------
// PI_KIT_SESSION_OUTPUT=<file> checks a saved kit-session-scenarios.sh output instead of starting Docker.
const saved = process.env.PI_KIT_SESSION_OUTPUT;
const containerReason = saved
  ? false
  : !process.env.PI_KIT_SESSION_CONTAINER
    ? 'set PI_KIT_SESSION_CONTAINER=1 to run the stage in a Docker ARM64 container'
    : spawnSync('docker', ['version'], { encoding: 'utf8' }).status !== 0 && 'no Docker here';
// In CI a missing Docker is a failure, not a skip: the step would go green without running a scenario.
const noDockerInCi = Boolean(process.env.CI) && containerReason === 'no Docker here';
// Debian 13 (trixie), pinned by digest like the stage 13 test, so a new upstream image cannot change a check overnight.
const IMAGE = 'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';

// About 10 minutes under QEMU emulation on a PC (the apt-get is most of it), well under a minute on an ARM runner.
function runContainer() {
  const res = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--platform',
      'linux/arm64',
      '-v',
      `${repo}:/repo:ro`,
      IMAGE,
      'bash',
      '/repo/scripts/pi/container-test/kit-session-scenarios.sh',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 45 * 60_000 }
  );
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}${res.error ? `\n${res.error.message}` : ''}`;
}

test('the container suite has Docker when CI asks for it', { skip: !noDockerInCi }, () => {
  assert.fail('PI_KIT_SESSION_CONTAINER=1 and CI are set, but `docker version` failed');
});

describe('kit-session.sh in an ARM64 container', { skip: containerReason }, () => {
  /** @type {Map<string, {output: string, exit: number, calls: string[], world: string, state: string[], driver: string[], prev: string[], kitgm: string[]}>} */
  const runs = new Map();
  before(
    () => {
      const stdout = saved ? readFileSync(saved, 'utf8').replace(/\r\n/g, '\n') : runContainer();
      assert.match(stdout, /=== ALL DONE/, stdout);
      for (const block of stdout.split(/^=== SCENARIO /m).slice(1)) {
        const name = block.slice(0, block.indexOf('\n'));
        const part = label => {
          const m = block.match(new RegExp(`^--- ${label}\\n([\\s\\S]*?)(?=^--- |^=== END)`, 'm'));
          return (m?.[1] ?? '').trimEnd();
        };
        const lines = label => part(label).split('\n').filter(Boolean);
        runs.set(name, {
          output: part('output'),
          exit: Number(block.match(/^--- exit (\d+)$/m)?.[1]),
          calls: lines('calls'),
          world: part('options.json'),
          state: lines('state'),
          driver: lines('driver'),
          prev: lines('prev'),
          kitgm: lines('kitgm'),
        });
      }
    },
    { timeout: 46 * 60_000 }
  );
  const run = name => {
    const r = runs.get(name);
    assert.ok(r, `scenario ${name} did not run`);
    return r;
  };
  const count = (calls, call) => calls.filter(c => c === call).length;
  const notJournal = calls => calls.filter(c => !c.startsWith('journalctl'));
  const GM = 'foundry-ai-tool-gm-browser.service';
  const KIT = 'foundry-ai-tool-kit-gm-browser.service';
  const STATE_UP = [
    'ORIG_WORLD=curse-of-strahd',
    'WAS_GM_BROWSER=1',
    'STAMP=<stamp>',
    'KIT_GM_BROWSER=1',
    'ORIG_BRIDGE_USER=AbCdEfGh01234567',
  ];
  const PREV_KIT = [
    'worlds/strahd-kit/actors/000001.log',
    'worlds/strahd-kit/settings/000001.log',
    'worlds/strahd-kit/users/000001.log',
  ];
  // The Kit GM's password file, profile folder and browser, in the shapes the scenarios report (kit-session-scenarios.sh).
  const FILE_OK = 'env mode 600 owner root lines 1 shape ok';
  const PROFILE_OK = 'profile mode 700 owner foundry';
  const KIT_UP = [FILE_OK, 'env-tmp absent', PROFILE_OK, 'unit running'];
  const KIT_STOPPED_FILES_KEPT = [FILE_OK, 'env-tmp absent', PROFILE_OK, 'unit stopped'];
  const KIT_GONE = ['env absent', 'env-tmp absent', 'profile absent', 'unit stopped'];
  const kit = r => r.kitgm.filter(l => /^(env|env-tmp|profile|unit) /.test(l));
  // Where the passwords (the one the driver was handed, one that was on the Pi before) were found: nowhere.
  const leaks = r => r.kitgm.filter(l => l.startsWith('leak '));
  const noLeak = r => {
    assert.ok(
      leaks(r).every(l => /^leak output=(0|skipped) calls=0$/.test(l)),
      leaks(r).join('\n')
    );
    assert.doesNotMatch(r.output, /secret123|password=|GM_PASSWORD/i);
    assert.ok(
      !r.calls.some(c => /[0-9a-f]{32}/.test(c)),
      'no 32 hex characters in any recorded call'
    );
  };
  const SYSTEMD_RUN =
    'systemd-run --unit=foundry-ai-tool-kit-gm-browser --collect --quiet -p User=foundry -p Group=foundry ' +
    '-p NoNewPrivileges=true -p ProtectSystem=full -p PrivateTmp=true -p ReadWritePaths=/var/lib/foundry-ai-tool ' +
    '-p Nice=10 -p CPUWeight=20 -p Restart=always -p RestartSec=15 ' +
    '-p EnvironmentFile=/etc/foundry-ai-tool/kit-gm.env ' +
    '--setenv=HOME=/var/lib/foundry-ai-tool --setenv=TOOL_APP=/opt/foundry-ai-tool/app ' +
    '--setenv=FOUNDRY_URL=http://127.0.0.1:30000 --setenv=CHROMIUM=/usr/bin/chromium ' +
    '--setenv=GM_BROWSER_PROFILE=/var/lib/foundry-ai-tool/kit-gm-browser --setenv=ASSISTANT_GM_USER=Kit GM ' +
    '/opt/node24/bin/node /opt/foundry-ai-tool/gm-browser/assistant-gm.mjs run';
  // Nothing was changed: no service touched but the Assistant GM browser coming back, options.json as it was.
  const untouched = (r, world) => {
    assert.equal(r.exit, 1, r.output);
    assert.equal(count(r.calls, 'stop foundry.service'), 0, r.calls.join('\n'));
    assert.equal(count(r.calls, 'restart foundry.service'), 0);
    assert.equal(r.world, world);
    assert.doesNotMatch(r.output, /secret123/);
  };
  // A rolled-back MODE=up: options.json, Foundry and the Assistant GM browser as before, no state file, no Kit GM.
  const rolledBack = r => {
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
    assert.equal(count(r.calls, 'restart foundry.service'), 1, r.calls.join('\n'));
    assert.equal(r.calls.at(-1), `start ${GM}`);
  };

  test('up: Foundry runs strahd-kit, the state is saved, the Assistant GM browser stays stopped', () => {
    const r = run('up-ok');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(notJournal(r.calls), [
      'cat foundry-ai-tool-bridge.service',
      `is-active ${KIT}`,
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      'is-active --quiet foundry.service',
      `is-active --quiet ${GM}`,
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
      `reset-failed ${KIT}`,
      SYSTEMD_RUN,
    ]);
    assert.equal(r.world, 'strahd-kit');
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.match(
      r.output,
      /DRIVER ACTION=setup WORLD=strahd-kit HOME=\/var\/lib\/foundry-ai-tool TOOL_APP=\/opt\/foundry-ai-tool\/app MAX_DELETE= HAS_USER=true HAS_PW=true/
    );
    assert.match(r.output, /DRIVER_SEES options=strahd-kit foundry_runs=true/);
    assert.match(r.output, /Join: {2}http:\/\/foundry-pi:30000\/join/);
    assert.match(r.output, /User: {2}Kit Player \(no password\)/);
    assert.match(r.output, /MODE=down/);
    assert.match(r.output, /The Assistant GM browser is stopped/);
    assert.doesNotMatch(r.output, /secret123|password=|GM_PASSWORD/i);
    assert.deepEqual(r.driver, ['upload removed', 'installed yes']);
    assert.deepEqual(r.prev, PREV_KIT);
    assert.ok(
      !r.prev.some(p => p.includes('curse-of-strahd')),
      'the campaign world is never copied'
    );
  });

  test('up writes the Kit GM password file: root only, mode 600, one line, 32 hex characters, before the driver runs', () => {
    const r = run('up-ok');
    assert.deepEqual(kit(r), KIT_UP);
    // The fake driver saw the file (mode 600) when it ran, and was handed the password in its environment.
    assert.match(r.output, /HAS_KITPW=true KITPW_SHAPE=true\nDRIVER_SEES .* kit_env=600/);
    // The password the driver got is the one in the file, and it differs from the fixed pattern fixtures use.
    assert.ok(r.kitgm.includes('driver-password-is-file yes'), r.kitgm.join('\n'));
    // The file is made through a mktemp file in /etc/foundry-ai-tool and a rename: no temp file is left.
    assert.ok(r.kitgm.includes('env-tmp absent'));
  });

  for (const name of ['up-ok', 'up-leftover', 'up-driver-fails', 'up-kit-not-joined']) {
    test(`${name}: the Kit GM password is never printed and never on a command line`, () => {
      const r = run(name);
      assert.ok(leaks(r).length >= 1, 'the password was looked for');
      noLeak(r);
    });
  }

  test('up says where the password is, and that it is not printed', () => {
    const r = run('up-ok');
    assert.match(r.output, /never printed here/);
    assert.match(r.output, /\/etc\/foundry-ai-tool\/kit-gm\.env \(root only, mode 600\)/);
  });

  test('up starts the Kit GM browser as a transient unit with the properties of the real Assistant GM unit', () => {
    const r = run('up-ok');
    assert.equal(count(r.calls, SYSTEMD_RUN), 1, r.calls.join('\n'));
    // The file was there, mode 600, when the unit was started.
    assert.ok(r.kitgm.includes('env-seen-by-unit mode 600'), r.kitgm.join('\n'));
    // Every hardening and priority property of the real unit (stage 5) is on the transient one.
    const stage5 = readFileSync(path.join(repo, 'scripts', 'pi', 'remote', '5-tool.sh'), 'utf8');
    for (const prop of [
      'NoNewPrivileges=true',
      'ProtectSystem=full',
      'PrivateTmp=true',
      'Nice=10',
      'CPUWeight=20',
      'Restart=always',
      'RestartSec=15',
    ]) {
      assert.ok(stage5.split('\n').includes(prop), `5-tool.sh has ${prop}`);
      assert.ok(SYSTEMD_RUN.includes(`-p ${prop} `), `the transient unit has ${prop}`);
    }
    assert.ok(stage5.includes('User=$FOUNDRY_USER') && stage5.includes('Group=$FOUNDRY_USER'));
    assert.ok(stage5.includes('ReadWritePaths=$TOOL_DATA'));
    assert.ok(stage5.includes('ExecStart=$NODE_DIR/bin/node $driver_dir/assistant-gm.mjs run'));
    // The stage waits for the join line and then looks at the bridge link.
    const journal = r.calls.filter(c => c.startsWith('journalctl'));
    assert.ok(journal.length >= 1);
    for (const c of journal) {
      assert.match(
        c,
        /^journalctl -u foundry-ai-tool-kit-gm-browser --since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d --no-pager$/
      );
    }
    assert.match(r.output, /joined world strahd-kit as Kit GM/);
    assert.match(r.output, /a Foundry connection is established on the bridge's port 31415/);
  });

  test('up with the Assistant GM browser off: it is recorded as off', () => {
    const r = run('up-gm-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(r.state, [
      'mode 600 owner root',
      'ORIG_WORLD=curse-of-strahd',
      'WAS_GM_BROWSER=0',
      'STAMP=<stamp>',
      'KIT_GM_BROWSER=1',
      'ORIG_BRIDGE_USER=AbCdEfGh01234567',
    ]);
    assert.ok(!r.calls.some(c => /^(re)?start .*gm-browser/.test(c)));
  });

  test('up with Foundry off: no /api/status check, Foundry started on strahd-kit', () => {
    const r = run('up-foundry-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.equal(count(r.calls, 'start foundry.service'), 1);
    assert.equal(r.world, 'strahd-kit');
  });

  test('up refused when a kit session is up already; nothing changes, the Kit GM files stay', () => {
    const r = run('up-state-exists');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /a kit session is already up: run MODE=down first/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(r.driver, ['upload kept', 'installed no']);
    assert.deepEqual(r.prev, []);
    assert.deepEqual(
      kit(r),
      KIT_UP,
      'the running session keeps its password file, profile and browser'
    );
    noLeak(r);
  });

  test('up refused when Foundry launches strahd-kit already', () => {
    const r = run('up-already-kit');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /Foundry already launches strahd-kit/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.state, ['absent']);
  });

  test('up refused with someone online (the Assistant GM browser comes back, no state file, no Kit GM file)', () => {
    const r = run('up-users-online');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /2 user\(s\) are online in Foundry/);
    assert.equal(r.calls.at(-1), `start ${GM}`);
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(
      kit(r),
      KIT_GONE,
      'the password file is made only after Foundry runs strahd-kit'
    );
    assert.ok(!r.output.includes('DRIVER'), 'the driver never ran');
  });

  test('up with FORCE=1 goes on when people are online', () => {
    const r = run('up-users-online-force');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /2 user\(s\) still online; FORCE=1/);
    assert.equal(r.world, 'strahd-kit');
  });

  test('up refused when /api/status cannot be read', () => {
    const r = run('up-status-unreadable');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /cannot read who is online in Foundry/);
    assert.deepEqual(r.state, ['absent']);
  });

  test('up with the driver failing puts everything back, the Kit GM browser, file and profile included; no state file', () => {
    const r = run('up-driver-fails');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the setup of strahd-kit failed or did not verify/);
    assert.match(r.output, /options.json restored to launch 'curse-of-strahd'/);
    assert.match(r.output, /there is no kit session/);
    assert.match(
      r.output,
      /Kit Player and Kit GM may exist in strahd-kit: MODE=up and then MODE=down removes them/
    );
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
    assert.deepEqual(notJournal(r.calls), [
      'cat foundry-ai-tool-bridge.service',
      `is-active ${KIT}`,
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      'is-active --quiet foundry.service',
      `is-active --quiet ${GM}`,
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      'restart foundry.service',
      `is-active --quiet ${GM}`,
      `start ${GM}`,
    ]);
    assert.match(r.output, /old copies are in \/var\/lib\/foundry-import\/prev-/);
    assert.deepEqual(r.prev, PREV_KIT);
    assert.doesNotMatch(r.output, /secret123/);
  });

  test('up with the driver failing, Assistant GM browser off before: it stays off', () => {
    const r = run('up-driver-fails-gm-off');
    assert.equal(r.exit, 1, r.output);
    assert.equal(r.world, 'curse-of-strahd');
    assert.ok(!r.calls.some(c => c === `start ${GM}`));
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
  });

  for (const [name, reason, world] of [
    ['up-no-driver', /no \/root\/kit-session\.mjs: scp/, 'curse-of-strahd'],
    ['up-no-login', /no \/etc\/foundry-ai-tool\/world-strahd-kit\.env/, 'curse-of-strahd'],
    ['up-no-world', /world strahd-kit is not installed/, 'curse-of-strahd'],
    [
      'up-wrong-driver-path',
      /SESSION_DRIVER must be a \.mjs file under \/root\//,
      'curse-of-strahd',
    ],
    [
      'up-no-gm-driver',
      /the Assistant GM driver is not installed at \/opt\/foundry-ai-tool\/gm-browser\/assistant-gm\.mjs .*run stage 5 first\. Nothing was changed/,
      'curse-of-strahd',
    ],
    ['bad-mode', /usage: MODE=up .* or MODE=down .*got 'sideways'/, 'curse-of-strahd'],
    ['no-mode', /usage: MODE=up .* got ''/, 'curse-of-strahd'],
  ]) {
    test(`${name}: refused before anything changes`, () => {
      const r = run(name);
      untouched(r, world);
      assert.match(r.output, reason);
      assert.deepEqual(r.calls, []);
      assert.deepEqual(r.state, ['absent']);
      assert.deepEqual(r.prev, []);
      assert.deepEqual(kit(r), KIT_GONE);
    });
  }

  test('up refused when the bridge service has no unit: nothing stops, nothing is made', () => {
    const r = run('up-no-bridge-unit');
    untouched(r, 'curse-of-strahd');
    assert.match(
      r.output,
      /the bridge service \(foundry-ai-tool-bridge\.service\) does not exist: run stage 5 first/
    );
    assert.deepEqual(r.calls, ['cat foundry-ai-tool-bridge.service']);
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(r.prev, []);
    assert.deepEqual(kit(r), KIT_GONE);
  });

  test('the world cannot be changed from the environment', () => {
    const r = run('up-ignores-world-env');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /DRIVER ACTION=setup WORLD=strahd-kit /);
    assert.equal(r.world, 'strahd-kit');
  });

  test("up removes a leftover Kit GM file, profile and browser (no state file, so they are nobody's) and says so", () => {
    const r = run('up-leftover');
    assert.equal(r.exit, 0, r.output);
    assert.match(
      r.output,
      /removed what an earlier kit session left behind \(there is no state file, so none of it is in use\): \/etc\/foundry-ai-tool\/kit-gm\.env \/etc\/foundry-ai-tool\/\.kit-gm\.stale1 \/var\/lib\/foundry-ai-tool\/kit-gm-browser the unit foundry-ai-tool-kit-gm-browser \(active\)/
    );
    // The old browser is stopped before anything else is touched, and a fresh one runs at the end.
    const calls = notJournal(r.calls);
    assert.deepEqual(calls.slice(0, 4), [
      'cat foundry-ai-tool-bridge.service',
      `is-active ${KIT}`,
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
    ]);
    assert.equal(count(calls, SYSTEMD_RUN), 1);
    assert.deepEqual(kit(r), KIT_UP);
    assert.ok(
      r.kitgm.includes('driver-password-is-file yes'),
      'the new password replaced the old file'
    );
    assert.equal(leaks(r).length, 2, 'the new and the leftover password were both looked for');
    noLeak(r);
    assert.equal(r.world, 'strahd-kit');
  });

  test('up when the Kit GM browser never joins: everything is put back, the browser, file and profile removed', () => {
    const r = run('up-kit-not-joined');
    assert.equal(r.exit, 1, r.output);
    assert.match(
      r.output,
      /the Kit GM browser did not join strahd-kit as Kit GM within 2 minutes \(see: journalctl -u foundry-ai-tool-kit-gm-browser -n 30\)/
    );
    assert.match(r.output, /options.json restored to launch 'curse-of-strahd'/);
    rolledBack(r);
    assert.ok(r.calls.includes(`stop ${KIT}`), r.calls.join('\n'));
    // The wait really looked 60 times.
    assert.equal(r.calls.filter(c => c.startsWith('journalctl -u foundry-ai-tool-kit')).length, 60);
    noLeak(r);
  });

  test('up when the unit cannot be started: everything is put back, nothing of the Kit GM stays', () => {
    const r = run('up-kit-run-fails');
    assert.notEqual(r.exit, 0, r.output);
    assert.doesNotMatch(r.output, /summary/);
    rolledBack(r);
    assert.ok(r.calls.includes(`stop ${KIT}`));
    noLeak(r);
  });

  test('up warns, and goes on, when the bridge link is not established', () => {
    const r = run('up-no-bridge-link');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /no established connection on the bridge's port 31415 yet/);
    assert.equal(r.world, 'strahd-kit');
    assert.deepEqual(kit(r), KIT_UP);
  });

  test("up keeps the password file in /etc/foundry-ai-tool and nothing of it in the foundry user's folder (M2)", () => {
    const r = run('up-ok');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(kit(r), KIT_UP); // root:root, mode 600, one line
    assert.match(r.output, /wrote \/etc\/foundry-ai-tool\/kit-gm\.env/);
    // /var/lib/foundry-ai-tool holds the state file and the profile folder, never a password file or its temp files.
    assert.ok(r.kitgm.includes('tooldata kit-gm-browser kit-session.env'), r.kitgm.join('\n'));
    assert.ok(r.kitgm.includes('env-tmp absent'), 'no temp file is left in /etc/foundry-ai-tool');
  });

  test('up-plant-links: links the foundry user left where the profile folder goes are replaced, and root touches nothing they point to', () => {
    const r = run('up-plant-links');
    assert.equal(r.exit, 0, r.output);
    assert.ok(r.kitgm.includes('victims root:755 root:644 victim'), r.kitgm.join('\n'));
    assert.deepEqual(kit(r), KIT_UP); // a real folder, mode 700, owned by foundry
    assert.match(r.output, /removed what an earlier kit session left behind/);
  });

  test('up keeps the bridge user it replaced in the state file, and the driver reports it', () => {
    const r = run('up-ok');
    assert.ok(r.state.includes('ORIG_BRIDGE_USER=AbCdEfGh01234567'), r.state.join('\n'));
    assert.match(r.output, /ORIG_BRIDGE_USER=AbCdEfGh01234567/);
    assert.match(
      r.output,
      /the bridge user it replaced \(AbCdEfGh01234567\) is kept in the state file/
    );
    // Any GM before: an empty value, still a line (the teardown then restores nothing).
    const empty = run('up-orig-bridge-empty');
    assert.equal(empty.exit, 0, empty.output);
    assert.ok(empty.state.includes('ORIG_BRIDGE_USER='), empty.state.join('\n'));
    assert.match(empty.output, /the bridge user it replaced \(Any GM\) is kept/);
  });

  test('set_world is done by the foundry user (M1): links in its folders are not followed, mode and owner of options.json stay', () => {
    const r = run('up-plant-links');
    assert.equal(r.exit, 0, r.output);
    assert.ok(r.kitgm.includes('victims root:755 root:644 victim'), r.kitgm.join('\n'));
    assert.ok(r.kitgm.includes('options mode 644 owner foundry tmp absent'), r.kitgm.join('\n'));
    assert.equal(r.world, 'strahd-kit');
    const up600 = run('up-options-600');
    assert.equal(up600.exit, 0, up600.output);
    assert.ok(
      up600.kitgm.includes('options mode 600 owner foundry tmp absent'),
      up600.kitgm.join('\n')
    );
    const down600 = run('down-options-600');
    assert.equal(down600.exit, 0, down600.output);
    assert.equal(down600.world, 'curse-of-strahd');
    assert.ok(
      down600.kitgm.includes('options mode 600 owner foundry tmp absent'),
      down600.kitgm.join('\n')
    );
  });

  test('up-options-readonly: when the foundry user cannot write options.json, nothing half written is left and everything is put back', () => {
    const r = run('up-options-readonly');
    assert.notEqual(r.exit, 0, r.output);
    assert.equal(r.world, 'curse-of-strahd', 'options.json is as it was');
    assert.ok(r.kitgm.includes('options mode 644 owner foundry tmp absent'), r.kitgm.join('\n'));
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
    assert.equal(count(r.calls, 'restart foundry.service'), 1, r.calls.join('\n'));
    assert.equal(r.calls.at(-1), `start ${GM}`);
  });

  test('up-orig-bridge-bad: a reported bridge user that is not a user id puts everything back', () => {
    const r = run('up-orig-bridge-bad');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the setup reported a bridge user that is not a user id/);
    rolledBack(r);
  });

  test('up-orig-bridge-none: a setup that does not report the bridge user puts everything back', () => {
    const r = run('up-orig-bridge-none');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the setup did not report the bridge user it replaced/);
    rolledBack(r);
  });

  test('up-leftover-activating: a Kit GM unit between restarts is a leftover, stopped before anything else (L6)', () => {
    const r = run('up-leftover-activating');
    assert.equal(r.exit, 0, r.output);
    assert.match(
      r.output,
      /removed what an earlier kit session left behind \(there is no state file, so none of it is in use\): the unit foundry-ai-tool-kit-gm-browser \(activating\)/
    );
    assert.deepEqual(notJournal(r.calls).slice(0, 4), [
      'cat foundry-ai-tool-bridge.service',
      `is-active ${KIT}`,
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
    ]);
    assert.ok(r.kitgm.includes('unit-activating no'), 'the old unit is gone');
    assert.deepEqual(kit(r), KIT_UP);
  });

  test('up-xtrace: run as bash -x, the trace holds neither the GM login nor the Kit GM password (L7)', () => {
    const r = run('up-xtrace');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /^\+ /m, 'the trace really was on');
    assert.doesNotMatch(r.output, /secret123/);
    assert.ok(leaks(r).length >= 1);
    // The trace names the variables but never their values.
    assert.ok(
      leaks(r).every(l => l === 'leak output=0 calls=0'),
      leaks(r).join('\n')
    );
    assert.ok(r.kitgm.includes('driver-password-is-file yes'));
  });

  test('up with the ssh session dropping (SIGPIPE) after the services stopped still restores everything', () => {
    const r = run('up-pipe-closed');
    assert.notEqual(r.exit, 0, r.output);
    assert.doesNotMatch(r.output, /summary/, 'the output really was cut off');
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.equal(count(r.calls, 'restart foundry.service'), 1, r.calls.join('\n'));
    assert.equal(r.calls.at(-1), `start ${GM}`);
    // The cut falls after options.json was changed: the run was killed after the old world was put back.
    assert.match(r.output, /strahd-kit is running/);
  });

  // The cut falls at each of the new steps; the unit was running when it fell at the start and at the wait.
  for (const [name, last, started] of [
    ['up-pipe-closed-kit-file', /making the password file for Kit GM/, false],
    ['up-pipe-closed-kit-driver', /wrote \/etc\/foundry-ai-tool\/kit-gm\.env/, false],
    ['up-pipe-closed-kit-start', /==> starting the Kit GM browser/, true],
    ['up-pipe-closed-kit-wait', /started foundry-ai-tool-kit-gm-browser\.service/, true],
  ]) {
    test(`${name}: the ssh session drops during the Kit GM steps, everything is still removed and restored`, () => {
      const r = run(name);
      assert.notEqual(r.exit, 0, r.output);
      assert.doesNotMatch(r.output, /summary/, 'the output really was cut off');
      assert.match(r.output.split('\n').at(-1), last, 'the cut falls here');
      rolledBack(r);
      assert.ok(r.calls.includes(`stop ${KIT}`), r.calls.join('\n'));
      assert.equal(r.calls.includes(SYSTEMD_RUN), started, 'the unit was started or not yet');
      noLeak(r);
    });
  }

  test('down: the Kit GM browser stops first, the teardown runs while strahd-kit runs, then the Kit GM file goes and options.json, Foundry and the GM browser go back', () => {
    const r = run('down-ok');
    assert.equal(r.exit, 0, r.output);
    assert.match(
      r.output,
      /DRIVER ACTION=teardown WORLD=strahd-kit .* MAX_DELETE= HAS_USER=true HAS_PW=true HAS_KITPW=false KITPW_SHAPE=false/
    );
    assert.match(r.output, /DRIVER_SEES options=strahd-kit foundry_runs=true kit_env=600/);
    assert.deepEqual(notJournal(r.calls), [
      'is-active --quiet foundry.service',
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      `is-active --quiet ${KIT}`,
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
      `restart ${GM}`,
      `is-active --quiet ${GM}`,
    ]);
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
    assert.match(r.output, /removed the Kit GM password file and browser profile/);
    assert.match(r.output, /Kit Player, its actors and Kit GM are gone from strahd-kit/);
    assert.match(r.output, /the Assistant GM browser joined the world/);
    assert.match(r.output, /Foundry launches: curse-of-strahd/);
    assert.doesNotMatch(r.output, /secret123/);
    noLeak(r);
  });

  test('down with the Assistant GM browser off before the session: it stays off', () => {
    const r = run('down-gm-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.ok(!r.calls.some(c => /^(re)?start .*gm-browser/.test(c)));
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
  });

  test('down with no original world: options.json launches no world and the stage does not wait', () => {
    const r = run('down-no-world');
    assert.equal(r.exit, 0, r.output);
    assert.equal(r.world, 'null');
    assert.match(r.output, /Foundry launches: no world/);
    assert.ok(!r.calls.some(c => c.startsWith('journalctl')), 'no wait for "joined world"');
    assert.deepEqual(r.state, ['absent']);
  });

  test('down with a state file from before the Kit GM existed: no Kit GM step, the teardown still runs', () => {
    const r = run('down-old-state');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(notJournal(r.calls), [
      'is-active --quiet foundry.service',
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
      `restart ${GM}`,
      `is-active --quiet ${GM}`,
    ]);
    assert.ok(!r.calls.some(c => c.includes('kit-gm')), 'the Kit GM unit is never touched');
    assert.match(r.output, /DRIVER ACTION=teardown WORLD=strahd-kit .* HAS_KITPW=false/);
    assert.doesNotMatch(r.output, /removed the Kit GM password file/);
    assert.doesNotMatch(r.output, /The Kit GM browser is stopped/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(kit(r), KIT_GONE);
  });

  test('down hands the bridge user it replaced to the teardown; a missing line means Any GM, an empty one too', () => {
    const r = run('down-ok');
    assert.match(r.output, /DRIVER_SEES .* orig_bridge=set:AbCdEfGh01234567/);
    const none = run('down-no-orig-bridge');
    assert.equal(none.exit, 0, none.output);
    assert.match(none.output, /DRIVER_SEES .* orig_bridge=unset/);
    assert.deepEqual(none.state, ['absent']);
    const empty = run('down-empty-orig-bridge');
    assert.equal(empty.exit, 0, empty.output);
    assert.match(empty.output, /DRIVER_SEES .* orig_bridge=set:\n/);
  });

  test('down refused when the ORIG_BRIDGE_USER line is not a user id', () => {
    const r = run('down-bad-orig-bridge');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /holds no valid ORIG_BRIDGE_USER/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(r.calls, []);
    assert.ok(r.state.includes('ORIG_BRIDGE_USER=../etc'), 'the state file is left as it was');
    assert.deepEqual(kit(r), KIT_UP);
  });

  test('down refused without a state file', () => {
    const r = run('down-no-state');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /no kit session is up/);
    assert.deepEqual(r.calls, []);
  });

  test('down refused when options.json does not launch strahd-kit; the state file stays', () => {
    const r = run('down-not-on-kit');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /options.json does not launch strahd-kit/);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(kit(r), KIT_UP, 'refused before the Kit GM browser was touched');
  });

  test('down refused when the state file holds something it must not trust', () => {
    const r = run('down-bad-state');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /ORIG_WORLD/);
    assert.deepEqual(r.calls, []);
  });

  test('down refused when the KIT_GM_BROWSER line is not 1 (a missing line is fine, a wrong one is not)', () => {
    const r = run('down-bad-kit-flag');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /holds no valid KIT_GM_BROWSER \(1 or no such line\)/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(r.calls, []);
    assert.ok(r.state.includes('KIT_GM_BROWSER=maybe'), 'the state file is left as it was');
  });

  test('down with the driver failing changes nothing else: Foundry stays on strahd-kit, the state and the Kit GM file stay, the Kit GM browser stays stopped', () => {
    const r = run('down-driver-fails');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /the teardown in strahd-kit failed or did not verify/);
    assert.match(r.output, /run MODE=down again/);
    assert.match(r.output, /the Kit GM browser stays stopped/);
    assert.match(r.output, /the state file and the Kit GM password file stay/);
    assert.deepEqual(r.calls, [
      'is-active --quiet foundry.service',
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      `is-active --quiet ${KIT}`,
      `stop ${GM}`,
    ]);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(kit(r), KIT_STOPPED_FILES_KEPT);
    noLeak(r);
  });

  test('down refused while someone is online (the Kit Player must leave first); FORCE=1 goes on', () => {
    const r = run('down-users-online');
    untouched(r, 'strahd-kit');
    assert.match(
      r.output,
      /1 user\(s\) are online in Foundry: the Kit Player must leave the game first/
    );
    assert.match(r.output, /the Kit GM browser is stopped now and stays stopped/);
    assert.ok(!r.output.includes('DRIVER'), 'the driver never ran');
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(kit(r), KIT_STOPPED_FILES_KEPT);
    const force = run('down-users-online-force');
    assert.equal(force.exit, 0, force.output);
    assert.match(force.output, /1 user\(s\) still online; FORCE=1/);
    assert.equal(force.world, 'curse-of-strahd');
    assert.deepEqual(kit(force), KIT_GONE);
  });

  test('down refused when Foundry is not running', () => {
    const r = run('down-foundry-off');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /Foundry is not running: start it/);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(kit(r), KIT_UP, 'refused before the Kit GM browser was touched');
  });

  test('down passes MAX_DELETE on to the driver, and refuses one that is not a number', () => {
    const r = run('down-max-delete');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /ACTION=teardown .* MAX_DELETE=9 /);
    const bad = run('down-bad-max-delete');
    untouched(bad, 'strahd-kit');
    assert.match(bad.output, /MAX_DELETE must be a whole number from 1/);
    assert.deepEqual(bad.calls, []);
  });

  test('down with a failed Assistant GM browser start: the session is over (no state file, options.json back)', () => {
    const r = run('down-gm-browser-fails');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the Assistant GM browser did not start/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.equal(count(r.calls, 'start foundry.service'), 1);
    assert.deepEqual(kit(r), KIT_GONE);
  });

  test('down with the ssh session dropping after options.json was put back still ends with Foundry and the GM browser running', () => {
    // Cut while Foundry is stopped: the handler starts Foundry again, then the Assistant GM browser.
    const stopping = run('down-pipe-closed-stopping');
    assert.notEqual(stopping.exit, 0, stopping.output);
    assert.equal(stopping.world, 'curse-of-strahd');
    assert.deepEqual(stopping.state, ['absent']);
    assert.equal(count(stopping.calls, 'start foundry.service'), 1, stopping.calls.join('\n'));
    assert.equal(stopping.calls.at(-1), `start ${GM}`);
    assert.deepEqual(kit(stopping), KIT_GONE);
    // Cut while the campaign world starts: Foundry runs already, the GM browser must still come back.
    const starting = run('down-pipe-closed-starting');
    assert.notEqual(starting.exit, 0, starting.output);
    assert.equal(starting.world, 'curse-of-strahd');
    assert.deepEqual(starting.state, ['absent']);
    assert.ok(starting.calls.includes(`start ${GM}`), starting.calls.join('\n'));
    assert.deepEqual(kit(starting), KIT_GONE);
  });

  test('down with the ssh session dropping right after the teardown still removes the Kit GM file and profile; the session stays up for another MODE=down', () => {
    const r = run('down-pipe-closed-after-teardown');
    assert.notEqual(r.exit, 0, r.output);
    assert.match(r.output.split('\n').at(-1), /DRIVER_SEES /);
    assert.doesNotMatch(r.output, /summary/, 'the output really was cut off');
    // The files go before the next line is printed; nothing else was put back, so MODE=down can run again.
    assert.deepEqual(kit(r), KIT_GONE);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.equal(r.world, 'strahd-kit');
    assert.equal(count(r.calls, 'stop foundry.service'), 0);
  });

  test('down stops the Assistant GM browser before it counts who is online', () => {
    const r = run('down-gm-active');
    assert.equal(r.exit, 0, r.output);
    const calls = notJournal(r.calls);
    assert.deepEqual(calls.slice(0, 6), [
      'is-active --quiet foundry.service',
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      `is-active --quiet ${KIT}`,
      `stop ${GM}`,
      'stop foundry.service',
    ]);
    assert.equal(r.world, 'curse-of-strahd');
    // With it running, /api/status counts it as a user: refused for a real reason, but it was stopped first.
    const online = run('down-gm-active-users-online');
    untouched(online, 'strahd-kit');
    assert.ok(online.calls.includes(`stop ${GM}`));
    assert.match(online.output, /2 user\(s\) are online/);
  });

  test('down stops the Kit GM browser before it counts who is online (it counts as a user while it runs)', () => {
    const r = run('down-kit-active');
    assert.equal(r.exit, 0, r.output);
    const stopKit = r.calls.indexOf(`stop ${KIT}`);
    assert.ok(stopKit >= 0, 'the Kit GM browser is stopped');
    assert.ok(stopKit < r.calls.indexOf(`stop ${GM}`), 'the Kit GM browser stops first');
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(kit(r), KIT_GONE);
  });

  test('down with a real user online is still refused after the Kit GM browser was stopped, and says so', () => {
    const online = run('down-kit-active-users-online');
    untouched(online, 'strahd-kit');
    assert.match(online.output, /2 user\(s\) are online in Foundry/);
    assert.match(online.output, /the Kit GM browser is stopped now and stays stopped/);
    assert.ok(online.calls.includes(`stop ${KIT}`));
    assert.deepEqual(kit(online), KIT_STOPPED_FILES_KEPT);
  });

  test('down refused when the Kit GM browser cannot be stopped: nothing else is touched', () => {
    const r = run('down-kit-stop-fails');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /the Kit GM browser \(foundry-ai-tool-kit-gm-browser\) did not stop/);
    assert.deepEqual(r.calls, [
      'is-active --quiet foundry.service',
      `stop ${KIT}`,
      `reset-failed ${KIT}`,
      `is-active --quiet ${KIT}`,
    ]);
    assert.ok(!r.output.includes('DRIVER'), 'the driver never ran');
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(kit(r), KIT_UP);
  });

  test('down when the campaign world does not come back: the session is over, the GM browser is started', () => {
    const r = run('down-world-not-back');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /curse-of-strahd is not running on port 30000/);
    assert.match(r.output, /Foundry did not come back on 'curse-of-strahd'/);
    assert.match(r.output, /options.json is restored/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.equal(r.calls.at(-1), `start ${GM}`);
    const off = run('down-world-not-back-gm-off');
    assert.equal(off.exit, 1, off.output);
    assert.ok(!off.calls.some(c => c === `start ${GM}`));
  });

  test('down when Foundry cannot be stopped: nothing was put back, the state stays, run it again', () => {
    const r = run('down-stop-fails');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /nothing was put back/);
    assert.match(r.output, /run MODE=down again/);
    assert.doesNotMatch(r.output, /options.json is restored/);
    assert.equal(r.world, 'strahd-kit');
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.ok(!r.calls.some(c => c === `start ${GM}`), 'the GM browser stays off');
    // The teardown was verified, so the Kit GM file is gone already; a second MODE=down finds nothing to remove.
    assert.deepEqual(kit(r), KIT_GONE);
  });
});

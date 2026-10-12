// Tests for the Pi kit session (scripts/pi/remote/kit-session.sh and kit-session.mjs, docs/dev/PI-SETUP.md):
//   node --test scripts/pi/kit-session.test.mjs
// - the in-browser part (kit-session.mjs) against a fake `game`: every decision of the setup (which settings
//   differ, what the read-back must show, the checks on the Kit Player user) and of the teardown (which actors
//   count, the limit, what is deleted, what must be gone afterwards), a second run changing nothing;
// - with PI_KIT_SESSION_CONTAINER=1 (needs Docker; CI would run it on the ARM runner): the stage itself in a
//   Debian 13 ARM64 container with stand-ins for systemd (scripts/pi/container-test/kit-session-scenarios.sh): up and
//   down, every refusal before anything stops, a failing driver putting everything back, services that were off
//   staying off.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FLAGS,
  MODULE_ID,
  PACKS,
  PHB_MODULE,
  PLAYER_NAME,
  SETTING_KEYS,
  SOURCES,
  applyChanges,
  blockers,
  createPlayer,
  deleteKit,
  joinsWithoutPassword,
  mismatches,
  parseMaxDelete,
  playerUserProblems,
  readState,
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
  const sets = [];
  const game = {
    sets,
    docs,
    world: { id: world },
    user: { name: 'Gamemaster', isGM },
    modules: new Map([
      [MODULE_ID, { active: moduleActive }],
      [PHB_MODULE, { active: phbActive }],
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
  for (const u of game.users) u.delete = async () => game.users.splice(game.users.indexOf(u), 1);
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
  /** @type {Map<string, {output: string, exit: number, calls: string[], world: string, state: string[], driver: string[], prev: string[]}>} */
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
  const STATE_UP = ['ORIG_WORLD=curse-of-strahd', 'WAS_GM_BROWSER=1', 'STAMP=<stamp>'];
  const PREV_KIT = [
    'worlds/strahd-kit/actors/000001.log',
    'worlds/strahd-kit/settings/000001.log',
    'worlds/strahd-kit/users/000001.log',
  ];
  // Nothing was changed: no service touched but the Assistant GM browser coming back, options.json as it was.
  const untouched = (r, world) => {
    assert.equal(r.exit, 1, r.output);
    assert.equal(count(r.calls, 'stop foundry.service'), 0, r.calls.join('\n'));
    assert.equal(count(r.calls, 'restart foundry.service'), 0);
    assert.equal(r.world, world);
    assert.doesNotMatch(r.output, /secret123/);
  };

  test('up: Foundry runs strahd-kit, the state is saved, the Assistant GM browser stays stopped', () => {
    const r = run('up-ok');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(r.calls, [
      'is-active --quiet foundry.service',
      `is-active --quiet ${GM}`,
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
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

  test('up with the Assistant GM browser off: it is recorded as off', () => {
    const r = run('up-gm-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(r.state, [
      'mode 600 owner root',
      'ORIG_WORLD=curse-of-strahd',
      'WAS_GM_BROWSER=0',
      'STAMP=<stamp>',
    ]);
    assert.ok(!r.calls.some(c => /^(re)?start .*gm-browser/.test(c)));
  });

  test('up with Foundry off: no /api/status check, Foundry started on strahd-kit', () => {
    const r = run('up-foundry-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.equal(count(r.calls, 'start foundry.service'), 1);
    assert.equal(r.world, 'strahd-kit');
  });

  test('up refused when a kit session is up already; nothing changes', () => {
    const r = run('up-state-exists');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /a kit session is already up: run MODE=down first/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    assert.deepEqual(r.driver, ['upload kept', 'installed no']);
    assert.deepEqual(r.prev, []);
  });

  test('up refused when Foundry launches strahd-kit already', () => {
    const r = run('up-already-kit');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /Foundry already launches strahd-kit/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.state, ['absent']);
  });

  test('up refused with someone online (the Assistant GM browser comes back, no state file)', () => {
    const r = run('up-users-online');
    untouched(r, 'curse-of-strahd');
    assert.match(r.output, /2 user\(s\) are online in Foundry/);
    assert.equal(r.calls.at(-1), `start ${GM}`);
    assert.deepEqual(r.state, ['absent']);
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

  test('up with the driver failing puts options.json, Foundry and the Assistant GM browser back; no state file', () => {
    const r = run('up-driver-fails');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the setup of strahd-kit failed or did not verify/);
    assert.match(r.output, /options.json restored to launch 'curse-of-strahd'/);
    assert.match(r.output, /there is no kit session/);
    assert.match(
      r.output,
      /Kit Player may exist in strahd-kit: MODE=up and then MODE=down removes it/
    );
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.deepEqual(notJournal(r.calls), [
      'is-active --quiet foundry.service',
      `is-active --quiet ${GM}`,
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
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
    });
  }

  test('the world cannot be changed from the environment', () => {
    const r = run('up-ignores-world-env');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /DRIVER ACTION=setup WORLD=strahd-kit /);
    assert.equal(r.world, 'strahd-kit');
  });

  test('down: the teardown runs while strahd-kit runs, then options.json, Foundry and the GM browser go back', () => {
    const r = run('down-ok');
    assert.equal(r.exit, 0, r.output);
    assert.match(
      r.output,
      /DRIVER ACTION=teardown WORLD=strahd-kit .* MAX_DELETE= HAS_USER=true HAS_PW=true/
    );
    assert.match(r.output, /DRIVER_SEES options=strahd-kit foundry_runs=true/);
    assert.deepEqual(notJournal(r.calls), [
      'is-active --quiet foundry.service',
      `stop ${GM}`,
      'stop foundry.service',
      'start foundry.service',
      `restart ${GM}`,
      `is-active --quiet ${GM}`,
    ]);
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.match(r.output, /the Assistant GM browser joined the world/);
    assert.match(r.output, /Foundry launches: curse-of-strahd/);
    assert.doesNotMatch(r.output, /secret123/);
  });

  test('down with the Assistant GM browser off before the session: it stays off', () => {
    const r = run('down-gm-was-off');
    assert.equal(r.exit, 0, r.output);
    assert.ok(!r.calls.some(c => /^(re)?start .*gm-browser/.test(c)));
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
  });

  test('down with no original world: options.json launches no world and the stage does not wait', () => {
    const r = run('down-no-world');
    assert.equal(r.exit, 0, r.output);
    assert.equal(r.world, 'null');
    assert.match(r.output, /Foundry launches: no world/);
    assert.ok(!r.calls.some(c => c.startsWith('journalctl')), 'no wait for "joined world"');
    assert.deepEqual(r.state, ['absent']);
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
  });

  test('down refused when the state file holds something it must not trust', () => {
    const r = run('down-bad-state');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /ORIG_WORLD/);
    assert.deepEqual(r.calls, []);
  });

  test('down with the driver failing changes nothing: Foundry stays on strahd-kit, the state stays', () => {
    const r = run('down-driver-fails');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /the teardown in strahd-kit failed or did not verify/);
    assert.match(r.output, /run MODE=down again/);
    assert.deepEqual(r.calls, ['is-active --quiet foundry.service', `stop ${GM}`]);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
  });

  test('down refused while someone is online (the Kit Player must leave first); FORCE=1 goes on', () => {
    const r = run('down-users-online');
    untouched(r, 'strahd-kit');
    assert.match(
      r.output,
      /1 user\(s\) are online in Foundry: the Kit Player must leave the game first/
    );
    assert.ok(!r.output.includes('DRIVER'), 'the driver never ran');
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
    const force = run('down-users-online-force');
    assert.equal(force.exit, 0, force.output);
    assert.match(force.output, /1 user\(s\) still online; FORCE=1/);
    assert.equal(force.world, 'curse-of-strahd');
  });

  test('down refused when Foundry is not running', () => {
    const r = run('down-foundry-off');
    untouched(r, 'strahd-kit');
    assert.match(r.output, /Foundry is not running: start it/);
    assert.deepEqual(r.state, ['mode 600 owner root', ...STATE_UP]);
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
  });

  test('up with the ssh session dropping (SIGPIPE) after the services stopped still restores everything', () => {
    const r = run('up-pipe-closed');
    assert.notEqual(r.exit, 0, r.output);
    assert.doesNotMatch(r.output, /summary/, 'the output really was cut off');
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(r.state, ['absent']);
    assert.equal(count(r.calls, 'restart foundry.service'), 1, r.calls.join('\n'));
    assert.equal(r.calls.at(-1), `start ${GM}`);
  });

  test('down stops the Assistant GM browser before it counts who is online', () => {
    const r = run('down-gm-active');
    assert.equal(r.exit, 0, r.output);
    const calls = notJournal(r.calls);
    assert.deepEqual(calls.slice(0, 3), [
      'is-active --quiet foundry.service',
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
  });
});

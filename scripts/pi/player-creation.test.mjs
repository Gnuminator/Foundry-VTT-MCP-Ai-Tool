// Tests for Pi stage 13 (scripts/pi/remote/13-player-creation.sh, D-112 and D-113):
//   node --test scripts/pi/player-creation.test.mjs
// - the in-browser part (player-creation-settings.mjs) against a fake `game`: the three settings, and
//   Actor Studio's per-user usage-tracking turned off (D-113), a second run changing nothing;
// - with PI_STAGE13_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the stage itself in a
//   Debian 13 ARM64 container with stand-ins for systemd (scripts/pi/container-test/stage13-scenarios.sh):
//   the downgrade guard, an unreadable /api/status ("?"), people online, the setup screen, the install
//   from a local zip, services that were off staying off, and a failed Assistant GM browser start.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyState, blockers, mismatches, readState } from './remote/player-creation-settings.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE_ID = 'foundryvtt-actor-studio';
const PACK = 'dnd-players-handbook.equipment';
const ARGS = { moduleId: MODULE_ID, pack: PACK, roles: [1, 2] };
const TRACKING = `${MODULE_ID}.usage-tracking`;

// A Setting document: Foundry keeps `value` as JSON (a JSONField), so an update with the string 'false'
// and one with the boolean false both read back as false.
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

function fakeGame({
  tracking = true,
  docs = [],
  actorCreate = [3, 4],
  equipment = false,
  sources = { equipment: null, races: ['dnd-players-handbook.origins'] },
  isGM = true,
  moduleActive = true,
} = {}) {
  const values = new Map([
    ['core.permissions', { ACTOR_CREATE: actorCreate, FILES_BROWSE: [2, 3, 4] }],
    [`${MODULE_ID}.enableEquipmentSelection`, equipment],
    [`${MODULE_ID}.compendiumSources`, sources],
  ]);
  const registered = new Map([...values.keys()].map(k => [k, {}]));
  if (tracking) registered.set(TRACKING, {});
  const sets = [];
  return {
    sets,
    docs,
    world: { id: 'curse-of-strahd' },
    user: { name: 'Gamemaster', isGM },
    modules: new Map([[MODULE_ID, { active: moduleActive }]]),
    packs: new Map([[PACK, {}]]),
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
}

describe('player-creation-settings.mjs (the in-browser part)', () => {
  before(() => {
    globalThis.CONST = {
      USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
    };
  });
  after(() => {
    delete globalThis.game;
    delete globalThis.CONST;
  });

  test('sets the three settings, keeps the roles and sources that were there, then verifies', async () => {
    globalThis.game = fakeGame();
    const start = readState(ARGS);
    assert.deepEqual(blockers(start, 'curse-of-strahd'), []);
    const changed = await applyState(ARGS);
    assert.deepEqual(changed, [
      'core.permissions ACTOR_CREATE',
      'enableEquipmentSelection',
      'compendiumSources.equipment',
    ]);
    const end = readState(ARGS);
    assert.deepEqual(end.actorCreate, [1, 2, 3, 4]);
    assert.equal(end.enableEquipmentSelection, true);
    assert.deepEqual(end.compendiumSources, {
      equipment: [PACK],
      races: ['dnd-players-handbook.origins'],
    });
    assert.deepEqual(mismatches(start, end), []);
  });

  test('turns usage-tracking off for each user who has it saved as anything but false', async () => {
    const docs = [
      settingDoc(TRACKING, 'u1', true),
      settingDoc(TRACKING, 'u2', 'yes'),
      settingDoc(TRACKING, 'u3', false),
      settingDoc(TRACKING, null, true), // not a per-user value: left alone
      settingDoc(`${MODULE_ID}.other`, 'u1', true),
    ];
    globalThis.game = fakeGame({ docs });
    const start = readState(ARGS);
    assert.equal(start.trackingOn, 2);
    assert.match(mismatches(start, start).join('; '), /usage-tracking is still on for 2 user\(s\)/);
    const changed = await applyState(ARGS);
    assert.ok(changed.includes('usage-tracking off for 2 user(s)'), changed.join(', '));
    assert.deepEqual(
      docs.map(d => d.updates),
      [1, 1, 0, 0, 0]
    );
    const end = readState(ARGS);
    assert.equal(end.trackingOn, 0);
    assert.deepEqual(mismatches(start, end), []);
  });

  test('a second run changes nothing', async () => {
    const docs = [settingDoc(TRACKING, 'u1', true)];
    globalThis.game = fakeGame({ docs });
    await applyState(ARGS);
    const setsAfterFirst = globalThis.game.sets.length;
    assert.deepEqual(await applyState(ARGS), []);
    assert.equal(globalThis.game.sets.length, setsAfterFirst);
    assert.equal(docs[0].updates, 1);
  });

  test('without the usage-tracking setting registered, tracking is reported as null and not touched', async () => {
    const docs = [settingDoc(TRACKING, 'u1', true)];
    globalThis.game = fakeGame({ tracking: false, docs });
    assert.equal(readState(ARGS).trackingOn, null);
    const changed = await applyState(ARGS);
    assert.ok(!changed.some(c => c.startsWith('usage-tracking')), changed.join(', '));
    assert.equal(docs[0].updates, 0);
  });

  test('blockers name a non-GM login, an inactive module and the wrong world', () => {
    globalThis.game = fakeGame({ isGM: false, moduleActive: false });
    const problems = blockers(readState(ARGS), 'strahd-kit').join('; ');
    assert.match(problems, /joined world curse-of-strahd, expected strahd-kit/);
    assert.match(problems, /Gamemaster is not a GM/);
    assert.match(problems, /module is not active/);
  });

  test('run as a script (also through a symlinked folder), main() runs and stops on the missing TOOL_APP', () => {
    const script = path.join(repo, 'scripts', 'pi', 'remote', 'player-creation-settings.mjs');
    const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' };
    const direct = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    assert.equal(direct.status, 1, direct.stdout + direct.stderr);
    assert.match(direct.stdout + direct.stderr, /TOOL_APP is not set/);

    // Node gives import.meta.url the real path but keeps the link in argv[1]; the guard must still be true.
    const dir = mkdtempSync(path.join(tmpdir(), 'pc-link-'));
    const link = path.join(dir, 'remote');
    try {
      symlinkSync(path.dirname(script), link, 'junction');
      const viaLink = spawnSync(
        process.execPath,
        [path.join(link, 'player-creation-settings.mjs')],
        {
          encoding: 'utf8',
          env,
        }
      );
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

  test('mismatches catch a lost role and a changed compendium source', () => {
    globalThis.game = fakeGame();
    const start = readState(ARGS);
    const end = {
      ...start,
      actorCreate: [1, 2, 4],
      enableEquipmentSelection: true,
      compendiumSources: { equipment: [PACK], races: [] },
    };
    const problems = mismatches(start, end).join('; ');
    assert.match(problems, /ACTOR_CREATE lost role 3/);
    assert.match(problems, /another compendium source changed/);
  });
});

// ---- the stage in an ARM64 container ------------------------------------------------------------------
// PI_STAGE13_OUTPUT=<file> checks a saved stage13-scenarios.sh output instead of starting Docker.
const saved = process.env.PI_STAGE13_OUTPUT;
const containerReason = saved
  ? false
  : !process.env.PI_STAGE13_CONTAINER
    ? 'set PI_STAGE13_CONTAINER=1 to run the stage in a Docker ARM64 container'
    : spawnSync('docker', ['version'], { encoding: 'utf8' }).status !== 0 && 'no Docker here';
// In CI a missing Docker is a failure, not a skip: the step would go green without running a scenario.
const noDockerInCi = Boolean(process.env.CI) && containerReason === 'no Docker here';
// Debian 13 (trixie), pinned by digest so a new upstream image cannot change a required check overnight.
// Update: docker buildx imagetools inspect debian:13 (the index digest, not one platform's).
const IMAGE = 'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';

// About 30 minutes under QEMU emulation on a PC, a few minutes on an ARM runner.
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
      '/repo/scripts/pi/container-test/stage13-scenarios.sh',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 45 * 60_000 }
  );
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}${res.error ? `\n${res.error.message}` : ''}`;
}

test('the container suite has Docker when CI asks for it', { skip: !noDockerInCi }, () => {
  assert.fail('PI_STAGE13_CONTAINER=1 and CI are set, but `docker version` failed');
});

describe('13-player-creation.sh in an ARM64 container', { skip: containerReason }, () => {
  /** @type {Map<string, {output: string, exit: number, calls: string[], world: string, version: string, prev: string[]}>} */
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
        runs.set(name, {
          output: part('output'),
          exit: Number(block.match(/^--- exit (\d+)$/m)?.[1]),
          calls: part('calls').split('\n').filter(Boolean),
          world: part('options.json'),
          version: part('module version'),
          prev: part('prev').split('\n').filter(Boolean),
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
  const PINNED = '2.10.5-aitool.4';
  const GOOD_CALLS = [
    'is-active --quiet foundry.service',
    'is-active --quiet foundry-ai-tool-gm-browser.service',
    'stop foundry-ai-tool-gm-browser.service',
    'stop foundry.service',
    'start foundry.service',
    'stop foundry.service',
    'start foundry.service',
    'stop foundry.service',
    'restart foundry.service',
    'restart foundry-ai-tool-gm-browser.service',
    'is-active --quiet foundry-ai-tool-gm-browser.service',
  ];

  test('a good run sets both worlds (kit first), puts options.json back and restarts both services', () => {
    const r = run('good');
    assert.equal(r.exit, 0, r.output);
    assert.deepEqual(
      r.calls.filter(c => !c.startsWith('journalctl')),
      GOOD_CALLS
    );
    assert.match(r.output, /WORLD=strahd-kit HAS_PW=true[\s\S]*WORLD=curse-of-strahd HAS_PW=true/);
    assert.match(r.output, /HOME=\/var\/lib\/foundry-ai-tool TOOL_APP=\/opt\/foundry-ai-tool\/app/);
    assert.doesNotMatch(r.output, /secret123/);
    assert.match(r.output, /the Assistant GM browser joined the world/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.version, PINNED);
    assert.deepEqual(r.prev, [
      'worlds/curse-of-strahd/settings/000001.log',
      'worlds/strahd-kit/settings/000001.log',
    ]);
  });

  for (const [name, reason] of [
    ['status-unreadable', /cannot read who is online in Foundry/],
    ['status-html', /cannot read who is online in Foundry/],
    ['users-online', /2 user\(s\) are online in Foundry/],
  ]) {
    test(`${name}: refused before Foundry stops; the Assistant GM browser comes back`, () => {
      const r = run(name);
      assert.equal(r.exit, 1, r.output);
      assert.match(r.output, reason);
      assert.equal(count(r.calls, 'stop foundry.service'), 0, r.calls.join('\n'));
      assert.equal(count(r.calls, 'restart foundry.service'), 0);
      assert.equal(r.calls.at(-1), 'start foundry-ai-tool-gm-browser.service');
      assert.equal(r.world, 'curse-of-strahd');
      assert.deepEqual(r.prev, []);
    });
  }

  test('FORCE=1 goes on when /api/status cannot be read', () => {
    const r = run('status-unreadable-force');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /cannot read who is online \(\/api\/status\); FORCE=1/);
    assert.deepEqual(
      r.calls.filter(c => !c.startsWith('journalctl')),
      GOOD_CALLS
    );
  });

  test('the setup screen (no users field) counts as nobody online', () => {
    const r = run('setup-screen');
    assert.equal(r.exit, 0, r.output);
    assert.doesNotMatch(r.output, /WARNING: .*online/);
  });

  test('a newer installed build is refused before anything stops (the downgrade guard)', () => {
    const r = run('downgrade-refused');
    assert.equal(r.exit, 1, r.output);
    assert.match(
      r.output,
      /2\.10\.5-aitool\.9 is newer than 2\.10\.5-aitool\.4: .*ALLOW_DOWNGRADE=1/
    );
    assert.deepEqual(r.calls, []);
    assert.equal(r.version, '2.10.5-aitool.9');
  });

  test('ALLOW_DOWNGRADE=1 replaces the newer build and keeps it in prev', () => {
    const r = run('downgrade-allowed');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /ALLOW_DOWNGRADE=1, replacing it/);
    assert.equal(r.version, PINNED);
    assert.ok(r.prev.includes('modules/foundryvtt-actor-studio/module.json'), r.prev.join('\n'));
  });

  test('an older build is upgraded from the checked zip, the old one kept in prev', () => {
    const r = run('upgrade');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /sha256 matches/);
    assert.match(r.output, /only files and folders, all inside the module folder/);
    assert.equal(r.version, PINNED);
    assert.ok(r.prev.includes('modules/foundryvtt-actor-studio/module.json'), r.prev.join('\n'));
  });

  test('Foundry off before the run: no /api/status check, Foundry left stopped', () => {
    const r = run('foundry-off');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /Foundry was not running before this run: left stopped/);
    assert.equal(count(r.calls, 'restart foundry.service'), 0);
    assert.equal(r.calls.filter(c => c.startsWith('start foundry.service')).length, 2);
    assert.ok(r.calls.includes('restart foundry-ai-tool-gm-browser.service'));
    assert.ok(!r.calls.some(c => c.startsWith('journalctl')), 'no wait for "joined world"');
  });

  test('both services off before the run: the settings are set, both stay off', () => {
    const r = run('services-off');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /left stopped/);
    assert.match(r.output, /the Assistant GM browser was not running before this run: left off/);
    assert.equal(r.calls.at(-1), 'stop foundry.service');
    assert.ok(!r.calls.some(c => /^(re)?start foundry-ai-tool-gm-browser/.test(c)));
    assert.equal(r.world, 'curse-of-strahd');
  });

  test('a failed Assistant GM browser start fails the run but restarts Foundry only once', () => {
    const r = run('gm-browser-fails');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /the Assistant GM browser did not start/);
    assert.equal(count(r.calls, 'restart foundry.service'), 1, r.calls.join('\n'));
    assert.equal(r.calls.at(-1), 'start foundry-ai-tool-gm-browser.service');
    assert.equal(r.world, 'curse-of-strahd');
  });

  test('another WORLD without KIT_WORLD is refused before anything stops (no strahd-kit default)', () => {
    const r = run('training-needs-kit-world');
    assert.equal(r.exit, 1, r.output);
    assert.match(r.output, /WORLD=frostmaiden-training needs KIT_WORLD set/);
    assert.deepEqual(r.calls, []);
  });

  test('the training world with KIT_WORLD= sets only that world and leaves strahd-kit alone', () => {
    const r = run('training-world');
    assert.equal(r.exit, 0, r.output);
    assert.match(r.output, /WORLD=frostmaiden-training HAS_PW=true/);
    assert.doesNotMatch(r.output, /WORLD=(strahd-kit|curse-of-strahd) HAS_PW/);
    assert.doesNotMatch(r.output, /secret123/);
    assert.equal(r.world, 'curse-of-strahd');
  });
});

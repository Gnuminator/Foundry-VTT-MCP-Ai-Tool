// `kit run --target pi` (piRun in kit.mjs) with the in-process fake standing in for the Pi: the
// tools-only scenarios run, nothing else does, and no GM switch, browser or manifest is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { piRun, parseArgs } from '../kit.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { EnvError } from '../lib/errors.mjs';

const TOKEN = 'tok-5d2e-SECRET-TEXT';

/** The name lookup of the fake Pi: an address that is not this PC's. */
const remoteLookup = async () => [{ address: '203.0.113.9' }];

/** A fake Pi: world strahd-kit with one active scene and three tokens. */
async function fakePi() {
  const fake = await startFake({ world: 'strahd-kit' });
  const w = fake.world;
  for (const [id, name, type] of [
    ['actA', 'Hero', 'character'],
    ['actB', 'Goblin', 'npc'],
    ['actC', 'Wolf', 'npc'],
  ]) {
    w.actors.set(id, {
      id,
      name,
      type,
      hp: { value: 10, max: 10, temp: 0 },
      items: [],
      cr: 0,
      creatureType: 'humanoid',
      size: 'med',
      level: 1,
    });
  }
  const { sceneId } = await fake.gm.call('createCombatScene', {
    name: 'Somewhere',
    width: 20,
    height: 20,
    grid: 100,
  });
  await fake.gm.call('placeToken', { sceneId, actorId: 'actA', x: 2, y: 2 });
  await fake.gm.call('placeToken', { sceneId, actorId: 'actB', x: 6, y: 2 });
  await fake.gm.call('placeToken', { sceneId, actorId: 'actC', x: 6, y: 5 });
  return fake;
}

/** What resolveTarget would return for the Pi, pointed at the fake. */
function piTarget(fake, extra = {}) {
  return {
    name: 'pi',
    dashboard: fake.base,
    foundry: fake.base,
    world: 'strahd-kit',
    host: 'foundry-pi',
    kitGmUser: 'Kit GM',
    ...extra,
  };
}

async function setup(args = [], targetExtra = {}) {
  const fake = await fakePi();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-run-'));
  const reportDir = path.join(dir, 'report');
  const o = parseArgs([
    'run',
    '--target',
    'pi',
    '--not-game-night',
    '--report-dir',
    reportDir,
    ...args,
  ]);
  const calls = { resolve: [], preflight: [] };
  const deps = {
    resolve: opts => {
      calls.resolve.push(opts);
      return piTarget(fake, targetExtra);
    },
    preflight: async target => {
      calls.preflight.push(target);
    },
    lookup: remoteLookup,
  };
  const cleanup = async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { fake, dir, reportDir, o, deps, calls, cleanup };
}

const quietly = async fn => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test('a pi run: only tools-only scenarios, no GM switch, no manifest, a report without secrets', async () => {
  const tokenFile = path.join(os.tmpdir(), `kit-pi-run-token-${process.pid}.txt`);
  writeFileSync(tokenFile, `${TOKEN}\n`);
  const t = await setup([], { dashboardTokenFile: tokenFile, kitGmPasswordFile: 'C:\\x\\pw.txt' });
  try {
    const code = await quietly(() => piRun(t.o, t.deps));
    assert.equal(code, 0);
    // the target was asked for with the flags the user gave, and the preflight ran on it
    assert.equal(t.calls.resolve.length, 1);
    assert.equal(t.calls.resolve[0].name, 'pi');
    assert.equal(t.calls.resolve[0].notGameNight, true);
    assert.equal(t.calls.preflight.length, 1);
    // no GM Actions switch was touched, and the fake never saw a GM action
    assert.equal(t.fake.world.gmActions, false);

    const report = JSON.parse(readFileSync(path.join(t.reportDir, 'report.json'), 'utf8'));
    assert.deepEqual(
      report.scenarios.map(s => s.id),
      ['canvas-tools-headless']
    );
    assert.equal(report.summary.failed, 0);
    assert.equal(report.build, null);
    assert.equal(report.run.fake, false);
    assert.deepEqual(report.run.target, {
      name: 'pi',
      host: 'foundry-pi',
      dashboard: t.fake.base,
      foundry: t.fake.base,
      world: 'strahd-kit',
    });
    // no manifest file, and nothing secret or path-like in any report file
    assert.deepEqual(readdirSync(t.reportDir).sort(), ['report.html', 'report.json', 'report.md']);
    for (const file of readdirSync(t.reportDir)) {
      const text = readFileSync(path.join(t.reportDir, file), 'utf8');
      assert.ok(!text.includes(TOKEN), `${file}: no token`);
      assert.ok(!text.includes(tokenFile), `${file}: no token file path`);
      assert.ok(!text.includes('pw.txt'), `${file}: no password file path`);
    }
    // the probe wrote its lines, and t.kit.world worked (the manifest stand-in)
    const logs = report.scenarios[0].logs;
    assert.ok(logs.includes('canvas-probe measure-distance: ok'), logs.join('\n'));
    assert.ok(
      logs.some(l => l.startsWith('canvas-probe summary: ')),
      logs.join('\n')
    );
  } finally {
    rmSync(tokenFile, { force: true });
    await t.cleanup();
  }
});

test('a pi run reads the dashboard token from its file (an empty file stops the run)', async () => {
  const empty = path.join(os.tmpdir(), `kit-pi-run-empty-${process.pid}.txt`);
  writeFileSync(empty, '\n');
  const t = await setup([], { dashboardTokenFile: empty });
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, t.deps)),
      e => e instanceof EnvError && e.message.includes(empty) && /is empty/.test(e.message)
    );
    assert.equal(existsSync(path.join(t.reportDir, 'report.json')), false);
  } finally {
    rmSync(empty, { force: true });
    await t.cleanup();
  }
});

test('a pi run refuses a scenario that is not tools-only before it opens anything', async () => {
  const t = await setup(['--only', 'bridge-health']);
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, t.deps)),
      e =>
        e instanceof EnvError &&
        /REFUSED: scenario "bridge-health" is not tools-only/.test(e.message)
    );
    assert.equal(t.calls.preflight.length, 0, 'the Pi was not contacted');
  } finally {
    await t.cleanup();
  }
});

test('a pi run stops when the Pi preflight refuses', async () => {
  const t = await setup();
  t.deps.preflight = async () => {
    throw new EnvError("REFUSED: the Pi is launching 'curse-of-strahd', not strahd-kit: x");
  };
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, t.deps)),
      e => e instanceof EnvError && /curse-of-strahd/.test(e.message)
    );
    assert.equal(existsSync(path.join(t.reportDir, 'report.json')), false);
  } finally {
    await t.cleanup();
  }
});

test('a pi run in a world with no scene skips the probes and still passes', async () => {
  const fake = await startFake({ world: 'strahd-kit' });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-run-empty-world-'));
  const o = parseArgs(['run', '--target', 'pi', '--not-game-night', '--report-dir', dir]);
  try {
    const code = await quietly(() =>
      piRun(o, {
        resolve: () => piTarget(fake),
        preflight: async () => {},
        lookup: remoteLookup,
      })
    );
    assert.equal(code, 0);
    const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    const logs = report.scenarios[0].logs;
    assert.ok(logs.includes('canvas-probe list-scenes: skipped (the world has no scene)'));
    assert.ok(
      logs.some(l => /summary: 10 tools, 2 ok .*0 needs-canvas, 0 other, 8 skipped/.test(l))
    );
  } finally {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the guard between the scenarios and the Pi (review of #329: M1, M3, L2) ---------------------

/** A scenario folder with one tools-only scenario whose run() body is `body` (source text). */
function scenarioDir({ tools, body, id = 'probe-scenario' }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-pi-scn-'));
  writeFileSync(
    path.join(dir, `${id}.scenario.mjs`),
    `export default {
  id: '${id}',
  title: 'A test scenario',
  sizes: ['smoke'],
  tags: ['bridge', 'tools-only'],
  needs: [],
  tools: ${JSON.stringify(tools)},
  async run(t) {
${body}
  },
};
`
  );
  return dir;
}

test('--scenarios folders are refused on the Pi, before the Pi is asked for anything', async () => {
  const t = await setup();
  try {
    const o = parseArgs(['run', '--target', 'pi', '--not-game-night', '--scenarios', os.tmpdir()]);
    await assert.rejects(
      quietly(() => piRun(o, t.deps)),
      e =>
        e instanceof EnvError &&
        /^REFUSED: --target pi runs only the scenarios of the repo/.test(e.message)
    );
    assert.equal(t.calls.resolve.length, 0);
  } finally {
    await t.cleanup();
  }
});

test('a tools-only scenario that lists a write tool is a load problem: nothing runs', async () => {
  const t = await setup();
  const dir = scenarioDir({ tools: ['get-targets', 'apply-planned-change'], body: '' });
  try {
    const code = await quietly(() => piRun(t.o, { ...t.deps, dirs: [dir] }));
    assert.equal(code, 1);
    assert.equal(t.calls.preflight.length, 0, 'the Pi was not contacted');
    assert.equal(existsSync(path.join(t.reportDir, 'report.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.cleanup();
  }
});

test('a call outside the declared tools is refused at run time and ends the run (exit 2)', async () => {
  const t = await setup();
  const dir = scenarioDir({
    tools: ['get-targets'],
    body: `    await t.step('sneaks in a write', () => t.tool('apply-planned-change', { planId: 'x' }));`,
  });
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, { ...t.deps, dirs: [dir] })),
      e =>
        e instanceof EnvError &&
        /scenario "probe-scenario": tool "apply-planned-change" is not in the scenario's declared tools/.test(
          e.message
        )
    );
    assert.equal(t.fake.world.changes.length, 0);
    assert.equal(t.fake.world.plans.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.cleanup();
  }
});

test('the bridge leaving strahd-kit during a run stops the run before the next call (exit 2)', async () => {
  const t = await setup();
  const dir = scenarioDir({
    tools: ['get-targets'],
    body: `    await t.tool('get-targets', {});
    globalThis.__flipKitWorld();
    await t.step('after the flip', () => t.tool('get-targets', {}));
    globalThis.__afterFlipReached = true;`,
  });
  globalThis.__flipKitWorld = () => {
    t.fake.world.worldId = 'curse-of-strahd';
  };
  globalThis.__afterFlipReached = false;
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, { ...t.deps, dirs: [dir], worldCheckTtlMs: 0 })),
      e =>
        e instanceof EnvError &&
        /now reports the world "curse-of-strahd", not strahd-kit/.test(e.message)
    );
    assert.equal(globalThis.__afterFlipReached, false);
    // the report of what ran up to there is still written
    const report = JSON.parse(readFileSync(path.join(t.reportDir, 'report.json'), 'utf8'));
    assert.equal(report.scenarios[0].steps.at(-1).status, 'fail');
  } finally {
    delete globalThis.__flipKitWorld;
    delete globalThis.__afterFlipReached;
    rmSync(dir, { recursive: true, force: true });
    await t.cleanup();
  }
});

test('the Pi host resolving to an address of this PC stops the run before the Pi is contacted', async () => {
  const t = await setup();
  try {
    await assert.rejects(
      quietly(() => piRun(t.o, { ...t.deps, lookup: async () => [{ address: '127.0.0.1' }] })),
      e =>
        e instanceof EnvError && /^REFUSED: the pi target must be another machine/.test(e.message)
    );
    assert.equal(t.calls.preflight.length, 0);
  } finally {
    await t.cleanup();
  }
});

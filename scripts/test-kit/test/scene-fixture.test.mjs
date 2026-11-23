// The scene fixture (lib/scene-fixture.mjs, `kit fixture`) against the in-process fake: it makes a
// scene with two named tokens and a party group, a second run changes nothing, and the Pi target
// refuses the command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneFixture, FIXTURE_ACTORS, FIXTURE_SCENE } from '../lib/scene-fixture.mjs';
import { checkPiOptions, parseArgs } from '../kit.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { EnvError } from '../lib/errors.mjs';

test('the fixture makes a scene, two named tokens and a party group, once', async () => {
  const fake = await startFake({ world: 'strahd-kit' });
  try {
    const dashboard = createDashboardClient({ base: fake.base });
    const first = await buildSceneFixture({ gm: fake.gm, dashboard });
    assert.equal(first.created, true);
    assert.equal(first.tokenIds.length, 2);
    const scenes = [...fake.world.scenes.values()].filter(s => s.name === FIXTURE_SCENE);
    assert.equal(scenes.length, 1);
    const names = [...fake.world.tokens.values()].map(t => t.name).sort();
    assert.deepEqual(names, [...FIXTURE_ACTORS].sort());

    const second = await buildSceneFixture({ gm: fake.gm, dashboard });
    assert.equal(second.created, false);
    assert.equal(second.groupId, first.groupId);
    assert.equal([...fake.world.scenes.values()].length, 1);
    assert.equal(fake.world.tokens.size, 2);
  } finally {
    await fake.close();
  }
});

test('a fixture scene left without tokens by an interrupted run gets them on the next run', async () => {
  const fake = await startFake({ world: 'strahd-kit' });
  try {
    const dashboard = createDashboardClient({ base: fake.base });
    await buildSceneFixture({ gm: fake.gm, dashboard });
    fake.world.tokens.clear();
    const logs = [];
    const again = await buildSceneFixture({ gm: fake.gm, dashboard, log: l => logs.push(l) });
    assert.equal(again.created, false);
    assert.equal(again.tokenIds.length, 2);
    assert.equal(fake.world.tokens.size, 2);
    assert.ok(logs.includes('2 tokens placed'), logs.join(' | '));
    // A third run finds both tokens and places nothing.
    const third = await buildSceneFixture({ gm: fake.gm, dashboard });
    assert.deepEqual([...third.tokenIds].sort(), [...again.tokenIds].sort());
    assert.equal(fake.world.tokens.size, 2);
  } finally {
    await fake.close();
  }
});

test('--target pi refuses the fixture command', () => {
  const o = parseArgs(['fixture', '--target', 'pi']);
  assert.throws(() => checkPiOptions(o), EnvError);
});

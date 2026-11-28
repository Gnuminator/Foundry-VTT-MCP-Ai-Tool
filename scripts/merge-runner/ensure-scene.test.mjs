import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureTestScene } from './ensure-scene.mjs';

/** A fake GM page: evaluate runs the real in-page function against a fake `game`. */
function fakePage(scenes) {
  const calls = [];
  const game = { scenes: { getName: n => list.find(s => s.name === n) }, canvas: { scene: null } };
  const list = scenes.map(s => {
    const scene = {
      id: s.name,
      name: s.name,
      active: s.active,
      activate: async () => {
        calls.push(`activate ${s.name}`);
        if (s.activeAfter ?? true) scene.active = true;
      },
      view: async () => {
        calls.push(`view ${s.name}`);
        game.canvas.scene = scene;
      },
    };
    return scene;
  });
  return {
    calls,
    evaluate: async (fn, arg) => {
      globalThis.game = game;
      try {
        return await fn(arg);
      } finally {
        delete globalThis.game;
      }
    },
  };
}

test('activates and views Test Arena when no scene is active', async () => {
  const page = fakePage([{ name: 'Test Arena', active: false }]);
  assert.equal(await ensureTestScene(page), 'activated Test Arena');
  assert.deepEqual(page.calls, ['activate Test Arena', 'view Test Arena']);
});

test('does not re-activate a scene that is already active', async () => {
  const page = fakePage([{ name: 'Test Arena', active: true }]);
  assert.equal(await ensureTestScene(page), 'Test Arena is already active');
  assert.ok(!page.calls.includes('activate Test Arena'));
});

test('fails with one clear line when the scene is missing', async () => {
  await assert.rejects(
    ensureTestScene(fakePage([{ name: 'Other', active: true }])),
    /the scene "Test Arena" does not exist in the world/
  );
});

test('fails with one clear line when activation does not take', async () => {
  await assert.rejects(
    ensureTestScene(fakePage([{ name: 'Test Arena', active: false, activeAfter: false }])),
    /would not become the active scene/
  );
});

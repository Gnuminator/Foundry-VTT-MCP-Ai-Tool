import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKit } from '../lib/builder.mjs';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { createDashboardClient } from '../lib/dashboard.mjs';
import { startFake } from '../lib/fake/index.mjs';
import { loadScenarios } from '../lib/loader.mjs';
import { loadProfile } from '../lib/profiles.mjs';
import { runScenariosDetailed } from '../lib/runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.join(here, '..', 'kit.mjs');
const repoRoot = path.resolve(here, '..', '..', '..');
const WORLD = 'ai-tool-kit-srd';

test('all --fake builds the fake class compendium: coverage, profile and no console errors', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-heroes-'));
  try {
    const run = spawnSync(
      process.execPath,
      [kit, 'all', '--fake', '--report-dir', path.join(dir, 'r')],
      { encoding: 'utf8', timeout: 150000, env: { ...process.env, TEST_KIT_HOME: dir } }
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(path.join(dir, 'r', 'report.json'), 'utf8'));
    assert.equal(report.build.profile, 'srd');
    assert.deepEqual(report.build.consoleErrors, []);
    assert.deepEqual(report.build.coverage.classes, { found: 6, built: 6 });
    assert.deepEqual(report.build.coverage.subclasses, { found: 7, built: 6, failed: [] });
    const md = readFileSync(path.join(dir, 'r', 'report.md'), 'utf8');
    assert.match(md, /- Profile: srd/);
    assert.match(md, /## Coverage/);
    assert.match(md, /- Classes: 6 built of 6 found/);
    assert.match(md, /## Build console errors/);
    const html = readFileSync(path.join(dir, 'r', 'report.html'), 'utf8');
    assert.match(html, /<span>Profile srd<\/span>/);
    assert.match(html, /<h2>Coverage<\/h2>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('all --fake --size full: every class at four levels, every subclass at level 20', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-heroes-'));
  try {
    const run = spawnSync(
      process.execPath,
      [kit, 'all', '--size', 'full', '--fake', '--report-dir', path.join(dir, 'r')],
      { encoding: 'utf8', timeout: 150000, env: { ...process.env, TEST_KIT_HOME: dir } }
    );
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(path.join(dir, 'r', 'report.json'), 'utf8'));
    // 6 classes x 4 tier levels, then 7 subclasses (the legacy Champion is skipped: a 2024 one exists).
    assert.equal(report.build.heroes.length, 6 * 4 + 7);
    assert.equal(report.build.coverage.heroes, 31);
    assert.deepEqual(report.build.coverage.subclasses, { found: 7, built: 7, failed: [] });
    const owners = report.build.heroes.filter((/** @type {any} */ h) => h.owner);
    assert.deepEqual(
      owners.map((/** @type {any} */ h) => h.owner),
      ['Kit Player']
    );
    const advancement = report.scenarios.find(
      (/** @type {any} */ s) => s.id === 'heroes-advancement'
    );
    assert.equal(advancement.status, 'pass');
    assert.equal(advancement.steps.length, 31);
    assert.equal(advancement.attachments[0].data.heroesFailed, 0);
    assert.equal(report.summary.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Builds a smoke kit on the fake, lets `damage` break something, and runs heroes-advancement.
 * @param {(world: import('../lib/fake/state.mjs').World, manifest: any) => void} damage
 */
async function runHeroesAdvancement(damage) {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const manifest = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      size: 'smoke',
      profile: loadProfile('srd'),
    });
    damage(fake.world, manifest);
    const catalog = await loadToolCatalog(repoRoot);
    const { scenarios } = await loadScenarios([path.join(here, '..', 'scenarios')], {
      size: 'smoke',
      only: ['heroes-advancement'],
      catalog,
    });
    const { results } = await runScenariosDetailed(scenarios, {
      dashboard,
      gm: fake.gm,
      manifest,
      fake: true,
    });
    return results[0];
  } finally {
    await fake.close();
  }
}

/** @param {any} manifest @param {string} name */
const heroNamed = (manifest, name) =>
  manifest.heroes.find((/** @type {any} */ h) => h.name === name);

test('heroes-advancement: a hero that misses a grant fails with a SYSTEM message that names it', async () => {
  const result = await runHeroesAdvancement((world, manifest) => {
    const actor = world.actors.get(heroNamed(manifest, 'Kit Fighter 5').actorId);
    assert.ok(actor);
    actor.items = actor.items.filter(i => i.name !== 'Fighter Mastery');
  });
  assert.equal(result.status, 'fail');
  const failed = result.steps.filter(s => s.status === 'fail');
  assert.equal(failed.length, 1);
  assert.match(failed[0].label, /^Kit Fighter 5: fighter 5 \(champion\)$/);
  assert.match(
    failed[0].error?.message ?? '',
    /^\[SYSTEM\] 1 grant\(s\) missing: Fighter Mastery \(level 5\)/
  );
  // Every other hero still passed, and the coverage says what failed and how.
  assert.equal(result.steps.filter(s => s.status === 'pass').length, 5);
  const coverage = result.attachments.find(a => a.name === 'coverage');
  assert.deepEqual(/** @type {any} */ (coverage?.data).problemsByKind, {
    KIT: 0,
    CONTENT: 0,
    SYSTEM: 1,
  });
  assert.equal(/** @type {any} */ (coverage?.data).heroesFailed, 1);
});

test('heroes-advancement: a grant that does not resolve is a CONTENT failure', async () => {
  const result = await runHeroesAdvancement(world => {
    world.faults.unresolved.add('Cleric Mastery');
  });
  const failed = result.steps.filter(s => s.status === 'fail');
  assert.deepEqual(
    failed.map(s => s.label.split(':')[0]),
    ['Kit Cleric 5']
  );
  assert.match(
    failed[0].error?.message ?? '',
    /^\[CONTENT\] 1 grant uuid\(s\) do not resolve: level 5 Compendium\./
  );
});

test('heroes-advancement: wrong hit points are a KIT failure with the sum worked out', async () => {
  const result = await runHeroesAdvancement((world, manifest) => {
    const actor = world.actors.get(heroNamed(manifest, 'Kit Wizard 5').actorId);
    assert.ok(actor);
    actor.hp.max += 5;
    actor.hp.value += 5;
  });
  const failed = result.steps.filter(s => s.status === 'fail');
  assert.equal(failed.length, 1);
  const message = failed[0].error?.message ?? '';
  assert.match(
    message,
    /^\[KIT\] hit points: max 32, expected 27 = 22 \(d6 average\) \+ 1 CON x 5/
  );
  assert.match(message, /\(\+1 per level off\)/);
});

test('heroes-advancement: a hero the builder could not build fails with its build error, classified', async () => {
  const result = await runHeroesAdvancement((world, manifest) => {
    const row = heroNamed(manifest, 'Kit Rogue 5');
    row.buildError = 'createHero: class: stuck after answering Rogue / ItemChoice';
    row.actorId = '';
  });
  const failed = result.steps.filter(s => s.status === 'fail');
  assert.equal(failed.length, 1);
  assert.match(
    failed[0].error?.message ?? '',
    /^\[KIT\] the hero was not built: createHero: class: stuck after answering/
  );
});

test('the fake player screen shows a player character HP as numbers and keeps monsters hidden', async () => {
  const fake = await startFake({ world: WORLD });
  try {
    const dashboard = createDashboardClient({ base: fake.base, token: '' });
    const manifest = await buildKit({
      dashboard,
      gm: fake.gm,
      world: WORLD,
      profile: loadProfile('srd'),
    });
    const hero = manifest.heroes.find(h => h.owner && h.tokenId);
    assert.ok(hero);
    const monster = manifest.monsters[0];
    const combat = await fake.gm.call('startCombat', {
      sceneId: manifest.scene.sceneId,
      tokenIds: [hero.tokenId, monster.tokenId],
    });
    const state = (await dashboard.http('/api/player/state')).data;
    const rows = new Map(state.combat.combatants.map((/** @type {any} */ c) => [c.id, c]));
    const pc = /** @type {any} */ (rows.get(combat.combatantIds[0]));
    const npc = /** @type {any} */ (rows.get(combat.combatantIds[1]));
    const real = await fake.gm.call('readActor', { actorId: hero.actorId });
    assert.equal(pc.isPC, true);
    assert.equal(pc.name, hero.name);
    assert.deepEqual(pc.hp, { value: real.hp.value, max: real.hp.max, temp: 0 });
    assert.equal(npc.isPC, false);
    assert.equal(npc.hp, null);
    assert.equal(npc.name, 'Unknown creature');
  } finally {
    await fake.close();
  }
});

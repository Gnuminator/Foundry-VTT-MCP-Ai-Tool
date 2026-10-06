/**
 * The bridge, the dashboard and the module are up and agree: health, the world, the module
 * version, every catalogued tool offered, and the kit's own documents visible through the tools.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolCatalog } from '../lib/catalog.mjs';
import { builtHeroes, listOf, tokenHeroes } from '../lib/helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'bridge-health',
  title: 'The bridge, dashboard and module are up and the kit is visible',
  sizes: ['smoke', 'full'],
  tags: ['bridge', 'dashboard', 'module'],
  needs: ['heroes', 'monsters', 'scene'],
  tools: [
    'get-world-info',
    'list-characters',
    'list-scenes',
    'get-current-scene',
    'search-compendium',
  ],
  gmActions: ['worldStatus'],
  timeoutMs: 60000,

  async run(t) {
    await t.step('the dashboard is healthy and linked to Foundry', async () => {
      const { status, data } = await t.http('/api/health');
      t.equal(status, 200, 'GET /api/health status');
      t.check(data && data.ok === true, '/api/health says ok', data);
      t.equal(data.controlChannel, 'connected', 'control channel');
    });

    await t.step('get-world-info names the kit world', async () => {
      const info = await t.tool('get-world-info', {});
      t.equal(info.id, t.kit.world, 'world id');
      t.equal(info.system && info.system.id, 'dnd5e', 'game system');
    });

    await t.step('the module is active and matches the repo version', async () => {
      const status = await t.gm('worldStatus');
      t.equal(status.worldId, t.kit.world, 'GM page world');
      t.check(status.moduleActive === true, 'the foundry-mcp-bridge module is active', status);
      const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      t.equal(status.moduleVersion, pkg.version, 'module version equals the repo version');
    });

    await t.step('/api/tools offers every tool of every set', async () => {
      const catalog = await loadToolCatalog(repoRoot);
      const { status, data } = await t.http('/api/tools');
      t.equal(status, 200, 'GET /api/tools status');
      const offered = new Set((data.tools || []).map((/** @type {any} */ x) => x.name));
      const missing = [...catalog.all].filter(name => !offered.has(name)).sort();
      t.check(
        missing.length === 0,
        `tools missing from /api/tools: ${missing.join(', ')}`,
        missing
      );
      return `${offered.size} offered, ${catalog.all.size} catalogued`;
    });

    await t.step('list-characters has every kit hero', async () => {
      const result = await t.tool('list-characters', {});
      const ids = new Set(listOf(result, 'characters').map(c => c.id));
      const heroes = builtHeroes(t.kit);
      const missing = heroes.filter(h => !ids.has(h.actorId)).map(h => h.name);
      t.check(missing.length === 0, `heroes missing from list-characters: ${missing.join(', ')}`);
      return `${heroes.length} heroes of ${ids.size} characters`;
    });

    await t.step('list-scenes and get-current-scene show the kit scene', async () => {
      const scenes = listOf(await t.tool('list-scenes', {}), 'scenes');
      const found = scenes.find(s => s.id === t.kit.scene.sceneId);
      t.check(found, `list-scenes lacks the kit scene ${t.kit.scene.name}`);
      t.equal(found.name, t.kit.scene.name, 'scene name in list-scenes');
      const current = await t.tool('get-current-scene', {});
      t.equal(current.id, t.kit.scene.sceneId, 'active scene id');
      const tokenIds = new Set((current.tokens || []).map((/** @type {any} */ x) => x.id));
      const wanted = [...tokenHeroes(t.kit), ...t.kit.monsters].map(x => x.tokenId);
      const missing = wanted.filter(id => !tokenIds.has(id));
      t.check(missing.length === 0, `${missing.length} kit tokens are not on the active scene`);
    });

    await t.step('search-compendium finds a kit monster by name', async () => {
      const monster = t.kit.monsters[0];
      const compendiumName = monster.name.replace(/^Kit /, '');
      const result = await t.tool('search-compendium', { query: compendiumName });
      const hit = listOf(result, 'results').find(r => r.id === monster.itemId);
      t.check(
        hit,
        `search-compendium "${compendiumName}" did not return ${monster.packId}.${monster.itemId}`
      );
      t.equal(hit.pack && hit.pack.id, monster.packId, 'pack of the hit');
    });
  },
};

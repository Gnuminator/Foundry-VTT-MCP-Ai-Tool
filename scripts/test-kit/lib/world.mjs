/**
 * The kit's own worlds: create a world's folder (world.json only; Foundry makes the databases on
 * first launch) and provision it once it runs (the bridge module and the profile's modules on,
 * kit users, bridge user). Never deletes anything and refuses worlds that are not in KIT_WORLDS.
 * The world and its title come from the content profile (profiles.mjs).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KIT_GM_USER, KIT_PLAYER_USER, KIT_WORLDS } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { assertKitWorld, collectErrors, joinGame, launchBrowser, waitForGame } from './gm.mjs';

const MODULE_ID = 'foundry-mcp-bridge';
const DEFAULT_GM = 'Gamemaster';

/** Same versions as the everyday test world (C:/FoundryTest/data/Data/worlds/ai-tool-test). */
const WORLD_JSON = {
  system: 'dnd5e',
  coreVersion: '14.368',
  systemVersion: '6.0.5',
  compatibility: { minimum: '14', verified: '14' },
  description: '<p>Test kit world. Rebuilt by the kit; never a real campaign.</p>',
  flags: {},
};

/**
 * Create the world folder when missing. Never touches an existing world.
 * @param {{dataDir: string, profile: {world: string, title: string}, log?: (m: string) => void}} o
 * @returns {{created: boolean, path: string}}
 */
export function initWorld({ dataDir, profile, log = () => {} }) {
  const world = profile.world;
  if (!KIT_WORLDS.includes(world)) {
    throw new EnvError(`REFUSED: "${world}" is not a kit world (${KIT_WORLDS.join(', ')}).`);
  }
  const dir = path.join(dataDir, 'Data', 'worlds', world);
  if (existsSync(dir)) {
    log(`world folder exists: ${dir}`);
    return { created: false, path: dir };
  }
  if (!existsSync(path.join(dataDir, 'Data', 'worlds'))) {
    throw new EnvError(`No Foundry data folder at ${dataDir} (Data/worlds is missing).`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'world.json'),
    JSON.stringify({ id: world, title: profile.title, ...WORLD_JSON }, null, 2) + '\n'
  );
  log(`created world folder: ${dir}`);
  return { created: true, path: dir };
}

/**
 * Provision the running kit world. Idempotent: a second run changes nothing.
 * @param {{foundryUrl: string, world: string, modules?: string[], log?: (m: string) => void}} o
 *   `modules`: the profile's modules; they and the modules they require are enabled with the bridge
 * @returns {Promise<{changed: string[], users: string[], bridgeUser: string, modules: string[]}>}
 */
export async function provisionWorld({ foundryUrl, world, modules = [], log = () => {} }) {
  await assertKitWorld(foundryUrl, world);
  const browser = await launchBrowser();
  const { page } = browser;
  collectErrors(page);
  const changed = [];
  try {
    // A fresh world's Gamemaster has no password; once the kit GM exists, join as it instead.
    const joinAs = async user => {
      await joinGame(page, { foundryUrl, user, joinTimeoutMs: 15000 });
    };
    let hasKitGm = false;
    try {
      await joinAs(KIT_GM_USER);
      hasKitGm = true;
    } catch {
      await joinAs(DEFAULT_GM);
    }
    log(`joined as ${hasKitGm ? KIT_GM_USER : DEFAULT_GM}`);

    // The bridge, the profile's modules and whatever those require (module.json relationships).
    const wanted = await page.evaluate(
      async ({ id, extra }) => {
        const want = new Set([id, ...extra]);
        const queue = [...want];
        while (queue.length) {
          const next = queue.pop();
          const mod = game.modules.get(next);
          if (!mod) throw new Error(`module "${next}" is not installed on this Foundry`);
          for (const rel of mod.relationships?.requires ?? []) {
            if (rel.type && rel.type !== 'module') continue;
            if (!want.has(rel.id)) {
              want.add(rel.id);
              queue.push(rel.id);
            }
          }
        }
        const config = game.settings.get('core', 'moduleConfiguration') ?? {};
        const missing = [...want].filter(m => !config[m]);
        if (missing.length) {
          await game.settings.set('core', 'moduleConfiguration', {
            ...config,
            ...Object.fromEntries([...want].map(m => [m, true])),
          });
        }
        return { want: [...want], missing };
      },
      { id: MODULE_ID, extra: modules }
    );
    if (wanted.missing.length) {
      changed.push(`enabled ${wanted.missing.join(', ')}`);
      log(`enabled ${wanted.missing.join(', ')}; reloading`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGame(page, 300000);
    }

    const result = await page.evaluate(
      async ({ id, gmName, playerName, want }) => {
        for (const m of want) {
          if (!game.modules.get(m)?.active) throw new Error(`${m} is not active after enabling it`);
        }
        const done = [];
        const ensure = async (name, role) => {
          const user = game.users.getName(name);
          if (!user) {
            await User.implementation.create({ name, role, password: '' });
            done.push(`created user ${name}`);
          } else if (user.role !== role) {
            await user.update({ role });
            done.push(`set role of ${name}`);
          }
          return game.users.getName(name);
        };
        const gm = await ensure(gmName, CONST.USER_ROLES.GAMEMASTER);
        await ensure(playerName, CONST.USER_ROLES.PLAYER);
        if (game.settings.get(id, 'bridgeUserId') !== gm.id) {
          await game.settings.set(id, 'bridgeUserId', gm.id);
          done.push('set the bridge user');
        }
        return {
          done,
          bridgeUser: game.users.get(game.settings.get(id, 'bridgeUserId'))?.name ?? '',
          users: game.users.map(u => `${u.name} (role ${u.role})`),
        };
      },
      { id: MODULE_ID, gmName: KIT_GM_USER, playerName: KIT_PLAYER_USER, want: wanted.want }
    );
    changed.push(...result.done);
    if (result.bridgeUser !== KIT_GM_USER) throw new Error('the bridge user setting did not stick');
    log(`users: ${result.users.join(', ')}; bridge user: ${result.bridgeUser}`);
    return { changed, users: result.users, bridgeUser: result.bridgeUser, modules: wanted.want };
  } finally {
    await browser.close();
  }
}

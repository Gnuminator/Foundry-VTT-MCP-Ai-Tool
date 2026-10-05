/**
 * The kit's own world: create its folder (world.json only; Foundry makes the databases on first
 * launch) and provision it once it runs (module on, kit users, bridge user). Never deletes
 * anything and refuses worlds that are not in KIT_WORLDS.
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
  title: 'AI Tool Kit (SRD)',
  system: 'dnd5e',
  coreVersion: '14.368',
  systemVersion: '6.0.5',
  compatibility: { minimum: '14', verified: '14' },
  description:
    '<p>Test kit world built from the SRD only. Rebuilt by the kit; never a real campaign.</p>',
  flags: {},
};

/**
 * Create the world folder when missing. Never touches an existing world.
 * @param {{dataDir: string, world: string, log?: (m: string) => void}} o
 * @returns {{created: boolean, path: string}}
 */
export function initWorld({ dataDir, world, log = () => {} }) {
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
    JSON.stringify({ id: world, ...WORLD_JSON }, null, 2) + '\n'
  );
  log(`created world folder: ${dir}`);
  return { created: true, path: dir };
}

/**
 * Provision the running kit world. Idempotent: a second run changes nothing.
 * @param {{foundryUrl: string, world: string, log?: (m: string) => void}} o
 * @returns {Promise<{changed: string[], users: string[], bridgeUser: string}>}
 */
export async function provisionWorld({ foundryUrl, world, log = () => {} }) {
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

    const enabled = await page.evaluate(async id => {
      const config = game.settings.get('core', 'moduleConfiguration') ?? {};
      const active = Object.entries(config).filter(([, on]) => on);
      if (config[id] && active.length === 1) return false;
      await game.settings.set('core', 'moduleConfiguration', { [id]: true });
      return true;
    }, MODULE_ID);
    if (enabled) {
      changed.push(`enabled ${MODULE_ID}`);
      log(`enabled ${MODULE_ID}; reloading`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGame(page);
    }

    const result = await page.evaluate(
      async ({ id, gmName, playerName }) => {
        if (!game.modules.get(id)?.active) throw new Error(`${id} is not active after enabling it`);
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
      { id: MODULE_ID, gmName: KIT_GM_USER, playerName: KIT_PLAYER_USER }
    );
    changed.push(...result.done);
    if (result.bridgeUser !== KIT_GM_USER) throw new Error('the bridge user setting did not stick');
    log(`users: ${result.users.join(', ')}; bridge user: ${result.bridgeUser}`);
    return { changed, users: result.users, bridgeUser: result.bridgeUser };
  } finally {
    await browser.close();
  }
}

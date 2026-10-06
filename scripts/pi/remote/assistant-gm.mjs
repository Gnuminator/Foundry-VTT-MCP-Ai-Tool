// The Assistant GM: a headless Chromium logged into Foundry as a dedicated user, so the
// foundry-mcp-bridge module (which runs in a GM's browser) keeps its link to the bridge with no
// human GM online. Installed by stage 5 (scripts/pi/remote/5-tool.sh) and run by the
// foundry-ai-tool-gm-browser service as the foundry user.
//
//   node assistant-gm.mjs run        join and stay; exits on trouble so systemd restarts it
//   node assistant-gm.mjs provision  one time, in a fresh world: enable the module, create the
//                                    Assistant GM user and make it the bridge user
//
// Environment: TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL, CHROMIUM,
// GM_BROWSER_PROFILE, ASSISTANT_GM_USER, ASSISTANT_GM_PASSWORD; provision also reads
// PROVISION_GM_USER, PROVISION_GM_PASSWORD (empty for a fresh world's Gamemaster) and
// PROVISION_GM_NEW_PASSWORD (set on that user afterwards). Passwords are never printed.

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const require = createRequire(join(env('TOOL_APP'), 'package.json'));
const { chromium } = require('playwright-core');

const FOUNDRY_URL = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
const MODULE_ID = 'foundry-mcp-bridge';
const ASSISTANT_ROLE = 3; // CONST.USER_ROLES.ASSISTANT: a GM, but the human GM stays the primary GM
const CHECK_EVERY_MS = 60_000;
const WAIT_FOR_WORLD_MS = 30_000;

const log = msg => console.log(`[assistant-gm] ${msg}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(profile) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: env('CHROMIUM', '/usr/bin/chromium'),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
    viewport: { width: 1280, height: 800 },
  });
  // Even with no canvas, a paused world shows the "Game Paused" banner, whose CSS animation never
  // ends: the browser redraws it 60 times a second in software, which kept the gpu process busy
  // (measured on the PC: 15 % of a core down to 0.2 %; about 90 % on the Pi). Let every CSS
  // animation run once and stop (animationend still fires). An init script, so it also applies
  // after each reload and navigation; a constructable style sheet, so it needs no <head> yet.
  await context.addInitScript(() => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('*, *::before, *::after { animation-iteration-count: 1 !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      // an engine without adoptedStyleSheets: the CPU stays high, nothing breaks
    }
  });
  return context;
}

// True when a world is running; false while Foundry shows setup, has no active world or is down.
// /join answers 200 even with no world ("There is currently no active game session"), so the
// status is not enough: a running world's join page carries <template id="join-game">
// (Foundry draws the form from it in the browser); the error page does not.
async function worldIsActive(page) {
  try {
    const res = await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'domcontentloaded' });
    if (!res?.ok()) return false;
    const path = new URL(page.url()).pathname;
    if (path.endsWith('/game')) return true;
    return path.endsWith('/join') && (await page.locator('template#join-game').count()) > 0;
  } catch {
    return false;
  }
}

async function joinWorld(page, user, password) {
  if (new URL(page.url()).pathname.endsWith('/game')) return;
  await page.locator('#join-username').fill(user);
  await page.keyboard.press('Escape');
  await page.locator('#join-password').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: 60_000 });
}

async function waitForGame(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
}

// No map canvas in this browser: it saves the Pi's CPU, and the bridge reads documents, not the
// canvas (it falls back where it would pan or measure). A client setting, so only this browser.
async function noCanvas(page) {
  const changed = await page.evaluate(async () => {
    if (game.settings.get('core', 'noCanvas')) return false;
    await game.settings.set('core', 'noCanvas', true);
    return true;
  });
  if (changed) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGame(page);
  }
}

async function enter(page, user, password) {
  while (!(await worldIsActive(page))) {
    log(`no world is running at ${FOUNDRY_URL}; trying again in ${WAIT_FOR_WORLD_MS / 1000} s`);
    await sleep(WAIT_FOR_WORLD_MS);
  }
  await joinWorld(page, user, password);
  await waitForGame(page);
  await noCanvas(page);
}

async function run() {
  const user = env('ASSISTANT_GM_USER', 'Assistant GM');
  const context = await launch(env('GM_BROWSER_PROFILE'));
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('crash', () => {
    log('the page crashed');
    process.exit(1);
  });
  await enter(page, user, env('ASSISTANT_GM_PASSWORD'));
  const info = await page.evaluate(
    id => ({
      world: game.world.id,
      user: game.user.name,
      isGM: game.user.isGM,
      module: game.modules.get(id)?.active ?? false,
    }),
    MODULE_ID
  );
  log(
    `joined world ${info.world} as ${info.user} (GM: ${info.isGM}, module active: ${info.module})`
  );
  if (!info.module) log(`the ${MODULE_ID} module is not active in this world; enable it as a GM`);
  // Stay. Foundry sends a client back to /join when the world stops or the user is kicked;
  // exit then and let systemd start a fresh browser.
  for (;;) {
    await sleep(CHECK_EVERY_MS);
    const ok = await page
      .evaluate(() => globalThis.game?.ready === true && location.pathname.endsWith('/game'))
      .catch(() => false);
    if (!ok) {
      log('left the game (world stopped, kicked or the page broke); restarting');
      await context.close().catch(() => {});
      process.exit(1);
    }
  }
}

async function provision() {
  const gmUser = env('PROVISION_GM_USER', 'Gamemaster');
  const gmPassword = env('PROVISION_GM_PASSWORD', '');
  const gmNewPassword = env('PROVISION_GM_NEW_PASSWORD', '');
  const assistant = env('ASSISTANT_GM_USER', 'Assistant GM');
  const assistantPassword = env('ASSISTANT_GM_PASSWORD');
  // A throwaway profile, so the Gamemaster's session never lands in the Assistant GM's profile.
  const profile = mkdtempSync(join(tmpdir(), 'assistant-gm-provision-'));
  const context = await launch(profile);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    // A fresh world's Gamemaster has no password; after a first run it has the new one.
    if (!(await worldIsActive(page))) throw new Error(`no world is running at ${FOUNDRY_URL}`);
    try {
      await joinWorld(page, gmUser, gmNewPassword || gmPassword);
    } catch {
      await worldIsActive(page);
      await joinWorld(page, gmUser, gmPassword);
    }
    await waitForGame(page);

    const enabled = await page.evaluate(async id => {
      const config = game.settings.get('core', 'moduleConfiguration') ?? {};
      if (config[id]) return false;
      await game.settings.set('core', 'moduleConfiguration', { ...config, [id]: true });
      return true;
    }, MODULE_ID);
    if (enabled) {
      log(`enabled ${MODULE_ID}; reloading`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForGame(page);
    }

    const result = await page.evaluate(
      async ({ id, name, password, role, gmPassword }) => {
        if (!game.modules.get(id)?.active) throw new Error(`${id} is not active after enabling it`);
        let user = game.users.getName(name);
        if (user) await user.update({ role, password });
        else user = await User.implementation.create({ name, role, password });
        await game.settings.set(id, 'bridgeUserId', user.id);
        if (gmPassword) await game.user.update({ password: gmPassword });
        return {
          bridgeUser: game.settings.get(id, 'bridgeUserId') === user.id,
          users: game.users.map(u => `${u.name} (role ${u.role})`),
        };
      },
      {
        id: MODULE_ID,
        name: assistant,
        password: assistantPassword,
        role: ASSISTANT_ROLE,
        gmPassword: gmNewPassword,
      }
    );
    log(`module active; bridge user is ${assistant}: ${result.bridgeUser}`);
    log(`users: ${result.users.join(', ')}`);
    if (!result.bridgeUser) throw new Error('the bridge user setting did not stick');
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
const main = mode === 'run' ? run : mode === 'provision' ? provision : null;
if (!main) {
  console.error('usage: node assistant-gm.mjs run|provision');
  process.exit(2);
}
main().catch(err => {
  log(`error: ${err?.message ?? err}`);
  process.exit(1);
});

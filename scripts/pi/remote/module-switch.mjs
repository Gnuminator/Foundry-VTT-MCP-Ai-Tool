// Switch one module off or on in the running world, or read its state (stage 36, scripts/pi/remote/36-drop-ddb-importer.sh).
// A headless Chromium joins the world as its GM (the same way world-switches.mjs does) and, for MODE=off or MODE=on,
// sets that module's entry in Foundry's own `core.moduleConfiguration` world setting, then reloads the page and reads the
// entry back from the server. MODE=read changes nothing. Nothing is deleted: the module's files stay where they are.
// A second run with the same MODE changes nothing. Passwords are never printed.
//
// Environment: TOOL_APP (the built tool, for playwright-core), FOUNDRY_URL (default http://127.0.0.1:30000),
// CHROMIUM (default /usr/bin/chromium), GM_USER, GM_PASSWORD, WORLD (the world id that must be running),
// MODULE_ID (the module), MODE (read, off or on).

import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const log = msg => console.log(`[module-switch] ${msg}`);
const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

export const MODES = ['read', 'off', 'on'];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

// Runs in the browser: what Foundry knows about the module right now.
export function readState({ id }) {
  const mod = game.modules.get(id);
  let configured = null;
  try {
    const cfg = game.settings.get('core', 'moduleConfiguration') ?? {};
    configured = id in cfg ? cfg[id] === true : null;
  } catch {
    configured = null;
  }
  return {
    world: game.world.id,
    user: game.user.name,
    isGM: game.user.isGM,
    installed: Boolean(mod),
    active: mod?.active === true,
    configured,
  };
}

// Runs in the browser: sets only this module's entry, leaving every other module's entry as it is.
export async function applyState({ id, enabled }) {
  const cfg = foundry.utils.deepClone(game.settings.get('core', 'moduleConfiguration') ?? {});
  if (cfg[id] === enabled) return false;
  cfg[id] = enabled;
  await game.settings.set('core', 'moduleConfiguration', cfg);
  return true;
}

// The problems that stop a change, as plain sentences.
export function blockers(state, world, id) {
  const problems = [];
  if (state.world !== world) problems.push(`joined world ${state.world}, expected ${world}`);
  if (!state.isGM) problems.push(`${state.user} is not a GM`);
  if (!state.installed) problems.push(`module ${id} is not installed in this world`);
  return problems;
}

// What the setting must look like at the end of MODE=off or MODE=on.
export function mismatch(after, enabled) {
  return after.configured === enabled
    ? null
    : `core.moduleConfiguration says ${JSON.stringify(after.configured)} for the module, expected ${enabled}`;
}

// Foundry 14.368 types the user name into a text field; 14.369 picks it from a list (same as world-switches.mjs).
async function typeJoinUser(page, user) {
  const name = page.locator('#join-username');
  const state = await name.evaluate((el, u) => {
    if (el.tagName !== 'SELECT') return 'input';
    const option = Array.from(el.options).find(o => o.textContent.trim() === u);
    return !option ? 'missing' : option.disabled ? 'online' : 'select';
  }, user);
  if (state === 'select') {
    await name.selectOption({ label: user });
  } else if (state === 'input') {
    await name.fill(user);
    await page.keyboard.press('Escape');
  } else {
    return state;
  }
  return 'ok';
}

async function main() {
  const mode = env('MODE');
  if (!MODES.includes(mode))
    throw new Error(`MODE must be one of ${MODES.join(', ')} (got ${mode})`);
  const id = env('MODULE_ID');
  if (!ID_RE.test(id)) throw new Error(`MODULE_ID '${id}' is not a module id`);
  const world = env('WORLD');
  const user = env('GM_USER');
  const password = env('GM_PASSWORD');
  const foundryUrl = env('FOUNDRY_URL', 'http://127.0.0.1:30000').replace(/\/$/, '');
  const require = createRequire(join(env('TOOL_APP'), 'package.json'));
  const { chromium } = require('playwright-core');

  // A throwaway profile, so the GM's session never lands in the Assistant GM's profile.
  const profile = mkdtempSync(join(tmpdir(), 'module-switch-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: env('CHROMIUM', '/usr/bin/chromium'),
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--mute-audio', '--no-first-run'],
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const res = await page.goto(`${foundryUrl}/join`, { waitUntil: 'domcontentloaded' });
    const onJoin = res?.ok() && new URL(page.url()).pathname.endsWith('/join');
    if (!onJoin || (await page.locator('template#join-game').count()) === 0) {
      throw new Error(`no world is running at ${foundryUrl}`);
    }
    const typed = await typeJoinUser(page, user);
    if (typed !== 'ok') {
      throw new Error(
        `could not join as ${user}: that user is ${typed === 'online' ? 'already online' : 'not in the world'}`
      );
    }
    await page.locator('#join-password').fill(password);
    await page.locator('button[name="join"]').click();
    await page.waitForURL(/\/game$/, { timeout: 60_000 }).catch(() => {
      throw new Error(`could not join as ${user}: wrong password, or that user is already online`);
    });
    const ready = () =>
      page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
    await ready();

    const before = await page.evaluate(readState, { id });
    log(
      `world ${before.world}, joined as ${before.user} (GM: ${before.isGM}); ${id}: installed ${before.installed}, active ${before.active}, configured ${JSON.stringify(before.configured)}`
    );
    if (mode === 'read') return;
    const problems = blockers(before, world, id);
    if (problems.length) throw new Error(problems.join('; '));

    const enabled = mode === 'on';
    const changed = await page.evaluate(applyState, { id, enabled });
    log(
      changed
        ? `${id} is now ${enabled ? 'switched on' : 'switched off'}`
        : `nothing to change (already ${mode})`
    );

    // Read back after a reload, so the check sees what the server stored and not this browser's copy.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const after = await page.evaluate(readState, { id });
    log(`after: active ${after.active}, configured ${JSON.stringify(after.configured)}`);
    const wrong = mismatch(after, enabled);
    if (wrong) throw new Error(`read-back does not match: ${wrong}`);
    log('verified');
  } finally {
    await context.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

// Run only as a script (the stage runs it with node); the tests import the functions above.
const invokedAs = (() => {
  if (!process.argv[1]) return '';
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return pathToFileURL(process.argv[1]).href;
  }
})();
if (invokedAs === import.meta.url) {
  main().catch(err => {
    log(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
}

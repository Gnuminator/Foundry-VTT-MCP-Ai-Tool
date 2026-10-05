/**
 * The GM page: a headless Edge (playwright-core, `channel: 'msedge'`, a fresh temp profile)
 * joined to the kit world as the passwordless kit GM. Scenarios and the builder run code in
 * Foundry only through it: `call(action, args)` runs the matching function from gm-actions.mjs
 * with `page.evaluate`. Console errors and page errors are collected from the first request.
 *
 * Also exports the join helpers that world.mjs reuses for provisioning a fresh world.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  GM_ACTIONS,
  KIT_FLAG_KEY,
  KIT_FLAG_SCOPE,
  KIT_GM_USER,
  KIT_WORLDS,
  LIVE_BRIDGE_PORTS,
} from './contract.mjs';
import { EnvError } from './errors.mjs';
import { GM_ACTION_FUNCTIONS } from './gm-actions.mjs';

/** The running world's id from /api/status ('' at the setup screen). */
export async function activeWorld(foundryUrl) {
  const res = await fetch(`${foundryUrl}/api/status`);
  if (!res.ok) throw new EnvError(`Foundry ${foundryUrl}: /api/status answered ${res.status}`);
  const status = await res.json();
  return typeof status.world === 'string' ? status.world : '';
}

/** Refuses live bridge ports and anything but a kit world; returns the running world check. */
export async function assertKitWorld(foundryUrl, world) {
  const port = Number(new URL(foundryUrl).port || 80);
  if (LIVE_BRIDGE_PORTS.includes(port))
    throw new EnvError(`REFUSED: port ${port} is the live bridge.`);
  if (!KIT_WORLDS.includes(world)) {
    throw new EnvError(`REFUSED: "${world}" is not a kit world (${KIT_WORLDS.join(', ')}).`);
  }
  const running = await activeWorld(foundryUrl);
  if (running !== world) {
    throw new EnvError(
      `Foundry runs world "${running || '(setup screen)'}", not "${world}"; not joining.`
    );
  }
}

/**
 * Launch a headless Edge with a throwaway profile.
 * @returns {Promise<{context: import('playwright-core').BrowserContext, page: import('playwright-core').Page, close: () => Promise<void>}>}
 */
export async function launchBrowser({ headless = true } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'kit-gm-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless,
      viewport: { width: 1440, height: 900 },
      chromiumSandbox: true,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',
        // A covered window must keep drawing, or Foundry's canvas never gets ready.
        '--disable-features=CalculateNativeWinOcclusion,Translate',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    });
  } catch (err) {
    rmSync(profile, { recursive: true, force: true });
    throw new EnvError(`Could not start Edge: ${err instanceof Error ? err.message : err}`);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    async close() {
      await context.close().catch(() => {});
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Edge may still hold the folder; the OS temp folder is cleaned up later.
      }
    },
  };
}

/**
 * Collect console errors and uncaught page errors with timestamps (a live array).
 * @param {import('playwright-core').Page} page
 * @returns {Array<{at: string, message: string, source: string}>}
 */
export function collectErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    errors.push({
      at: new Date().toISOString(),
      message: msg.text(),
      source: loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : 'console',
    });
  });
  page.on('pageerror', err => {
    errors.push({
      at: new Date().toISOString(),
      message: String(err?.stack || err),
      source: 'pageerror',
    });
  });
  return errors;
}

/**
 * Join the running world as a passwordless user and wait for `game.ready`.
 * @param {import('playwright-core').Page} page
 */
export async function joinGame(
  page,
  { foundryUrl, user, password = '', joinTimeoutMs = 30000, gameTimeoutMs = 120000 }
) {
  await page.goto(`${foundryUrl}/join`, { waitUntil: 'domcontentloaded' });
  const name = page.locator('#join-username');
  await name.waitFor({ timeout: 30000 });
  await name.fill(user);
  await page.keyboard.press('Escape'); // closes the name autocomplete
  await page.locator('#join-password').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForURL(/\/game$/, { timeout: joinTimeoutMs });
  await waitForGame(page, gameTimeoutMs);
}

/** Wait until `game.ready`. */
export async function waitForGame(page, timeoutMs = 120000) {
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
}

/**
 * Open a GM session in the kit world.
 * @param {{foundryUrl: string, world: string, user?: string, headless?: boolean, log?: (m: string) => void}} o
 * @returns {Promise<{call: (action: string, args?: object) => Promise<any>, close: () => Promise<void>, page: import('playwright-core').Page}>}
 */
export async function openGmSession({
  foundryUrl,
  world,
  user = KIT_GM_USER,
  headless = true,
  log = () => {},
}) {
  await assertKitWorld(foundryUrl, world);
  const browser = await launchBrowser({ headless });
  const errors = collectErrors(browser.page);
  try {
    log(`joining ${world} as ${user}`);
    await joinGame(browser.page, { foundryUrl, user });
    const who = await browser.page.evaluate(() => ({ isGM: game.user.isGM, name: game.user.name }));
    if (!who.isGM) throw new EnvError(`${user} joined but is not a GM.`);
    await browser.page.evaluate(() => {
      if (globalThis.game.paused) globalThis.game.togglePause(false, { broadcast: true });
    });
  } catch (err) {
    await browser.close();
    throw err;
  }
  return {
    page: browser.page,
    close: () => browser.close(),
    async call(action, args = {}) {
      if (!(action in GM_ACTIONS)) throw new Error(`Unknown GM action "${action}".`);
      if (action === GM_ACTIONS.consoleErrors) {
        // The runner passes epoch milliseconds; an ISO string works too.
        const raw = args?.since;
        const since = typeof raw === 'number' ? raw : raw ? Date.parse(raw) : 0;
        return { errors: errors.filter(e => Date.parse(e.at) >= since) };
      }
      const fn = GM_ACTION_FUNCTIONS[action];
      if (!fn) throw new Error(`GM action "${action}" has no implementation.`);
      return browser.page.evaluate(fn, {
        ...args,
        _kit: { flagScope: KIT_FLAG_SCOPE, flagKey: KIT_FLAG_KEY },
      });
    },
  };
}
